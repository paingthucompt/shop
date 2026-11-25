// Script writer: one separate script per language (th / my) — never mixed.
// Uses any OpenAI-compatible Chat Completions endpoint (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL).
// With LLM_API_KEY empty it uses GEMINI_API_KEY through Gemini's OpenAI-compatible endpoint.
import { buildClipPrompt, buildShotRequest, clipSeconds, parseShots } from "./flow-prompt.js";

const LANG_NAME = { th: "Thai (ภาษาไทย)", my: "Burmese (မြန်မာဘာသာ, Unicode)" };
const CTA_HINT = {
  th: 'a short call to action telling viewers to tap the yellow basket, e.g. "กดตะกร้าเหลืองได้เลย"',
  my: 'a short call to action telling viewers to tap the basket to buy, e.g. "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါ"',
};

/**
 * Script angle = how the script sells. "auto" lets the model pick (the original behaviour). Every angle
 * still obeys the honesty rules below: no fake reviews, no fake urgency, no exaggerated results.
 */
const ANGLE_GUIDE = {
  auto: "",
  problem_solution: `Angle: problem → solution. The hook names a small everyday problem the viewer recognises; the lines show how this product solves it.`,
  review: `Angle: honest first-person creator review ("I tried this…"). Give your own impression of what you see and use — never pretend to quote other customers, star ratings or sales numbers.`,
  unboxing: `Angle: unboxing / first impression. The hook builds curiosity about what is inside; the lines react to the look, feel and first use.`,
  soft_sell: `Angle: soft sell. Relaxed, friendly, lifestyle tone — focus on how the product fits into a normal day; the call to action is a gentle suggestion.`,
  hard_sell: `Angle: direct-response. Lead with the strongest benefit, keep sentences punchy, end with a clear direct call to action. Mention a price, discount or deadline ONLY if it is in the product details — never invent urgency ("only today", "almost sold out").`,
  storytelling: `Angle: mini story. A tiny relatable moment (before → discovering the product → after) told in the first person; realistic, no dramatic transformations.`,
};

export const SCRIPT_ANGLES = Object.keys(ANGLE_GUIDE);

export function buildScriptPrompt(product, lang, seconds = 10, angle = "auto") {
  const maxLines = seconds <= 10 ? 3 : 4;
  return [
    `You write voiceover scripts for short vertical TikTok Shop / Shopee affiliate videos.`,
    `Write ONLY in ${LANG_NAME[lang]}. Natural spoken style a real local creator would use — not a translation, no English sentences.`,
    `Video length: about ${seconds} seconds. Total spoken text must fit that time (${lang === "my" ? "Burmese is slower to speak — keep it extra short" : "keep it short"}).`,
    ``,
    `Product: ${product.title}`,
    product.description ? `Details: ${product.description}` : "",
    product.price ? `Price: ${product.price} ${product.currency || "THB"}` : "",
    ``,
    ANGLE_GUIDE[angle] || "",
    ``,
    `Rules:`,
    `- Only claim what the product details support. No medical claims, no "best in the world", no fake discounts.`,
    `- The product name / details may be in another language (e.g. Thai): never copy any of its letters, not even single vowels or tone marks — translate the meaning into ${LANG_NAME[lang]} (e.g. "fridge", "litres" written in ${LANG_NAME[lang]} letters). Brand names and model numbers in Latin letters and digits are fine.`,
    `- hook: max 8 words, stops the scroll (problem, surprise or result). It is SPOKEN first, at 0 seconds, and counts toward the time limit — lead with the benefit, never "hello everyone".`,
    `- lines: ${maxLines - 1}–${maxLines} short sentences describing what the viewer sees and why it is good.`,
    `- captions: one on-screen key phrase per line (2–5 words, max 30 characters), same order as lines. It is NOT the spoken sentence — it is the selling point at a glance for muted viewers (e.g. a spec, a benefit, a number).`,
    `- cta: ${CTA_HINT[lang]}.`,
    ``,
    `Return ONLY JSON: {"hook": "...", "lines": ["...", "..."], "captions": ["...", "..."], "cta": "..."}`,
  ].filter((l) => l !== "").join("\n");
}

export function parseScript(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM did not return JSON");
  const j = JSON.parse(m[0]);
  if (typeof j.hook !== "string" || !Array.isArray(j.lines) || typeof j.cta !== "string") {
    throw new Error("LLM JSON missing hook/lines/cta");
  }
  // keep captions aligned with lines: drop a caption together with its empty line; missing → ""
  const caps = Array.isArray(j.captions) ? j.captions : [];
  const pairs = j.lines.map((s, i) => [String(s).trim(), String(caps[i] ?? "").trim()]).filter(([l]) => l);
  return { hook: j.hook.trim(), lines: pairs.map(([l]) => l), captions: pairs.map(([, c]) => c), cta: j.cta.trim() };
}

