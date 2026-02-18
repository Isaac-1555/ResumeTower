-- Add per-user LLM provider + model selection for the poller.
-- Defaults to OpenRouter + Qwen3 Coder.

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS llm_provider TEXT NOT NULL DEFAULT 'openrouter',
  ADD COLUMN IF NOT EXISTS llm_model TEXT NOT NULL DEFAULT 'qwen/qwen3-coder';

ALTER TABLE public.user_integrations
  DROP CONSTRAINT IF EXISTS user_integrations_llm_provider_check;

ALTER TABLE public.user_integrations
  ADD CONSTRAINT user_integrations_llm_provider_check
  CHECK (llm_provider IN ('openrouter', 'gemini', 'disabled'));
