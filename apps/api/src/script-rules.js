// Limits for a single-language script. Keeps TTS cost and video length bounded for a fixed-price job.
export const SCRIPT_LIMITS = { hook: 80, line: 160, caption: 60, cta: 80, maxLines: 6 };

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

const SCRIPT_RE = { th: /[฀-๿]/, my: /[က-႟ꧠ-꧿ꩠ-ꩿ]/ };
const LANG_LABEL = { th: "Thai", my: "Myanmar" };
// any letter outside the script's own alphabet and Latin (brand names): Hebrew, Chinese, Cyrillic …
const OTHER_LETTER = Object.fromEntries(Object.entries(LANG_LABEL).map(([l, name]) =>
  [l, new RegExp(`(?![\\p{Script=Latin}\\p{Script=${name}}\\p{Script=Inherited}])[\\p{L}\\p{M}]`, "u")]));

/**
 * Each video is one language: a Myanmar script must not contain Thai text and vice versa
 * (it would be burned into the wrong video). Latin brand names / numbers are fine.
 * Returns an error message or null.
 */
export function foreignScriptIssue(lang, s) {
  const text = [s?.hook, ...(s?.lines || []), ...(s?.captions || []), s?.cta].join(" ");
  for (const [other, re] of Object.entries(SCRIPT_RE)) {
    if (other !== lang && re.test(text)) return `the ${LANG_LABEL[lang]} script contains ${LANG_LABEL[other]} text — rewrite it in ${LANG_LABEL[lang]}`;
  }
  const stray = OTHER_LETTER[lang] ? [...new Set(text.split(/\s+/).filter((w) => OTHER_LETTER[lang].test(w)))] : [];
  if (stray.length) return `the ${LANG_LABEL[lang]} script contains letters of another language (${stray.join(" ")}) — rewrite it in ${LANG_LABEL[lang]}`;
  return null;
}

/**
 * Shorten to at most `max` characters without cutting a word or a syllable: Thai/Myanmar have no
 * spaces between words, so break at Intl.Segmenter word boundaries (graphemes as a last resort).
 */
export function truncateText(text, max) {
  const s = clean(text);
  if (s.length <= max) return s;
  const lang = SCRIPT_RE.my.test(s) ? "my" : SCRIPT_RE.th.test(s) ? "th" : "en";
  let out = "";
  for (const { segment } of new Intl.Segmenter(lang, { granularity: "word" }).segment(s)) {
    if ((out + segment).length > max) break;
    out += segment;
  }
  if (!out.trim()) {
    for (const { segment } of new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(s)) {
      if ((out + segment).length > max) break;
      out += segment;
    }
  }
  return out.trim();
}

/**
 * Lines + their optional on-screen captions, kept aligned: empty lines are dropped together with
 * their caption, and captions always has exactly one entry per line ("" = show the spoken line).
 */
/** "A" | "B" — who says a line in a mini drama (anything else → A) */
const speakerOf = (v) => (String(v ?? "").trim().toUpperCase() === "B" ? "B" : "A");

/** lines with their caption and speaker; an empty line is dropped together with both */
function alignLines(rawLines, rawCaptions, rawSpeakers) {
  const caps = Array.isArray(rawCaptions) ? rawCaptions : [];
  const spk = Array.isArray(rawSpeakers) ? rawSpeakers : [];
  const rows = rawLines.map((l, i) => [clean(l), clean(caps[i]), speakerOf(spk[i])]).filter(([l]) => l);
  return { lines: rows.map(([l]) => l), captions: rows.map(([, c]) => c), speakers: rows.map(([, , sp]) => sp) };
}

/** User-edited script → { script } or { error } */
export function validateScript(body, lang) {
  const hook = clean(body?.hook);
  const cta = clean(body?.cta);
  if (!Array.isArray(body?.lines)) return { error: "hook, lines[], cta required" };
  if (body.captions !== undefined && !Array.isArray(body.captions)) return { error: "captions must be an array" };
  if (body.speakers !== undefined && !Array.isArray(body.speakers)) return { error: "speakers must be an array" };
  const { lines, captions, speakers } = alignLines(body.lines, body.captions, body.speakers);
  const L = SCRIPT_LIMITS;
  if (!hook || !cta || !lines.length) return { error: "hook, lines[], cta required" };
  if (hook.length > L.hook) return { error: `hook is too long (max ${L.hook} characters)` };
  if (cta.length > L.cta) return { error: `call to action is too long (max ${L.cta} characters)` };
  if (lines.length > L.maxLines) return { error: `too many lines (max ${L.maxLines})` };
  if (lines.some((l) => l.length > L.line)) return { error: `each line must be at most ${L.line} characters` };
  if (captions.some((c) => c.length > L.caption)) return { error: `on-screen text must be at most ${L.caption} characters` };
  const foreign = lang && foreignScriptIssue(lang, { hook, lines, captions, cta });
  if (foreign) return { error: foreign };
  return { script: { hook, lines, captions, speakers, cta } };
}

/** LLM output is already short by prompt; clamp it anyway (at word boundaries) so a runaway reply can't exceed the limits */
export function clampScript(s) {
  const L = SCRIPT_LIMITS;
  const { lines, captions, speakers } = alignLines(s.lines, s.captions, s.speakers);
  return {
    hook: truncateText(s.hook, L.hook),
    lines: lines.slice(0, L.maxLines).map((l) => truncateText(l, L.line)),
    captions: captions.slice(0, L.maxLines).map((c) => truncateText(c, L.caption)),
    speakers: speakers.slice(0, L.maxLines),
    cta: truncateText(s.cta, L.cta),
  };
}
