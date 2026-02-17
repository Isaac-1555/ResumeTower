-- Create users table (future-proofing, links to auth.users if needed)
-- In Supabase, auth.users is managed by the Auth system. 
-- We'll create a public.users table that references auth.users for app-specific data if needed, 
-- or just rely on auth.users. The PRD says "users (future-proofing)".
-- For now, let's create a table that mirrors auth.users for easier joins if we want additional profile data.

CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Jobs Table
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL, -- Added user_id for multi-tenant support/security
  email_id TEXT UNIQUE NOT NULL, -- From Gmail
  job_title TEXT,
  company TEXT,
  location TEXT,
  description TEXT,
  job_link TEXT,
  extracted_skills JSONB DEFAULT '[]'::JSONB,
  status TEXT DEFAULT 'prepared' CHECK (status IN ('prepared', 'applied', 'rejected', 'interview')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  applied_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Resumes Table
CREATE TABLE IF NOT EXISTS public.resumes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  resume_json JSONB NOT NULL,
  resume_pdf_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

-- Cover Letters Table
CREATE TABLE IF NOT EXISTS public.cover_letters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  cover_letter_text TEXT,
  cover_letter_pdf_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.cover_letters ENABLE ROW LEVEL SECURITY;

-- Base Profile Table
CREATE TABLE IF NOT EXISTS public.base_profile (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  profile_json JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.base_profile ENABLE ROW LEVEL SECURITY;

-- Policies

-- Users: Users can see their own data
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Jobs: Users can CRUD their own jobs
CREATE POLICY "Users can view own jobs" ON public.jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own jobs" ON public.jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own jobs" ON public.jobs FOR DELETE USING (auth.uid() = user_id);

-- Resumes: Users can CRUD their own resumes
CREATE POLICY "Users can view own resumes" ON public.resumes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own resumes" ON public.resumes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own resumes" ON public.resumes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own resumes" ON public.resumes FOR DELETE USING (auth.uid() = user_id);

-- Cover Letters: Users can CRUD their own cover letters
CREATE POLICY "Users can view own cover letters" ON public.cover_letters FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cover letters" ON public.cover_letters FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cover letters" ON public.cover_letters FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cover letters" ON public.cover_letters FOR DELETE USING (auth.uid() = user_id);

-- Base Profile: Users can CRUD their own profile
CREATE POLICY "Users can view own base profile" ON public.base_profile FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own base profile" ON public.base_profile FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own base profile" ON public.base_profile FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own base profile" ON public.base_profile FOR DELETE USING (auth.uid() = user_id);

-- Storage Buckets (Optional but likely needed for PDFs)
-- insert into storage.buckets (id, name) values ('resumes', 'resumes');
-- insert into storage.buckets (id, name) values ('cover_letters', 'cover_letters');
