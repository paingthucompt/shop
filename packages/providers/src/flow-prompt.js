// Prompt for Google Flow, which the user runs with their own subscription (no per-video API cost).
// Flow makes only the SILENT product clip: Video → Ingredients → 9:16 → Omni 1.2 Flash → 720p → Length.
// The user uploads that clip here and the app adds what Flow does badly: natural Thai / Myanmar
// voiceover, captions, hook and CTA. One clip serves both languages, so nobody speaks in it.
import { styleLook } from "./seedance.js";

export const MAX_CLIP_SECONDS = 15; // Flow / Omni 1.2 Flash maximum
const MIN_CLIP_SECONDS = 5;

// spoken graphemes per second, measured on the app's own TTS renders (2026-11-20): Thai ≈ 10.4,
// Burmese ≈ 12.4 — kept slightly conservative so the clip is long enough for the voiceover
const LANG = {
  th: { rate: 10, script: /[฀-๿]/g },
  my: { rate: 12, script: /[က-႟ꧠ-꧿ꩠ-ꩿ]/g },
};

/** rough spoken length of a line */
export function speechSeconds(text, lang) {
  const g = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(String(text || ""))].length;
  return Math.max(1.2, g / (LANG[lang]?.rate || 10));
}

const beatsOf = (script) => [script?.hook, ...(script?.lines || []), script?.cta].map((b) => String(b || "").trim()).filter(Boolean);

/** finished video length for one script, using the video engine's timeline (lead 0.15 s, 0.25 s gaps, 0.8 s tail) */
export function videoSeconds(script, lang) {
  const beats = beatsOf(script);
  if (!beats.length) return 0;
  return 0.15 + beats.reduce((a, b) => a + speechSeconds(b, lang), 0) + 0.25 * (beats.length - 1) + 0.8;
}

/** Flow "Length": the longest language's video + ~1 s, whole seconds, 5–15 (shorter = fewer Flow credits) */
export function clipSeconds(scripts) {
  const longest = Math.max(0, ...Object.entries(scripts || {}).map(([lang, s]) => videoSeconds(s, lang)));
  return Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, Math.ceil(longest + 1)));
}

/** product name without Thai / Burmese text (the prompt is English; Flow must not read foreign text aloud or write it) */
export function promptTitle(title) {
  let t = String(title || "");
  for (const L of Object.values(LANG)) t = t.replace(L.script, " ");
  t = t.replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").replace(/^[\s\-–—|,.]+|[\s\-–—|,.]+$/g, "").trim();
  return /\p{L}/u.test(t) ? t : "the product in the attached photos";
}

/** shot list used when no LLM wrote one */
export function defaultShots(seconds) {
  const a = Math.round(seconds * 0.3), b = Math.round(seconds * 0.7);
  return `0–${a}s: the full product clearly visible and centred; a hand picks it up and shows it to the camera. ` +
    `${a}–${b}s: close-ups of the key details, then the product used for its main purpose with a realistic result. ` +
    `${b}–${seconds}s: the product placed upright, fully visible, in a clean hero frame.`;
}

/** the ready-to-paste Flow prompt */
export function buildClipPrompt(product, { style = "product", seconds = 10, shots } = {}) {
  return [
    `Vertical 9:16, ${seconds} seconds, photorealistic social-commerce product video.`,
    `Product: ${promptTitle(product.title)} — exactly as in the attached product photos: same shape, colours, materials, logo and label text. It is one single product that looks identical in every shot; never morph, duplicate or redesign it. Do not invent features.`,
    styleLook(style),
    `Shot list: ${String(shots || defaultShots(seconds)).trim()}`,
    `Results must be realistic and modest — no exaggerated or instant transformations.`,
    `Nobody speaks: no voice, no narration, no lip movement${style === "presenter" ? " (the presenter only smiles and demonstrates)" : ""}. Audio: only natural sounds of the product being handled. No music.`,
    `No on-screen text, subtitles, captions, logos or watermarks. Keep the top and bottom fifth of the frame free of important detail (captions are added there later).`,
  ].join("\n");
}

