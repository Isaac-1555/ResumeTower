/**
 * Standalone IMAP Poller Server (Node.js)
 *
 * Runs outside the Supabase Edge Runtime (which has tight CPU limits) so that
 * heavy libraries like `imapflow` can operate without being killed.
 *
 * Start:  cd scripts && npm install && npm start
 * Usage:  POST http://localhost:54350/poll
 */

import http from "node:http";
import { createHash, webcrypto } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { GoogleGenAI } from "@google/genai";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PORT = Number(process.env.POLLER_PORT || 54350);

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const IMAP_SECRET_KEY = process.env.IMAP_SECRET_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_EMAILS_PER_SYNC = Number(process.env.MAX_EMAILS_PER_SYNC || 50);
const MAX_LINKS_PER_EMAIL = Number(process.env.MAX_LINKS_PER_EMAIL || 20);
const MAX_EMAIL_TEXT_CHARS = Number(process.env.MAX_EMAIL_TEXT_CHARS || 24000);
const MAX_DESCRIPTION_CHARS = Number(process.env.MAX_DESCRIPTION_CHARS || 8000);
const IMAP_SOCKET_TIMEOUT_MS = Number(process.env.IMAP_SOCKET_TIMEOUT_MS || 60000);
const IMAP_GREETING_TIMEOUT_MS = Number(process.env.IMAP_GREETING_TIMEOUT_MS || 15000);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 180000);

const DEFAULT_KEYWORDS = ["job", "hiring", "application"];
let pollRunning = false;
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    opportunities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          job_title: { type: "string" },
          company: { type: "string" },
          location: { type: "string" },
          description: { type: "string" },
          required_skills: {
            type: "array",
            items: { type: "string" },
          },
          posting_url: { type: "string" },
          apply_url: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["job_title"],
      },
    },
  },
  required: ["opportunities"],
};

const ENRICHMENT_SCHEMA = {
  type: "object",
  properties: {
    job_title: { type: "string" },
    company: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
    required_skills: {
      type: "array",
      items: { type: "string" },
    },
    posting_url: { type: "string" },
    apply_url: { type: "string" },
    confidence: { type: "number" },
  },
};

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    resume_json: {
      type: "object",
      additionalProperties: true,
    },
    highlighted_keywords: {
      type: "array",
      items: { type: "string" },
    },
    rationale: { type: "string" },
  },
  required: ["resume_json"],
};

// ---------------------------------------------------------------------------
// Crypto helpers (mirrors save-integration edge function)
// ---------------------------------------------------------------------------
const subtle = webcrypto.subtle;

async function getKey() {
  const secret = IMAP_SECRET_KEY;
  if (!secret) throw new Error("IMAP_SECRET_KEY is not set – pass it via env");
  return subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.padEnd(32).slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function decrypt(encryptedB64, ivB64) {
  const key = await getKey();
  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}
function normalizeString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeUrl(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeStringArray(values, max = 40) {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  for (const value of values) {
    const normalized = normalizeString(String(value).toLowerCase());
    if (!normalized) continue;
    unique.add(normalized);
    if (unique.size >= max) break;
  }
  return [...unique];
}

function extractLinksFromHtml(html) {
  if (!html) return [];
  const links = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;

  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const url = normalizeUrl(match[1]);
    if (!url) continue;
    const text = normalizeString(
      String(match[2] || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "),
      "",
    );
    links.push({ url, text });
  }

  return links;
}

function extractLinksFromText(text) {
  if (!text) return [];
  const links = [];
  const urlRegex = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = normalizeUrl(match[0]);
    if (!url) continue;
    links.push({ url, text: "" });
  }
  return links;
}

function dedupeLinks(links, maxLinks = MAX_LINKS_PER_EMAIL) {
  const byUrl = new Map();
  for (const link of links) {
    const url = normalizeUrl(link?.url);
    if (!url) continue;
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        text: normalizeString(link?.text, ""),
      });
    }
    if (byUrl.size >= maxLinks) break;
  }
  return [...byUrl.values()];
}

function truncate(text, maxChars) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function serializeError(err) {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}

