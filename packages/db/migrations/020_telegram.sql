-- 020: finished videos go to the user's own Telegram bot (token stored encrypted like an API key;
-- the chat it sends to is found with "Connect" and kept in users.ai_prefs.telegram_chat_id)
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_provider_check
  CHECK (provider IN ('gemini', 'seedance', 'openai', 'higgsfield', 'telegram'));
-- when each video was sent to Telegram (null = not yet / failed)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS telegram_sent_at TIMESTAMPTZ;