const SCRIPT_RE = { th: /[฀-๿]/, my: /[က-႟ꧠ-꧿ꩠ-ꩿ]/ };
// a letter that is neither in `lang`'s own script nor Latin (brand names) — Thai in a Burmese line, but also
// Hebrew / Chinese / Cyrillic … that a model sometimes slips in (seen: Hebrew "ממש" in a Burmese hook)
const SCRIPT_NAME = { th: "Thai", my: "Myanmar" };
const OTHER_LETTER = Object.fromEntries(Object.entries(SCRIPT_NAME).map(([l, name]) =>
  [l, new RegExp(`(?![\\p{Script=Latin}\\p{Script=${name}}\\p{Script=Inherited}])[\\p{L}\\p{M}]`, "u")]));

/**
 * A short product name usable inside a `lang` hook: the title's first phrase (≤ 24 characters),
 * only if it is written in that language or plain Latin — a Thai title must never appear in a
 * Burmese video (and vice versa). Returns "" when no such name exists.
 */
export function shortName(title, lang) {
  const first = String(title || "").trim().split(/\s+/)[0] || "";
  const foreign = Object.entries(SCRIPT_RE).some(([l, re]) => l !== lang && re.test(first));
  if (!first || foreign || [...first].length > 24) return "";
  return first;
}

const MOCK = {
  th: (p) => {
    const n = shortName(p.title, "th");
    return {
      hook: n ? `${n} ตัวนี้ต้องลอง!` : "ของดีตัวนี้ต้องลอง!",
      lines: ["แกะกล่องมาก็สวยมาก", "ใช้งานง่าย คุณภาพดีเกินราคา"],
      captions: ["สวยตั้งแต่แกะกล่อง", "คุ้มเกินราคา"],
      cta: "กดตะกร้าเหลืองได้เลย",
    };
  },
  my: (p) => {
    const n = shortName(p.title, "my");
    return {
      hook: n ? `${n} ကို စမ်းကြည့်ပါ!` : "ဒီပစ္စည်းလေး စမ်းကြည့်ပါ!",
      lines: ["ဗူးဖွင့်လိုက်တာနဲ့ လှနေပြီ", "သုံးရလွယ်ပြီး ဈေးနဲ့ထိုက်တန်တယ်"],
      captions: ["ဗူးဖွင့်ကတည်းက လှ", "ဈေးနဲ့ ထိုက်တန်"],
      cta: "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါ",
    };
  },
};

const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
// flash-lite answers in seconds even on the free tier; the bigger flash models often hang there (2026-11-20)
export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-flash-lite-latest";
// tried in order when the main model is busy (503 "high demand") or hangs
export const DEFAULT_GEMINI_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"];

const listOf = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * { key, baseUrl, model } or null (→ built-in sample scripts).
 *   LLM_API_KEY set     → that provider (LLM_BASE_URL, default OpenAI)
 *   else GEMINI_API_KEY → Gemini; a leftover non-Gemini LLM_BASE_URL / LLM_MODEL is ignored so the
 *                         Gemini key is never sent to another provider
 */
export function llmConfig(env = process.env) {
  if (env.LLM_API_KEY) {
    return {
      key: env.LLM_API_KEY, baseUrl: env.LLM_BASE_URL || "https://api.openai.com/v1", model: env.LLM_MODEL || "gpt-4.1-mini",
      fallbacks: listOf(env.LLM_FALLBACK_MODELS),
    };
  }
  if (env.GEMINI_API_KEY) {
    return {
      key: env.GEMINI_API_KEY,
      baseUrl: env.LLM_BASE_URL?.includes("generativelanguage.googleapis.com") ? env.LLM_BASE_URL : GEMINI_OPENAI_URL,
      model: env.LLM_MODEL?.startsWith("gemini") ? env.LLM_MODEL : DEFAULT_GEMINI_TEXT_MODEL,
      fallbacks: env.LLM_FALLBACK_MODELS !== undefined ? listOf(env.LLM_FALLBACK_MODELS) : DEFAULT_GEMINI_FALLBACKS,
    };
  }
  return null;
}

const llmEnabled = () => Boolean(llmConfig());

/** one user message → the model's text reply */
async function chat(content, temperature) {
  const { key: LLM_API_KEY, baseUrl: LLM_BASE_URL, model: main, fallbacks = [] } = llmConfig();
  // providers answer 429/503 ("high demand") in bursts and sometimes hang: cap each try, and move on to
  // the next fallback model (or retry the last one) instead of waiting minutes on a busy model
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 40_000);
  const models = [main, ...fallbacks.filter((m) => m !== main)];
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const LLM_MODEL = models[Math.min(attempt - 1, models.length - 1)];
    try {
      const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: LLM_MODEL, temperature, messages: [{ role: "user", content }] }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || "";
      }
      last = `LLM ${res.status} (${LLM_MODEL}): ${(await res.text()).slice(0, 300)}`;
      if (res.status !== 429 && res.status < 500) break; // bad key / bad request: retrying won't help
    } catch (err) {
      last = err.name === "TimeoutError" ? `LLM timed out after ${timeoutMs / 1000}s (${LLM_MODEL})` : `LLM ${err.message}`;
    }
    console.warn(`[llm] ${last.slice(0, 160)}${attempt < 3 ? ` — trying ${models[Math.min(attempt, models.length - 1)]}` : ""}`);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(last);
}

