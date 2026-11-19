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
