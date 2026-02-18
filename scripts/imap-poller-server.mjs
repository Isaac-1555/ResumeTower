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
import { jsPDF } from "jspdf";

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

const DEFAULT_KEYWORDS = ["Indeed", "linkedin", "glassdoor"];
let pollStats = {
  running: false,
  integrationsFound: 0,
  emailsScanned: 0,
  emailsKeywordMatched: 0,
  opportunitiesExtracted: 0,
  jobsInserted: 0,
  duplicateJobs: 0,
  resumesGenerated: 0,
  resumesFailed: 0,
  errors: [],
};

function resetStats() {
  pollStats = {
    running: true,
    integrationsFound: 0,
    emailsScanned: 0,
    emailsKeywordMatched: 0,
    opportunitiesExtracted: 0,
    jobsInserted: 0,
    duplicateJobs: 0,
    resumesGenerated: 0,
    resumesFailed: 0,
    errors: [],
  };
}

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
    name: { type: "string" },
    contact: { type: "string" },
    summary: { type: "string" },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string" },
          period: { type: "string" },
          points: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["title", "company"],
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          degree: { type: "string" },
          school: { type: "string" },
          year: { type: "string" },
          location: { type: "string" },
        },
      },
    },
    skills: {
      type: "array",
      items: { type: "string" },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          issuer: { type: "string" },
          year: { type: "string" },
        },
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          link: { type: "string" },
        },
      },
    },
  },
  required: ["name", "contact"],
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
      resume_json: {
        name: baseProfile.personal_info?.name || "Candidate",
        contact: baseProfile.personal_info?.email || "",
        summary: "Gemini disabled - using base profile fallback",
        experience: [],
        education: [],
        skills: baseProfile.skills || [],
        certifications: [],
        projects: [],
      },
      highlighted_keywords: [],
      rationale: "Gemini is disabled; using base profile as fallback.",
      generation_error: "GEMINI_API_KEY is not set",
    };
  }

  const styleGuide =
    "Use a 'Professional' style: Clean, balanced whitespace, professional summary at top, clear section headings, standard corporate formatting. Focus on leadership and clarity.";

  const prompt = `
    You are an expert Resume Writer.
    
    MY PROFILE:
    ${JSON.stringify(baseProfile, null, 2)}

    JOB DESCRIPTION (extracted text):
    Title: ${opportunity.job_title}
    Company: ${opportunity.company}
    Description: ${opportunity.description}
    Skills: ${opportunity.required_skills?.join(", ")}

    TASK:
    Write a tailored resume for this job description based on my profile.
    ${styleGuide}
    
    IMPORTANT: 
    - Output strictly valid JSON.
    - Schema:
    {
      "name": "String (My Name)",
      "contact": "String (Phone | Email | LinkedIn | Location)",
      "summary": "String (Professional Summary - keep it concise)",
      "experience": [
        { 
          "title": "String", 
          "company": "String", 
          "location": "String",
          "period": "String", 
          "points": ["String", "String"] 
        }
      ],
      "education": [
         { "degree": "String", "school": "String", "year": "String", "location": "String" }
      ],
      "skills": ["String", "String"],
      "certifications": [
        { "name": "String", "issuer": "String", "year": "String" }
      ],
      "projects": [
        { "name": "String", "description": "String", "link": "String (Optional)" }
      ]
    }
    - Do not invent facts. Rephrase existing profile data to match JD keywords.
    - IMPORTANT: If a specific field (like 'issuer' or 'year' in certifications) is NOT provided in the source profile, leave it as an empty string "". Do NOT put "N/A", "Unknown", "Ongoing", or "Present".
    - If there is only the year and no issuer, just provide the year. If there is only the issuer and no year, just provide the issuer.
    - Ensure bullet points are impactful (Action Verb + Context + Result).
  `;

  try {
    const { parsed } = await generateStructuredJson({
      prompt,
      schema: RESUME_SCHEMA,
    });

    return {
      resume_json: parsed,
      highlighted_keywords: [],
      rationale: "Generated via pocket-resume professional template",
      generation_error: null,
    };
  } catch (err) {
    return {
      resume_json: {
        name: baseProfile.personal_info?.name || "Error",
        contact: "Generation Failed",
        summary: serializeError(err),
        experience: [],
        education: [],
        skills: [],
        certifications: [],
        projects: [],
      },
      highlighted_keywords: [],
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
  // Use data from resumeJson which is structured now.
  const data = resumeJson;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = 1.4;
  let y = 50;

  function checkPageBreak(heightNeeded) {
    if (y + heightNeeded > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = 50;
    }
  }

  function addText(text, fontSize, fontStyle = "normal", options = {}) {
    if (!text) return;
    const align = options.align || "left";
    const color = options.color || "#000000";
    const maxWidth = options.maxWidth || contentWidth;
    const bottomSpacing = options.bottomSpacing || 0;

    doc.setFontSize(fontSize);
    doc.setFont("helvetica", fontStyle);
    doc.setTextColor(color);

    let cleanText = String(text).replace(/•/g, "").trim();
    // Simplified sanitization for Node
    cleanText = cleanText.replace(/[^\x00-\x7F]/g, " ");

    const lines = doc.splitTextToSize(cleanText, maxWidth);
    const height = lines.length * fontSize * lineHeight;

    checkPageBreak(height);

    if (align === "center") {
      doc.text(lines, pageWidth / 2, y, { align: "center" });
    } else if (align === "right") {
      doc.text(lines, pageWidth - margin, y, { align: "right" });
    } else {
      doc.text(lines, margin, y);
    }

    y += height + bottomSpacing;
  }

  function addSectionHeader(title) {
    const fontSize = 12;
    checkPageBreak(30);
    y += 10;

    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "bold");
    doc.setTextColor("#000000");
    doc.text(title.toUpperCase(), margin, y);

    y += 6;
    doc.setLineWidth(1);
    doc.setDrawColor(0, 0, 0);
    doc.line(margin, y, pageWidth - margin, y);

    y += 15;
  }

  function addBullet(text) {
    const fontSize = 11;
    const bulletIndent = 12;
    const maxWidth = contentWidth - bulletIndent;

    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "normal");

    let cleanText = String(text).replace(/[^\x00-\x7F]/g, " ");
    const lines = doc.splitTextToSize(cleanText, maxWidth);
    const height = lines.length * fontSize * lineHeight;

    checkPageBreak(height);

    const bulletY = y - fontSize / 3;
    doc.setFillColor(0, 0, 0);
    doc.circle(margin + 3, bulletY, 2, "F");

    doc.text(lines, margin + bulletIndent, y);
    y += height + 4;
  }

  // --- Rendering Logic (Professional Style) ---

  // 1. Header
  addText(data.name || "Candidate", 14, "bold", { align: "center", bottomSpacing: 5 });
  addText(data.contact || "", 11, "normal", { align: "center", bottomSpacing: 15 });

  // 2. Summary
  if (data.summary) {
    addSectionHeader("Professional Summary");
    addText(data.summary, 11, "normal", { bottomSpacing: 10 });
  }

  // 3. Skills
  if (data.skills && data.skills.length > 0) {
    addSectionHeader("Skills");
    const fontSize = 11;
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "normal");
    const h = fontSize * lineHeight;
    const bulletRadius = 1.5;
    const bulletGap = 5;

    const sanitizedSkills = data.skills
      .map((s) => String(s || "").replace(/[^\x00-\x7F]/g, " ").trim())
      .filter((s) => s);

    let currentX = margin;
    checkPageBreak(h);

    sanitizedSkills.forEach((text, index) => {
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", "normal");
      const textWidth = doc.getTextWidth(text);

      if (currentX > margin && currentX + textWidth > pageWidth - margin) {
        currentX = margin;
        y += h;
        checkPageBreak(h);
      }

      if (textWidth > contentWidth) {
        // Wrap long single skill
        const wrapped = doc.splitTextToSize(text, contentWidth);
        wrapped.forEach((line, li) => {
          checkPageBreak(h);
          doc.text(line, margin, y);
          if (li < wrapped.length - 1) {
            y += h;
            currentX = margin;
          } else {
            currentX = margin + doc.getTextWidth(line);
          }
        });
      } else {
        doc.text(text, currentX, y);
        currentX += textWidth;
      }

      if (index < sanitizedSkills.length - 1) {
        const totalBulletWidth = bulletGap + bulletRadius * 2 + bulletGap;
        if (currentX + totalBulletWidth > pageWidth - margin) {
          currentX = margin;
          y += h;
          checkPageBreak(h);
        }
        currentX += bulletGap;
        const bulletY = y - fontSize / 3;
        doc.setFillColor(0, 0, 0);
        doc.circle(currentX + bulletRadius, bulletY, bulletRadius, "F");
        currentX += bulletRadius * 2 + bulletGap;
      }
    });
    y += h + 10;
  }

  // 4. Experience
  if (data.experience && data.experience.length > 0) {
    addSectionHeader("Experience");
    data.experience.forEach((exp) => {
      checkPageBreak(50);

      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      const periodText = exp.period && !/^(n\/a|unknown)$/i.test(exp.period) ? exp.period : "";
      const dateWidth = doc.getTextWidth(periodText);

      const titleText = (exp.title || "").toUpperCase();
      doc.setFont("helvetica", "bold");
      const availableTitleWidth = contentWidth - dateWidth - 20;
      let cleanTitle = titleText.replace(/[^\x00-\x7F]/g, " ");
      const titleLines = doc.splitTextToSize(cleanTitle, availableTitleWidth);

      doc.setFont("helvetica", "normal");
      doc.text(periodText, pageWidth - margin, y, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.text(titleLines, margin, y);

      const titleHeight = titleLines.length * 11 * lineHeight;
      y += Math.max(titleHeight, 14);

      doc.setFontSize(11);
      doc.setFont("helvetica", "italic");
      if (exp.location && !/^(n\/a|unknown)$/i.test(exp.location)) {
        const locWidth = doc.getTextWidth(exp.location);
        doc.setFont("helvetica", "normal");
        doc.text(exp.location, pageWidth - margin, y, { align: "right" });

        const availableCompWidth = contentWidth - locWidth - 20;
        const companyLines = doc.splitTextToSize(exp.company || "", availableCompWidth);
        doc.setFont("helvetica", "italic");
        doc.text(companyLines, margin, y);
        y += Math.max(companyLines.length * 11 * lineHeight, 14);
      } else {
        doc.text(exp.company || "", margin, y);
        y += 14;
      }

      y += 4;
      if (exp.points && Array.isArray(exp.points)) {
        exp.points.forEach((point) => addBullet(point));
      }
      y += 6;
    });
  }

  // 5. Projects
  if (data.projects && data.projects.length > 0) {
    addSectionHeader("Projects");
    data.projects.forEach((proj) => {
      checkPageBreak(30);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(proj.name || "", margin, y);
      y += 14;
      addText(proj.description, 11, "normal", { bottomSpacing: 10 });
    });
  }

  // 6. Education
  if (data.education && data.education.length > 0) {
    addSectionHeader("Education");
    data.education.forEach((edu) => {
      checkPageBreak(40);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      let yearText = edu.year && !/^(n\/a|unknown)$/i.test(edu.year) ? edu.year : "";
      const yearWidth = doc.getTextWidth(yearText);

      const availableSchoolWidth = contentWidth - yearWidth - 20;
      doc.setFont("helvetica", "bold");
      const schoolLines = doc.splitTextToSize(edu.school || "", availableSchoolWidth);

      doc.setFont("helvetica", "normal");
      if (yearText) doc.text(yearText, pageWidth - margin, y, { align: "right" });

      doc.setFont("helvetica", "bold");
      doc.text(schoolLines, margin, y);
      y += Math.max(schoolLines.length * 11 * lineHeight, 14);

      doc.setFont("helvetica", "normal");
      const degreeLines = doc.splitTextToSize(edu.degree || "", contentWidth);
      doc.text(degreeLines, margin, y);
      y += degreeLines.length * 11 * lineHeight + 10;
    });
  }

  // 7. Certifications
  if (data.certifications && data.certifications.length > 0) {
    addSectionHeader("Certifications");
    data.certifications.forEach((cert) => {
      checkPageBreak(20);
      let text = cert.name || "";
      const issuer = cert.issuer && !/^(n\/a|none|unknown|ongoing)$/i.test(cert.issuer) ? cert.issuer : "";
      const year = cert.year && !/^(n\/a|none|unknown|ongoing|present)$/i.test(cert.year) ? cert.year : "";

      if (issuer) text += ` - ${issuer}`;
      if (year) text += ` (${year})`;
      addBullet(text);
    });
    y += 6;
  }

  // Output as Uint8Array
  return new Uint8Array(doc.output("arraybuffer"));
}

