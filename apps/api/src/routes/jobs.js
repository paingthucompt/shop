import { Router } from "express";
import { query, tx, changeCredits, failJob } from "@app/db";
import { seedance, higgsfield, pricing, sceneImages, keys, aiCatalog } from "@app/providers";
import { ah, requireAuth, withUserKeys, videoQueue, mediaUrl } from "../lib.js";
import { parseAiProvider, parseClipSource, parseId, parseLangs, parseStyle, parseVoiceSpeed, publicError, publicErrorCode, VOICE_SPEED } from "../validate.js";
import { foreignScriptIssue } from "../script-rules.js";

const r = Router();
r.use(requireAuth);
r.use(withUserKeys); // the user's own AI keys → their videos cost no credits

const COST = () => Number(process.env.JOB_CREDIT_COST || 10);
// the user's own clip / the already-paid scene images only need voiceover + captions: no AI video cost
const UPLOAD_COST = () => Number(process.env.UPLOAD_CREDIT_COST || 2);
const SCENES_VIDEO_COST = () => Number(process.env.SCENES_VIDEO_CREDIT_COST || 2);

async function loadJob(userId, id) {
  const { rows } = await query("SELECT * FROM video_jobs WHERE id = $1 AND user_id = $2", [id, userId]);
  const j = rows[0];
  if (!j) return null;
  const [{ rows: vids }, { rows: refund }, { rows: spend }] = await Promise.all([
    query("SELECT lang, path, srt_path, duration FROM videos WHERE job_id = $1 ORDER BY lang", [id]),
    query("SELECT 1 FROM credit_ledger WHERE user_id = $1 AND reason = 'refund' AND ref = $2 LIMIT 1", [userId, String(id)]),
    query("SELECT kind, sum(usd) AS usd, bool_or(NOT priced) AS unpriced FROM api_usage WHERE job_id = $1 GROUP BY kind ORDER BY kind", [id]),
  ]);
  return {
    id: j.id, product_id: j.product_id, langs: j.langs, status: j.status, stage: j.stage, style: j.style,
    credits_charged: j.credits_charged, own_key: j.own_key, created_at: j.created_at, updated_at: j.updated_at,
    error: j.status === "failed" ? publicError(j.error, { ownKey: j.own_key }) : null,
    error_code: j.status === "failed" ? publicErrorCode(j.error) : null,
    refunded: refund.length > 0,
    clip_url: mediaUrl(j.clip_path),
    videos: vids.map((v) => ({ lang: v.lang, duration: v.duration, url: mediaUrl(v.path), srt_url: mediaUrl(v.srt_path) })),
    // what the job's API calls really cost (AI clip + voiceover); scripts / scene images are on the product
    api_usd: Math.round(spend.reduce((a, s) => a + Number(s.usd), 0) * 1e4) / 1e4,
    api_cost: spend.map((s) => ({ kind: s.kind, usd: Math.round(Number(s.usd) * 1e4) / 1e4, unpriced: s.unpriced })),
  };
}

/** TTS_PROVIDER_TH / _MY override TTS_PROVIDER per language → "gemini", or "th:gemini · my:edge" when they differ */
function voiceoverLabel(langs) {
  const of = (l) => String(process.env[`TTS_PROVIDER_${l.toUpperCase()}`] || process.env.TTS_PROVIDER || "none").toLowerCase();
  const all = [...new Set(langs.map(of))];
  return all.length === 1 ? all[0] : langs.map((l) => `${l}:${of(l)}`).join(" · ");
}

/** everything a user must see before spending: credits, what Seedance will be asked, output settings */
/** the model picked for one AI video: a Higgsfield model path or a Gemini Omni resolution; "" → default */
function parseAiModel(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!higgsfield.MODELS[value] && !aiCatalog.GEMINI_VIDEO[value]) {
    throw Object.assign(new Error(`ai_model must be one of: ${[...Object.keys(aiCatalog.GEMINI_VIDEO), ...Object.keys(higgsfield.MODELS)].join(", ")}`), { status: 400 });
  }
  return value;
}

