-- 006: Google Flow prompt pack per script (one per language): { style, shots, scenes: [{ n, seconds, spoken, prompt }], mock }
-- The spoken text in each scene always mirrors the script; editing the script rebuilds the scenes.
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS flow_prompt JSONB;