function unusedWriteObjectAsLines(prefix, value, lines, depth = 0) {
  // This function is no longer used but kept if we need to revert
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
async function imapFetchUnread(imapHost, imapPort, imapUser, password, { maxEmails = MAX_EMAILS_PER_SYNC } = {}) {
  const client = await createImapClient(imapHost, imapPort, imapUser, password);
  const fetched = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = await client.search({ seq: "1:*" }, { uid: true });
      const uids = maxEmails > 0 ? allUids.slice(-maxEmails) : allUids;
      console.log(`  Found ${allUids.length} total message(s), fetching newest ${uids.length} (limit: ${maxEmails > 0 ? maxEmails : "unlimited"}).`);

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
async function handlePoll({ syncAll = false } = {}) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("Polling IMAP for new jobs...");
  // resetStats() is now called by the HTTP handler before calling this function
  const stats = pollStats;
  const errors = pollStats.errors;

  try {
    const { data: integrations, error: intError } = await supabase
      .from("user_integrations")
      .select("*")
      .not("imap_host", "is", null)
      .not("imap_user", "is", null)
      .not("imap_password_encrypted", "is", null);

    if (intError) throw intError;
    if (!integrations || integrations.length === 0) {
      console.log("No integrations found");
      return;
    }
    stats.integrationsFound = integrations.length;

    console.log(`Found ${integrations.length} integration(s).`);
    if (!ai) {
      console.warn(
        "GEMINI_API_KEY is not set. Falling back to non-LLM extraction and base-profile resumes.",
      );
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
        max_emails_per_sync,
      } = integration;

      // Determine effective email limit for this user
      const effectiveMaxEmails = syncAll
        ? 0 // 0 = unlimited
        : typeof max_emails_per_sync === "number" && max_emails_per_sync > 0
          ? max_emails_per_sync
          : 10; // default to 10

      const keywords =
        Array.isArray(job_keywords) && job_keywords.length > 0
          ? [...new Set(job_keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean))]
          : DEFAULT_KEYWORDS;
      const matchInBody = keyword_match_scope === "subject_or_body";

      try {
        const password = await decrypt(imap_password_encrypted, encryption_iv);
        const baseProfile = await fetchBaseProfile(supabase, user_id);

        // --- Phase 1: Fetch all unread messages (short IMAP connection) ---
        console.log(`  Phase 1: Fetching unread emails from ${imap_host}...`);
        const rawMessages = await imapFetchUnread(imap_host, imap_port, imap_user, password, {
          maxEmails: effectiveMaxEmails,
        });
        stats.emailsScanned += rawMessages.length;
        console.log(
          `  Phase 1 done: fetched ${rawMessages.length} message(s). IMAP connection closed.`,
        );

        // --- Phase 2: Process messages offline (no IMAP connection) ---
        console.log(`  Phase 2: Processing messages...`);
        const uidsToMark = [];

        for (const raw of rawMessages) {
          let emailContext;
          try {
            emailContext = await parseMessage(raw.sourceBuffer, {
              uid: raw.uid,
              envelope: raw.envelope,
            });
          } catch (err) {
            errors.push(`Failed to parse message UID ${raw.uid}: ${serializeError(err)}`);
            continue;
          }

          // Deduplication: if we already have jobs from this email_id, skip it.
          const { count: existingEmailCount, error: existingEmailError } = await supabase
            .from("jobs")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user_id)
            .eq("email_id", emailContext.messageId);

          if (existingEmailError) {
            console.warn(
              `  Warning: failed to check existing email_id ${emailContext.messageId}:`,
              existingEmailError.message,
            );
          } else if (existingEmailCount && existingEmailCount > 0) {
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
            const primaryUrl =
              enriched.apply_url ||
              enriched.posting_url ||
              emailContext.links[0]?.url ||
              null;
            const fingerprint = buildJobFingerprint(emailContext.messageId, enriched);

            const { data: existingJob, error: existingError } = await supabase
              .from("jobs")
              .select("id")
              .eq("user_id", user_id)
              .eq("email_id", emailContext.messageId)
              .eq("job_fingerprint", fingerprint)
              .maybeSingle();

            if (existingError) {
              errors.push(
                `Existing-job check failed for "${enriched.job_title}": ${serializeError(existingError)}`,
              );
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
                normalizeString(
                  enriched.description,
                  emailContext.textBody || emailContext.subject,
                ),
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
              parse_status: enriched.enrichment_status === "error" ? "partial" : "parsed",
              parse_error: enriched.enrichment_error || null,
            };

            const { data: insertedJob, error: insertError } = await supabase
              .from("jobs")
              .insert(jobData)
              .select()
              .single();

            if (insertError) {
              errors.push(
                `Job insert failed for "${jobData.job_title}": ${serializeError(insertError)}`,
              );
              continue;
            }

            stats.jobsInserted += 1;
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

              const { error: resumeInsertError } = await supabase.from("resumes").insert({
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
        console.log(
          `  Phase 2 done: ${stats.jobsInserted} job(s) inserted, ${uidsToMark.length} message(s) to mark read.`,
        );

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
            "IMAP authentication failed. If using Gmail, make sure you are using a Google App Password.",
          );
        } else {
          errors.push(err?.message || String(err));
        }
      }
    }

    console.log(
      `Done. Imported ${stats.jobsInserted} job(s), ${errors.length} error(s).`,
    );
  } catch (err) {
    console.error("Critical poll error:", err);
    errors.push(err.message || String(err));
  } finally {
    pollStats.running = false;
  }
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
    return res.end(JSON.stringify({ ok: true, pollRunning: pollStats.running }));
  }

  // Status check
  if (url.pathname === "/status") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify(pollStats));
  }

  if (url.pathname === "/poll" && req.method === "POST") {
    if (pollStats.running) {
      res.writeHead(409, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "A sync is already in progress. Please wait for it to finish.", stats: pollStats }));
    }

    // Parse request body for options (e.g. { syncAll: true })
    let reqBody = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (raw.trim()) reqBody = JSON.parse(raw);
    } catch {
      // Ignore parse errors – treat as empty body (default sync)
    }
    const syncAll = reqBody?.syncAll === true;

    // Start background polling
    resetStats();
    handlePoll({ syncAll }).catch((err) => {
      console.error("Background poll error:", err);
      pollStats.running = false;
      pollStats.errors.push(String(err));
    });

    res.writeHead(202, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ message: "Polling started in background", stats: pollStats }));
  }

  res.writeHead(404, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`IMAP poller server listening on http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/poll`);
});
