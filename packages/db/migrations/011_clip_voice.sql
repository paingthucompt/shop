-- 011: the uploaded clip already has the voice (e.g. a Flow presenter speaking with lip-sync):
-- the app then keeps the clip's own audio and adds only captions, hook and CTA (no voiceover)
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS clip_has_voice boolean NOT NULL DEFAULT false;
