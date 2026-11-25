import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import crypto from "node:crypto";
import { query, tx, changeCredits } from "@app/db";
import { llm, shopee, seedance, flowPrompt, sceneImages, productLink, usage, keys, apiErrors } from "@app/providers";
import { probeClip } from "@app/video-engine";
import { ah, requireAuth, withUserKeys, requireKey, STORAGE_DIR, mediaUrl } from "../lib.js";
import { httpError, parseId, parseLangs, parseAngle, parseStyle, isShopeeUrl, publicError } from "../validate.js";
import { validateScript, clampScript } from "../script-rules.js";

const r = Router();
r.use(requireAuth);
r.use(withUserKeys); // the user's own AI keys, if they added them
// cost tracking: AI calls made while handling a request are recorded for this user (and product)
r.use((req, _res, next) => usage.withUsage({ userId: req.userId }, next));
r.param("id", (_req, _res, next, id) => usage.withUsage({ productId: Number(id) || null }, next));

// extension comes from the (filtered) mime type, never from the client's file name
const IMG_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = join(STORAGE_DIR, "uploads", String(req.userId));
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, f, cb) => cb(null, `${crypto.randomUUID()}${IMG_EXT[f.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
  fileFilter: (_req, f, cb) => (IMG_EXT[f.mimetype] ? cb(null, true) : cb(httpError(400, "only jpg/png/webp images"))),
});

// the user's own product clip (e.g. downloaded from Google Flow); the worker normalises it to 9:16
const VIDEO_EXT = { "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" };
const CLIP_MAX_MB = 200;
const clipUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = join(STORAGE_DIR, "uploads", String(req.userId));
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, f, cb) => cb(null, `clip-${crypto.randomUUID()}${VIDEO_EXT[f.mimetype]}`),
  }),
  limits: { fileSize: CLIP_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => (VIDEO_EXT[f.mimetype] ? cb(null, true) : cb(httpError(400, "only MP4, MOV or WebM videos"))),
});

// AI script writing costs the platform money but no credits → cap it per user
const aiLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: Number(process.env.SCRIPT_GEN_PER_HOUR || 20),
  keyGenerator: (req) => `user:${req.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many AI script requests — try again in a while" },
});

const CURRENCIES = ["THB", "MMK", "USD"];

