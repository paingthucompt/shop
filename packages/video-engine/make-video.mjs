#!/usr/bin/env node
/**
 * Product Video Studio — ပစ္စည်း video တစ်ခုကနေ ထိုင်း video နဲ့ မြန်မာ video သီးသန့်စီ ထုတ်ပေးတဲ့ tool
 *
 * Input : ပစ္စည်း video (ဥပမာ Seedance ကထုတ်ထားတဲ့ 9:16 clip, ပစ္စည်းအသံပါ)
 * Output: <name>-th.mp4 (ထိုင်းအသံ+ထိုင်းစာ) နဲ့ <name>-my.mp4 (မြန်မာအသံ+မြန်မာစာ)
 *
 * Usage:  node make-video.mjs config.json [--lang th|my] [--no-tts]
 *
 * Requirements: Node >= 20, ffmpeg >= 6.1 (libass + harfbuzz), `pip install edge-tts`
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as hb from "harfbuzzjs";
import { ttsProviderFor } from "./tts-provider.js";
import { geminiAudio, GEMINI_TTS_LANGUAGE } from "./gemini-audio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, "fonts");
const FONTS = {
  th: { file: "NotoSansThai-Bold.ttf", family: "Noto Sans Thai" },
  my: { file: "Padauk-Bold.ttf", family: "Padauk" },
  latin: { file: "NotoSans-Bold.ttf", family: "Noto Sans" },
};

// ---------------------------------------------------------------- helpers
const die = (msg) => { console.error(`\n✖ ${msg}`); process.exit(1); };
const log = (msg) => console.log(`• ${msg}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr || "").slice(-2000)}`);
  return r.stdout;
}

function probe(file) {
  const j = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]));
  const v = j.streams.find((s) => s.codec_type === "video");
  return {
    duration: parseFloat(j.format.duration),
    width: v?.width, height: v?.height,
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
const assEscape = (t) => t.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");

// ---------------------------------------------------------------- text measuring + wrapping
// libass က ASS font size ကို usWinAscent + usWinDescent အမြင့်လို့ ယူပါတယ် (VSFilter compatible)။
// font တစ်ခုချင်းရဲ့ win metrics က ထိုင်း font နဲ့ မတူလို့ ASS size တူရင် မြန်မာစာ သေးသွားပါတယ်။
// ဒါကြောင့် size တွေကို "em px" (စာလုံးအမြင်အရွယ်) နဲ့ သတ်မှတ်ပြီး ASS size ကို ဘာသာအလိုက် ပြောင်းပေးပါတယ်။
const fontCache = {};
function getFont(key) {
  if (fontCache[key]) return fontCache[key];
  const data = readFileSync(join(FONT_DIR, FONTS[key].file));
  const face = new hb.Face(new hb.Blob(data));
  const font = new hb.Font(face);
  const dv = new DataView(data.buffer, data.byteOffset);
  const numTables = dv.getUint16(4);
  let winAsc = 0, winDesc = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...data.subarray(rec, rec + 4)) === "OS/2") {
      const off = dv.getUint32(rec + 8);
      winAsc = dv.getUint16(off + 74);
      winDesc = dv.getUint16(off + 76);
    }
  }
  const upem = face.upem;
  const ratio = (winAsc + winDesc || upem) / upem; // libass: ASS size = winAscent+winDescent
  const cmap = new Set(face.collectUnicodes());
  return (fontCache[key] = { font, upem, ratio, cmap, family: FONTS[key].family });
}

/** em px → ASS Fontsize for a font */
const assSize = (key, em) => Math.round(em * getFont(key).ratio);

/**
 * Split text into runs by font coverage: Thai/Myanmar glyphs use the script font,
 * anything it lacks (Latin, digits, %, ฿ …) uses Noto Sans — so "IPX8" / "50%" never turn into boxes
 * and are sized consistently (libass's own fallback would size them with the wrong metrics).
 */
function runs(text, lang) {
  const main = getFont(lang), out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const key = cp === 0x20 || main.cmap.has(cp) ? lang : "latin";
    const last = out[out.length - 1];
    if (last && (last.key === key || cp === 0x20)) last.text += ch;
    else out.push({ key, text: ch });
  }
  return out;
}