/** LLM request: one timed shot list for the clip that follows the beats of the script */
export function buildShotRequest(product, { style = "product", seconds = 10, script } = {}) {
  const beats = beatsOf(script);
  return [
    `You plan the shots of a ${seconds}-second vertical 9:16 TikTok Shop / Shopee product clip made in Google Flow from the attached product photos.`,
    `A voiceover is added later; the clip must show what it says, in this order (it may be in Thai or Burmese — read it, never copy it):`,
    ...beats.map((b, i) => `- ${i === 0 ? "hook" : i === beats.length - 1 ? "call to action" : `line ${i}`}: ${b}`),
    ``,
    `Setting and camera style: ${styleLook(style)}`,
    `Write ONE shot list in English with timings that add up to ${seconds} seconds (e.g. "0–3s: …"), 3–5 shots, max 90 words, with real actions that suit this product and how it is used.`,
    `The first second shows the whole product clearly; the last shot ends on the product fully visible. Only show what the product details support. Nobody speaks. No on-screen text.`,
    ``,
    `Product: ${product.title}`,
    product.description ? `Details: ${String(product.description).slice(0, 1500)}` : "",
    ``,
    `Return ONLY JSON: {"shots": "0–3s: …"}`,
  ].filter((l) => l !== "").join("\n");
}

const SHOT_MAX = 900;
/** cap a shot list without cutting mid-sentence */
function clampShot(text) {
  if (text.length <= SHOT_MAX) return text;
  const cut = text.slice(0, SHOT_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > SHOT_MAX / 2 ? cut.slice(0, end + 1) : cut;
}

/** the shot list from a chatty reply ({"shots": "…"} or {"shots": ["…", …]}), or null */
export function parseShots(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[0]).shots;
    const s = (Array.isArray(raw) ? raw.join(" ") : String(raw ?? "")).replace(/\s+/g, " ").trim();
    return s ? clampShot(s) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- storyboard image (Flow → Image)
// One storyboard sheet per language, made BEFORE the video: panels = the script beats with their timings,
// visuals from the clip's shot list and the exact on-screen text. The finished image is also added to the
// Flow video as an ingredient so the clip follows it. Built from data only — no LLM call, no cost.

const SB = {
  th: { name: "Thai", labels: { hook: "เปิดเรื่อง", intro: "แนะนำสินค้า", feature: "จุดเด่น", use: "ใช้งานจริง", value: "ความคุ้มค่า", cta: "ปิดท้าย + Call to Action" }, buy: "สั่งซื้อเลย!" },
  my: { name: "Burmese (Myanmar)", labels: { hook: "အစပိုင်း", intro: "ပစ္စည်းမိတ်ဆက်", feature: "အားသာချက်", use: "အသုံးပြုပုံ", value: "တန်ဖိုး", cta: "နိဂုံး + ဝယ်ယူရန်" }, buy: "အခုပဲ ဝယ်လိုက်ပါ!" },
};
const MIDDLE_ROLES = ["intro", "feature", "use", "value"];

/** "0–3s: a. 3–7s: b." → [{ from: 0, to: 3, text: "a." }, …] */
export function parseShotSegments(shots) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*s\s*:\s*([\s\S]*?)(?=\s*\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?\s*s\s*:|$)/g;
  for (const m of String(shots || "").matchAll(re)) out.push({ from: Number(m[1]), to: Number(m[2]), text: m[3].trim() });
  return out;
}

/** script beats → timed panels ({ role, label, from, to, text, visual }) spread over the clip length */
export function storyboardPanels(script, lang, { seconds = 15, shots } = {}) {
  const L = SB[lang];
  const caps = script?.captions || [];
  const beats = [
    { role: "hook", text: script?.hook },
    ...(script?.lines || []).map((l, i) => ({ role: MIDDLE_ROLES[Math.min(i, MIDDLE_ROLES.length - 1)], text: String(caps[i] || "").trim() || l, said: l })),
    { role: "cta", text: script?.cta },
  ].filter((b) => String(b.text || "").trim());
  const weights = beats.map((b) => speechSeconds(b.said || b.text, lang));
  const total = weights.reduce((a, w) => a + w, 0) || 1;
  const segs = parseShotSegments(shots);
  let t = 0;
  return beats.map((b, i) => {
    const from = Math.round(t);
    t += (weights[i] / total) * seconds;
    const to = i === beats.length - 1 ? seconds : Math.max(from + 1, Math.round(t));
    // the shot that overlaps this panel the most (earlier one on a tie)
    let seg = null, best = 0;
    for (const s of segs) {
      const overlap = Math.min(to, s.to) - Math.max(from, s.from);
      if (overlap > best) { best = overlap; seg = s; }
    }
    const visual = seg?.text.replace(/[.\s]+$/, "") || null;
    return { role: b.role, label: L.labels[b.role], from, to, text: String(b.text).trim(), visual };
  });
}