// link import downloads photos from the shops' CDNs → cap it per user
const importLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: Number(process.env.LINK_IMPORT_PER_HOUR || 60),
  keyGenerator: (req) => `user:${req.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many link imports — try again in a while" },
});

/** bookmarklet data from the user's browser: only plain strings / numbers, bounded sizes */
function parseImportPage(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const str = (x, max) => (typeof x === "string" ? x.slice(0, max) : "");
  return {
    url: str(v.url, 2000),
    title: str(v.title, 300),
    description: str(v.description, 3000),
    price: typeof v.price === "number" || typeof v.price === "string" ? String(v.price).replace(/[^\d.]/g, "").slice(0, 20) : "",
    currency: str(v.currency, 5).toUpperCase(),
    images: Array.isArray(v.images) ? v.images.filter((u) => typeof u === "string").slice(0, 30).map((u) => u.slice(0, 2000)) : [],
  };
}

// public shape: signed URLs only — never absolute server paths
const present = ({ clip_path: clipPath, clip_seconds: clipSecs, ...p }) => ({
  ...p,
  images: (p.images || []).map((i) => ({ url: mediaUrl(i.path), mime: i.mime })),
  clip: clipPath ? { url: mediaUrl(clipPath), seconds: Number(clipSecs) } : null,
  scenes: Array.isArray(p.scenes)
    ? p.scenes.map(({ path, prompt, mime, ...s }) => ({ ...s, url: path ? mediaUrl(path) : null }))
    : null,
});

const removeUploads = (files = []) => Promise.all(files.map((f) => rm(f.path, { force: true })));

/** delete a path only if it is inside STORAGE_DIR */
const removeStored = (p) => {
  const abs = resolve(p);
  return abs.startsWith(STORAGE_DIR + sep) ? rm(abs, { recursive: true, force: true }) : null;
};

async function ownProduct(userId, rawId) {
  const { rows } = await query("SELECT * FROM products WHERE id = $1 AND user_id = $2", [parseId(rawId), userId]);
  if (!rows[0]) throw httpError(404, "product not found");
  return rows[0];
}

function parseProductForm(b) {
  const title = String(b.title || "").trim();
  if (!title) return { error: "title required" };
  if (title.length > 200) return { error: "title is too long (max 200)" };
  const description = String(b.description || "").trim();
  if (description.length > 2000) return { error: "details are too long (max 2000)" };
  let price = null;
  if (b.price !== undefined && String(b.price).trim() !== "") {
    price = Number(b.price);
    if (!Number.isFinite(price) || price < 0 || price > 1e10) return { error: "invalid price" };
  }
  const currency = b.currency || "THB";
  if (!CURRENCIES.includes(currency)) return { error: `currency must be one of ${CURRENCIES.join(", ")}` };
  const urlOk = (u) => { try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; } };
  const productUrl = String(b.product_url || "").trim() || null;
  const affiliateUrl = String(b.affiliate_url || "").trim() || null;
  if ((productUrl && !urlOk(productUrl)) || (affiliateUrl && !urlOk(affiliateUrl))) return { error: "links must be http(s) URLs" };
  return { value: { title, description: description || null, price, currency, productUrl, affiliateUrl } };
}

r.get("/", ah(async (req, res) => {
  const { rows } = await query("SELECT * FROM products WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [req.userId]);
  res.json(rows.map(present));
}));

/**
 * POST /api/products/import  { url } and/or { page } (from the bookmarklet) → product fields + photos as
 * data URLs for the "Add product" form. Nothing is saved yet: the user checks it and presses Save.
 */
r.post("/import", importLimiter, ah(async (req, res) => {
  const url = typeof req.body.url === "string" ? req.body.url.trim().slice(0, 4000) : "";
  const page = parseImportPage(req.body.page);
  if (!url && !page) throw httpError(400, "paste a TikTok Shop or Shopee product link");
  const r2 = await productLink.importProduct({ url: url || undefined, page }, { shopee });
  res.json({
    ...r2,
    images: r2.images.map((i) => ({ src: `data:${i.mime};base64,${i.data.toString("base64")}`, mime: i.mime })),
  });
}));

/** multipart: title, description, price, currency, product_url, affiliate_url, source, images[] (1–4) */
r.post("/", upload.array("images", 4), ah(async (req, res) => {
  const form = parseProductForm(req.body);
  if (form.error || !req.files?.length) {
    await removeUploads(req.files);
    return res.status(400).json({ error: form.error || "at least one product image required" });
  }
  const p = form.value;
  let affiliateUrl = p.affiliateUrl;
  if (!affiliateUrl && p.productUrl && isShopeeUrl(p.productUrl) && shopee.shopeeEnabled()) {
    try { affiliateUrl = await shopee.generateShortLink(p.productUrl, [`u${req.userId}`]); } catch (e) { console.warn(e.message); }
  }
  const images = req.files.map((f) => ({ path: f.path, mime: f.mimetype }));
  try {
    const { rows } = await query(
      `INSERT INTO products (user_id, source, title, description, price, currency, product_url, affiliate_url, images)
       VALUES ($1,$9,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.userId, p.title, p.description, p.price, p.currency, p.productUrl, affiliateUrl, JSON.stringify(images),
        ["tiktok", "shopee"].includes(req.body.source) ? req.body.source : "manual"],
    );
    res.status(201).json(present(rows[0]));
  } catch (e) {
    await removeUploads(req.files);
    throw e;
  }
}));

r.get("/:id", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  const { rows: scripts } = await query("SELECT lang, hook, lines, captions, cta, angle, updated_at FROM scripts WHERE product_id = $1", [p.id]);
  const byLang = Object.fromEntries(scripts.map((s) => [s.lang, s]));
  res.json({ ...present(p), scripts: byLang, flow_prompts: flowPromptsOf(p, p.clip_prompt, byLang), features: { scene_images: scenesOn(), ai_video: seedance.aiVideoProvider() } });
}));