function shapeWidth(text, key, emPx) {
  const { font, upem } = getFont(key);
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  return (buf.getGlyphPositions().reduce((a, p) => a + p.xAdvance, 0) / upem) * emPx;
}
const textWidthPx = (text, lang, emPx) => runs(text, lang).reduce((w, r) => w + shapeWidth(r.text, r.key, emPx), 0);

/** ASS text with per-run font overrides for fallback characters */
function assText(text, lang, emPx) {
  return runs(text, lang).map((r) => r.key === lang
    ? assEscape(r.text)
    : `{\\fn${getFont(r.key).family}\\fs${assSize(r.key, emPx)}}${assEscape(r.text)}{\\fn${getFont(lang).family}\\fs${assSize(lang, emPx)}}`).join("");
}

/**
 * Line breaking for Thai / Myanmar (no spaces between words):
 *  1. prefer breaking at spaces (phrase boundaries the writer chose)
 *  2. a phrase wider than the frame is split into words with Intl.Segmenter — never inside a
 *     grapheme cluster, so vowel signs / asat / medials always stay attached
 *  3. balanced: use the fewest lines, then make them roughly equal (no 1-word orphan lines)
 */
function wrap(text, lang, emPx, maxWidth) {
  const seg = new Intl.Segmenter(lang, { granularity: "word" });
  const tokens = []; // { t, sp } — sp: needs a space before it
  for (const phrase of text.trim().split(/\s+/)) {
    if (textWidthPx(phrase, lang, emPx) <= maxWidth) { tokens.push({ t: phrase, sp: true }); continue; }
    [...seg.segment(phrase)].forEach((s, i) => tokens.push({ t: s.segment, sp: i === 0 }));
  }
  const greedy = (limit) => {
    const lines = [];
    let line = "";
    for (const tk of tokens) {
      const cand = line ? line + (tk.sp ? " " : "") + tk.t : tk.t;
      if (line && textWidthPx(cand, lang, emPx) > limit) { lines.push(line); line = tk.t; }
      else line = cand;
    }
    if (line) lines.push(line);
    return lines;
  };
  const best = greedy(maxWidth);
  if (best.length <= 1) return best;
  const total = textWidthPx(text, lang, emPx);
  for (let limit = total / best.length; limit < maxWidth; limit += emPx * 0.5) {
    const l = greedy(limit);
    if (l.length === best.length) return l;
  }
  return best;
}

// ---------------------------------------------------------------- TTS
// TTS_PROVIDER=azure → Azure AI Speech (official; production)
// TTS_PROVIDER=edge  → edge-tts CLI (unofficial endpoint; prototype only)
// TTS_PROVIDER=gemini → Gemini TTS (GEMINI_API_KEY) — expressive, steerable "creator" delivery
// TTS_PROVIDER_TH / TTS_PROVIDER_MY override TTS_PROVIDER for one language (e.g. Thai gemini, Burmese edge)
const xmlEscape = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function ttsAzure(text, voice, rate, outFile) {
  const key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION || "southeastasia";
  if (!key) throw new Error("AZURE_SPEECH_KEY not set");
  const locale = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}"><prosody rate="${rate}">${xmlEscape(text)}</prosody></voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "product-video-engine",
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

// Gemini TTS: the text is spoken verbatim; delivery is steered by a style note, not by the text.
// One request per line, so every line gets the same voice + style for a consistent read.
const GEMINI_STYLE = {
  th: "a real Thai TikTok Shop creator talking to a friend: warm, upbeat, natural and conversational, lively but not shouting, a little fast-paced",
  my: "a real Burmese (Myanmar) TikTok / Facebook seller talking to a friend: warm, upbeat, natural and conversational, lively but not shouting, a little fast-paced",
};
// a prebuilt voice (Leda, Kore …) or your own custom voice_<id> from `npm run voice` (tools/gemini-voice.mjs)
const geminiVoice = (lang) => process.env[`GEMINI_TTS_VOICE_${lang.toUpperCase()}`] || process.env.GEMINI_TTS_VOICE || "Leda";
// "off" → no language hint; set once per run when the API rejects the hint for a language
const ttsLanguageOff = new Set(process.env.GEMINI_TTS_LANGUAGE === "off" ? ["th", "my"] : []);