async function parseMessage(sourceBuffer, message) {
  const parsed = await simpleParser(sourceBuffer, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
  });

  const subject = normalizeString(parsed.subject || message.envelope?.subject, "(No Subject)");
  const from =
    normalizeString(parsed.from?.text, "") ||
    normalizeString(message.envelope?.from?.[0]?.name, "") ||
    normalizeString(message.envelope?.from?.[0]?.address, "(Unknown)");
  const receivedAt = parsed.date || message.envelope?.date || null;
  const messageId =
    normalizeString(parsed.messageId, "") ||
    normalizeString(message.envelope?.messageId, "") ||
    `imap-${message.uid}`;

  const textBody = normalizeString(parsed.text || "", "");
  const htmlBody = typeof parsed.html === "string" ? parsed.html : "";
  const links = dedupeLinks([
    ...extractLinksFromHtml(htmlBody),
    ...extractLinksFromText(textBody),
  ]);

  return {
    messageId,
    subject,
    from,
    receivedAt,
    textBody,
    htmlBody,
    links,
  };
}

function keywordMatch({ subject, textBody }, keywords, matchInBody) {
  const subjectLower = subject.toLowerCase();
  if (keywords.some((keyword) => subjectLower.includes(keyword))) return true;
  if (!matchInBody) return false;
  const bodyLower = textBody.toLowerCase();
  return keywords.some((keyword) => bodyLower.includes(keyword));
}

