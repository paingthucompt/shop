-- 002: how the AI product clip looks (Seedance only; the free photo clip ignores it)
--   product   = product-only UGC demo (hands, close-ups, real use)
--   presenter = a local-looking creator holds and demonstrates the product (no lip-sync; voiceover is added per language)
ALTER TABLE video_jobs
  ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'product' CHECK (style IN ('product', 'presenter'));