async function ttsGemini(text, lang, outFile) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const body = {
    model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
    input: [{
      type: "user_input",
      content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: process.env.GEMINI_TTS_STYLE || GEMINI_STYLE[lang] }] }],
    }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: geminiVoice(lang) }] },
  };
  // pronunciation hint (th-TH / my-MM), as the gemini-api CLI's --language sends it
  const language = !ttsLanguageOff.has(lang) && GEMINI_TTS_LANGUAGE[lang];
  if (language) body.generation_config.speech_config[0].language = language;
  let last = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${base}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const textBody = await res.text();
    if (res.ok) {
      const out = geminiAudio(JSON.parse(textBody)); // joins all audio blocks; raw PCM gets a WAV header
      if (!out) throw new Error("Gemini TTS returned no audio");
      writeFileSync(outFile, out.audio);
      return;
    }
    last = `${res.status}: ${textBody.slice(0, 200)}`;
    // the language hint isn't accepted for this language → drop it for the rest of the run and retry at once
    if (res.status === 400 && body.generation_config.speech_config[0].language && /language/i.test(textBody)) {
      console.warn(`⚠ Gemini TTS rejected language ${GEMINI_TTS_LANGUAGE[lang]} — retrying without it`);
      ttsLanguageOff.add(lang);
      delete body.generation_config.speech_config[0].language;
      attempt--;
      continue;
    }
    if (res.status !== 429 && res.status < 500) break; // bad request: retrying won't help
    if (res.status === 429 && /per day/i.test(textBody)) break; // daily quota (free tier: 10/day) — waiting won't help today
    if (attempt < 5) {
      // free tier: a few requests per minute — wait as long as Google asks ("retry in 23s" / retryDelay)
      const asked = Number((textBody.match(/retry in (\d+(?:\.\d+)?)s/i) || textBody.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) || [])[1]);
      const waitMs = res.status === 429 && asked ? Math.min(65, asked + 1) * 1000 : 1500 * 2 ** (attempt - 1);
      console.warn(`⚠ Gemini TTS ${res.status} — waiting ${(waitMs / 1000).toFixed(0)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error(`Gemini TTS ${last}`);
}

/**
 * Voiceover speed: the user's choice for this video (cfg.speeds), else 1. Applied with ffmpeg atempo,
 * which keeps the pitch.
 */
function voiceSpeed(cfg, lang) {
  const own = Number(cfg.speeds?.[lang]);
  const n = own > 0 ? own : 1;
  return Number.isFinite(n) ? Math.min(2, Math.max(0.5, n)) : 1;
}

function speedUp(file, speed) {
  const out = file.replace(/\.\w+$/, `.x${speed}.wav`);
  run("ffmpeg", ["-v", "error", "-y", "-i", file, "-af", `atempo=${speed}`, out]);
  return out;
}

/** silences inside an audio file → [{ start, end }] (ffmpeg silencedetect) */
function silences(file, noise = "-38dB", minSec = 0.3) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noise}:d=${minSec}`, "-f", "null", "-"], { encoding: "utf8" });
  const out = [];
  let start = null;
  for (const line of String(r.stderr || "").split("\n")) {
    const a = line.match(/silence_start: (-?[\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) start = Number(a[1]);
    if (b && start !== null) { out.push({ start: Math.max(0, start), end: Number(b[1]) }); start = null; }
  }
  return out;
}

/**
 * Gemini TTS for ALL lines of one language in ONE request (free tier allows only a few requests per
 * minute): lines are joined with long pauses, then the audio is cut at the n-1 longest pauses so every
 * line still gets its own clip and caption timing. Returns null if the pauses can't be found reliably.
 */
async function ttsGeminiBatch(texts, lang, workDir) {
  if (texts.length < 2) return null;
  const full = join(workDir, "vo_all.wav");
  await ttsGemini(texts.join("\n<long pause>\n"), lang, full);
  const total = probe(full).duration;
  const gaps = silences(full).filter((g) => g.start > 0.3 && g.end < total - 0.3);
  if (gaps.length < texts.length - 1) return null;
  const cuts = gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, texts.length - 1)
    .map((g) => (g.start + g.end) / 2).sort((a, b) => a - b);
  const bounds = [0, ...cuts, total];
  const parts = [];
  for (let i = 0; i < texts.length; i++) {
    const seg = join(workDir, `vo_${i}.wav`);
    run("ffmpeg", ["-v", "error", "-y", "-i", full, "-ss", bounds[i].toFixed(3), "-to", bounds[i + 1].toFixed(3), "-c:a", "pcm_s16le", seg]);
    let file = seg;
    try { const t = trimSilence(seg); if (probe(t).duration > 0.3) file = t; } catch { /* keep untrimmed */ }
    const dur = probe(file).duration;
    // a cut in the wrong place leaves a near-empty or overlong part — then fall back to one request per line
    const expect = estimateSeconds(texts[i], lang);
    if (dur < 0.35 || dur > expect * 3 + 1.5) return null;
    parts.push({ file, dur });
  }
  return parts;
}

