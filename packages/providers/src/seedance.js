// Seedance (BytePlus ModelArk) image-to-video
// Docs: POST {base}/contents/generations/tasks  →  GET {base}/contents/generations/tasks/{id}
// Status: queued | running | succeeded | failed | expired

const cfg = () => ({
  baseUrl: process.env.SEEDANCE_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3",
  apiKey: process.env.SEEDANCE_API_KEY,
  model: process.env.SEEDANCE_MODEL,
  resolution: process.env.SEEDANCE_RESOLUTION || "720p",
  duration: Number(process.env.SEEDANCE_DURATION || 10),
});

export const seedanceEnabled = () => Boolean(cfg().apiKey);

/**
 * How the product clip is made (CLIP_MODE):
 *   auto (default) → "seedance" when SEEDANCE_API_KEY is set, otherwise "photos"
 *   photos         → free Ken Burns video from the product photos (no AI cost)
 *   seedance       → always Seedance (fails if the key is missing)
 *   sample         → samples/sample-product-clip.mp4 (pipeline debugging only)
 */
export function clipMode() {
  const m = String(process.env.CLIP_MODE || "auto").toLowerCase();
  if (["photos", "seedance", "sample"].includes(m)) return m;
  return seedanceEnabled() ? "seedance" : "photos";
}

/**
 * UGC product-video prompt. Product accuracy comes first (labels, shape, colour must match the references).
 * Kept in English: video models follow English prompts most reliably; the on-screen language is added later.
 */
export const CLIP_STYLES = ["product", "presenter"];

/**
 * Presenter variant: a local-looking creator demonstrates the product. They never speak on camera —
 * the same clip serves both the Thai and the Myanmar video, so any lip movement would match neither
 * voiceover. Shots are spelled out because short-form sellers cut every ~2s (wide → hands close-up → wide).
 */
function buildPresenterPrompt(product) {
  return [
    `Create a photorealistic vertical 9:16 social-commerce video based STRICTLY on the supplied PRODUCT REFERENCE IMAGES.`,
    `Product: ${product.title}${product.description ? ` — ${product.description}` : ""}.`,
    `Keep the exact product shape, colours, materials, logo and label text from the references. Do not invent features, accessories or text.`,
    `Presenter: a friendly, ordinary-looking Southeast Asian creator in their 20s–30s (natural skin texture, casual everyday clothes, no influencer glamour), in a real lived-in home setting with soft daylight.`,
    `Shots (hard cuts, about 2–3 seconds each): 1) medium shot — presenter holds the product up to the camera, product fully visible; 2) close-up — their hands operate the key feature of the product; 3) medium shot — presenter uses the product naturally and reacts with a genuine smile and nod.`,
    `The presenter does NOT talk: mouth closed or smiling, no lip movement, no speaking (a voiceover is added later in two languages).`,
    `Audio: only authentic sounds naturally produced by the visible product interaction. No music, no voice, no speech.`,
    `No on-screen text, captions, logos or watermarks.`,
    `FINAL PRIORITY ORDER: 1. Product reference accuracy 2. Realistic physical behaviour and hands 3. Clear full-product visibility 4. Natural presenter 5. Attractive social-commerce presentation.`,
    `Never sacrifice product accuracy for cinematic effect.`,
  ].join("\n");
}

export function buildProductPrompt(product, { style = "product" } = {}) {
  if (style === "presenter") return buildPresenterPrompt(product);
  return [
    `Create a photorealistic vertical 9:16 social-commerce product video based STRICTLY on the supplied PRODUCT REFERENCE IMAGES.`,
    `Product: ${product.title}${product.description ? ` — ${product.description}` : ""}.`,
    `Keep the exact product shape, colours, materials, logo and label text from the references. Do not invent features, accessories or text.`,
    `Style: natural handheld iPhone / UGC look, soft daylight, real home or desk setting, hands interacting with the product.`,
    `Show: the full product clearly, then close-ups of key details, then realistic everyday use.`,
    `Audio: only authentic sounds naturally produced by the visible product interaction (e.g. box opening, packaging rustle, button clicks, tapping, pouring). No music, no voice, no sounds for actions that are not visible.`,
    `No on-screen text, captions, logos or watermarks.`,
    `FINAL PRIORITY ORDER: 1. Product reference accuracy 2. Realistic physical behaviour 3. Clear full-product visibility 4. Relevant real-world usage 5. Natural UGC appearance 6. Attractive social-commerce presentation.`,
    `Never sacrifice product accuracy for cinematic effect.`,
  ].join("\n");
}

/** imageUrls: public https URLs or data:image/...;base64 strings (1–4 reference images) */
export function buildCreateBody(product, imageUrls, opts = {}) {
  const c = cfg();
  return {
    model: opts.model || c.model,
    content: [
      { type: "text", text: opts.prompt || buildProductPrompt(product, { style: opts.style }) },
      ...imageUrls.slice(0, 4).map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
    ],
    ratio: "9:16",
    duration: opts.duration || c.duration,
    resolution: opts.resolution || c.resolution,
    generate_audio: true,
    watermark: false,
  };
}

async function call(path, init = {}) {
  const c = cfg();
  if (!c.apiKey) throw new Error("SEEDANCE_API_KEY is not set");
  const res = await fetch(`${c.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Seedance ${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  return json;
}

export async function createTask(product, imageUrls, opts) {
  const json = await call("/contents/generations/tasks", { method: "POST", body: JSON.stringify(buildCreateBody(product, imageUrls, opts)) });
  return json.id;
}

export const getTask = (id) => call(`/contents/generations/tasks/${encodeURIComponent(id)}`);

/** Poll until finished; returns the generated video URL */
export async function waitForTask(id, { intervalMs = 10_000, timeoutMs = 15 * 60_000, onStatus } = {}) {
  const start = Date.now();
  for (;;) {
    const t = await getTask(id);
    onStatus?.(t.status);
    if (t.status === "succeeded") {
      const url = t.content?.video_url || t.video_url;
      if (!url) throw new Error("Seedance succeeded but no video_url in response");
      return url;
    }
    if (t.status === "failed" || t.status === "expired") {
      throw new Error(`Seedance task ${t.status}: ${t.error?.message || ""}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error("Seedance task timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
