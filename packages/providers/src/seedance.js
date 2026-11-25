// Seedance (BytePlus ModelArk) image-to-video
// Docs: POST {base}/contents/generations/tasks  →  GET {base}/contents/generations/tasks/{id}
// Status: queued | running | succeeded | failed | expired
import { geminiSettings } from "./gemini-video.js"; // circular with gemini-video.js, but only used at call time
import { higgsfieldEnabled, higgsfieldSettings } from "./higgsfield.js"; // circular too, call time only
import { env as keyEnv } from "./keys.js";
import { providerError } from "./api-errors.js";

const cfg = () => ({
  baseUrl: process.env.SEEDANCE_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3",
  apiKey: keyEnv().SEEDANCE_API_KEY,
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
 *   gemini         → Gemini Omni video via the Gemini API (GEMINI_API_KEY) — only when chosen explicitly
 *   sample         → samples/sample-product-clip.mp4 (pipeline debugging only)
 */
export function clipMode() {
  const m = String(process.env.CLIP_MODE || "auto").toLowerCase();
  if (["photos", "seedance", "gemini", "sample"].includes(m)) return m;
  return seedanceEnabled() ? "seedance" : "photos";
}

/** model / length / resolution of the clip the current mode makes (shown in the quote, used for script length) */
/** every AI video service that has a key (for this user): the default first */
const HAS_KEY = { gemini: () => Boolean(keyEnv().GEMINI_API_KEY), higgsfield: () => higgsfieldEnabled(), seedance: () => seedanceEnabled() };

export function aiVideoProviders() {
  const first = aiVideoProvider();
  return [first, ...["gemini", "higgsfield", "seedance"].filter((p) => p !== first && HAS_KEY[p]())].filter(Boolean);
}

/**
 * the AI video provider used when the user picks "AI video": the one they chose (if it has a key),
 * else AI_VIDEO_PROVIDER, else Gemini, else Seedance, else null
 */
export function aiVideoProvider(chosen) {
  if (HAS_KEY[chosen]?.()) return chosen;
  const forced = String(keyEnv().AI_VIDEO_PROVIDER || "").toLowerCase();
  if (forced === "higgsfield" && higgsfieldEnabled()) return "higgsfield";
  if (forced === "gemini" && keyEnv().GEMINI_API_KEY) return "gemini";
  if (forced === "seedance" && seedanceEnabled()) return "seedance";
  if (keyEnv().GEMINI_API_KEY) return "gemini";
  return seedanceEnabled() ? "seedance" : null;
}

/** model / length / resolution of the clip a given mode makes (default: CLIP_MODE) */
export function clipSettings(mode = clipMode(), { model } = {}) {
  if (mode === "gemini") return { mode, ...geminiSettings(model) };
  if (mode === "higgsfield") return { mode, ...higgsfieldSettings(model) };
  const c = cfg();
  return { mode, model: mode === "seedance" ? c.model || null : null, duration: c.duration, resolution: c.resolution };
}

/**
 * UGC product-video prompt. Product accuracy comes first (labels, shape, colour must match the references).
 * Kept in English: video models follow English prompts most reliably; the on-screen language is added later.
 *
 * Every style shares the same header (product + reference accuracy + consistency) and footer (no text,
 * priority order); a style only changes the look, the shots and the audio.
 */
const STYLE_SPECS = {
  // product-only UGC demo (default)
  product: {
    look: `Style: natural handheld iPhone / UGC look, soft daylight, real home or desk setting, hands interacting with the product.`,
    shots: `Show: the full product clearly, then close-ups of key details, then realistic everyday use.`,
    audio: `Audio: only authentic sounds naturally produced by the visible product interaction (e.g. box opening, packaging rustle, button clicks, tapping, pouring). No music, no voice, no sounds for actions that are not visible.`,
    priority: `1. Product reference accuracy 2. Realistic physical behaviour 3. Clear full-product visibility 4. Relevant real-world usage 5. Natural UGC appearance 6. Attractive social-commerce presentation.`,
  },
  // a local-looking creator demonstrates the product. They never speak on camera — the same clip serves
  // both the Thai and the Myanmar video, so any lip movement would match neither voiceover. Shots are
  // spelled out because short-form sellers cut every ~2s (wide → hands close-up → wide).
  presenter: {
    look: `Presenter: a friendly, ordinary-looking Southeast Asian creator in their 20s–30s (natural skin texture, casual everyday clothes, no influencer glamour), in a real lived-in home setting with soft daylight.`,
    shots: `Shots (hard cuts, about 2–3 seconds each): 1) medium shot — presenter holds the product up to the camera, product fully visible; 2) close-up — their hands operate the key feature of the product; 3) medium shot — presenter uses the product naturally and reacts with a genuine smile and nod.\nThe presenter does NOT talk: mouth closed or smiling, no lip movement, no speaking (a voiceover is added later in two languages).`,
    audio: `Audio: only authentic sounds naturally produced by the visible product interaction. No music, no voice, no speech.`,
    priority: `1. Product reference accuracy 2. Realistic physical behaviour and hands 3. Clear full-product visibility 4. Natural presenter 5. Attractive social-commerce presentation.`,
  },
  unboxing: {
    look: `Style: first-person handheld UGC unboxing on a clean table, soft daylight, only hands visible.`,
    shots: `Shots (hard cuts, about 2–3 seconds each): 1) top-down — hands open the box or package; 2) hands lift the product out and turn it once toward the camera, product fully visible; 3) close-up of the key detail, then the product set down upright and fully visible. Only show packaging that appears in the references; if none is shown, use a plain unbranded box or pouch.`,
    audio: `Audio: only authentic unboxing sounds (cardboard, tape, packaging rustle, the product being placed on the table). No music, no voice.`,
    priority: `1. Product reference accuracy 2. Realistic hands and packaging 3. Clear full-product visibility 4. Natural UGC appearance 5. Attractive social-commerce presentation.`,
  },
  hero: {
    look: `Style: premium studio product commercial — the product stands alone on a clean seamless backdrop in a colour that suits it, soft key light with gentle rim light, subtle reflection on the surface. No people, no hands.`,
    shots: `Camera: one smooth slow orbit or turntable rotation around the product (about 180–360 degrees) so every side is seen, ending on a centred front-facing hero frame with the product fully visible.`,
    audio: `Audio: near-silent, clean room tone only. No music, no voice, no whooshes.`,
    priority: `1. Product reference accuracy 2. Consistent shape on every side of the rotation 3. Clear full-product visibility 4. Clean premium lighting.`,
  },
  macro: {
    look: `Style: macro detail commercial — extreme close-ups with shallow depth of field, soft daylight, product texture and materials in sharp focus.`,
    shots: `Shots (slow push-ins, about 2–3 seconds each): 1) macro of the main material or texture; 2) macro of a key functional detail (button, seam, nozzle, cap, port — only ones visible in the references); 3) pull back to a medium shot where the whole product is fully visible.`,
    audio: `Audio: only subtle authentic sounds of the product being touched. No music, no voice.`,
    priority: `1. Product reference accuracy 2. Only details that exist in the references 3. Sharp texture 4. Final shot shows the whole product.`,
  },
  in_action: {
    look: `Style: natural handheld UGC, real everyday location where this product is normally used, soft daylight, hands (and if needed a body seen from the shoulders down, face not shown) using the product.`,
    shots: `Shots (hard cuts, about 2–3 seconds each): 1) the product is picked up and switched on / opened / applied; 2) close-up of the product doing its main job, with a realistic visible result; 3) medium shot of comfortable everyday use, product fully visible. Results must be realistic and modest — no exaggerated or instant transformations.`,
    audio: `Audio: only authentic sounds naturally produced by the visible product use. No music, no voice.`,
    priority: `1. Product reference accuracy 2. Realistic physical behaviour and results 3. Clear full-product visibility 4. Relevant real-world usage 5. Natural UGC appearance.`,
  },
  flatlay: {
    look: `Style: aesthetic top-down flat-lay on a textured surface (linen, wood or paper in a colour that suits the product), soft diffused daylight, a few simple unbranded props that fit how the product is used.`,
    shots: `Camera: locked top-down. Hands place the product in the centre, then arrange two or three props around it; slow gentle push-in to finish with the product fully visible and clearly the hero. Props must never cover or overlap the product.`,
    audio: `Audio: only soft authentic sounds of objects being placed on the surface. No music, no voice.`,
    priority: `1. Product reference accuracy 2. Product stays the clear hero 3. Clear full-product visibility 4. Clean aesthetic composition.`,
  },
};

export const CLIP_STYLES = Object.keys(STYLE_SPECS);

/** the "look" sentence of a style (setting, camera, who is in shot) — reused by the Flow prompts */
export const styleLook = (style) => (STYLE_SPECS[style] || STYLE_SPECS.product).look;

export function buildProductPrompt(product, { style = "product" } = {}) {
  const spec = STYLE_SPECS[style] || STYLE_SPECS.product;
  return [
    `Create a photorealistic vertical 9:16 social-commerce ${style === "presenter" ? "video" : "product video"} based STRICTLY on the supplied PRODUCT REFERENCE IMAGES.`,
    // captions are added later in the viewer's language: any text the model writes would be in the wrong one
    `NO ADDED TEXT IN THE VIDEO: no captions, subtitles, titles, slogans, feature callouts, price tags, banners or graphics.`,
    `The product's OWN printed logo, brand name and label text MUST stay on the product exactly as in the references — clearly visible and readable in the shots, never removed, blurred or rewritten.`,
    `Product: ${product.title}${product.description ? ` — ${String(product.description).slice(0, 400)}` : ""}.`,
    `Keep the exact product shape, colours, materials, logo and label text from the references. Do not invent features, accessories or text.`,
    `Product consistency: it is ONE single product that looks identical in every shot and across every cut — same colour, size, proportions and label position. Never morph, duplicate, resize or redesign it between shots.`,
    spec.look,
    spec.shots,
    spec.audio,
    `No on-screen text, captions, logos or watermarks.`,
    `FINAL PRIORITY ORDER: ${spec.priority}`,
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
  if (!res.ok) throw new Error(providerError("Seedance", res.status, text));
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
