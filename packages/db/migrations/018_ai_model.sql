-- 018: the AI video model the user picked for a job (e.g. a Higgsfield model path); null = the default
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS ai_model TEXT;