const MAX_IMAGES = 4;
const hasActiveJob = async (productId) =>
  (await query("SELECT 1 FROM video_jobs WHERE product_id = $1 AND status IN ('queued', 'running') LIMIT 1", [productId])).rows.length > 0;
const BUSY = "a video is still being made for this product — wait until it finishes";

/** add photos to an existing product (multipart images[]); total stays ≤ 4 */
r.post("/:id/images", upload.array("images", MAX_IMAGES), ah(async (req, res) => {
  const files = req.files || [];
  try {
    const p = await ownProduct(req.userId, req.params.id);
    if (!files.length) throw httpError(400, "choose at least one photo");
    const added = files.map((f) => ({ path: f.path, mime: f.mimetype }));
    // the length check is part of the UPDATE, so two parallel uploads cannot exceed the limit
    const { rows } = await query(
      `UPDATE products SET images = images || $2::jsonb
       WHERE id = $1 AND jsonb_array_length(images) + $3 <= ${MAX_IMAGES} RETURNING *`,
      [p.id, JSON.stringify(added), added.length],
    );
    if (!rows[0]) throw httpError(400, `a product can have at most ${MAX_IMAGES} photos (it has ${p.images.length})`);
    res.status(201).json(present(rows[0]));
  } catch (e) {
    await removeUploads(files);
    throw e;
  }
}));

/** remove one photo by position; at least one photo must remain */
r.delete("/:id/images/:index", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= p.images.length) return res.status(400).json({ error: "invalid photo" });
  if (p.images.length <= 1) return res.status(400).json({ error: "a product needs at least one photo" });
  if (await hasActiveJob(p.id)) return res.status(409).json({ error: BUSY });
  const removed = p.images[index];
  const next = p.images.filter((_, i) => i !== index);
  // only apply if nobody changed the photos meanwhile
  const { rows } = await query(
    "UPDATE products SET images = $2::jsonb WHERE id = $1 AND images = $3::jsonb RETURNING *",
    [p.id, JSON.stringify(next), JSON.stringify(p.images)],
  );
  if (!rows[0]) return res.status(409).json({ error: "the photos changed — reload and try again" });
  await removeStored(removed.path)?.catch(() => {});
  res.json(present(rows[0]));
}));

r.delete("/:id", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  if (await hasActiveJob(p.id)) return res.status(409).json({ error: BUSY });
  const { rows: jobs } = await query("SELECT id FROM video_jobs WHERE product_id = $1", [p.id]);
  await query("DELETE FROM products WHERE id = $1", [p.id]);
  // files are not in the DB cascade: remove uploads and rendered videos (best effort)
  await Promise.allSettled([
    ...(p.images || []).map((i) => removeStored(i.path)),
    ...(p.clip_path ? [removeStored(p.clip_path)] : []),
    removeStored(join(STORAGE_DIR, "scenes", String(p.id))),
    ...jobs.map((j) => removeStored(join(STORAGE_DIR, "jobs", String(j.id)))),
  ]);
  res.status(204).end();
}));

/** angle: set when the AI writes the script; null (a user edit) keeps the stored one */
const saveScript = (productId, lang, s, angle = null) => query(
  `INSERT INTO scripts (product_id, lang, hook, lines, captions, cta, angle) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'auto'))
   ON CONFLICT (product_id, lang) DO UPDATE SET hook = EXCLUDED.hook, lines = EXCLUDED.lines,
     captions = EXCLUDED.captions, cta = EXCLUDED.cta, angle = COALESCE($7, scripts.angle), updated_at = now()
   RETURNING lang, hook, lines, captions, cta, angle, updated_at`,
  [productId, lang, s.hook, JSON.stringify(s.lines), JSON.stringify(s.captions || []), s.cta, angle],
).then((r) => r.rows[0]);

const saveClipPrompt = (productId, cp) => query(
  "UPDATE products SET clip_prompt = $2 WHERE id = $1 RETURNING clip_prompt", [productId, JSON.stringify(cp)],
).then((r) => r.rows[0]?.clip_prompt ?? null);

