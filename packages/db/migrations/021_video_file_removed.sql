-- 021: a video's files are removed from this machine an hour after they reached the user's Telegram
-- (storage on this machine may be cleaned; Telegram keeps the video). The row, script and costs stay.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS file_removed_at TIMESTAMPTZ;
