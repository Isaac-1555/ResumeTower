-- Allow users to configure custom keyword matching for job email ingestion.
-- `job_keywords` are matched against subject only (default) or subject+body.

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS job_keywords TEXT[] NOT NULL DEFAULT ARRAY['job', 'hiring', 'application']::TEXT[],
  ADD COLUMN IF NOT EXISTS keyword_match_scope TEXT NOT NULL DEFAULT 'subject';

ALTER TABLE public.user_integrations
  DROP CONSTRAINT IF EXISTS user_integrations_keyword_match_scope_check;

ALTER TABLE public.user_integrations
  ADD CONSTRAINT user_integrations_keyword_match_scope_check
  CHECK (keyword_match_scope IN ('subject', 'subject_or_body'));