// absolute path when edge-tts is not on PATH (e.g. pipx installs to ~/.local/bin)
const EDGE_TTS = process.env.EDGE_TTS_BIN || "edge-tts";

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// same-language backup voice, used when the chosen one keeps failing
const ALT_VOICE = {
  "th-TH-PremwadeeNeural": "th-TH-NiwatNeural", "th-TH-NiwatNeural": "th-TH-PremwadeeNeural",
  "my-MM-NilarNeural": "my-MM-ThihaNeural", "my-MM-ThihaNeural": "my-MM-NilarNeural",
};

function edgeOnce(text, voice, rate, outFile) {
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    // --rate=+8% form: a value starting with "-" would otherwise be parsed as a flag
    const r = spawnSync(EDGE_TTS, ["--voice", voice, `--rate=${rate}`, "--text", text, "--write-media", outFile], { encoding: "utf8" });
    if (r.status === 0 && existsSync(outFile)) return null;
    last = (r.stderr || r.error?.message || "").split("\n").filter(Boolean).slice(-1).join(" ");
    if (r.error?.code === "ENOENT") break; // binary missing: retrying won't help
    if (attempt < 4) sleepSync(1500 * 2 ** (attempt - 1)); // 1.5s, 3s, 6s
  }
  return last || "unknown error";
}

// The keyless Edge endpoint throttles bursts of requests and then answers "NoAudioReceived" for
// valid text (measured: the same request succeeds again a few seconds later). Retry with backoff,
// then fall back to the other voice of the same language rather than failing the whole video.
function ttsEdge(text, voice, rate, outFile) {
  const err = edgeOnce(text, voice, rate, outFile);
  if (!err) return;
  const alt = ALT_VOICE[voice];
  if (alt && !edgeOnce(text, alt, rate, outFile)) {
    console.warn(`⚠ ${voice} kept failing (${err}) — this line uses ${alt}`);
    return;
  }
  throw new Error(`edge-tts failed (${voice}): ${err}`);
}

/**
 * TTS engines pad every clip with ~0.1–0.3s of silence at both ends; across 4–5 lines that adds a
 * second or more of dead air and a sluggish rhythm. Trim it (keep a hair of tail for natural decay)
 * so lines flow like a real creator talking. Returns the trimmed file.
 */
function trimSilence(file) {
  const out = file.replace(/\.\w+$/, ".trim.wav");
  run("ffmpeg", ["-v", "error", "-y", "-i", file, "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03," +
    "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse", out]);
  return out;
}

// Gemini TTS out of quota / down (e.g. free tier: 10 requests a day) → the rest of this video uses the free Edge voice instead of failing the whole job
let geminiOff = false;
let edgeOk = null;
const edgeAvailable = () => (edgeOk ??= spawnSync(EDGE_TTS, ["--help"], { encoding: "utf8" }).status === 0);
function geminiFailed(err) {
  if (!edgeAvailable()) throw err;
  geminiOff = true;
  console.warn(`⚠ ${TTS_PROVIDER} voice unavailable (${String(err.message).slice(0, 140)}) — using the free Edge voice for this video`);
}

const WAV_TTS = { gemini: ttsGemini };

