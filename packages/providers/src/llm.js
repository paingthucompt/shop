// Script writer: one separate script per language (th / my) — never mixed.
// Uses any OpenAI-compatible Chat Completions endpoint (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL).
import { buildProductPrompt } from "./seedance.js";

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
    `- The product details may be in another language: never copy that text — say it in ${LANG_NAME[lang]}. Brand names and model numbers in Latin letters are fine.`,
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

const llmEnabled = () => Boolean(process.env.LLM_API_KEY);

/** one user message → the model's text reply */
async function chat(content, temperature) {
  const { LLM_API_KEY, LLM_BASE_URL = "https://api.openai.com/v1", LLM_MODEL = "gpt-4.1-mini" } = process.env;
  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, temperature, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

export async function generateScript(product, lang, { seconds = 10, angle = "auto" } = {}) {
  if (!LANG_NAME[lang]) throw new Error(`unsupported lang ${lang}`);
  if (!llmEnabled()) return { ...MOCK[lang](product), mock: true };
  return parseScript(await chat(buildScriptPrompt(product, lang, seconds, angle), 0.8));
}

export const VIDEO_PROMPT_MAX = 2000;

/**
 * Ask the LLM for a ready-to-paste prompt for a video tool the user runs themselves (Google Flow / Veo,
 * Seedance, Kling …): the house prompt for the chosen style, rewritten into a timed shot list for this
 * product that follows the beats of the script. All product-accuracy / no-text / no-speech rules stay.
 */
export function buildVideoPromptRequest(product, { style = "product", seconds = 10, script } = {}) {
  const beats = script
    ? [`hook: ${script.hook}`, ...(script.lines || []).map((l, i) => `line ${i + 1}: ${l}`), `call to action: ${script.cta}`]
    : [];
  return [
    `You write prompts for AI video tools such as Google Flow (Veo). The user attaches the product photos as reference images.`,
    `Rewrite the BASE PROMPT below into ONE ready-to-paste prompt for this specific product: a ${seconds}-second vertical 9:16 clip.`,
    `Make it a concrete shot list with timings (e.g. "0–3s: …"), choosing actions, setting and props that suit this product and how it is really used.`,
    beats.length ? `A voiceover is added later. Match the shots, in order, to the beats of this script (it may be in Thai or Burmese — read it, do not copy it):\n${beats.map((b) => `- ${b}`).join("\n")}` : "",
    `Keep every rule of the base prompt: exact product appearance and consistency, no on-screen text, captions or logos, nobody speaks (no lip movement), audio only natural product sounds, no music.`,
    `Only show features the product details support.`,
    `Write in English. Return ONLY the prompt text — no title, no markdown, no explanation. At most ${VIDEO_PROMPT_MAX - 200} characters.`,
    ``,
    `Product: ${product.title}`,
    product.description ? `Details: ${String(product.description).slice(0, 1500)}` : "",
    ``,
    `BASE PROMPT:`,
    buildProductPrompt(product, { style }),
  ].filter((l) => l !== "").join("\n");
}

/** → { prompt, mock? }  Without an LLM key the house prompt for the style is returned as is. */
export async function generateVideoPrompt(product, opts = {}) {
  if (!llmEnabled()) return { prompt: buildProductPrompt(product, { style: opts.style }), mock: true };
  const text = (await chat(buildVideoPromptRequest(product, opts), 0.7))
    .replace(/^```\w*\s*|\s*```$/g, "")
    .trim();
  if (!text) throw new Error("LLM returned an empty video prompt");
  return { prompt: text.slice(0, VIDEO_PROMPT_MAX) };
}
