-- Enable multiple job opportunities per email while keeping idempotent ingestion.
-- Adds extraction metadata for LLM parsing and creates a public resume PDF bucket.

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_email_id_key;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS source_subject TEXT,
  ADD COLUMN IF NOT EXISTS source_from TEXT,
  ADD COLUMN IF NOT EXISTS source_received_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS source_message_uid BIGINT,
  ADD COLUMN IF NOT EXISTS source_links JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS posting_url TEXT,
  ADD COLUMN IF NOT EXISTS apply_url TEXT,
  ADD COLUMN IF NOT EXISTS extraction_model TEXT,
  ADD COLUMN IF NOT EXISTS extraction_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS extraction_raw JSONB,
  ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'parsed',
  ADD COLUMN IF NOT EXISTS parse_error TEXT;

UPDATE public.jobs
SET
  job_fingerprint = COALESCE(
    NULLIF(job_fingerprint, ''),
    md5(
      COALESCE(email_id, '') || '|' ||
      COALESCE(lower(job_title), '') || '|' ||
      COALESCE(lower(company), '') || '|' ||
      COALESCE(lower(job_link), '')
    )
  ),
  source_subject = COALESCE(source_subject, job_title),
  posting_url = COALESCE(posting_url, job_link),
  apply_url = COALESCE(apply_url, job_link),
  source_links = COALESCE(source_links, '[]'::JSONB),
  parse_status = COALESCE(parse_status, 'parsed')
WHERE TRUE;

ALTER TABLE public.jobs
  ALTER COLUMN job_fingerprint SET NOT NULL,
  ALTER COLUMN source_links SET NOT NULL,
  ALTER COLUMN parse_status SET NOT NULL;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_parse_status_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_parse_status_check
  CHECK (parse_status IN ('parsed', 'partial', 'failed', 'skipped'));

CREATE UNIQUE INDEX IF NOT EXISTS jobs_user_email_fingerprint_key
  ON public.jobs (user_id, email_id, job_fingerprint);

CREATE INDEX IF NOT EXISTS jobs_apply_url_idx
  ON public.jobs (apply_url);

CREATE INDEX IF NOT EXISTS jobs_posting_url_idx
  ON public.jobs (posting_url);

CREATE INDEX IF NOT EXISTS jobs_parse_status_idx
  ON public.jobs (parse_status);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  true,
  10485760,
  ARRAY['application/pdf']::TEXT[]
)
ON CONFLICT (id)
DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