async function tts(text, voice, rate, outFile, lang) {
  if (WAV_TTS[TTS_PROVIDER] && !geminiOff) {
    try {
      await WAV_TTS[TTS_PROVIDER](text, lang, (outFile = outFile.replace(/\.mp3$/, ".wav")));
    } catch (err) {
      geminiFailed(err);
      ttsEdge(text, voice, rate, (outFile = outFile.replace(/\.wav$/, ".mp3")));
    }
  } else if (TTS_PROVIDER === "azure") await ttsAzure(text, voice, rate, outFile);
  else ttsEdge(text, voice, rate, outFile);
  let file = outFile;
  try {
    const trimmed = trimSilence(outFile);
    if (probe(trimmed).duration > 0.3) file = trimmed; // never replace speech with an empty file
  } catch { /* keep the untrimmed audio */ }
  return { file, dur: probe(file).duration };
}

// rough reading-time estimate when TTS is off (graphemes per second)
const estimateSeconds = (text, lang) => {
  const g = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(text)].length;
  return Math.max(1.6, g / (lang === "my" ? 9 : 11));
};

// ---------------------------------------------------------------- main
const argv = process.argv.slice(2);
const cfgPath = argv.find((a) => !a.startsWith("--"));
if (!cfgPath) die("usage: node make-video.mjs config.json [--no-tts]");
const langArg = argv[argv.indexOf("--lang") + 1];
const ONLY = argv.includes("--lang") ? langArg : null;
const TTS_PROVIDER = ttsProviderFor(ONLY);
const noTts = argv.includes("--no-tts") || TTS_PROVIDER === "none";
const cfgDir = dirname(resolve(cfgPath));
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const P = (p) => resolve(cfgDir, p);

