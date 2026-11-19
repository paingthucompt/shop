import { Router } from "express";
import { query, tx, changeCredits, failJob } from "@app/db";
import { seedance } from "@app/providers";
import { ah, requireAuth, videoQueue, mediaUrl } from "../lib.js";
import { parseId, parseLangs, parseStyle, publicError } from "../validate.js";
import { foreignScriptIssue } from "../script-rules.js";

const r = Router();
r.use(requireAuth);

const COST = () => Number(process.env.JOB_CREDIT_COST || 10);

async function loadJob(userId, id) {
  const { rows } = await query("SELECT * FROM video_jobs WHERE id = $1 AND user_id = $2", [id, userId]);
  const j = rows[0];
  if (!j) return null;
  const [{ rows: vids }, { rows: refund }] = await Promise.all([
    query("SELECT lang, path, srt_path, duration FROM videos WHERE job_id = $1 ORDER BY lang", [id]),
    query("SELECT 1 FROM credit_ledger WHERE user_id = $1 AND reason = 'refund' AND ref = $2 LIMIT 1", [userId, String(id)]),
  ]);
  return {
    id: j.id, product_id: j.product_id, langs: j.langs, status: j.status, stage: j.stage, style: j.style,
    credits_charged: j.credits_charged, created_at: j.created_at, updated_at: j.updated_at,
    error: j.status === "failed" ? publicError(j.error) : null,
    refunded: refund.length > 0,
    clip_url: mediaUrl(j.clip_path),
    videos: vids.map((v) => ({ lang: v.lang, duration: v.duration, url: mediaUrl(v.path), srt_url: mediaUrl(v.srt_path) })),
  };
}

/** everything a user must see before spending: credits, what Seedance will be asked, output settings */
async function buildQuote(userId, productId, langs, style = "product") {
  const { rows: [product] } = await query("SELECT * FROM products WHERE id = $1 AND user_id = $2", [productId, userId]);
  if (!product) return { status: 404, error: "product not found" };
  const [{ rows: scripts }, { rows: [user] }] = await Promise.all([
    query("SELECT lang, hook, lines, captions, cta FROM scripts WHERE product_id = $1 AND lang = ANY($2)", [productId, langs]),
    query("SELECT credits FROM users WHERE id = $1", [userId]),
  ]);
  const missing = langs.filter((l) => !scripts.some((s) => s.lang === l));
  // e.g. Thai product name left inside the Myanmar script → would be burned into the Myanmar video
  const scriptIssues = Object.fromEntries(
    scripts.map((s) => [s.lang, foreignScriptIssue(s.lang, s)]).filter(([, issue]) => issue),
  );
  const cost = COST();
  const clip = seedance.clipSettings();
  const balance = user?.credits ?? 0;
  return {
    product_id: productId,
    langs,
    cost,
    balance,
    balance_after: balance - cost,
    enough_credits: balance >= cost,
    missing_scripts: missing,
    script_issues: scriptIssues,
    clip: {
      mode: clip.mode,
      // style only changes the AI video prompt (Seedance / Gemini); the free photo clip has no people
      style,
      style_applies: clip.mode === "seedance" || clip.mode === "gemini",
      model: clip.model,
      duration_s: clip.duration,
      resolution: clip.resolution,
      reference_images: Math.min(4, (product.images || []).length),
      prompt: seedance.buildProductPrompt(product, { style }),
    },
    voiceover: (process.env.TTS_PROVIDER || "none").toLowerCase(),
  };
}

/** GET /api/jobs/quote?product_id=1&langs=th,my — free preview, nothing is charged */
r.get("/quote", ah(async (req, res) => {
  const q = await buildQuote(req.userId, parseId(req.query.product_id, "product_id"), parseLangs(req.query.langs), parseStyle(req.query.style));
  if (q.error) return res.status(q.status).json({ error: q.error });
  res.json(q);
}));

/**
 * body: { product_id, langs: ["th","my"], style: one of CLIP_STYLES, confirm_cost }
 * confirm_cost must equal the quoted cost — the user explicitly agreed to this price.
 * Credits are charged up front and refunded on failure.
 */
r.post("/", ah(async (req, res) => {
  const productId = parseId(req.body.product_id, "product_id");
  const langs = parseLangs(req.body.langs);
  const style = parseStyle(req.body.style);
  const q = await buildQuote(req.userId, productId, langs, style);
  if (q.error) return res.status(q.status).json({ error: q.error });
  if (q.missing_scripts.length) return res.status(400).json({ error: `write the script first for: ${q.missing_scripts.join(", ")}` });
  const issues = Object.values(q.script_issues);
  if (issues.length) return res.status(400).json({ error: issues.join("; ") });
  if (Number(req.body.confirm_cost) !== q.cost) {
    return res.status(409).json({ error: "the price changed or was not confirmed — review the quote again", quote: q });
  }

  const job = await tx(async (c) => {
    const { rows } = await c.query(
      "INSERT INTO video_jobs (user_id, product_id, langs, credits_charged, style) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.userId, productId, langs, q.cost, style],
    );
    await changeCredits(c, req.userId, -q.cost, "job", String(rows[0].id));
    return rows[0];
  });
  try {
    await videoQueue.add("render", { jobId: job.id }, { jobId: `job-${job.id}`, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
  } catch (err) {
    // credits were already taken — give them back instead of leaving a job stuck in "queued"
    console.error(`[job ${job.id}] queue error:`, err.message);
    await failJob(job.id, `could not be queued: ${err.message}`);
    return res.status(503).json({ error: "the video service is busy — nothing was charged, please try again" });
  }
  res.status(201).json(await loadJob(req.userId, job.id));
}));

r.get("/", ah(async (req, res) => {
  const { rows } = await query(
    `SELECT j.id, j.product_id, p.title AS product_title, j.langs, j.status, j.stage, j.created_at, j.updated_at
     FROM video_jobs j JOIN products p ON p.id = j.product_id WHERE j.user_id = $1 ORDER BY j.created_at DESC LIMIT 100`,
    [req.userId],
  );
  res.json(rows);
}));

r.get("/:id", ah(async (req, res) => {
  const job = await loadJob(req.userId, parseId(req.params.id));
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
}));

export default r;
