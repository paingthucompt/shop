-- 005: the last AI-written prompt for an external video tool (Google Flow / Veo, Seedance, Kling …)
-- the user runs themselves; video_prompt_style = the clip style it was written for.
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_prompt TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_prompt_style TEXT;
