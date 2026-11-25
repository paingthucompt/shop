// Higgsfield (open.higgsfield.ai) image-to-video — the user's own key replaces BytePlus Seedance.
// Docs: https://docs.higgsfield.ai   Auth: "Authorization: Key <KEY_ID>:<KEY_SECRET>"
//   POST /files/generate-upload-url → PUT the photo → POST /{model-path} { prompt, image_url, … }
//   → GET /requests/{id}/status until completed (video.url) | failed | nsfw | canceled
// One model path per deployment (HIGGSFIELD_MODEL). The default is the image-to-video model whose
// request schema is in Higgsfield's OpenAPI spec (Kling 2.5 Turbo Pro: prompt, image_url, duration 5|10).
// Other models: set HIGGSFIELD_MODEL to their path and add their extra fields with HIGGSFIELD_PARAMS (JSON).
// Failed and NSFW requests are not charged by Higgsfield.
import { buildProductPrompt } from "./seedance.js"; // circular, used at call time only
import { env as keyEnv } from "./keys.js";
import { providerError } from "./api-errors.js";

export const DEFAULT_MODEL = "kling-video/v2.5-turbo/pro/image-to-video";
const BASE = () => (process.env.HIGGSFIELD_BASE_URL || "https://api.higgsfield.ai").replace(/\/$/, "");

function extraParams() {
  try { return JSON.parse(process.env.HIGGSFIELD_PARAMS || "{}"); } catch { return {}; }
}

/**
 * The image-to-video models the user can pick (checked against the API 2026-11-26: each takes prompt +
 * image_url + duration; max = the longest clip it accepts). Prices per second in pricing.js.
 */
export const MODELS = {
  "kling-video/v2.5-turbo/pro/image-to-video": { name: "Kling 2.5 Turbo Pro", durations: [5, 10] },
  "kling-video/v4.0-flash/image-to-video": { name: "Kling 4.0 Flash", max: 20 },
  "kling-video/v4.0/image-to-video": { name: "Kling 4.0", max: 30 },
  "bytedance/seedance-2.5/image-to-video": { name: "Seedance 2.5", max: 30 },
};

/** a duration the model accepts, as close as possible to the wanted one */
export function modelDuration(model, wanted) {
  const m = MODELS[model];
  if (m?.durations) return m.durations.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a));
  return m?.max ? Math.min(m.max, Math.max(3, Math.round(wanted))) : wanted;
}

const cleanModel = (m) => String(m || "").replace(/^\/+/, "");

const cfg = (model) => ({
  key: keyEnv().HIGGSFIELD_API_KEY, // "KEY_ID:KEY_SECRET"
  model: cleanModel(model) || cleanModel(keyEnv().HIGGSFIELD_MODEL) || DEFAULT_MODEL,
  duration: Number(keyEnv().HIGGSFIELD_DURATION || 10),
  // the start frame is 1080×1920 and the model keeps its aspect; label used for pricing / the quote
  resolution: process.env.HIGGSFIELD_RESOLUTION || "720p",
});

export const higgsfieldEnabled = () => Boolean(cfg().key);
/** model / length / resolution of a clip; model: a MODELS key the user picked (else the default) */
export const higgsfieldSettings = (model) => {
  const c = cfg(model);
  return { model: c.model, name: MODELS[c.model]?.name || c.model, duration: modelDuration(c.model, c.duration), resolution: c.resolution };
};

/** "Higgsfield 401: …" errors (see api-errors.js for what the user is told) */
async function call(path, init = {}, key = cfg().key) {
  if (!key) throw new Error("HIGGSFIELD_API_KEY is not set");
  const res = await fetch(path.startsWith("http") ? path : `${BASE()}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(60_000),
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(providerError("Higgsfield", res.status, text));
  return text ? JSON.parse(text) : {};
}

/** a product photo → a temporary public URL Higgsfield can read */
export async function uploadImage(bytes, mime = "image/jpeg") {
  const u = await call("/files/generate-upload-url", { method: "POST", body: JSON.stringify({ content_type: mime }) });
  // the presigned URL gets only its own headers — never the API key
  const put = await fetch(u.upload_url, { method: "PUT", headers: { ...(u.upload_headers || {}), "Content-Type": u.content_type || mime }, body: bytes });
  if (!put.ok) throw new Error(`Higgsfield upload failed (${put.status})`);
  return u.public_url;
}

// never "text" alone: that also removes the product's own logo and label, which must stay
const NEGATIVE = "added captions, subtitles, overlay text, titles, watermark, new signs, stickers or price tags, missing or changed product logo, distorted or morphing product, duplicated product, extra fingers, blurry, low quality";

export function buildRequestBody(product, imageUrl, opts = {}) {
  const c = higgsfieldSettings(opts.model);
  // keep the prompt under ~2400 characters (style specs ≈ 1,700 + a 400-character description)
  const prompt = (opts.prompt || buildProductPrompt(product, { style: opts.style })).slice(0, 2400);
  return {
    prompt,
    image_url: imageUrl,
    duration: opts.duration || c.duration,
    negative_prompt: NEGATIVE,
    ...extraParams(),
  };
}

/**
 * Start one generation from the 9:16 start frame. idempotencyKey (e.g. "job-79") makes a retried
 * submit return the same request instead of paying twice. → request id
 */
export async function createRequest(product, frame, { mime = "image/jpeg", style, model, idempotencyKey } = {}) {
  const imageUrl = await uploadImage(frame, mime);
  const json = await call(`/${cfg(model).model}`, {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: JSON.stringify(buildRequestBody(product, imageUrl, { style, model })),
  });
  if (!json.request_id) throw new Error(`Higgsfield: no request_id in the reply (${JSON.stringify(json).slice(0, 200)})`);
  return json.request_id;
}

export const getRequest = (id) => call(`/requests/${encodeURIComponent(id)}/status`);

/** poll until the clip is ready → its URL (kept by Higgsfield for ≥ 7 days) */
export async function waitForRequest(id, { onStatus, intervalMs = 8000, timeoutMs = 20 * 60_000 } = {}) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    const r = await getRequest(id);
    if (r.status !== last) { last = r.status; onStatus?.(r.status); }
    if (r.status === "completed") {
      if (!r.video?.url) throw new Error("Higgsfield request completed but returned no video");
      return r.video.url;
    }
    if (r.status === "nsfw") throw new Error("Higgsfield nsfw: the photos or prompt were refused by the content filter");
    if (r.status === "failed" || r.status === "canceled") throw new Error(`Higgsfield request ${r.status}: ${r.error || "no reason given"}`);
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error("Higgsfield request timed out");
}
