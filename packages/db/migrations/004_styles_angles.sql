-- 004: more AI clip looks + a script "angle" (how the script sells)
--   video_jobs.style: product | presenter | unboxing | hero (studio 360°) | macro (texture close-ups)
--                     | in_action (real use) | flatlay (top-down aesthetic)  — Seedance only
--   scripts.angle:    auto | problem_solution | review | unboxing | soft_sell | hard_sell | storytelling
--                     — the angle the AI last wrote this script with (user edits keep it)
ALTER TABLE video_jobs DROP CONSTRAINT IF EXISTS video_jobs_style_check;
ALTER TABLE video_jobs ADD CONSTRAINT video_jobs_style_check
  CHECK (style IN ('product', 'presenter', 'unboxing', 'hero', 'macro', 'in_action', 'flatlay'));

ALTER TABLE scripts ADD COLUMN IF NOT EXISTS angle TEXT NOT NULL DEFAULT 'auto'
  CHECK (angle IN ('auto', 'problem_solution', 'review', 'unboxing', 'soft_sell', 'hard_sell', 'storytelling'));
