-- 012: what each AI / API call really cost (US$), for cost tracking: per job, per product and per month.
-- One row per billable call (script writing, voiceover, AI clip, scene image …). usd is computed from
-- the token / second / image counts with the price table in packages/providers/src/pricing.js.
CREATE TABLE IF NOT EXISTS api_usage (
  id            bigserial PRIMARY KEY,
  user_id       bigint REFERENCES users(id) ON DELETE SET NULL,
  product_id    bigint REFERENCES products(id) ON DELETE SET NULL,
  job_id        bigint REFERENCES video_jobs(id) ON DELETE SET NULL,
  kind          text NOT NULL,          -- script | translate | clip_prompt | tts | video | image | text
  provider      text NOT NULL,          -- gemini | seedance | openai …
  model         text,
  input_tokens  integer,
  output_tokens integer,
  seconds       numeric(8, 2),
  images        integer,
  usd           numeric(12, 6) NOT NULL DEFAULT 0,
  priced        boolean NOT NULL DEFAULT true,  -- false: model missing from the price table (usd = 0)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_job_idx ON api_usage (job_id);
CREATE INDEX IF NOT EXISTS api_usage_product_idx ON api_usage (product_id);
CREATE INDEX IF NOT EXISTS api_usage_user_time_idx ON api_usage (user_id, created_at);