const scriptsOf = (productId) => query("SELECT lang, hook, lines, captions, cta FROM scripts WHERE product_id = $1", [productId])
  .then((r) => Object.fromEntries(r.rows.map((s) => [s.lang, s])));

/**
 * The Google Flow prompts per language — derived from the scripts + clip prompt, never stored:
 *   storyboard = Flow Image prompt for the storyboard sheet
 *   video      = Flow Video prompt that turns that storyboard (+ product photos) into the silent clip
 * → { th: { storyboard, video, seconds }, my: … } | null
 */
function flowPromptsOf(p, clipPrompt, scripts) {
  if (!clipPrompt) return null;
  const { seconds, shots, style } = clipPrompt;
  return Object.fromEntries(Object.entries(scripts)
    .filter(([lang]) => ["th", "my"].includes(lang))
    .map(([lang, script]) => [lang, {
      seconds,
      storyboard: flowPrompt.buildStoryboardPrompt(p, lang, { script, seconds, shots, style }),
      video: flowPrompt.buildStoryboardVideoPrompt(p, lang, { script, seconds, shots, style }),
      video_talking: flowPrompt.buildStoryboardVideoPrompt(p, lang, { script, seconds, shots, style, speaking: true }),
    }]));
}

// AI scene images cost ~US$0.07 each → off unless SCENE_IMAGES=on (Flow makes the pictures for free)
const scenesOn = () => /^(on|1|true|yes)$/i.test(process.env.SCENE_IMAGES || "") && sceneImages.sceneImagesEnabled();

/**
 * AI-write one script per language (in parallel), then ONE Google Flow prompt for the silent product
 * clip both languages share (its shots follow the script). A failing prompt never loses the scripts.
 * body: { langs: ["th","my"], angle?: "auto"|"problem_solution"|…, style?: one of CLIP_STYLES }
 * → { scripts: { th, my }, clip_prompt: { style, seconds, shots, prompt, mock } }
 */
r.post("/:id/scripts/generate", aiLimiter, ah(async (req, res) => {
  requireKey();
  const p = await ownProduct(req.userId, req.params.id);
  const langs = parseLangs(req.body.langs);
  const angle = parseAngle(req.body.angle);
  const style = parseStyle(req.body.style);
  const seconds = seedance.clipSettings().duration;
  const entries = await Promise.all(langs.map(async (lang) => {
    const s = await llm.generateScript(p, lang, { seconds, angle }).catch((e) => {
      if (e.status) throw e; // a script problem the user can act on
      console.error(`[scripts] ${lang}: ${e.message}`);
      // the API key / its project is the problem (common with users' own keys) → say what to fix
      const code = apiErrors.errorCode(e.message);
      if (apiErrors.isKeyProblem(code)) throw Object.assign(httpError(400, publicError(e.message)), { code, expose: true });
      throw Object.assign(httpError(503, "the AI writer is busy or unreachable — try again in a minute"), { expose: true });
    });
    return [lang, { ...(await saveScript(p.id, lang, clampScript(s), angle)), mock: !!s.mock }];
  }));
  const scripts = await scriptsOf(p.id); // all languages, so the clip is long enough for each voiceover
  let cp;
  try {
    cp = await llm.generateClipPrompt(p, { style, scripts });
  } catch (err) {
    console.warn(`clip prompt for product ${p.id} failed: ${err.message}`);
    const secs = flowPrompt.clipSeconds(scripts);
    cp = { style, seconds: secs, shots: null, mock: true, prompt: flowPrompt.buildClipPrompt(p, { style, seconds: secs }) };
  }
  const clipPrompt = await saveClipPrompt(p.id, cp);
  res.json({ scripts: Object.fromEntries(entries), clip_prompt: clipPrompt, flow_prompts: flowPromptsOf(p, clipPrompt, scripts) });
}));

