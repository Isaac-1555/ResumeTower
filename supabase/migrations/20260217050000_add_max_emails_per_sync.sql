-- Add per-user "max emails per sync" setting (default 10).
-- When the poller receives { syncAll: true } it ignores this limit.
ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS max_emails_per_sync INTEGER NOT NULL DEFAULT 10;
