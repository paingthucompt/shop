-- 015: script format = what kind of video the script is written for, and how the video is then made
--   voiceover (narration over product shots, the original) | presenter (a creator talks to camera)
--   drama (a 2-person mini skit: speakers[] says who says each line, A or B) | montage (short punchy
--   text cards, fast cuts)
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'voiceover'
  CHECK (format IN ('voiceover', 'presenter', 'drama', 'montage'));
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS speakers JSONB NOT NULL DEFAULT '[]';
