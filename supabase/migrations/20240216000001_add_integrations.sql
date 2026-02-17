-- Create table to store user integration tokens (specifically for background processing)
CREATE TABLE IF NOT EXISTS public.user_integrations (
  user_id UUID REFERENCES auth.users(id) NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  access_token TEXT, -- Encrypted in a real app
  refresh_token TEXT, -- Encrypted in a real app
  expires_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own integrations" ON public.user_integrations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert/update own integrations" ON public.user_integrations FOR ALL USING (auth.uid() = user_id);
