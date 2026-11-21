-- 008: "AI scene images" — one AI image per script beat, animated by the worker (zoom / pan) under the
-- app's own voiceover and captions. products.scenes = [{ n, role, from, to, seconds, visual, prompt, path, mime }]
ALTER TABLE products ADD COLUMN IF NOT EXISTS scenes JSONB;
ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_clip_source_check;
ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_clip_source_check CHECK (clip_source IN ('auto', 'upload', 'scenes'));
