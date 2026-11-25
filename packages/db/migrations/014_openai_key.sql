-- 014: users can also add an OpenAI key (optional) — then their scripts are written by an OpenAI model
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_provider_check CHECK (provider IN ('gemini', 'seedance', 'openai'));
