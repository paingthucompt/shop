// Pure request-validation helpers (no DB / Redis imports, so they are unit-testable).
import { CLIP_STYLES } from "../../../packages/providers/src/seedance.js";
import { SCRIPT_ANGLES, SCRIPT_FORMATS } from "../../../packages/providers/src/llm.js";
import { errorCode } from "../../../packages/providers/src/api-errors.js";

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** positive integer id from a route/body param, else 400 */
export function parseId(value, name = "id") {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw httpError(400, `invalid ${name}`);
  return n;
}

export const LANG_CODES = ["th", "my"];

/** langs from a request (array or "th,my"): undefined → both; anything else must contain th and/or my */
export function parseLangs(value) {
  if (value === undefined) return [...LANG_CODES];
  const list = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(list)) throw httpError(400, "langs must be an array of th / my");
  const langs = [...new Set(list.map(String).filter((l) => LANG_CODES.includes(l)))];
  if (!langs.length) throw httpError(400, "langs must include th and/or my");
  return langs;
}

/** AI clip style: undefined → "product" */
export function parseStyle(value) {
  if (value === undefined || value === null || value === "") return "product";
  if (!CLIP_STYLES.includes(value)) throw httpError(400, `style must be one of: ${CLIP_STYLES.join(", ")}`);
  return value;
}

export const CLIP_SOURCES = ["auto", "upload", "scenes", "photos", "ai_video"];

/** where the product clip comes from: "auto" (CLIP_MODE), "upload" (the user's own clip), "scenes" (AI scene
 * images), "photos" (product photos with zoom / pan, no API cost) or "ai_video" (Gemini / Seedance, API cost) */
export function parseClipSource(value) {
  if (value === undefined || value === null || value === "") return "auto";
  if (!CLIP_SOURCES.includes(value)) throw httpError(400, `clip_source must be one of: ${CLIP_SOURCES.join(", ")}`);
  return value;
}

/** the AI video service the user picked: gemini | higgsfield | seedance; missing → null (the default one) */
export function parseAiProvider(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!["gemini", "higgsfield", "seedance"].includes(value)) throw httpError(400, "ai_provider must be gemini, higgsfield or seedance");
  return value;
}

export const VOICE_SPEED = { min: 0.8, max: 1.5 };

/** { th: 1.1, my: 1.2 } → validated speeds for the chosen languages (0.05 steps); empty → null (server default) */
export function parseVoiceSpeed(value, langs = LANG_CODES) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) throw httpError(400, "voice_speed must be an object like {\"my\": 1.15}");
  const out = {};
  for (const [lang, v] of Object.entries(value)) {
    if (!langs.includes(lang)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < VOICE_SPEED.min || n > VOICE_SPEED.max) {
      throw httpError(400, `voice_speed.${lang} must be between ${VOICE_SPEED.min} and ${VOICE_SPEED.max}`);
    }
    out[lang] = Math.round(n * 20) / 20;
  }
  return Object.keys(out).length ? out : null;
}

/** script angle: undefined → "auto" (the AI picks) */
export function parseAngle(value) {
  if (value === undefined || value === null || value === "") return "auto";
  if (!SCRIPT_ANGLES.includes(value)) throw httpError(400, `angle must be one of: ${SCRIPT_ANGLES.join(", ")}`);
  return value;
}

/** script format (voiceover | presenter | drama | montage); missing → voiceover */
export function parseFormat(value) {
  if (value === undefined || value === null || value === "") return "voiceover";
  if (!SCRIPT_FORMATS.includes(value)) throw httpError(400, `format must be one of: ${SCRIPT_FORMATS.join(", ")}`);
  return value;
}

/** only real Shopee hosts (shopee.co.th, shopee.com.my, shp.ee …) get an affiliate link made with our credentials */
export function isShopeeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (/(^|\.)shopee\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host) || host === "shp.ee");
  } catch {
    return false;
  }
}

/** internal error text (ffmpeg stderr, provider messages) stays in the DB; users see a short reason */
// problems with the API key / its Google project — the owner of the key has to fix them
const KEY_PROBLEM = {
  key_invalid: "The API key was rejected. Check or replace it in Settings.",
  key_restricted: "The API key has restrictions (IP / website / API) that block this app. Use a key without restrictions.",
  key_suspended: "The Google Cloud project of the API key is suspended. Check it in Google Cloud Console.",
  key_service_disabled: "The Gemini API is turned off for the API key's project. Turn it on in Google Cloud Console and try again in a few minutes.",
  key_model_off: "This AI model isn't available on your account yet. Switch it on in the provider's console (Higgsfield: check the model and your account; BytePlus: Model activation), or choose another AI video service.",
  key_billing: "Your AI account has no billing or not enough balance. Turn on billing in Google AI Studio (free keys can't make AI video), or top up your Higgsfield / OpenAI balance.",
};

/** what a failed job's error is about, for the web app to translate: key_* | busy | null */
export const publicErrorCode = (message) => errorCode(message);

/** a job's error for the user: no paths / internals. ownKey: the job ran on the user's own keys (no credits) */
export function publicError(message, { ownKey = false } = {}) {
  const m = String(message || "");
  const code = errorCode(m);
  if (KEY_PROBLEM[code]) return KEY_PROBLEM[code];
  if (code === "busy" && ownKey) return "Google's AI service is busy or your key's quota is used up — please try again later.";
  if (/Higgsfield nsfw/i.test(m)) return "The AI video service refused these photos or this description (content filter) — nothing was charged. Try another main photo.";
  if (/Higgsfield request (failed|canceled)/i.test(m)) return "The AI clip could not be generated (Higgsfield) — failed clips are not charged. Try again or use a clearer main photo.";
  if (/Higgsfield request timed out/i.test(m)) return "The AI clip took too long to generate (Higgsfield).";
  if (/^Higgsfield 4\d\d/i.test(m)) return "The AI clip request was rejected (Higgsfield).";
  if (/Seedance task (failed|expired)/i.test(m)) return "The AI clip could not be generated (Seedance). Try clearer product photos.";
  if (/Seedance task timed out/i.test(m)) return "The AI clip took too long to generate.";
  if (/^Seedance 4\d\d/i.test(m)) return "The AI clip request was rejected (Seedance).";
  if (/RESOURCE_EXHAUSTED|high demand|^Gemini 429|^Gemini 503/i.test(m)) return "Google's AI video service is busy right now. Your credits were refunded — please try again in a few minutes.";
  if (/Gemini video (failed|cancel|expired|incomplete|completed but)/i.test(m)) return "The AI clip could not be generated (Gemini). Try clearer product photos.";
  if (/Gemini video timed out/i.test(m)) return "The AI clip took too long to generate.";
  if (/^Gemini 4\d\d/i.test(m)) return "The AI clip request was rejected (Gemini).";
  if (/scene images? (are|is) missing/i.test(m)) return "Some scene images are missing — make the scene images again.";
  if (/uploaded clip is missing/i.test(m)) return "Your uploaded clip is missing — upload it again.";
  if (/^ffmpeg failed|^ffprobe failed|no video stream/i.test(m)) return "Your clip could not be read — export it again as MP4 and re-upload.";
  if (/no (th|my) script/i.test(m)) return "A script was missing when the video started.";
  if (/product was deleted/i.test(m)) return "The product was deleted.";
  if (/could not be queued/i.test(m)) return "The video could not be started. Please try again.";
  return "Video rendering failed.";
}
