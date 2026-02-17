import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getKey() {
  const secret = Deno.env.get("IMAP_SECRET_KEY");
  if (!secret) throw new Error("IMAP_SECRET_KEY is not set");
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.padEnd(32).slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return keyMaterial;
}

async function decrypt(encryptedText: string, ivText: string): Promise<string> {
  const key = await getKey();
  const iv = new Uint8Array(atob(ivText).split('').map(c => c.charCodeAt(0)));
  const encrypted = new Uint8Array(atob(encryptedText).split('').map(c => c.charCodeAt(0)));

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Polling IMAP for new jobs...");
    const processedJobs: any[] = [];
    const errors: string[] = [];
    
    // 1. Get users with active integrations
    const { data: integrations, error: intError } = await supabaseClient
      .from('user_integrations')
      .select('*')
      .not('imap_host', 'is', null)
      .not('imap_user', 'is', null)
      .not('imap_password_encrypted', 'is', null);

    if (intError) throw intError;
    if (!integrations || integrations.length === 0) {
       console.log("No users with active integrations found.");
       return new Response(JSON.stringify({ message: "No integrations found" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Found ${integrations.length} integrations.`);

    for (const integration of integrations) {
      const { user_id, imap_host, imap_port, imap_user, imap_password_encrypted, encryption_iv, job_keywords, keyword_match_scope } = integration;
      const keywords = Array.isArray(job_keywords) && job_keywords.length > 0
        ? [...new Set(job_keywords.map((k: unknown) => String(k).trim().toLowerCase()).filter(Boolean))]
        : ["job", "hiring", "application"];
      const matchInBody = keyword_match_scope === "subject_or_body";
      
      try {
        const password = await decrypt(imap_password_encrypted, encryption_iv);

        const client = new ImapFlow({
          host: imap_host,
          port: imap_port || 993,
          secure: true,
          auth: {
            user: imap_user,
            pass: password,
          },
          logger: false,
          disableAutoIdle: true,
        });

        await client.connect();
        try {
          const lock = await client.getMailboxLock("INBOX");
          try {
            const uids = await client.search({ seen: false });
            for (const uid of uids) {
              for await (const message of client.fetch(uid, { uid: true, envelope: true, source: true })) {
                const subject = message.envelope?.subject || "(No Subject)";
                const subjectLower = subject.toLowerCase();
                let rawText: string | null = null;
                let matches = keywords.some((keyword: string) => subjectLower.includes(keyword));
                if (!matches && matchInBody && message.source) {
                  rawText = new TextDecoder().decode(message.source);
                  const bodyHaystack = rawText.toLowerCase();
                  matches = keywords.some((keyword: string) => bodyHaystack.includes(keyword));
                }
                if (!matches) continue;

                const idHeader = "imap-" + message.uid;
                const messageId = message.envelope?.messageId || idHeader;
                const fromEntry = message.envelope?.from?.[0];
                const from =
                  fromEntry?.name ||
                  fromEntry?.address ||
                  "(Unknown)";

                if (!message.source) continue;
                if (!rawText) rawText = new TextDecoder().decode(message.source);
                // Extract body after the MIME header/body separator
                const sepIdx = rawText.indexOf("\r\n\r\n");
                const body = sepIdx !== -1 ? rawText.substring(sepIdx + 4) : rawText;

                // Check if job already exists
                const { data: existingJob } = await supabaseClient
                  .from('jobs')
                  .select('id')
                  .eq('email_id', messageId)
                  .single();

                if (existingJob) continue;

                const jobData = {
                  email_id: messageId,
                  user_id: user_id,
                  job_title: subject,
                  company: from.split('<')[0].trim().replace(/\"/g, ''),
                  location: "Remote (Assumed)",
                  description: body.substring(0, 1000) + (body.length > 1000 ? "..." : ""),
                  job_link: `imap://${imap_host}/INBOX/${message.uid}`,
                  status: 'prepared',
                  extracted_skills: ["Parsing", "Automation", "React"],
                };

                const { data: insertedJob, error: insertError } = await supabaseClient
                  .from('jobs')
                  .insert(jobData)
                  .select()
                  .single();

                if (insertError) {
                  console.error("Insert Job Error", insertError);
                  continue;
                }

                // Generate Artifacts (Mocked)
                await supabaseClient.from('resumes').insert({
                  job_id: insertedJob.id,
                  user_id: user_id,
                  resume_json: { personal_info: { name: "User" } },
                  resume_pdf_url: "https://placehold.co/600x800.png?text=Resume"
                });

                await supabaseClient.from('cover_letters').insert({
                  job_id: insertedJob.id,
                  user_id: user_id,
                  cover_letter_text: `Cover letter for ${jobData.company}`,
                  cover_letter_pdf_url: "https://placehold.co/600x800.png?text=Cover+Letter"
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
        const errAny = err as any;
        if (errAny?.authenticationFailed) {
          errors.push("IMAP authentication failed. If using Gmail, make sure you are using a Google App Password (not your regular password). Generate one at https://myaccount.google.com/apppasswords");
        } else {
          errors.push(errAny?.message || String(err));
        }
      }
    }

    return new Response(
      JSON.stringify({ message: "Polled successfully", jobs: processedJobs, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