/** user edits a script. body: { hook, lines: [], captions?: [] (on-screen text per line), cta } → script + clip_prompt */
r.put("/:id/scripts/:lang", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  const { lang } = req.params;
  if (!["th", "my"].includes(lang)) return res.status(400).json({ error: "lang must be th or my" });
  const { script, error } = validateScript(req.body, lang);
  if (error) return res.status(400).json({ error });
  const saved = await saveScript(p.id, lang, script);
  // a longer / shorter voiceover changes the clip length the Flow prompt asks for (shots are kept)
  let clipPrompt = p.clip_prompt;
  const all = await scriptsOf(p.id);
  if (clipPrompt) {
    const seconds = flowPrompt.clipSeconds(all);
    if (seconds !== clipPrompt.seconds) {
      const { style = "product", shots = null } = clipPrompt;
      clipPrompt = await saveClipPrompt(p.id, { ...clipPrompt, seconds, prompt: flowPrompt.buildClipPrompt(p, { style, seconds, shots }) });
    }
  }
  res.json({ ...saved, clip_prompt: clipPrompt, flow_prompts: flowPromptsOf(p, clipPrompt, all) });
}));

/** upload the product clip (multipart field "clip"): MP4 / MOV / WebM, 2–60 s, ≤ 200 MB */
r.post("/:id/clip", clipUpload.single("clip"), ah(async (req, res) => {
  const file = req.file;
  try {
    if (!file) throw httpError(400, "choose a video file");
    const p = await ownProduct(req.userId, req.params.id);
    if (await hasActiveJob(p.id)) throw httpError(409, BUSY);
    let info;
    try { info = probeClip(file.path); } catch { throw httpError(400, "this file is not a playable video"); }
    if (info.duration < 2 || info.duration > 60) throw httpError(400, `the clip must be 2–60 seconds (this one is ${info.duration.toFixed(1)} s)`);
    const { rows } = await query(
      "UPDATE products SET clip_path = $2, clip_seconds = $3 WHERE id = $1 RETURNING *", [p.id, file.path, info.duration.toFixed(2)],
    );
    if (p.clip_path) await removeStored(p.clip_path);
    res.status(201).json(present(rows[0]));
  } catch (err) {
    if (file) await rm(file.path, { force: true });
    throw err;
  }
}));

r.delete("/:id/clip", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  if (await hasActiveJob(p.id)) return res.status(409).json({ error: BUSY });
  const { rows } = await query("UPDATE products SET clip_path = NULL, clip_seconds = NULL WHERE id = $1 RETURNING *", [p.id]);
  if (p.clip_path) await removeStored(p.clip_path);
  res.json(present(rows[0]));
}));

// ---------------------------------------------------------------- AI scene images
// One Gemini image per script beat (≈ US$0.07 each), charged up front in credits and refunded per
// failed image. The images are animated into the clip by the worker (clip_source "scenes").
const SCENE_COST = () => Number(process.env.SCENE_CREDIT_COST || 1);
const sceneLocks = new Set(); // one generation at a time per product (double clicks cost real money)

const toDataUrl = (img) => readFile(img.path).then((b) => `data:${img.mime || "image/jpeg"};base64,${b.toString("base64")}`);
const IMG_EXT_OF = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

async function makeScene(p, refs, scene) {
  const prompt = sceneImages.buildScenePrompt(p, { style: p.clip_prompt?.style, visual: scene.visual, role: scene.role });
  const img = await sceneImages.generateSceneImage(prompt, refs);
  const dir = join(STORAGE_DIR, "scenes", String(p.id));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `scene-${scene.n}-${crypto.randomUUID()}${IMG_EXT_OF[img.mime] || ".png"}`);
  await writeFile(path, img.data);
  return { ...scene, prompt, path, mime: img.mime };
}

/** run fn over items, at most `limit` at a time; never rejects → [{ ok, value | error }] */
async function settleLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { ok: true, value: await fn(items[i]) }; } catch (error) { out[i] = { ok: false, error }; }
    }
  }));
  return out;
}

// changeCredits throws 402 "Not enough credits" when the balance is too low
// with the user's own Gemini key the images are on their Google bill → no credits
const chargeScenes = (userId, productId, count) => (keys.usingOwnKeys() ? null
  : tx((c) => changeCredits(c, userId, -count * SCENE_COST(), "scenes", `product:${productId}`)));
