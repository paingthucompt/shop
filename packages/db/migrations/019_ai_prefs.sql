-- 019: each user's own AI choices (used only with their own API keys): which AI writes the scripts,
-- the voices, and the default AI video service / model. { script, voice, voice_b, video_provider,
-- gemini_video, higgsfield_model } — validated in packages/providers/src/ai-catalog.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_prefs JSONB NOT NULL DEFAULT '{}';
