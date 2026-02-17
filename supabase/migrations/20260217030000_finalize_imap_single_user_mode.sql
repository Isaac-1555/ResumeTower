-- Finalize single-user IMAP-only mode.
-- Removes leftover auth-era policies/table and sets a default fixed user_id for app records.

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can insert own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Users can view own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can insert own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can update own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can delete own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can view own cover letters" ON public.cover_letters;
DROP POLICY IF EXISTS "Users can insert own cover letters" ON public.cover_letters;
DROP POLICY IF EXISTS "Users can update own cover letters" ON public.cover_letters;
DROP POLICY IF EXISTS "Users can delete own cover letters" ON public.cover_letters;
DROP POLICY IF EXISTS "Users can view own base profile" ON public.base_profile;
DROP POLICY IF EXISTS "Users can insert own base profile" ON public.base_profile;
DROP POLICY IF EXISTS "Users can update own base profile" ON public.base_profile;
DROP POLICY IF EXISTS "Users can delete own base profile" ON public.base_profile;
DROP POLICY IF EXISTS "Users can view own integrations" ON public.user_integrations;
DROP POLICY IF EXISTS "Users can insert/update own integrations" ON public.user_integrations;

DROP TABLE IF EXISTS public.users;

ALTER TABLE public.jobs
  ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.resumes
  ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.cover_letters
  ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.base_profile
  ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.user_integrations
  ALTER COLUMN user_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
