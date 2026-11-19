-- 003: optional on-screen text per script line — a short key phrase shown instead of the spoken
-- sentence (e.g. spoken "charge it once and it lasts all day", on screen "1 charge = all day").
-- captions[i] belongs to lines[i]; "" or a missing entry means "show the spoken line".
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS captions JSONB NOT NULL DEFAULT '[]';
