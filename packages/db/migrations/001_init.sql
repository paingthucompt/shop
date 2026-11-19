-- 001_init: users, credits, products, scripts, video jobs, videos

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  credits       INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- every credit change is recorded (signup bonus, job charge, refund, purchase)
CREATE TABLE IF NOT EXISTS credit_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,           -- signup | job | refund | purchase | admin
  ref        TEXT,                    -- e.g. job id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'manual',   -- manual | shopee | tiktok
  title         TEXT NOT NULL,
  description   TEXT,
  price         NUMERIC(12,2),
  currency      TEXT NOT NULL DEFAULT 'THB',
  product_url   TEXT,
  affiliate_url TEXT,
  images        JSONB NOT NULL DEFAULT '[]',      -- [{ path, url }]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_user_idx ON products(user_id, created_at DESC);

-- one script per product per language (th / my); never mixed
CREATE TABLE IF NOT EXISTS scripts (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL CHECK (lang IN ('th', 'my')),
  hook        TEXT NOT NULL,
  lines       JSONB NOT NULL DEFAULT '[]',        -- ["...", "..."]
  cta         TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, lang)
);

CREATE TABLE IF NOT EXISTS video_jobs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id       BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  langs            TEXT[] NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',  -- queued | running | succeeded | failed
  stage            TEXT,                            -- clip | render:th | render:my | done
  error            TEXT,
  seedance_task_id TEXT,
  clip_path        TEXT,
  credits_charged  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_jobs_user_idx ON video_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS videos (
  id         BIGSERIAL PRIMARY KEY,
  job_id     BIGINT NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  path       TEXT NOT NULL,
  srt_path   TEXT,
  duration   NUMERIC(8,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, lang)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
