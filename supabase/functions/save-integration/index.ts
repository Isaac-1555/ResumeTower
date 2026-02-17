import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const APP_USER_ID = "00000000-0000-0000-0000-000000000001";

// Helper to derive a key from the secret (or use it directly if it's a key)
// For simplicity, we'll assume IMAP_SECRET_KEY is a 32-character string (256 bits)
// If not, we should hash it.
async function getKey() {
  const secret = Deno.env.get("IMAP_SECRET_KEY");
  if (!secret) throw new Error("IMAP_SECRET_KEY is not set");
  
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.padEnd(32).slice(0, 32)), // Ensure 32 bytes
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return keyMaterial;
}

async function encrypt(text: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoded
  );

  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
  };
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

    const { host, port, username, password } = await req.json();

    if (!host || !port || !username || !password) {
      return new Response("Missing required fields", { status: 400, headers: corsHeaders });
    }

    const { encrypted, iv } = await encrypt(password);

    const { error } = await supabaseClient
      .from('user_integrations')
      .upsert({
        user_id: APP_USER_ID,
        imap_host: host,
        imap_port: port,
        imap_user: username,
        imap_password_encrypted: encrypted,
        encryption_iv: iv,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;

    return new Response(
      JSON.stringify({ message: "Integration saved successfully" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
