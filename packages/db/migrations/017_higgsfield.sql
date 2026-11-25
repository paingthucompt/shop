-- 017: Higgsfield replaces BytePlus (Seedance) as the second AI video service for users' own keys.
-- The key is stored as "KEY_ID:KEY_SECRET" (Authorization: Key <id>:<secret>).
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_provider_check
  CHECK (provider IN ('gemini', 'seedance', 'openai', 'higgsfield'));
ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_ai_provider_check;
ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_ai_provider_check CHECK (ai_provider IN ('gemini', 'seedance', 'higgsfield'));
-- the running Higgsfield request, so a worker restart resumes it instead of paying twice
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS higgsfield_request_id TEXT;
