-- 007: the user's own product clip (e.g. made in Google Flow) + the prompt we give them for it.
--   products.clip_prompt  = { style, seconds, shots, prompt, mock } — one silent clip shared by th + my
--   products.clip_path / clip_seconds = the uploaded clip (normalised to 9:16 by the worker)
--   video_jobs.clip_source = 'auto' (CLIP_MODE: AI video / photos) | 'upload' (the product's uploaded clip)
-- scripts.flow_prompt (006, per-language talking prompts) is no longer written: Flow's Thai / Myanmar
-- speech was not good enough, the app's own voiceover is.
ALTER TABLE products ADD COLUMN IF NOT EXISTS clip_prompt JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS clip_path TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS clip_seconds NUMERIC(6,2);
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS clip_source TEXT NOT NULL DEFAULT 'auto'
  CHECK (clip_source IN ('auto', 'upload'));
