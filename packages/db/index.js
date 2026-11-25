import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export const query = (text, params) => pool.query(text, params);

/** Run fn inside a transaction; fn receives a client with .query */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Atomically change a user's credits and record it in the ledger. Throws if balance would go negative. */
export async function changeCredits(client, userId, delta, reason, ref = null) {
  const { rows } = await client.query(
    "UPDATE users SET credits = credits + $2 WHERE id = $1 AND credits + $2 >= 0 RETURNING credits",
    [userId, delta],
  );
  if (!rows.length) {
    const err = new Error("Not enough credits");
    err.status = 402;
    throw err;
  }
  await client.query(
    "INSERT INTO credit_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4)",
    [userId, delta, reason, ref],
  );
  return rows[0].credits;
}

/**
 * Mark a video job failed and refund its credits — exactly once (idempotent: a job that is
 * already failed or succeeded is left alone). Used by the API (queue errors) and the worker.
 * Returns true if credits were refunded by this call.
 */
export function failJob(jobId, message) {
  return tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE video_jobs SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1 AND status NOT IN ('failed', 'succeeded') RETURNING user_id, credits_charged`,
      [jobId, String(message || "failed").slice(0, 1000)],
    );
    if (!(rows[0]?.credits_charged > 0)) return false;
    await changeCredits(c, rows[0].user_id, rows[0].credits_charged, "refund", String(jobId));
    return true;
  });
}

/** store one priced API call (see @app/providers usage.js) — the usage sink of the API and the worker */
export function recordUsage(row) {
  return query(
    `INSERT INTO api_usage (user_id, product_id, job_id, kind, provider, model, input_tokens, output_tokens, seconds, images, usd, priced)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [row.userId ?? null, row.productId ?? null, row.jobId ?? null, row.kind, row.provider || "unknown", row.model ?? null,
      row.input_tokens ?? null, row.output_tokens ?? null, row.seconds ?? null, row.images ?? null, row.usd ?? 0, row.priced !== false],
  );
}

// ---------------- users' own AI API keys (encrypted at rest with AES-256-GCM)
// The encryption key comes from KEYS_SECRET (or, if unset, JWT_SECRET). Changing it makes stored keys
// unreadable — users then simply enter their key again.
// seedance (BytePlus) is no longer offered — kept so an old key can still be removed
export const KEY_PROVIDERS = ["gemini", "higgsfield", "openai", "seedance"];

function keysSecret() {
  const s = process.env.KEYS_SECRET || process.env.JWT_SECRET || "";
  if (s.length < 32) {
    throw Object.assign(new Error("API keys can't be stored: set KEYS_SECRET (32+ random characters) on the server"), { status: 503, expose: true });
  }
  return crypto.createHash("sha256").update(`user-api-keys:${s}`).digest();
}

/** plain key → "v1:iv:tag:ciphertext" (base64) */
export function sealKey(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keysSecret(), iv);
  const data = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), data].map((x) => (typeof x === "string" ? x : x.toString("base64"))).join(":");
}

/** the reverse of sealKey; throws if the secret changed or the value was tampered with */
export function openKey(sealed) {
  const [v, iv, tag, data] = String(sealed).split(":");
  if (v !== "v1") throw new Error("unknown key format");
  const d = crypto.createDecipheriv("aes-256-gcm", keysSecret(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** what the app shows instead of the key: "AIza…x7Qk" */
export const keyHint = (key) => `${key.slice(0, 4)}…${key.slice(-4)}`;

export function saveUserKey(userId, provider, key, verified) {
  return query(
    `INSERT INTO user_api_keys (user_id, provider, key_enc, hint, verified_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, provider) DO UPDATE SET key_enc = $3, hint = $4, verified_at = $5, updated_at = now()`,
    [userId, provider, sealKey(key), keyHint(key), verified ? new Date() : null],
  );
}

export const deleteUserKey = (userId, provider) =>
  query("DELETE FROM user_api_keys WHERE user_id = $1 AND provider = $2", [userId, provider]);

/** [{ provider, hint, verified_at, updated_at }] — never the key itself */
export async function listUserKeys(userId) {
  const { rows } = await query("SELECT provider, hint, verified_at, updated_at FROM user_api_keys WHERE user_id = $1 ORDER BY provider", [userId]);
  return rows;
}

/** { gemini?, seedance? } decrypted, for the provider calls made for this user */
export async function loadUserKeys(userId) {
  if (!userId) return {};
  const { rows } = await query("SELECT provider, key_enc FROM user_api_keys WHERE user_id = $1", [userId]);
  const keys = {};
  for (const r of rows) {
    try { keys[r.provider] = openKey(r.key_enc); } catch (err) { console.warn(`[keys] user ${userId} ${r.provider} key unreadable: ${err.message}`); }
  }
  return keys;
}

/** the user's own AI choices (users.ai_prefs) — cleaned by the caller (providers ai-catalog.js) */
export async function loadUserPrefs(userId) {
  if (!userId) return {};
  const { rows } = await query("SELECT ai_prefs FROM users WHERE id = $1", [userId]);
  return rows[0]?.ai_prefs || {};
}

export const saveUserPrefs = (userId, prefs) =>
  query("UPDATE users SET ai_prefs = $2 WHERE id = $1 RETURNING ai_prefs", [userId, JSON.stringify(prefs)]).then((r) => r.rows[0]?.ai_prefs || {});
