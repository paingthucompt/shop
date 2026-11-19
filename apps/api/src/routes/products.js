import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import crypto from "node:crypto";
import { query } from "@app/db";
import { llm, shopee } from "@app/providers";
import { ah, requireAuth, STORAGE_DIR, mediaUrl } from "../lib.js";
import { httpError, parseId, parseLangs, isShopeeUrl } from "../validate.js";
import { validateScript, clampScript } from "../script-rules.js";

const r = Router();
r.use(requireAuth);

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

// public shape: signed URLs only — never absolute server paths
const present = (p) => ({ ...p, images: (p.images || []).map((i) => ({ url: mediaUrl(i.path), mime: i.mime })) });

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

/** multipart: title, description, price, currency, product_url, affiliate_url, images[] (1–4) */
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
       VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.userId, p.title, p.description, p.price, p.currency, p.productUrl, affiliateUrl, JSON.stringify(images)],
    );
    res.status(201).json(present(rows[0]));
  } catch (e) {
    await removeUploads(req.files);
    throw e;
  }
}));

r.get("/:id", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  const { rows: scripts } = await query("SELECT lang, hook, lines, captions, cta, updated_at FROM scripts WHERE product_id = $1", [p.id]);
  res.json({ ...present(p), scripts: Object.fromEntries(scripts.map((s) => [s.lang, s])) });
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
    ...jobs.map((j) => removeStored(join(STORAGE_DIR, "jobs", String(j.id)))),
  ]);
  res.status(204).end();
}));

const saveScript = (productId, lang, s) => query(
  `INSERT INTO scripts (product_id, lang, hook, lines, captions, cta) VALUES ($1,$2,$3,$4,$5,$6)
   ON CONFLICT (product_id, lang) DO UPDATE SET hook = EXCLUDED.hook, lines = EXCLUDED.lines,
     captions = EXCLUDED.captions, cta = EXCLUDED.cta, updated_at = now()
   RETURNING lang, hook, lines, captions, cta, updated_at`,
  [productId, lang, s.hook, JSON.stringify(s.lines), JSON.stringify(s.captions || []), s.cta],
).then((r) => r.rows[0]);

/** AI-write separate scripts. body: { langs: ["th","my"] } */
r.post("/:id/scripts/generate", aiLimiter, ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  const langs = parseLangs(req.body.langs);
  const out = {};
  for (const lang of langs) {
    const s = await llm.generateScript(p, lang, { seconds: Number(process.env.SEEDANCE_DURATION || 10) });
    out[lang] = { ...(await saveScript(p.id, lang, clampScript(s))), mock: !!s.mock };
  }
  res.json(out);
}));

/** user edits a script. body: { hook, lines: [], captions?: [] (on-screen text per line), cta } */
r.put("/:id/scripts/:lang", ah(async (req, res) => {
  const p = await ownProduct(req.userId, req.params.id);
  const { lang } = req.params;
  if (!["th", "my"].includes(lang)) return res.status(400).json({ error: "lang must be th or my" });
  const { script, error } = validateScript(req.body, lang);
  if (error) return res.status(400).json({ error });
  res.json(await saveScript(p.id, lang, script));
}));

export default r;
