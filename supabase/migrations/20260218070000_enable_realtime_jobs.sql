-- Enable Supabase Realtime change notifications on the jobs table
-- so the frontend can subscribe to INSERT/DELETE events and update live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