const refundScenes = (userId, productId, count) => count > 0 && !keys.usingOwnKeys()
  ? tx((c) => changeCredits(c, userId, count * SCENE_COST(), "refund", `scenes:product:${productId}`)) : null;

async function withSceneLock(productId, fn) {
  if (sceneLocks.has(productId)) throw httpError(409, "scene images are already being made for this product");
  sceneLocks.add(productId);
  try { return await fn(); } finally { sceneLocks.delete(productId); }
}

/** make all scene images from the scripts + Flow shot list. → product */
r.post("/:id/scenes", aiLimiter, ah(async (req, res) => {
  requireKey();
  const p = await ownProduct(req.userId, req.params.id);
  if (!scenesOn()) throw httpError(403, "AI scene images are turned off (SCENE_IMAGES=on to enable) — make the storyboard in Google Flow instead");
  if (await hasActiveJob(p.id)) throw httpError(409, BUSY);
  const scripts = await scriptsOf(p.id);
  const lang = ["my", "th"].find((l) => scripts[l]);
  if (!lang || !p.clip_prompt) throw httpError(400, "write the scripts first (AI write scripts)");
  if (!p.images?.length) throw httpError(400, "add product photos first");
  const plan = sceneImages.planScenes(scripts[lang], lang, { seconds: p.clip_prompt.seconds, shots: p.clip_prompt.shots });
  const result = await withSceneLock(p.id, async () => {
    await chargeScenes(req.userId, p.id, plan.length);
    const refs = await Promise.all(p.images.slice(0, 4).map(toDataUrl));
    const made = await settleLimited(plan, 3, (scene) => makeScene(p, refs, scene));
    const failed = made.filter((m) => !m.ok);
    await refundScenes(req.userId, p.id, failed.length);
    failed.forEach((m) => console.warn(`scene image for product ${p.id} failed: ${m.error.message}`));
    // keep the plan complete: failed scenes stay without an image and can be redone one by one
    const scenes = plan.map((s, i) => (made[i].ok ? made[i].value : { ...s, path: null }));
    const old = Array.isArray(p.scenes) ? p.scenes.map((s) => s.path).filter(Boolean) : [];
    const { rows } = await query("UPDATE products SET scenes = $2 WHERE id = $1 RETURNING *", [p.id, JSON.stringify(scenes)]);
    await Promise.allSettled(old.map(removeStored));
    return { product: rows[0], failed: failed.length };
  });
  res.status(201).json({ ...present(result.product), scenes_failed: result.failed });
}));

/** remake one scene image (1 scene's credits). → product */
r.post("/:id/scenes/:n", aiLimiter, ah(async (req, res) => {
  requireKey();
  const p = await ownProduct(req.userId, req.params.id);
  if (await hasActiveJob(p.id)) throw httpError(409, BUSY);
  if (!scenesOn()) throw httpError(403, "AI scene images are turned off (SCENE_IMAGES=on to enable)");
  const n = parseId(req.params.n, "scene");
  const scene = (p.scenes || []).find((s) => s.n === n);
  if (!scene) throw httpError(404, "scene not found");
  const updated = await withSceneLock(p.id, async () => {
    await chargeScenes(req.userId, p.id, 1);
    let made;
    try {
      made = await makeScene(p, await Promise.all(p.images.slice(0, 4).map(toDataUrl)), scene);
    } catch (err) {
      await refundScenes(req.userId, p.id, 1);
      throw httpError(502, `the scene image could not be made — your credit was refunded (${err.message.slice(0, 120)})`);
    }
    const { rows } = await query(
      `UPDATE products SET scenes = (SELECT jsonb_agg(CASE WHEN (e->>'n')::int = $2 THEN $3::jsonb ELSE e END ORDER BY ord)
         FROM jsonb_array_elements(scenes) WITH ORDINALITY AS t(e, ord)) WHERE id = $1 RETURNING *`,
      [p.id, n, JSON.stringify(made)],
    );
    if (scene.path) await removeStored(scene.path);
    return rows[0];
  });
  res.json(present(updated));
}));

export default r;
