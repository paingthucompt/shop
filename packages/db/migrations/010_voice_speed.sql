-- 010: voiceover speed chosen per video and language, e.g. {"th": 1.1, "my": 1.2}
--   (1 = the voice's natural pace; NULL = the server default VOXCPM_SPEED / 1)
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS voice_speed jsonb;