async function buildQuote(userId, productId, langs, style = "product", clipSource = "auto", aiChoice = null, aiModel = null) {
  const { rows: [product] } = await query("SELECT * FROM products WHERE id = $1 AND user_id = $2", [productId, userId]);
  if (!product) return { status: 404, error: "product not found" };
  if (keys.keyMissing()) return { status: 400, error: "add your own Gemini API key in Settings first", code: "need_key" };
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
  const aiProvider = seedance.aiVideoProvider(aiChoice);
  if (clipSource === "ai_video" && !aiProvider) return { status: 400, error: "AI video is not set up (GEMINI_API_KEY or SEEDANCE_API_KEY)" };
  const upload = clipSource === "upload";
  const scenes = clipSource === "scenes";
  if (upload && !product.clip_path) return { status: 400, error: "upload your product clip first" };
  const sceneList = Array.isArray(product.scenes) ? product.scenes : [];
  if (scenes && (!sceneList.length || sceneList.some((s) => !s.path))) {
    return { status: 400, error: "make all scene images first (redo the missing ones)" };
  }
  // only an AI video costs the platform real money per clip; every other clip is voiceover + captions
  // with the user's own keys every API call is on their own bill → no credits
  const ownKey = keys.usingOwnKeys();
  const cost = ownKey ? 0 : upload || clipSource === "photos" ? UPLOAD_COST() : scenes ? SCENES_VIDEO_COST() : COST();
  const clip = upload
    ? { mode: "upload", model: null, duration: Number(product.clip_seconds), resolution: "720p" }
    : scenes
      ? { mode: "scenes", model: null, duration: sceneList.reduce((a, s) => a + Number(s.seconds), 0), resolution: "720p", scene_count: sceneList.length }
      : seedance.clipSettings(clipSource === "ai_video" ? aiProvider : clipSource === "photos" ? "photos" : undefined,
        // a model only counts for the service it belongs to (a Gemini resolution never goes to Higgsfield)
        { model: aiProvider === "higgsfield" ? (higgsfield.MODELS[aiModel] ? aiModel : null) : (aiCatalog.GEMINI_VIDEO[aiModel] ? aiModel : null) });
  const balance = user?.credits ?? 0;
  return {
    product_id: productId,
    langs,
    cost,
    own_key: ownKey,
    balance,
    balance_after: balance - cost,
    enough_credits: balance >= cost,
    missing_scripts: missing,
    script_issues: scriptIssues,
    clip_source: clipSource,
    // the AI video services this user can pick from (the quote is for ai_provider)
    ai_provider: clipSource === "ai_video" ? aiProvider : null,
    // stored with the job: the Higgsfield model path, or the Gemini Omni resolution
    ai_model: clipSource !== "ai_video" ? null : aiProvider === "higgsfield" ? clip.model : aiProvider === "gemini" ? clip.resolution : null,
    ai_providers: seedance.aiVideoProviders(),
    clip: {
      mode: clip.mode,
      // style only changes the AI video prompt (Seedance / Gemini); the free photo clip has no people
      style,
      style_applies: ["seedance", "gemini", "higgsfield"].includes(clip.mode),
      model: clip.model,
      model_name: clip.name || null,
      duration_s: clip.duration,
      resolution: clip.resolution,
      reference_images: Math.min(4, (product.images || []).length),
      scene_count: clip.scene_count,
      // US$ the AI clip will cost on the provider bill (same price table as the cost tracking)
      api_usd: ["seedance", "gemini", "higgsfield"].includes(clip.mode)
        ? Math.round((pricing.estimateClipUsd({ provider: clip.mode, model: clip.model, seconds: clip.duration, resolution: clip.resolution })
          + (clip.mode === "higgsfield" ? sceneImages.startFrameUsd() : 0)) * 1e4) / 1e4 : 0,
      prompt: seedance.buildProductPrompt(product, { style }),
    },
    voiceover: voiceoverLabel(langs),
    // the speed slider starts here (the user can change it per video before confirming)
    voice_speed_default: Object.fromEntries(langs.map((l) => [l, 1])),
    voice_speed_range: VOICE_SPEED,
  };
}

/** GET /api/jobs/quote?product_id=1&langs=th,my — free preview, nothing is charged */
r.get("/quote", ah(async (req, res) => {
  const q = await buildQuote(req.userId, parseId(req.query.product_id, "product_id"), parseLangs(req.query.langs), parseStyle(req.query.style), parseClipSource(req.query.clip_source), parseAiProvider(req.query.ai_provider), parseAiModel(req.query.ai_model));
  if (q.error) return res.status(q.status).json({ error: q.error, code: q.code });
  res.json(q);
}));

