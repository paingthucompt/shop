// Script writer: one separate script per language (th / my) — never mixed.
// Uses any OpenAI-compatible Chat Completions endpoint (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL).

const LANG_NAME = { th: "Thai (ภาษาไทย)", my: "Burmese (မြန်မာဘာသာ, Unicode)" };
const CTA_HINT = {
  th: 'a short call to action telling viewers to tap the yellow basket, e.g. "กดตะกร้าเหลืองได้เลย"',
  my: 'a short call to action telling viewers to tap the basket to buy, e.g. "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါ"',
};

export function buildScriptPrompt(product, lang, seconds = 10) {
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

export async function generateScript(product, lang, { seconds = 10 } = {}) {
  if (!LANG_NAME[lang]) throw new Error(`unsupported lang ${lang}`);
  const { LLM_API_KEY, LLM_BASE_URL = "https://api.openai.com/v1", LLM_MODEL = "gpt-4.1-mini" } = process.env;
  if (!LLM_API_KEY) return { ...MOCK[lang](product), mock: true };

  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.8,
      messages: [{ role: "user", content: buildScriptPrompt(product, lang, seconds) }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return parseScript(data.choices?.[0]?.message?.content || "");
}
