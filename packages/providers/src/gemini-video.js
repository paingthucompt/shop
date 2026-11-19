// Gemini Omni (Google AI / Gemini API) image-to-video — an alternative to Seedance (CLIP_MODE=gemini).
// Docs: https://aistudio.google.com/docs/omni  ·  POST {base}/interactions  →  GET {base}/interactions/{id}
// The request runs in the background and is polled, so a worker restart resumes it instead of paying twice.
import { buildProductPrompt } from "./seedance.js";

const cfg = () => ({
  baseUrl: (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
  apiKey: process.env.GEMINI_API_KEY,
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

async function call(path, init = {}) {
  const c = cfg();
  if (!c.apiKey) throw new Error("GEMINI_API_KEY is not set");
  const res = await fetch(`${c.baseUrl}${path}`, {
    ...init,
    headers: { "x-goog-api-key": c.apiKey, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  return json;
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
    if (it.error || FAILED.has(String(it.status).toLowerCase())) {
      throw new Error(`Gemini video ${it.status || "failed"}: ${it.error?.message || ""}`);
    }
    if (it.status === "completed") throw new Error("Gemini video completed but returned no video");
    if (!id) throw new Error("Gemini returned neither a video nor an interaction id");
    if (Date.now() - start > timeoutMs) throw new Error("Gemini video timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
    it = null;
  }
}
