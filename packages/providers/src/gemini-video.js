// Gemini Omni (Google AI / Gemini API) image-to-video — an alternative to Seedance (CLIP_MODE=gemini).
// Docs: https://aistudio.google.com/docs/omni  ·  POST {base}/interactions  →  GET {base}/interactions/{id}
// The request runs in the background and is polled, so a worker restart resumes it instead of paying twice.
import { buildProductPrompt } from "./seedance.js";
import { env as keyEnv } from "./keys.js";
import { providerError } from "./api-errors.js";

const cfg = () => ({
  baseUrl: (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
  apiKey: keyEnv().GEMINI_API_KEY,
  model: process.env.GEMINI_VIDEO_MODEL || "gemini-omni-1.2-flash",
  resolution: process.env.GEMINI_VIDEO_RESOLUTION || "720p",
  duration: geminiDuration(process.env.GEMINI_VIDEO_DURATION),
});

/** Omni accepts whole seconds 3–15 (default 10) */
export function geminiDuration(value) {
  const n = Math.round(Number(value || 10));
  return Number.isFinite(n) ? Math.min(15, Math.max(3, n)) : 10;
}

export const geminiEnabled = () => Boolean(cfg().apiKey);
export const geminiSettings = () => {
  const { model, resolution, duration } = cfg();
  return { model, resolution, duration };
};

/** "data:image/png;base64,AAAA" → { mime_type, data } */
function parseDataUrl(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) throw new Error("Gemini video needs inline images (data: URLs)");
  return { mime_type: m[1], data: m[2] };
}

/** imageUrls: data:image/...;base64 strings (1–6 reference images) */
export function buildInteractionBody(product, imageUrls, opts = {}) {
  const c = cfg();
  return {
    model: opts.model || c.model,
    input: [
      ...imageUrls.slice(0, 6).map((u) => ({ type: "image", ...parseDataUrl(u) })),
      { type: "text", text: opts.prompt || buildProductPrompt(product, { style: opts.style }) },
    ],
    response_format: {
      type: "video",
      aspect_ratio: "9:16",
      resolution: opts.resolution || c.resolution,
      duration: `${geminiDuration(opts.duration || c.duration)}s`,
    },
    background: true,
  };
}

/** the first generated video anywhere in an interaction (REST puts it in steps[].content[]) */
export function findVideo(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "video" && (node.data || node.uri)) return node;
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findVideo(v);
    if (hit) return hit;
  }
  return null;
}

const FAILED = new Set(["failed", "cancelled", "canceled", "expired", "incomplete"]);

/** ms to wait before retry `attempt` (1-based): Retry-After header, else 0.5 s doubling up to 8 s, with jitter */
export function retryDelayMs(attempt, res) {
  const after = Number(res?.headers?.get?.("retry-after"));
  if (after > 0) return Math.min(after, 30) * 1000;
  const base = Math.min(8000, 500 * 2 ** (attempt - 1));
  return base / 2 + Math.random() * (base / 2);
}

/**
 * One API call. Reads (GET, e.g. polling an interaction) retry on 429 / 5xx / network errors with
 * backoff for up to ~30 s, like Google's gemini-api CLI does for interaction status. Creating an
 * interaction (POST) is never retried: a request that reached Google may already be generating (and billed).
 */
async function call(path, init = {}, { retryForMs = 30_000 } = {}) {
  const c = cfg();
  if (!c.apiKey) throw new Error("GEMINI_API_KEY is not set");
  const retry = (init.method || "GET").toUpperCase() === "GET";
  const start = Date.now();
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${c.baseUrl}${path}`, {
        ...init,
        headers: { "x-goog-api-key": c.apiKey, "Content-Type": "application/json", ...(init.headers || {}) },
      });
    } catch (err) {
      if (!retry || Date.now() - start > retryForMs) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
      continue;
    }
    const text = await res.text();
    if (retry && (res.status === 429 || res.status >= 500) && Date.now() - start <= retryForMs) {
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt, res)));
      continue;
    }
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(providerError("Gemini", res.status, text));
    return json;
  }
}

async function videoBytes(video) {
  if (video.data) return Buffer.from(video.data, "base64");
  const res = await fetch(video.uri, { headers: { "x-goog-api-key": cfg().apiKey }, redirect: "follow" });
  if (!res.ok) throw new Error(`Gemini video download failed ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generate (or resume) one product clip → MP4 bytes.
 *   resumeId: an interaction id saved earlier — poll it instead of starting (and paying for) a new one
 *   onId(id): called once the interaction exists, so the caller can persist it before polling
 */
export async function generateVideo(product, imageUrls, { style, resumeId, onId, onStatus, intervalMs = 10_000, timeoutMs = 15 * 60_000 } = {}) {
  let it = resumeId ? null : await call("/interactions", { method: "POST", body: JSON.stringify(buildInteractionBody(product, imageUrls, { style })) });
  const id = resumeId || it.id;
  if (!resumeId && id) await onId?.(id);
  const start = Date.now();
  for (;;) {
    if (!it) it = await call(`/interactions/${encodeURIComponent(id)}`);
    onStatus?.(it.status);
    const video = findVideo(it);
    if (video) return videoBytes(video);
    // a failed interaction lists its reasons in errors[] (e.g. RESOURCE_EXHAUSTED when Google is out of capacity)
    const errs = [it.error, ...(Array.isArray(it.errors) ? it.errors : [])].filter(Boolean);
    if (errs.length || FAILED.has(String(it.status).toLowerCase())) {
      const why = errs.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join("; ");
      throw new Error(`Gemini video ${it.status || "failed"}: ${why}`);
    }
    if (it.status === "completed") throw new Error("Gemini video completed but returned no video");
    if (!id) throw new Error("Gemini returned neither a video nor an interaction id");
    if (Date.now() - start > timeoutMs) throw new Error("Gemini video timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
    it = null;
  }
}