/** words of a script with letters of another language (Thai "ตู้" or Hebrew "ממש" inside a Burmese line) */
export function foreignWords(script, lang) {
  const text = [script.hook, ...script.lines, ...(script.captions || []), script.cta].join(" ");
  return [...new Set(text.split(/\s+/).filter((w) => OTHER_LETTER[lang].test(w)))];
}

/** true when the product name / details contain letters of a script language other than `lang` */
export const hasForeignText = (product, lang) => {
  const text = `${product.title || ""} ${product.description || ""}`;
  return OTHER_LETTER[lang].test(text);
};

/**
 * Product name + details in plain English, for writing a script in another language: a small model
 * copies Thai letters from a Thai title into Burmese words, but it cannot copy what it never sees.
 * Falls back to the original product when the translation fails.
 */
export async function englishProduct(product) {
  const reply = await chat([
    `Translate this e-commerce product name and details into plain, short English. Keep brand names, model numbers, sizes and numbers exactly. Do not add anything.`,
    `Name: ${product.title}`,
    product.description ? `Details: ${String(product.description).slice(0, 1500)}` : "",
    `Return ONLY JSON: {"title": "...", "description": "..."}`,
  ].filter(Boolean).join("\n"), 0.2);
  const m = reply.match(/\{[\s\S]*\}/);
  const j = m ? JSON.parse(m[0]) : null;
  if (!j || typeof j.title !== "string" || !j.title.trim()) throw new Error("no translation");
  const clean = (x) => Object.values(SCRIPT_RE).some((re) => re.test(x)) ? "" : String(x || "").trim();
  if (!clean(j.title)) throw new Error("translation still in Thai / Burmese");
  return { ...product, title: clean(j.title), description: clean(j.description) || null };
}

/** a script problem the user can act on (shown as is, not as "server error") */
export class ScriptError extends Error {
  constructor(message) { super(message); this.name = "ScriptError"; this.status = 422; }
}

export async function generateScript(product, lang, { seconds = 10, angle = "auto" } = {}) {
  if (!LANG_NAME[lang]) throw new Error(`unsupported lang ${lang}`);
  if (!llmEnabled()) return { ...MOCK[lang](product), mock: true };
  // a name / details in the other language (e.g. a Thai title for a Burmese script) → English first
  let source = product;
  if (hasForeignText(product, lang)) {
    try { source = await englishProduct(product); } catch (e) { console.warn(`[llm] product translation failed (${e.message}) — using the original text`); }
  }
  // small models still sometimes copy letters of the other language: check every reply and ask
  // again, naming the broken words.
  const prompt = buildScriptPrompt(source, lang, seconds, angle);
  let script, bad = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const fix = bad.length
      ? `\n\nYour previous answer mixed in letters of another language in: ${bad.map((w) => `"${w}"`).join(", ")}. ` +
        `Write those words fully in ${LANG_NAME[lang]} letters (translate them; Latin brand names and digits are fine). Use NO other script.`
      : "";
    script = parseScript(await chat(prompt + fix, attempt === 1 ? 0.8 : 0.5));
    bad = foreignWords(script, lang);
    if (!bad.length) return script;
    console.warn(`[llm] ${lang} script has foreign letters (${bad.join(" ")}) — asking again (${attempt}/3)`);
  }
  throw new ScriptError(`the AI kept mixing other-language letters into the ${lang === "my" ? "Burmese" : "Thai"} script (${bad.join(" ")}) — press “Write again”, or write the product name in English`);
}

/**
 * Google Flow prompt for the shared silent clip (see flow-prompt.js). The LLM only plans the shot list
 * from the script beats; length and rules come from code. scripts: { th?, my? }
 * → { style, seconds, shots, prompt, mock }   mock = default shots (no LLM or unusable reply)
 */
export async function generateClipPrompt(product, { style = "product", scripts = {} } = {}) {
  const seconds = clipSeconds(scripts);
  const script = scripts.my || scripts.th;
  let shots = null;
  if (llmEnabled() && script) shots = parseShots(await chat(buildShotRequest(product, { style, seconds, script }), 0.7));
  return { style, seconds, shots, prompt: buildClipPrompt(product, { style, seconds, shots }), mock: !shots };
}
