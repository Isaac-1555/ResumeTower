-- Add unique constraint to user_id in base_profile to allow UPSERT on user_id
ALTER TABLE public.base_profile
  ADD CONSTRAINT base_profile_user_id_key UNIQUE (user_id);