async function generateStructuredJson({ prompt, schema, tools }) {
  if (!ai) throw new Error("GEMINI_API_KEY is not set");
  const config = {
    responseMimeType: "application/json",
    responseJsonSchema: schema,
  };
  if (tools?.length) config.tools = tools;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config,
  });

  let text = normalizeString(response.text, "");
  if (!text) {
    const candidateText = response.candidates?.[0]?.content?.parts
      ?.map((part) => normalizeString(part?.text, ""))
      .filter(Boolean)
      .join("\n");
    text = normalizeString(candidateText, "");
  }
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini returned invalid JSON: ${serializeError(err)}`);
  }

  return { parsed, response, responseText: text };
}

function buildFallbackOpportunity({ messageId, subject, from, textBody, links }) {
  return [
    {
      job_title: subject,
      company: normalizeString(from.split("<")[0], from),
      location: "Unknown",
      description: truncate(textBody, MAX_DESCRIPTION_CHARS),
      required_skills: [],
      posting_url: links[0]?.url || null,
      apply_url: links[0]?.url || null,
      confidence: 0.35,
      raw: {
        fallback: true,
        email_id: messageId,
      },
    },
  ];
}

async function extractOpportunitiesFromEmail(emailContext) {
  if (!ai) return buildFallbackOpportunity(emailContext);

  const prompt = [
    "Extract ALL distinct job opportunities from this email payload.",
    "One email can contain multiple jobs. Return one array item per distinct job.",
    "Prefer explicit apply links, then posting links. Keep skill names concise.",
    "If a field is missing, omit it or return an empty string.",
    "",
    "EMAIL_PAYLOAD_JSON:",
    JSON.stringify(
      {
        subject: emailContext.subject,
        from: emailContext.from,
        received_at: emailContext.receivedAt ? new Date(emailContext.receivedAt).toISOString() : null,
        text_body: truncate(emailContext.textBody, MAX_EMAIL_TEXT_CHARS),
        html_body_text: truncate(
          normalizeString(emailContext.htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), ""),
          MAX_EMAIL_TEXT_CHARS,
        ),
        links: emailContext.links.slice(0, MAX_LINKS_PER_EMAIL),
      },
      null,
      2,
    ),
  ].join("\n");

  try {
    const { parsed, responseText } = await generateStructuredJson({
      prompt,
      schema: EXTRACTION_SCHEMA,
    });

    const opportunities = Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];
    const cleaned = opportunities
      .map((opportunity) => ({
        job_title: normalizeString(opportunity?.job_title, emailContext.subject),
        company: normalizeString(opportunity?.company, normalizeString(emailContext.from.split("<")[0], emailContext.from)),
        location: normalizeString(opportunity?.location, "Unknown"),
        description: truncate(
          normalizeString(opportunity?.description, emailContext.textBody || emailContext.subject),
          MAX_DESCRIPTION_CHARS,
        ),
        required_skills: normalizeStringArray(opportunity?.required_skills, 50),
        posting_url: normalizeUrl(opportunity?.posting_url),
        apply_url: normalizeUrl(opportunity?.apply_url),
        confidence:
          typeof opportunity?.confidence === "number"
            ? Math.max(0, Math.min(1, opportunity.confidence))
            : null,
        raw: opportunity,
      }))
      .filter(
        (opportunity) =>
          normalizeString(opportunity.job_title) ||
          normalizeString(opportunity.description) ||
          opportunity.apply_url ||
          opportunity.posting_url,
      );

    if (cleaned.length > 0) return cleaned;

    return buildFallbackOpportunity({
      ...emailContext,
      links: emailContext.links,
    }).map((item) => ({
      ...item,
      raw: {
        ...item.raw,
        extraction_response: responseText,
      },
    }));
  } catch (err) {
    return buildFallbackOpportunity({
      ...emailContext,
      links: emailContext.links,
    }).map((item) => ({
      ...item,
      raw: {
        ...item.raw,
        extraction_error: serializeError(err),
      },
    }));
  }
}

async function enrichOpportunityWithUrls(opportunity, emailLinks) {
  if (!ai) {
    return {
      ...opportunity,
      enrichment_status: "skipped_no_gemini",
      enrichment_error: null,
      url_context_metadata: null,
    };
  }

  const candidateUrls = dedupeLinks([
    { url: opportunity.apply_url || "", text: "apply_url" },
    { url: opportunity.posting_url || "", text: "posting_url" },
    ...emailLinks.map((link) => ({ url: link.url, text: link.text || "" })),
  ]).map((link) => link.url);

  if (candidateUrls.length === 0) {
    return {
      ...opportunity,
      enrichment_status: "skipped_no_urls",
      enrichment_error: null,
      url_context_metadata: null,
    };
  }

  const prompt = [
    "Given this candidate job opportunity and URL list, use URL context to enrich the role.",
    "Return the best posting_url, apply_url, clean job_title/company/location, detailed description, and required_skills.",
    "",
    "CANDIDATE_JOB_JSON:",
    JSON.stringify(opportunity, null, 2),
    "",
    "URLS:",
    JSON.stringify(candidateUrls.slice(0, MAX_LINKS_PER_EMAIL), null, 2),
  ].join("\n");

  try {
    const { parsed, response } = await generateStructuredJson({
      prompt,
      schema: ENRICHMENT_SCHEMA,
      tools: [{ urlContext: {} }],
    });

    return {
      ...opportunity,
      job_title: normalizeString(parsed?.job_title, opportunity.job_title),
      company: normalizeString(parsed?.company, opportunity.company),
      location: normalizeString(parsed?.location, opportunity.location),
      description: truncate(
        normalizeString(parsed?.description, opportunity.description),
        MAX_DESCRIPTION_CHARS,
      ),
      required_skills: (() => {
        const merged = [
          ...normalizeStringArray(opportunity.required_skills, 60),
          ...normalizeStringArray(parsed?.required_skills, 60),
        ];
        return normalizeStringArray(merged, 60);
      })(),
      posting_url: normalizeUrl(parsed?.posting_url) || opportunity.posting_url || null,
      apply_url: normalizeUrl(parsed?.apply_url) || opportunity.apply_url || normalizeUrl(parsed?.posting_url) || opportunity.posting_url || null,
      confidence:
        typeof parsed?.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : opportunity.confidence,
      enrichment_status: "enriched",
      enrichment_error: null,
      url_context_metadata: response?.candidates?.[0]?.urlContextMetadata || null,
    };
  } catch (err) {
    return {
      ...opportunity,
      enrichment_status: "error",
      enrichment_error: serializeError(err),
      url_context_metadata: null,
    };
  }
}

async function fetchBaseProfile(supabase, userId) {
  const { data, error } = await supabase
    .from("base_profile")
    .select("profile_json")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (data?.profile_json && typeof data.profile_json === "object") {
    return data.profile_json;
  }

  return {
    personal_info: {
      name: "Candidate",
      email: "candidate@example.com",
      phone: "",
    },
    skills: [],
    experience: [],
    education: [],
  };
}

async function generateTailoredResume(baseProfile, opportunity) {
  if (!ai) {
    return {
      resume_json: baseProfile,
      highlighted_keywords: normalizeStringArray(opportunity.required_skills || [], 30),
      rationale: "Gemini is disabled; using base profile as fallback.",
      generation_error: "GEMINI_API_KEY is not set",
    };
  }

  const prompt = [
    "Create a tailored resume JSON for this job using the base profile.",
    "Constraints:",
    "- Keep the same high-level structure as the base profile whenever possible.",
    "- Tailor ordering and bullet emphasis to job requirements.",
    "- Do not fabricate employers, dates, or credentials not in base profile.",
    "- Keep output concise and recruiter-friendly.",
    "",
    "BASE_PROFILE_JSON:",
    JSON.stringify(baseProfile, null, 2),
    "",
    "JOB_JSON:",
    JSON.stringify(
      {
        job_title: opportunity.job_title,
        company: opportunity.company,
        location: opportunity.location,
        description: opportunity.description,
        required_skills: opportunity.required_skills,
      },
      null,
      2,
    ),
  ].join("\n");

  try {
    const { parsed } = await generateStructuredJson({
      prompt,
      schema: RESUME_SCHEMA,
    });

    if (!parsed?.resume_json || typeof parsed.resume_json !== "object") {
      throw new Error("Missing resume_json in Gemini response");
    }

    return {
      resume_json: parsed.resume_json,
      highlighted_keywords: normalizeStringArray(parsed?.highlighted_keywords, 40),
      rationale: normalizeString(parsed?.rationale, ""),
      generation_error: null,
    };
  } catch (err) {
    return {
      resume_json: baseProfile,
      highlighted_keywords: normalizeStringArray(opportunity.required_skills || [], 30),
      rationale: "Fallback to base profile due to resume generation error.",
      generation_error: serializeError(err),
    };
  }
}

function writeObjectAsLines(prefix, value, lines, depth = 0) {
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    lines.push(`${indent}${prefix}:`);
    for (const item of value) {
      if (item && typeof item === "object") {
        lines.push(`${indent}  -`);
        writeObjectAsLines("", item, lines, depth + 2);
      } else {
        lines.push(`${indent}  - ${String(item)}`);
      }
    }
    return;
  }

  if (value && typeof value === "object") {
    if (prefix) lines.push(`${indent}${prefix}:`);
    for (const [childKey, childValue] of Object.entries(value)) {
      writeObjectAsLines(childKey, childValue, lines, depth + (prefix ? 1 : 0));
    }
    return;
  }

  if (prefix) {
    lines.push(`${indent}${prefix}: ${String(value ?? "")}`);
  } else if (value !== undefined && value !== null) {
    lines.push(`${indent}${String(value)}`);
  }
}

async function renderResumePdf(opportunity, resumeJson) {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([612, 792]);
  const margin = 44;
  const maxWidth = page.getWidth() - margin * 2;
  const lineHeight = 15;
  let y = page.getHeight() - margin;

  const wrapText = (text, font, size) => {
    const clean = normalizeString(String(text).replace(/\s+/g, " "), "");
    if (!clean) return [];
    const words = clean.split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const ensureLines = (lineCount = 1) => {
    if (y - lineCount * lineHeight >= margin) return;
    page = pdfDoc.addPage([612, 792]);
    y = page.getHeight() - margin;
  };

  const drawWrappedLine = (text, { size = 11, bold = false } = {}) => {
    const font = bold ? boldFont : regularFont;
    const wrapped = wrapText(text, font, size);
    if (wrapped.length === 0) {
      ensureLines(1);
      y -= lineHeight;
      return;
    }
    ensureLines(wrapped.length);
    for (const line of wrapped) {
      page.drawText(line, {
        x: margin,
        y,
        size,
        font,
      });
      y -= lineHeight;
    }
  };

  drawWrappedLine(opportunity.job_title || "Tailored Resume", { size: 18, bold: true });
  drawWrappedLine(`${opportunity.company || ""}${opportunity.location ? ` • ${opportunity.location}` : ""}`, {
    size: 11,
  });
  y -= 6;

  const lines = [];
  writeObjectAsLines("resume", resumeJson, lines);
  for (const line of lines) {
    drawWrappedLine(line, { size: 10, bold: false });
  }

  return pdfDoc.save();
}

async function uploadResumePdf(supabase, userId, jobId, pdfBytes) {
  const objectPath = `${userId}/${jobId}/resume-${Date.now()}.pdf`;
  const { error } = await supabase.storage
    .from("resumes")
    .upload(objectPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from("resumes").getPublicUrl(objectPath);
  return data.publicUrl;
}

function buildJobFingerprint(emailId, opportunity) {
  const descriptor = [
    normalizeString(emailId, ""),
    normalizeString(opportunity.job_title, "").toLowerCase(),
    normalizeString(opportunity.company, "").toLowerCase(),
    normalizeUrl(opportunity.apply_url) ||
      normalizeUrl(opportunity.posting_url) ||
      normalizeString(opportunity.description, "").toLowerCase().slice(0, 320),
  ].join("|");
  return createHash("sha256").update(descriptor).digest("hex");
}

// ---------------------------------------------------------------------------
// IMAP helpers for short-lived connections
// ---------------------------------------------------------------------------
async function createImapClient(imapHost, imapPort, imapUser, password) {
  const client = new ImapFlow({
    host: imapHost,
    port: imapPort || 993,
    secure: true,
    auth: { user: imapUser, pass: password },
    logger: false,
    disableAutoIdle: true,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
  });
  client.on("error", (imapErr) => {
    console.error(`IMAP client error:`, imapErr?.message || imapErr);
  });
  return client;
}

async function closeImapClient(client) {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Fetch all unread messages (short IMAP connection)
// ---------------------------------------------------------------------------
async function imapFetchUnread(imapHost, imapPort, imapUser, password) {
  const client = await createImapClient(imapHost, imapPort, imapUser, password);
  const fetched = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = await client.search({ seen: false }, { uid: true });
      const uids = allUids.slice(-MAX_EMAILS_PER_SYNC);
      console.log(`  Found ${allUids.length} unread message(s), fetching newest ${uids.length}.`);

      for (const uid of uids) {
        for await (const message of client.fetch(uid, {
          uid: true,
          envelope: true,
          source: true,
        }, { uid: true })) {
          if (!message.source) continue;
          const sourceBuffer = Buffer.isBuffer(message.source)
            ? message.source
            : Buffer.from(message.source);
          fetched.push({ uid: message.uid, envelope: message.envelope, sourceBuffer });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await closeImapClient(client);
  }

  return fetched;
}

// ---------------------------------------------------------------------------
// Phase 3: Mark messages as read (short IMAP connection)
// ---------------------------------------------------------------------------
async function imapMarkAsRead(imapHost, imapPort, imapUser, password, uidsToMark) {
  if (uidsToMark.length === 0) return;

  const client = await createImapClient(imapHost, imapPort, imapUser, password);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const uid of uidsToMark) {
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await closeImapClient(client);
  }
}

// ---------------------------------------------------------------------------
// Poll handler
// ---------------------------------------------------------------------------
async function handlePoll() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("Polling IMAP for new jobs...");
  const processedJobs = [];
  const errors = [];
  const stats = {
    integrationsFound: 0,
    emailsScanned: 0,
    emailsKeywordMatched: 0,
    opportunitiesExtracted: 0,
    jobsInserted: 0,
    duplicateJobs: 0,
    resumesGenerated: 0,
    resumesFailed: 0,
  };

  const { data: integrations, error: intError } = await supabase
    .from("user_integrations")
    .select("*")
    .not("imap_host", "is", null)
    .not("imap_user", "is", null)
    .not("imap_password_encrypted", "is", null);

  if (intError) throw intError;
  if (!integrations || integrations.length === 0) {
    return {
      status: 200,
      body: { message: "No integrations found", jobs: [], errors: [], stats },
    };
  }
  stats.integrationsFound = integrations.length;

  console.log(`Found ${integrations.length} integration(s).`);
  if (!ai) {
    console.warn("GEMINI_API_KEY is not set. Falling back to non-LLM extraction and base-profile resumes.");
  }

  for (const integration of integrations) {
    const {
      user_id,
      imap_host,
      imap_port,
      imap_user,
      imap_password_encrypted,
      encryption_iv,
      job_keywords,
      keyword_match_scope,
    } = integration;

    const keywords = Array.isArray(job_keywords) && job_keywords.length > 0
      ? [...new Set(job_keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean))]
      : DEFAULT_KEYWORDS;
    const matchInBody = keyword_match_scope === "subject_or_body";

    try {
      const password = await decrypt(imap_password_encrypted, encryption_iv);
      const baseProfile = await fetchBaseProfile(supabase, user_id);

      // --- Phase 1: Fetch all unread messages (short IMAP connection) ---
      console.log(`  Phase 1: Fetching unread emails from ${imap_host}...`);
      const rawMessages = await imapFetchUnread(imap_host, imap_port, imap_user, password);
      stats.emailsScanned += rawMessages.length;
      console.log(`  Phase 1 done: fetched ${rawMessages.length} message(s). IMAP connection closed.`);

      // --- Phase 2: Process messages offline (no IMAP connection) ---
      console.log(`  Phase 2: Processing messages...`);
      const uidsToMark = [];

      for (const raw of rawMessages) {
        let emailContext;
        try {
          emailContext = await parseMessage(raw.sourceBuffer, { uid: raw.uid, envelope: raw.envelope });
        } catch (err) {
          errors.push(`Failed to parse message UID ${raw.uid}: ${serializeError(err)}`);
          continue;
        }

        const matches = keywordMatch(emailContext, keywords, matchInBody);
        if (!matches) continue;
        stats.emailsKeywordMatched += 1;

        const opportunities = await extractOpportunitiesFromEmail(emailContext);
        stats.opportunitiesExtracted += opportunities.length;
        let messagePersisted = false;

        for (const extracted of opportunities) {
          const enriched = await enrichOpportunityWithUrls(extracted, emailContext.links);
          const primaryUrl = enriched.apply_url || enriched.posting_url || emailContext.links[0]?.url || null;
          const fingerprint = buildJobFingerprint(emailContext.messageId, enriched);

          const { data: existingJob, error: existingError } = await supabase
            .from("jobs")
            .select("id")
            .eq("user_id", user_id)
            .eq("email_id", emailContext.messageId)
            .eq("job_fingerprint", fingerprint)
            .maybeSingle();

          if (existingError) {
            errors.push(`Existing-job check failed for "${enriched.job_title}": ${serializeError(existingError)}`);
            continue;
          }
          if (existingJob) {
            stats.duplicateJobs += 1;
            messagePersisted = true;
            continue;
          }

          const jobData = {
            email_id: emailContext.messageId,
            user_id,
            job_fingerprint: fingerprint,
            job_title: normalizeString(enriched.job_title, emailContext.subject),
            company: normalizeString(
              enriched.company,
              normalizeString(emailContext.from.split("<")[0], emailContext.from),
            ),
            location: normalizeString(enriched.location, "Unknown"),
            description: truncate(
              normalizeString(enriched.description, emailContext.textBody || emailContext.subject),
              MAX_DESCRIPTION_CHARS,
            ),
            job_link: primaryUrl || `imap://${imap_host}/INBOX/${raw.uid}`,
            posting_url: enriched.posting_url || primaryUrl,
            apply_url: enriched.apply_url || primaryUrl,
            source_subject: emailContext.subject,
            source_from: emailContext.from,
            source_received_at: emailContext.receivedAt,
            source_message_uid: raw.uid,
            source_links: emailContext.links,
            status: "prepared",
            extracted_skills: normalizeStringArray(enriched.required_skills, 60),
            extraction_model: GEMINI_MODEL,
            extraction_confidence: enriched.confidence,
            extraction_raw: {
              extraction: extracted.raw || null,
              enrichment_status: enriched.enrichment_status || null,
              enrichment_error: enriched.enrichment_error || null,
              url_context_metadata: enriched.url_context_metadata || null,
            },
            parse_status:
              enriched.enrichment_status === "error"
                ? "partial"
                : "parsed",
            parse_error: enriched.enrichment_error || null,
          };

          const { data: insertedJob, error: insertError } = await supabase
            .from("jobs")
            .insert(jobData)
            .select()
            .single();

          if (insertError) {
            errors.push(`Job insert failed for "${jobData.job_title}": ${serializeError(insertError)}`);
            continue;
          }

          stats.jobsInserted += 1;
          processedJobs.push(insertedJob);
          messagePersisted = true;

          try {
            const resumeGeneration = await generateTailoredResume(baseProfile, {
              ...enriched,
              ...insertedJob,
            });
            const pdfBytes = await renderResumePdf(
              {
                job_title: insertedJob.job_title,
                company: insertedJob.company,
                location: insertedJob.location,
              },
              resumeGeneration.resume_json,
            );
            const resumePdfUrl = await uploadResumePdf(
              supabase,
              user_id,
              insertedJob.id,
              pdfBytes,
            );

            const { error: resumeInsertError } = await supabase
              .from("resumes")
              .insert({
                job_id: insertedJob.id,
                user_id,
                resume_json: resumeGeneration.resume_json,
                resume_pdf_url: resumePdfUrl,
              });

            if (resumeInsertError) {
              throw resumeInsertError;
            }
            stats.resumesGenerated += 1;
          } catch (resumeErr) {
            stats.resumesFailed += 1;
            errors.push(
              `Resume generation failed for "${jobData.job_title}": ${serializeError(resumeErr)}`,
            );
          }
        }

        if (messagePersisted) {
          uidsToMark.push(raw.uid);
        }
      }
      console.log(`  Phase 2 done: ${stats.jobsInserted} job(s) inserted, ${uidsToMark.length} message(s) to mark read.`);

      // --- Phase 3: Mark processed messages as read (short IMAP connection) ---
      if (uidsToMark.length > 0) {
        console.log(`  Phase 3: Marking ${uidsToMark.length} message(s) as read...`);
        try {
          await imapMarkAsRead(imap_host, imap_port, imap_user, password, uidsToMark);
          console.log(`  Phase 3 done.`);
        } catch (markErr) {
          errors.push(`Failed to mark messages as read: ${serializeError(markErr)}`);
        }
      }
    } catch (err) {
      console.error(`Error processing user ${user_id}:`, err);
      if (err?.authenticationFailed) {
        errors.push(
          "IMAP authentication failed. If using Gmail, make sure you are using a Google App Password (not your regular password). Generate one at https://myaccount.google.com/apppasswords",
        );
      } else {
        errors.push(err?.message || String(err));
      }
    }
  }

  console.log(
    `Done. Imported ${processedJobs.length} job(s), ${errors.length} error(s).`,
  );
  return {
    status: 200,
    body: { message: "Polled successfully", jobs: processedJobs, errors, stats },
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, pollRunning }));
  }

  if (url.pathname === "/poll" && req.method === "POST") {
    if (pollRunning) {
      res.writeHead(409, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "A sync is already in progress. Please wait for it to finish." }));
    }

    pollRunning = true;
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Poll timed out — the IMAP server may be unreachable or slow. Check your IMAP host/port/credentials.")), POLL_TIMEOUT_MS),
      );
      const result = await Promise.race([handlePoll(), timeout]);
      res.writeHead(result.status, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.body));
    } catch (err) {
      console.error("Poll error:", err);
      res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    } finally {
      pollRunning = false;
    }
  }

  res.writeHead(404, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`IMAP poller server listening on http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/poll`);
});
