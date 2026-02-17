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
import { webcrypto } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";

const PORT = 54350;

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const IMAP_SECRET_KEY = process.env.IMAP_SECRET_KEY || "";

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
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(encryptedB64), (c) =>
    c.charCodeAt(0),
  );
  const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// Poll handler
// ---------------------------------------------------------------------------
async function handlePoll() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log("Polling IMAP for new jobs...");
  const processedJobs = [];
  const errors = [];

  const { data: integrations, error: intError } = await supabase
    .from("user_integrations")
    .select("*")
    .not("imap_host", "is", null)
    .not("imap_user", "is", null)
    .not("imap_password_encrypted", "is", null);

  if (intError) throw intError;
  if (!integrations || integrations.length === 0) {
    return { status: 200, body: { message: "No integrations found", jobs: [], errors: [] } };
  }

  console.log(`Found ${integrations.length} integration(s).`);

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
      : ["job", "hiring", "application"];
    const matchInBody = keyword_match_scope === "subject_or_body";

    try {
      const password = await decrypt(imap_password_encrypted, encryption_iv);

      const client = new ImapFlow({
        host: imap_host,
        port: imap_port || 993,
        secure: true,
        auth: { user: imap_user, pass: password },
        logger: false,
        disableAutoIdle: true,
      });

      await client.connect();
      try {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const allUids = await client.search({ seen: false });
          // Process only the most recent messages to avoid timeouts
          const MAX_BATCH = 50;
          const uids = allUids.slice(-MAX_BATCH);
          console.log(`  Found ${allUids.length} unread message(s), processing newest ${uids.length}.`);

          for (const uid of uids) {
            for await (const message of client.fetch(uid, {
              uid: true,
              envelope: true,
              source: true,
            })) {
              const subject = message.envelope?.subject || "(No Subject)";
              const subjectLower = subject.toLowerCase();
              let rawText = null;
              let matches = keywords.some((keyword) =>
                subjectLower.includes(keyword)
              );
              if (!matches && matchInBody && message.source) {
                rawText = message.source.toString("utf-8");
                const bodyHaystack = rawText.toLowerCase();
                matches = keywords.some((keyword) =>
                  bodyHaystack.includes(keyword)
                );
              }
              if (!matches) continue;

              const idHeader = "imap-" + message.uid;
              const messageId = message.envelope?.messageId || idHeader;
              const fromEntry = message.envelope?.from?.[0];
              const from =
                fromEntry?.name || fromEntry?.address || "(Unknown)";

              if (!message.source) continue;
              if (!rawText) rawText = message.source.toString("utf-8");
              const sepIdx = rawText.indexOf("\r\n\r\n");
              const body =
                sepIdx !== -1 ? rawText.substring(sepIdx + 4) : rawText;

              // De-duplicate
              const { data: existingJob } = await supabase
                .from("jobs")
                .select("id")
                .eq("email_id", messageId)
                .single();
              if (existingJob) continue;

              const jobData = {
                email_id: messageId,
                user_id,
                job_title: subject,
                company: from.split("<")[0].trim().replace(/"/g, ""),
                location: "Remote (Assumed)",
                description:
                  body.substring(0, 1000) + (body.length > 1000 ? "..." : ""),
                job_link: `imap://${imap_host}/INBOX/${message.uid}`,
                status: "prepared",
                extracted_skills: ["Parsing", "Automation", "React"],
              };

              const { data: insertedJob, error: insertError } = await supabase
                .from("jobs")
                .insert(jobData)
                .select()
                .single();

              if (insertError) {
                console.error("Insert Job Error", insertError);
                continue;
              }

              // Mocked artefacts
              await supabase.from("resumes").insert({
                job_id: insertedJob.id,
                user_id,
                resume_json: { personal_info: { name: "User" } },
                resume_pdf_url:
                  "https://placehold.co/600x800.png?text=Resume",
              });
              await supabase.from("cover_letters").insert({
                job_id: insertedJob.id,
                user_id,
                cover_letter_text: `Cover letter for ${jobData.company}`,
                cover_letter_pdf_url:
                  "https://placehold.co/600x800.png?text=Cover+Letter",
              });

              processedJobs.push(insertedJob);
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        try {
          await client.logout();
        } catch {
          client.close();
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
    body: { message: "Polled successfully", jobs: processedJobs, errors },
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

  if (url.pathname === "/poll" && req.method === "POST") {
    try {
      const result = await handlePoll();
      res.writeHead(result.status, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify(result.body));
    } catch (err) {
      console.error("Poll error:", err);
      res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  res.writeHead(404, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`IMAP poller server listening on http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/poll`);
});
