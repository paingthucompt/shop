// Pure request-validation helpers (no DB / Redis imports, so they are unit-testable).
import { CLIP_STYLES } from "../../../packages/providers/src/seedance.js";
import { SCRIPT_ANGLES } from "../../../packages/providers/src/llm.js";

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

/** script angle: undefined → "auto" (the AI picks) */
export function parseAngle(value) {
  if (value === undefined || value === null || value === "") return "auto";
  if (!SCRIPT_ANGLES.includes(value)) throw httpError(400, `angle must be one of: ${SCRIPT_ANGLES.join(", ")}`);
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
export function publicError(message) {
  const m = String(message || "");
  if (/Seedance task (failed|expired)/i.test(m)) return "The AI clip could not be generated (Seedance). Try clearer product photos.";
  if (/Seedance task timed out/i.test(m)) return "The AI clip took too long to generate.";
  if (/^Seedance 4\d\d/i.test(m)) return "The AI clip request was rejected (Seedance).";
  if (/Gemini video (failed|cancel|expired|incomplete|completed but)/i.test(m)) return "The AI clip could not be generated (Gemini). Try clearer product photos.";
  if (/Gemini video timed out/i.test(m)) return "The AI clip took too long to generate.";
  if (/^Gemini 4\d\d/i.test(m)) return "The AI clip request was rejected (Gemini).";
  if (/no (th|my) script/i.test(m)) return "A script was missing when the video started.";
  if (/product was deleted/i.test(m)) return "The product was deleted.";
  if (/could not be queued/i.test(m)) return "The video could not be started. Please try again.";
  return "Video rendering failed.";
}