const DEFAULT_VISUAL = {
  hook: "a relatable everyday moment that shows the problem, real person, natural light",
  intro: "the full product clearly presented, hero lighting",
  feature: "close-up of the product's key detail",
  use: "the product being used for its main purpose with a realistic result",
  value: "the product in everyday life, satisfied user",
  cta: "the product fully visible in a clean hero frame",
};

/** product name for a `lang` storyboard: keeps that language, removes the other one's script */
export function localTitle(title, lang) {
  let t = String(title || "");
  for (const [other, L] of Object.entries(LANG)) if (other !== lang) t = t.replace(L.script, " ");
  t = t.replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").replace(/^[\s\-–—|,.]+|[\s\-–—|,.]+$/g, "").trim();
  return /\p{L}/u.test(t) ? t : promptTitle(title);
}

/** the ready-to-paste Flow Image prompt for one language's storyboard sheet */
export function buildStoryboardPrompt(product, lang, { script, seconds = 15, shots, style = "product" } = {}) {
  const L = SB[lang];
  if (!L) throw new Error(`unsupported lang ${lang}`);
  const panels = storyboardPanels(script, lang, { seconds, shots });
  const price = product.price ? `${Number(product.price).toLocaleString("en-US")} ${product.currency || "THB"}` : null;
  return [
    `Create ONE landscape 16:9 storyboard sheet for a ${seconds}-second vertical (9:16) TikTok Shop / Shopee product video ad, in the style of a professional ad-agency storyboard: dark navy header, bold modern typography, high contrast, clean grid.`,
    `Use the attached product photos for the product in every panel — exactly the same shape, colours, materials, logo and label text; never redesign it.`,
    ``,
    `Header: the product name "${localTitle(product.title, lang)}" and the headline in ${L.name}: "${script.hook}". Small tag at the right: "AI Storyboard · ${seconds}s".`,
    ``,
    `Below the header, ${panels.length} numbered panels in time order, each a vertical 9:16 photorealistic frame with a rounded label at the top and the on-screen text overlaid in large bold ${L.name} letters:`,
    ...panels.map((p, i) => `${i + 1}. Label "${i + 1}. ${p.label} (${p.from}–${p.to}s)". Scene: ${p.visual || DEFAULT_VISUAL[p.role]}. On-screen text: "${p.text}"${p.role === "cta" ? ` with a yellow button "🛒 ${L.buy}"${price ? ` and the price "${price}"` : ""}` : ""}.`),
    ``,
    `Visual style of the frames: ${styleLook(style).replace(/^Style:\s*/, "")}`,
    `Write every ${L.name} text EXACTLY as given above, letter for letter, with correct ${L.name} script; no other text.`,
    `Do not add prices, discounts, warranties, delivery promises, ratings, shop names or badges that are not given above.`,
  ].join("\n");
}

/**
 * Flow Video prompt that turns the storyboard image (step ①, same language) into the silent clip.
 * The user attaches the storyboard + the product photos as ingredients; panels and timings here match
 * the storyboard prompt exactly, so the video follows the picture they already approved.
 */
export function buildStoryboardVideoPrompt(product, lang, { script, seconds = 15, shots, style = "product" } = {}) {
  const panels = storyboardPanels(script, lang, { seconds, shots });
  return [
    `Vertical 9:16, ${seconds} seconds, photorealistic social-commerce product video.`,
    `Follow the attached STORYBOARD image: it has ${panels.length} numbered panels. Turn them into ONE continuous video, in this order and timing, with smooth natural camera moves and quick cuts between panels:`,
    ...panels.map((p, i) => `${i + 1}. (${p.from}–${p.to}s) ${p.visual || DEFAULT_VISUAL[p.role]}`),
    `Product: ${promptTitle(product.title)} — exactly as in the attached product photos: same shape, colours, materials, logo and label text. It is one single product that looks identical in every shot; never morph, duplicate or redesign it. Do not invent features.`,
    styleLook(style),
    `Results must be realistic and modest — no exaggerated or instant transformations.`,
    `Nobody speaks: no voice, no narration, no lip movement. Audio: only natural sounds of the product being handled. No music.`,
    `The storyboard's labels, headline, captions, buttons and prices are only a plan — show NO text, subtitles, captions, buttons, logos or watermarks anywhere in the video. Every frame is a full-screen live-action shot (never the storyboard layout itself).`,
  ].join("\n");
}
