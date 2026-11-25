-- 016: which AI video service the user chose for an AI-video job (gemini | seedance); null = the default
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS ai_provider TEXT CHECK (ai_provider IN ('gemini', 'seedance'));
