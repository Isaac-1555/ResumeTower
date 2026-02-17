-- Enable pgcrypto for potential future use (good practice)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Alter user_integrations to support IMAP instead of Google OAuth
ALTER TABLE public.user_integrations
  DROP CONSTRAINT IF EXISTS user_integrations_provider_check;

ALTER TABLE public.user_integrations
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS expires_at;

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS imap_host TEXT,
  ADD COLUMN IF NOT EXISTS imap_port INTEGER,
  ADD COLUMN IF NOT EXISTS imap_user TEXT,
  ADD COLUMN IF NOT EXISTS imap_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS encryption_iv TEXT; -- For storing the IV if we use AES-GCM

-- Add a check to ensure we have the necessary IMAP fields (optional, but good for data integrity)
-- We can enforce this at the application level too.
