// What one API call costs in US$ — the single price table for cost tracking and pre-spend estimates.
// Prices checked 2026-11-25 (Google's Gemini API pricing page as summarised by several price trackers;
// Omni / Seedance per-second rates from the providers' pages). Several Gemini models have an
// introductory price until 2026-12-31 that doubles on 2027-01-01 — `from` dates below handle that.
// Override or add models without a code change: PRICES_JSON='{"text":{"my-model":{"in":1,"out":2}}}'

const NEW_YEAR = "2027-01-01";

/** per 1M tokens: in = input, out = output (thinking tokens bill as output) */
const TEXT = {
  "gemini-flash-lite-latest": { in: 0.3, out: 2.5 }, // alias of the current Flash-Lite (3.5)
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-3.6-flash": [{ in: 0.75, out: 3.75 }, { from: NEW_YEAR, in: 1.5, out: 7.5 }],
  // OpenAI (a user's own OpenAI key writes their scripts)
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
};

/** speech, per 1M tokens: in = text, out = audio (~25 audio tokens per second of speech) */
const TTS = {
  "gemini-3.8-flash-tts": [{ in: 0.5, out: 9 }, { from: NEW_YEAR, in: 1, out: 18 }],
  "gemini-3.8-flash-lite-tts": [{ in: 0.5, out: 6 }, { from: NEW_YEAR, in: 1, out: 12 }],
};
const AUDIO_TOKENS_PER_SECOND = 25;

/** AI video, per second of clip by resolution (provider name or model id) */
const VIDEO = {
  "gemini-omni-1.2-flash": { "360p": 0.0232, "720p": 0.0695, "1080p": 0.1043 },
  seedance: { "480p": 0.103, "720p": 0.231 },
  // Higgsfield, keyed by model path — checked against a real Higgsfield bill on 2026-11-26 (10 s, 720p start
  // frame, the model's own sound on): Seedance 2.5 $2.65 and Kling 4.0 $1.88 per clip, much more than the
  // list prices on open.higgsfield.ai/pricing ($0.118/s, $0.126/s). Kling 2.5 Turbo / 4.0 Flash: the bill
  // left ≈ $0.66 per clip for them, close to the estimates below.
  "kling-video/v2.5-turbo/pro/image-to-video": { "720p": 0.07 },
  "kling-video/v4.0-flash/image-to-video": { "720p": 0.063 },
  "kling-video/v4.0/image-to-video": { "720p": 0.188 },
  "bytedance/seedance-2.5/image-to-video": { "720p": 0.265 },
  "bytedance/seedance-2.0/image-to-video": { "720p": 0.08 },
  "alibaba/wan-3.0/image-to-video": { "720p": 0.038 },
};

/** image generation, per image */
const IMAGE = {
  "gemini-3.1-flash-image": { "1K": 0.067 },
};

function tables() {
  let extra = {};
  try { extra = JSON.parse(process.env.PRICES_JSON || "{}"); } catch { /* ignore a broken override */ }
  return {
    text: { ...TEXT, ...extra.text },
    tts: { ...TTS, ...extra.tts },
    video: { ...VIDEO, ...extra.video },
    image: { ...IMAGE, ...extra.image },
  };
}

/** the price entry in force on `date` (entries may be a list of { from?: "YYYY-MM-DD", … }) */
function inForce(entry, date) {
  if (!Array.isArray(entry)) return entry;
  const day = date.toISOString().slice(0, 10);
  return entry.filter((e) => !e.from || e.from <= day).at(-1) || null;
}

/** a resolution's price, or the closest listed one (e.g. "720" → "720p") */
function byResolution(rates, resolution) {
  if (!rates) return null;
  const r = String(resolution || "720p").toLowerCase().replace(/p?$/, "p");
  return rates[r] ?? rates[String(resolution)] ?? Object.values(rates)[0];
}

const TEXT_KINDS = new Set(["script", "translate", "clip_prompt", "text"]);

/**
 * One usage entry → { usd, priced }. priced = false when the model isn't in the table (usd 0) —
 * shown in the app as "price unknown" rather than silently counted as free.
 *   text/script/translate/clip_prompt: { model, input_tokens, output_tokens }
 *   tts:   { model, input_tokens, output_tokens } (or seconds when the reply had no usage)
 *   video: { provider, model, seconds, resolution }
 *   image: { model, images, size }
 */
export function priceUsage(entry, date = new Date()) {
  const t = tables();
  const { kind, model, provider } = entry;
  const M = 1_000_000;
  const tokens = (rate, inTok, outTok) => ((Number(inTok) || 0) * rate.in + (Number(outTok) || 0) * rate.out) / M;
  let usd = null;
  if (TEXT_KINDS.has(kind)) {
    const rate = inForce(t.text[model], date);
    if (rate) usd = tokens(rate, entry.input_tokens, entry.output_tokens);
  } else if (kind === "tts") {
    const rate = inForce(t.tts[model], date);
    const out = entry.output_tokens ?? Math.round((Number(entry.seconds) || 0) * AUDIO_TOKENS_PER_SECOND);
    if (rate) usd = tokens(rate, entry.input_tokens, out);
  } else if (kind === "video") {
    const perSec = byResolution(inForce(t.video[model] || t.video[provider], date), entry.resolution);
    if (perSec != null) usd = perSec * (Number(entry.seconds) || 0);
  } else if (kind === "image") {
    const rates = inForce(t.image[model], date);
    const each = rates && (rates[entry.size || "1K"] ?? Object.values(rates)[0]);
    if (each != null) usd = each * (Number(entry.images) || 1);
  }
  return usd == null ? { usd: 0, priced: false } : { usd: Math.round(usd * 1e6) / 1e6, priced: true };
}

/** price of an AI clip before it is made (the pre-spend quote) */
export const estimateClipUsd = ({ provider, model, seconds, resolution }) =>
  priceUsage({ kind: "video", provider, model, seconds, resolution }).usd;