/**
 * body: { product_id, langs: ["th","my"], style: one of CLIP_STYLES, clip_source?: "auto"|"upload",
 *         voice_speed?: { th: 1.1, my: 1.2 }, clip_has_voice?: boolean (upload only), confirm_cost }
 * confirm_cost must equal the quoted cost — the user explicitly agreed to this price.
 * Credits are charged up front and refunded on failure.
 */
r.post("/", ah(async (req, res) => {
  const productId = parseId(req.body.product_id, "product_id");
  const langs = parseLangs(req.body.langs);
  const style = parseStyle(req.body.style);
  const clipSource = parseClipSource(req.body.clip_source);
  const voiceSpeed = parseVoiceSpeed(req.body.voice_speed, langs);
  const clipHasVoice = req.body.clip_has_voice === true;
  const q = await buildQuote(req.userId, productId, langs, style, clipSource, parseAiProvider(req.body.ai_provider), parseAiModel(req.body.ai_model));
  if (q.error) return res.status(q.status).json({ error: q.error, code: q.code });
  if (q.missing_scripts.length) return res.status(400).json({ error: `write the script first for: ${q.missing_scripts.join(", ")}` });
  const issues = Object.values(q.script_issues);
  if (issues.length) return res.status(400).json({ error: issues.join("; ") });
  if (clipHasVoice && q.clip_source !== "upload") return res.status(400).json({ error: "\"the clip already has the voice\" only applies to an uploaded clip" });
  // a talking clip speaks ONE language — making a second language from it would put the wrong voice in it
  if (clipHasVoice && langs.length !== 1) return res.status(400).json({ error: "a clip with a voice speaks one language — choose only that language" });
  if (Number(req.body.confirm_cost) !== q.cost) {
    return res.status(409).json({ error: "the price changed or was not confirmed — review the quote again", quote: q });
  }

  const job = await tx(async (c) => {
    const { rows } = await c.query(
      "INSERT INTO video_jobs (user_id, product_id, langs, credits_charged, style, clip_source, voice_speed, clip_has_voice, own_key, ai_provider, ai_model) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [req.userId, productId, langs, q.cost, style, q.clip_source, clipHasVoice ? null : voiceSpeed && JSON.stringify(voiceSpeed), clipHasVoice, q.own_key, q.ai_provider, q.ai_model], // the source the user was quoted for
    );
    if (q.cost > 0) await changeCredits(c, req.userId, -q.cost, "job", String(rows[0].id));
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

/** the history list: enough to recognise, filter and download each job without opening it */
r.get("/", ah(async (req, res) => {
  const { rows } = await query(
    `SELECT j.id, j.product_id, p.title AS product_title, p.images->0->>'path' AS image_path,
            j.langs, j.status, j.stage, j.clip_source, j.style, j.credits_charged, j.own_key, j.clip_has_voice,
            j.created_at, j.updated_at,
            (SELECT COALESCE(sum(u.usd), 0) FROM api_usage u WHERE u.job_id = j.id) AS api_usd,
            COALESCE((SELECT json_agg(json_build_object('lang', v.lang, 'path', v.path, 'duration', v.duration) ORDER BY v.lang)
                      FROM videos v WHERE v.job_id = j.id), '[]') AS videos,
            EXISTS (SELECT 1 FROM credit_ledger c WHERE c.user_id = j.user_id AND c.reason = 'refund' AND c.ref = j.id::text) AS refunded
     FROM video_jobs j JOIN products p ON p.id = j.product_id WHERE j.user_id = $1 ORDER BY j.created_at DESC LIMIT 200`,
    [req.userId],
  );
  res.json(rows.map(({ image_path: img, videos, ...j }) => ({
    ...j,
    api_usd: Math.round(Number(j.api_usd) * 1e4) / 1e4,
    image_url: mediaUrl(img),
    videos: videos.map((v) => ({ lang: v.lang, duration: v.duration, url: mediaUrl(v.path) })),
  })));
}));

r.get("/:id", ah(async (req, res) => {
  const job = await loadJob(req.userId, parseId(req.params.id));
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
}));

export default r;