// ဘာသာတစ်ခု = video တစ်ခု (ထိုင်း video မှာ ထိုင်းအသံ+ထိုင်းစာ၊ မြန်မာ video မှာ မြန်မာအသံ+မြန်မာစာ — မရော)
if (!ONLY) {
  const langs = cfg.languages || ["th", "my"];
  for (const l of langs) {
    console.log(`\n=== ${l === "th" ? "ภาษาไทย (Thai)" : l === "my" ? "မြန်မာ (Myanmar)" : l} ===`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv, "--lang", l], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  process.exit(0);
}
if (!FONTS[ONLY] || ONLY === "latin") die(`unsupported language: ${ONLY} (use th or my)`);

const input = P(cfg.video);
if (!existsSync(input)) die(`video not found: ${input}`);
const output = P(cfg.output || "output.mp4").replace(/(\.mp4)?$/i, `-${ONLY}.mp4`);
const work = P(cfg.workDir || ".work") + `-${ONLY}`;
mkdirSync(work, { recursive: true });

const DEFAULT_VOICES = { th: "th-TH-PremwadeeNeural", my: "my-MM-NilarNeural" };
const voiceLang = ONLY; // spoken language = subtitle language
const voice = cfg.voices?.[ONLY] || DEFAULT_VOICES[ONLY];
const rate = cfg.rates?.[ONLY] || "+5%";
const trim = cfg.trim || {};

// 1) source clip (optional trim)
let src = input;
if (trim.start != null || trim.end != null) {
  src = join(work, "trimmed.mp4");
  const a = ["-v", "error", "-y"];
  if (trim.start != null) a.push("-ss", String(trim.start));
  a.push("-i", input);
  if (trim.end != null) a.push("-t", String(trim.end - (trim.start || 0)));
  a.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", src);
  run("ffmpeg", a);
}
const info = probe(src);
const W = info.width, H = info.height;
log(`source ${W}x${H}, ${info.duration.toFixed(2)}s, audio=${info.hasAudio}`);

// 2) voiceover per line → durations
const lines = cfg.lines || [];
const hook = cfg.hook, cta = cfg.cta;
const spoken = [...(hook?.speak ? [{ ...hook, kind: "hook" }] : []), ...lines.map((l) => ({ ...l, kind: "line" })), ...(cta?.speak ? [{ ...cta, kind: "cta" }] : [])];

// LEAD: first word almost immediately — top TikTok sellers start talking at 0.0s
const GAP = 0.25, LEAD = cfg.lead ?? 0.15;
// fitToVoice: the video ends shortly after the last spoken word (trimming a longer clip),
// instead of always running the full clip length with silence at the end
const TAIL = 0.8;
const hookShow = cfg.hookSeconds ?? 2.8;
const ctaShow = cfg.ctaSeconds ?? 2.8;
// cfg.tts === false: the clip already has the voice (a presenter speaking with lip-sync) — captions only
let useTts = !noTts && cfg.tts !== false && lines.length > 0;
const clips = [];
if (useTts) {
  if (TTS_PROVIDER === "edge") {
    try { run(EDGE_TTS, ["--help"]); } catch { die(`edge-tts not found (${EDGE_TTS}) — run: pipx install edge-tts, set EDGE_TTS_BIN to its path, or use TTS_PROVIDER=none`); }
  }
  let batch = null;
  if (TTS_PROVIDER === "gemini") {
    try { batch = await ttsGeminiBatch(spoken.map((s) => s[voiceLang]), voiceLang, work); } catch (err) {
      if (/per day|429/.test(err.message)) geminiFailed(err); // quota: don't spend more requests per line
      else console.warn(`⚠ one-request TTS failed (${err.message.slice(0, 120)}) — one request per line`);
    }
    if (batch) log(`TTS: 1 request for ${spoken.length} lines`);
    else if (spoken.length > 1 && !geminiOff) console.warn("⚠ could not split the one-request voiceover by its pauses — one request per line");
  }
  const speed = voiceSpeed(cfg, voiceLang);
  if (Math.abs(speed - 1) >= 0.005) log(`voice speed ×${speed}`);
  for (const [i, s] of spoken.entries()) {
    let { file, dur } = batch ? batch[i] : await tts(s[voiceLang], voice, rate, join(work, `vo_${i}.mp3`), voiceLang);
    if (Math.abs(speed - 1) >= 0.005) { file = speedUp(file, speed); dur = probe(file).duration; }
    clips.push({ ...s, file, dur });
    log(`TTS ${i + 1}/${spoken.length}: ${dur.toFixed(2)}s  ${s[voiceLang]}`);
  }
} else {
  spoken.forEach((s) => clips.push({ ...s, dur: estimateSeconds(s[voiceLang], voiceLang) }));
  log("TTS off — timing estimated from text length");
}

// 3) timeline: hook → lines (each line = its voiceover) → CTA
let t = LEAD;
const events = [];
for (const c of clips) {
  c.start = t;
  c.end = t + c.dur;
  t = c.end + GAP;
}
const voEnd = clips.length ? clips[clips.length - 1].end : 0;
const minEnd = Math.max(voEnd + 0.4, (hook && !hook.speak ? hookShow : 0) + 0.5);
let total = !useTts ? info.duration
  : cfg.fitToVoice ? Math.max(voEnd + TAIL, minEnd, cfg.minSeconds ?? 5)
  : Math.max(info.duration, minEnd);
if (!useTts && clips.length) {
  // spread estimated lines across the clip, between hook and CTA (a spoken hook is one of the clips)
  const s0 = hook && !hook.speak ? hookShow * 0.6 : LEAD;
  const s1 = (cta ? total - ctaShow : total) - 0.2;
  const sum = clips.reduce((a, c) => a + c.dur, 0);
  const k = Math.min(1, (s1 - s0 - GAP * clips.length) / sum);
  let tt = s0;
  for (const c of clips) { c.dur *= k; c.start = tt; c.end = tt + c.dur; tt = c.end + GAP; }
}
const freeze = Math.max(0, total - info.duration);
if (freeze > 1.5) console.warn(`⚠ voiceover is ${freeze.toFixed(1)}s longer than the clip — shorten the ${ONLY} lines or raise rates.${ONLY} (the last frame will be frozen)`);
log(`final length ${total.toFixed(2)}s${freeze > 0 ? ` (last frame held +${freeze.toFixed(2)}s for voiceover)` : ""}`);

// 4) ASS subtitles
const fs = (r) => Math.round(W * r);
// visual sizes (em px) — Thai and Myanmar look the same height on screen
const S = {
  TH: fs(cfg.style?.thSize ?? 0.062), MY: fs(cfg.style?.mySize ?? 0.056),
  HTH: fs(0.076), HMY: fs(0.068), CTH: fs(0.07), CMY: fs(0.064),
  // key-phrase captions are short → bigger, on a translucent box so they read over busy product photos
  KTH: fs(0.07), KMY: fs(0.068),
};
const LANG = { TH: "th", MY: "my", HTH: "th", HMY: "my", CTH: "th", CMY: "my", KTH: "th", KMY: "my" };
const margin = Math.round(W * 0.07);
const maxW = W - margin * 2;
const subBottom = Math.round(H * (cfg.style?.bottomSafe ?? 0.24)); // TikTok caption/UI safe zone
const out = Math.max(2, Math.round(W * 0.006));

const styles = [
  // name, family, size, primary, outline, back, borderStyle, outlineW, align, marginV
  ["TH", FONTS.th.family, S.TH, "&H00FFFFFF", "&H00000000", "&H80000000", 1, out + 1, 2, 0],
  ["MY", FONTS.my.family, S.MY, "&H00FFFFFF", "&H00000000", "&H80000000", 1, out + 1, 2, 0],
  ["HTH", FONTS.th.family, S.HTH, "&H00FFFFFF", "&H00000000", "&H00000000", 1, out + 2, 8, 0],
  ["HMY", FONTS.my.family, S.HMY, "&H00FFFFFF", "&H00000000", "&H00000000", 1, out + 2, 8, 0],
  ["CTH", FONTS.th.family, S.CTH, "&H00101010", "&H0000D7FF", "&H0000D7FF", 3, Math.round(W * 0.014), 2, 0],
  ["CMY", FONTS.my.family, S.CMY, "&H00101010", "&H0000D7FF", "&H0000D7FF", 3, Math.round(W * 0.012), 2, 0],
  // BorderStyle 3 = box behind the text in OutlineColour (&H40 alpha ≈ 75% opaque black)
  ["KTH", FONTS.th.family, S.KTH, "&H00FFFFFF", "&H40000000", "&H40000000", 3, Math.round(W * 0.016), 2, 0],
  ["KMY", FONTS.my.family, S.KMY, "&H00FFFFFF", "&H40000000", "&H40000000", 3, Math.round(W * 0.016), 2, 0],
];
const styleLines = styles.map(([n, f, sz, pc, oc, bc, bs, ow, al, mv]) =>
  `Style: ${n},${f},${assSize(LANG[n], sz)},${pc},&H000000FF,${oc},${bc},-1,0,0,0,100,100,0,0,${bs},${ow},${bs === 1 ? 1 : 0},${al},${margin},${margin},${mv},1`
);

// line pitch: Myanmar needs more room for stacked vowels/medials
const lineH = (style) => Math.round(S[style] * (LANG[style] === "my" ? 1.65 : 1.5));
/** stacked bilingual block, bottom-anchored: Thai above, Myanmar below */
function bilingual(start, end, th, my, thStyle, myStyle, bottomY, center = false) {
  const thL = th ? wrap(th, "th", S[thStyle], maxW) : [];
  const myL = my ? wrap(my, "my", S[myStyle], maxW) : [];
  const ev = [];
  let y = bottomY;
  const x = Math.round(W / 2);
  for (let i = myL.length - 1; i >= 0; i--) {
    ev.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${myStyle},,0,0,0,,{\\an2\\pos(${x},${y})}${assText(myL[i], "my", S[myStyle])}`);
    y -= lineH(myStyle);
  }
  if (myL.length) y -= Math.round(S[myStyle] * 0.25);
  for (let i = thL.length - 1; i >= 0; i--) {
    ev.push(`Dialogue: 0,${assTime(start)},${assTime(end)},${thStyle},,0,0,0,,{\\an2\\pos(${x},${y})}${assText(thL[i], "th", S[thStyle])}`);
    y -= lineH(thStyle);
  }
  return ev;
}
function topBlock(start, end, th, my) {
  const ev = [];
  let y = Math.round(H * 0.11);
  const x = Math.round(W / 2);
  const fade = "{\\fad(150,200)}";
  for (const l of th ? wrap(th, "th", S.HTH, maxW) : []) {
    ev.push(`Dialogue: 1,${assTime(start)},${assTime(end)},HTH,,0,0,0,,{\\an8\\pos(${x},${y})}${fade}${assText(l, "th", S.HTH)}`);
    y += lineH("HTH");
  }
  for (const l of my ? wrap(my, "my", S.HMY, maxW) : []) {
    ev.push(`Dialogue: 1,${assTime(start)},${assTime(end)},HMY,,0,0,0,,{\\an8\\pos(${x},${y})}${fade}${assText(l, "my", S.HMY)}`);
    y += lineH("HMY");
  }
  return ev;
}

const subY = H - subBottom;
if (hook) {
  const h = clips.find((c) => c.kind === "hook");
  events.push(...topBlock(0, h ? h.end + 0.3 : hookShow, ONLY === "th" ? hook.th : null, ONLY === "my" ? hook.my : null));
}
for (const c of clips.filter((c) => c.kind === "line")) {
  // on-screen text: an optional short key phrase (`caption`) instead of the spoken sentence —
  // muted viewers get the selling point at a glance; the .srt keeps the spoken words
  const key = !!c.caption?.trim();
  const shown = key ? c.caption.trim() : c[ONLY];
  const [thStyle, myStyle] = key ? ["KTH", "KMY"] : ["TH", "MY"];
  events.push(...bilingual(c.start, c.end + GAP * 0.8, ONLY === "th" ? shown : null, ONLY === "my" ? shown : null, thStyle, myStyle, subY));
}
if (cta) {
  const c = clips.find((x) => x.kind === "cta");
  const s = c ? c.start : Math.max(0, total - ctaShow);
  const ctaEv = bilingual(s, total, ONLY === "th" ? cta.th : null, ONLY === "my" ? cta.my : null, "CTH", "CMY", Math.round(H * 0.6));
  events.push(...ctaEv.map((e) => e.replace("Dialogue: 0", "Dialogue: 2").replace("}", "\\fad(200,0)}")));
}

const ass = [
  "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  ...styleLines, "",
  "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ...events, "",
].join("\n");
const assFile = join(work, "subs.ass");
writeFileSync(assFile, ass);
// also export plain .srt per language (for platform caption upload)
const srtTime = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = (lang) => clips.filter((c) => c.kind === "line").map((c, i) =>
  `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c[lang]}\n`).join("\n");
writeFileSync(output.replace(/\.mp4$/i, ".srt"), srt(ONLY));
log(`subtitles: ${events.length} events`);

// 5) ffmpeg compose: product sound (ducked under voice) + voiceover + burned subs
const esc = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const fargs = ["-v", "error", "-y", "-i", src];
const voClips = clips.filter((c) => c.file);
voClips.forEach((c) => fargs.push("-i", c.file));
let fc = `[0:v]${freeze > 0 ? `tpad=stop_mode=clone:stop_duration=${freeze.toFixed(3)},` : ""}ass='${esc(assFile)}':fontsdir='${esc(FONT_DIR)}':shaping=complex,format=yuv420p[v];`;
const productVol = cfg.productVolume ?? (voClips.length ? 0.55 : 1.0);
fc += info.hasAudio
  ? `[0:a]aresample=48000,apad=whole_dur=${total.toFixed(3)},volume=${productVol}[bed];`
  : `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[bed];`;
if (voClips.length) {
  voClips.forEach((c, i) => {
    const ms = Math.round(c.start * 1000);
    fc += `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}];`;
  });
  fc += `${voClips.map((_, i) => `[vo${i}]`).join("")}amix=inputs=${voClips.length}:normalize=0,apad=whole_dur=${total.toFixed(3)},asplit=2[vo][sc];`;
  fc += `[bed][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[ducked];`;
  fc += `[ducked][vo]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
} else {
  fc += `[bed]loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
}
fargs.push("-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output);
run("ffmpeg", fargs);
log(`done → ${output}`);
console.log(`RESULT ${JSON.stringify({ lang: ONLY, path: output, srt: output.replace(/\.mp4$/i, ".srt"), duration: +total.toFixed(2) })}`);
