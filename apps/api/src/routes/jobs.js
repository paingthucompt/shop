import { Router } from "express";
import { query, tx, changeCredits, failJob } from "@app/db";
import { seedance } from "@app/providers";
import { ah, requireAuth, videoQueue, mediaUrl } from "../lib.js";
import { parseClipSource, parseId, parseLangs, parseStyle, parseVoiceSpeed, publicError, VOICE_SPEED } from "../validate.js";
import { foreignScriptIssue } from "../script-rules.js";

const r = Router();
r.use(requireAuth);

const COST = () => Number(process.env.JOB_CREDIT_COST || 10);
// the user's own clip / the already-paid scene images only need voiceover + captions: no AI video cost
const UPLOAD_COST = () => Number(process.env.UPLOAD_CREDIT_COST || 2);
const SCENES_VIDEO_COST = () => Number(process.env.SCENES_VIDEO_CREDIT_COST || 2);

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

/** TTS_PROVIDER_TH / _MY override TTS_PROVIDER per language → "gemini", or "th:gemini · my:voxcpm" when they differ */
function voiceoverLabel(langs) {
  const of = (l) => String(process.env[`TTS_PROVIDER_${l.toUpperCase()}`] || process.env.TTS_PROVIDER || "none").toLowerCase();
  const all = [...new Set(langs.map(of))];
  return all.length === 1 ? all[0] : langs.map((l) => `${l}:${of(l)}`).join(" · ");
}

/** VOXCPM_SPEED_MY / VOXCPM_SPEED for the local VoxCPM voice, otherwise the voice's natural pace (1) */
function defaultVoiceSpeed(lang) {
  const provider = String(process.env[`TTS_PROVIDER_${lang.toUpperCase()}`] || process.env.TTS_PROVIDER || "none").toLowerCase();
  if (provider !== "voxcpm") return 1;
  const n = Number(process.env[`VOXCPM_SPEED_${lang.toUpperCase()}`] || process.env.VOXCPM_SPEED || 1);
  return Number.isFinite(n) && n >= VOICE_SPEED.min && n <= VOICE_SPEED.max ? n : 1;
}

/** everything a user must see before spending: credits, what Seedance will be asked, output settings */
async function buildQuote(userId, productId, langs, style = "product", clipSource = "auto") {
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
  // "auto" follows CLIP_MODE; the explicit choices map onto the same clip modes
  if (clipSource === "auto") clipSource = { photos: "photos", gemini: "ai_video", seedance: "ai_video" }[seedance.clipMode()] || "auto";
  const aiProvider = seedance.aiVideoProvider();
  if (clipSource === "ai_video" && !aiProvider) return { status: 400, error: "AI video is not set up (GEMINI_API_KEY or SEEDANCE_API_KEY)" };
  const upload = clipSource === "upload";
  const scenes = clipSource === "scenes";
  if (upload && !product.clip_path) return { status: 400, error: "upload your product clip first" };
  const sceneList = Array.isArray(product.scenes) ? product.scenes : [];
  if (scenes && (!sceneList.length || sceneList.some((s) => !s.path))) {
    return { status: 400, error: "make all scene images first (redo the missing ones)" };
  }
  // only an AI video costs the platform real money per clip; every other clip is voiceover + captions
  const cost = upload || clipSource === "photos" ? UPLOAD_COST() : scenes ? SCENES_VIDEO_COST() : COST();
  const clip = upload
    ? { mode: "upload", model: null, duration: Number(product.clip_seconds), resolution: "720p" }
    : scenes
      ? { mode: "scenes", model: null, duration: sceneList.reduce((a, s) => a + Number(s.seconds), 0), resolution: "720p", scene_count: sceneList.length }
      : seedance.clipSettings(clipSource === "ai_video" ? aiProvider : clipSource === "photos" ? "photos" : undefined);
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
    clip_source: clipSource,
    clip: {
      mode: clip.mode,
      // style only changes the AI video prompt (Seedance / Gemini); the free photo clip has no people
      style,
      style_applies: clip.mode === "seedance" || clip.mode === "gemini",
      model: clip.model,
      duration_s: clip.duration,
      resolution: clip.resolution,
      reference_images: Math.min(4, (product.images || []).length),
      scene_count: clip.scene_count,
      prompt: seedance.buildProductPrompt(product, { style }),
    },
    voiceover: voiceoverLabel(langs),
    // the speed slider starts here (the user can change it per video before confirming)
    voice_speed_default: Object.fromEntries(langs.map((l) => [l, defaultVoiceSpeed(l)])),
    voice_speed_range: VOICE_SPEED,
  };
}

/** GET /api/jobs/quote?product_id=1&langs=th,my — free preview, nothing is charged */
r.get("/quote", ah(async (req, res) => {
  const q = await buildQuote(req.userId, parseId(req.query.product_id, "product_id"), parseLangs(req.query.langs), parseStyle(req.query.style), parseClipSource(req.query.clip_source));
  if (q.error) return res.status(q.status).json({ error: q.error });
  res.json(q);
}));

/**
 * body: { product_id, langs: ["th","my"], style: one of CLIP_STYLES, clip_source?: "auto"|"upload",
 *         voice_speed?: { th: 1.1, my: 1.2 }, confirm_cost }
 * confirm_cost must equal the quoted cost — the user explicitly agreed to this price.
 * Credits are charged up front and refunded on failure.
 */
r.post("/", ah(async (req, res) => {
  const productId = parseId(req.body.product_id, "product_id");
  const langs = parseLangs(req.body.langs);
  const style = parseStyle(req.body.style);
  const clipSource = parseClipSource(req.body.clip_source);
  const voiceSpeed = parseVoiceSpeed(req.body.voice_speed, langs);
  const q = await buildQuote(req.userId, productId, langs, style, clipSource);
  if (q.error) return res.status(q.status).json({ error: q.error });
  if (q.missing_scripts.length) return res.status(400).json({ error: `write the script first for: ${q.missing_scripts.join(", ")}` });
  const issues = Object.values(q.script_issues);
  if (issues.length) return res.status(400).json({ error: issues.join("; ") });
  if (Number(req.body.confirm_cost) !== q.cost) {
    return res.status(409).json({ error: "the price changed or was not confirmed — review the quote again", quote: q });
  }

  const job = await tx(async (c) => {
    const { rows } = await c.query(
      "INSERT INTO video_jobs (user_id, product_id, langs, credits_charged, style, clip_source, voice_speed) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [req.userId, productId, langs, q.cost, style, q.clip_source, voiceSpeed && JSON.stringify(voiceSpeed)], // the source the user was quoted for
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
