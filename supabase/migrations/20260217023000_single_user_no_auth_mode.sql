-- Single-user local mode: remove hard dependency on auth.users and auth.uid()-based RLS.
-- This enables app usage without sign-in while keeping existing table shapes.

-- Remove FK constraints to auth.users where present.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_user_id_fkey;
ALTER TABLE public.resumes DROP CONSTRAINT IF EXISTS resumes_user_id_fkey;
ALTER TABLE public.cover_letters DROP CONSTRAINT IF EXISTS cover_letters_user_id_fkey;
ALTER TABLE public.base_profile DROP CONSTRAINT IF EXISTS base_profile_user_id_fkey;
ALTER TABLE public.user_integrations DROP CONSTRAINT IF EXISTS user_integrations_user_id_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- Disable RLS policies that rely on auth.uid() for no-login mode.
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cover_letters DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_profile DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_integrations DISABLE ROW LEVEL SECURITY;
