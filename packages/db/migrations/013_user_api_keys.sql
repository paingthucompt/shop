-- 013: users bring their own AI API keys (Gemini, Seedance). Keys are stored encrypted (AES-256-GCM,
-- see sealKey in packages/db/index.js) and never sent back to the browser — only a short hint.
-- A user with their own Gemini key pays Google directly: their videos cost no credits.
CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('gemini', 'seedance')),
  key_enc     text NOT NULL,
  hint        text NOT NULL,
  verified_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- the job was made with the user's own keys (no credits charged) → the worker must use those keys too
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS own_key boolean NOT NULL DEFAULT false;
