-- 009: the clip source is chosen per video instead of only by CLIP_MODE:
--   photos   = the product photos with zoom / pan (no API cost)
--   ai_video = AI video from the photos (Gemini / Seedance — real API cost, ~US$3–4 per clip)
ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_clip_source_check;
ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_clip_source_check
  CHECK (clip_source IN ('auto', 'upload', 'scenes', 'photos', 'ai_video'));
