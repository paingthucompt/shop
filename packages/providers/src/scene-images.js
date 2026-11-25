// "AI scene images": one photorealistic 9:16 frame per script beat, made with Gemini image models
// (Nano Banana 2) from the product photos as references. ~US$0.067 per 1K image (measured 2026-11-20:
// 1,120 output image tokens). No text in the images — the app adds Thai / Myanmar captions itself.
import { styleLook } from "./seedance.js";
import { reportUsage, geminiTokens } from "./usage.js";
import { promptTitle, storyboardPanels } from "./flow-prompt.js";
import { env as keyEnv } from "./keys.js";
import { providerError } from "./api-errors.js";

const cfg = () => ({
  baseUrl: (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
  apiKey: keyEnv().GEMINI_API_KEY,
  model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image",
  size: process.env.GEMINI_IMAGE_SIZE || "1K",
});

export const sceneImagesEnabled = () => Boolean(cfg().apiKey);
export const MAX_SCENES = 6;

const ROLE_VISUAL = {
  hook: "a relatable everyday moment that shows the problem the product solves, real person (hands or shoulders-down), natural light",
  intro: "the full product clearly presented in a real setting, hero lighting",
  feature: "close-up of the product's key detail",
  use: "the product being used for its main purpose with a realistic result",
  value: "the product in everyday life, satisfied user (face not shown)",
  cta: "the product fully visible and centred in a clean, attractive hero frame",
};

/**
 * Scenes for the video: the storyboard panels of the reference script (timings over `seconds`,
 * visuals from the Flow shot list), merged down to MAX_SCENES. → [{ n, role, from, to, seconds, visual }]
 */
export function planScenes(script, lang, { seconds = 15, shots } = {}) {
  let panels = storyboardPanels(script, lang, { seconds, shots });
  while (panels.length > MAX_SCENES) { // merge the two shortest neighbours in the middle
    let k = 1, best = Infinity;
    for (let i = 1; i < panels.length - 2; i++) {
      const d = panels[i + 1].to - panels[i].from;
      if (d < best) { best = d; k = i; }
    }
    panels = [...panels.slice(0, k), { ...panels[k], to: panels[k + 1].to }, ...panels.slice(k + 2)];
  }
  return panels.map((p, i) => ({
    n: i + 1, role: p.role, from: p.from, to: p.to, seconds: p.to - p.from,
    visual: p.visual || ROLE_VISUAL[p.role] || ROLE_VISUAL.use,
  }));
}

/** the image prompt for one scene */
export function buildScenePrompt(product, { style = "product", visual, role } = {}) {
  return [
    `ONE photorealistic vertical 9:16 photo: a single frame from a TikTok Shop product video, one moment, one camera angle. Never a grid, collage, split screen, sequence or multiple panels.`,
    `Product: ${promptTitle(product.title)} — exactly as in the attached product photos: same shape, colours, materials, logo and proportions; never redesign it. Do not invent features or accessories.`,
    `Moment to show (if several actions are described, show only the most telling one): ${String(visual || ROLE_VISUAL[role] || ROLE_VISUAL.use).replace(/[.\s]+$/, "")}.`,
    styleLook(style),
    `Composition: the scene fills the entire frame edge to edge, sharp from top to bottom like a real phone video frame (no letterbox, no blurred or faded areas); the product and the action sit in the middle of the frame.`,
    role === "cta" ? `The product must be fully visible, sharp and attractive.` : "",
    `Realistic results only — no exaggerated or instant transformations.`,
    `No text, letters, captions, labels, logos other than the product's own, watermarks or price tags anywhere (ignore any text in the reference photos).`,
  ].filter(Boolean).join("\n");
}

const parseDataUrl = (u) => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(u);
  if (!m) throw new Error("scene images need inline reference images (data: URLs)");
  return { inline_data: { mime_type: m[1], data: m[2] } };
};

export function buildImageRequest(prompt, refImages, { size } = {}) {
  return {
    contents: [{ role: "user", parts: [...refImages.slice(0, 4).map(parseDataUrl), { text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: size || cfg().size } },
  };
}

/** first image part of a generateContent reply → { mime, data: Buffer } | null */
export function findImage(reply) {
  for (const c of reply?.candidates || []) {
    for (const p of c.content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) return { mime: d.mimeType || d.mime_type || "image/png", data: Buffer.from(d.data, "base64") };
    }
  }
  return null;
}

/** one scene image → { mime, data, model, usage }. Retries 429 / 5xx; no image (e.g. blocked) is an error. */
export async function generateSceneImage(prompt, refImages, { timeoutMs = 120_000 } = {}) {
  const c = cfg();
  if (!c.apiKey) throw new Error("GEMINI_API_KEY is not set");
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${c.baseUrl}/models/${encodeURIComponent(c.model)}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "x-goog-api-key": c.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(buildImageRequest(prompt, refImages)),
      });
      const text = await res.text();
      if (res.ok) {
        const reply = JSON.parse(text);
        const img = findImage(reply);
        if (!img) throw new Error(`Gemini image: no image returned (${reply?.candidates?.[0]?.finishReason || reply?.promptFeedback?.blockReason || "unknown"})`);
        reportUsage({ kind: "image", provider: "gemini", model: c.model, images: 1, size: c.size, ...geminiTokens(reply.usageMetadata) });
        return { ...img, model: c.model, usage: reply.usageMetadata || null };
      }
      last = providerError("Gemini image", res.status, text);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      if (/no image returned/.test(err.message)) throw err;
      last = err.name === "TimeoutError" ? `Gemini image timed out after ${timeoutMs / 1000}s` : err.message;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(last);
}
