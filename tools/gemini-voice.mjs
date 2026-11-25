#!/usr/bin/env node
// Your own Gemini TTS voice, stored on Google's side (no model on this Mac).
// Same Voices API that Google's gemini-api CLI uses (`gemini-api voices create`, `tts --voice-prompt`).
//
//   npm run voice -- design my "A warm young Burmese woman, friendly online seller, clear and lively"
//   npm run voice -- clone  my --source me.wav --consent consent.wav     (your own voice; both recordings by you)
//   npm run voice -- say    voice_abc123 my "မင်္ဂလာပါ ရှင့်"            → samples/voice_abc123-my.wav
//   npm run voice -- say    Leda th --video "…"      as in the videos (seller style note) → samples/Leda-th-video.wav
//   npm run voice -- list                your custom voices
//   npm run voice -- list th             every voice for Thai (incl. Google's, e.g. th-th-podcaster-1)
//   npm run voice -- delete voice_abc123
//
// Then put the printed id in .env, e.g. GEMINI_TTS_VOICE_MY=voice_abc123 (with TTS_PROVIDER=gemini).
// Stored voices expire after 1 year unused and count toward a per-project quota.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { geminiAudio, GEMINI_TTS_LANGUAGE, GEMINI_STYLE } from "../packages/video-engine/gemini-audio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const KEY = process.env.GEMINI_API_KEY;
const MIME = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".webm": "audio/webm" };

async function api(path, init = {}) {
  if (!KEY) throw new Error("GEMINI_API_KEY is not set (run with: node --env-file=.env tools/gemini-voice.mjs …)");
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" } });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  return json;
}

const language = (lang) => GEMINI_TTS_LANGUAGE[lang] || lang;
const voiceId = (id) => String(id || "").trim().replace(/^voices\//, "");

function audioFile(path) {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`${path}: use a .wav, .mp3, .m4a, .ogg, .flac or .webm recording`);
  return { mime_type: mime, data: readFileSync(path).toString("base64") };
}

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
}

async function create(lang, voice) {
  const out = await api("/voices", { method: "POST", body: JSON.stringify({ store: true, voice: { ...voice, language_code: language(lang) } }) });
  const v = out.voice || out;
  const id = voiceId(v.id || v.name);
  if (!id) throw new Error(`no voice id in the reply: ${JSON.stringify(out).slice(0, 300)}`);
  console.log(`✓ ${id}`);
  console.log(`  add to .env:  GEMINI_TTS_VOICE_${String(lang).toUpperCase()}=${id}`);
  console.log(`  try it:       npm run voice -- say ${id} ${lang} "…"`);
}

/** video: add the same style note the videos use (GEMINI_TTS_STYLE or the seller style per language) */
async function say(id, lang, text, video = false) {
  const style = video && (process.env.GEMINI_TTS_STYLE || GEMINI_STYLE[lang]);
  const body = {
    model: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
    input: [{ type: "user_input", content: [{ type: "text", text, ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}) }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: voiceId(id), language: language(lang) }] },
  };
  const out = geminiAudio(await api("/interactions", { method: "POST", body: JSON.stringify(body) }));
  if (!out) throw new Error("no audio in the reply");
  mkdirSync(join(ROOT, "samples"), { recursive: true });
  const file = join(ROOT, "samples", `${voiceId(id)}-${lang}${video ? "-video" : ""}.${out.ext}`);
  writeFileSync(file, out.audio);
  console.log(file);
}

/** no lang → your own (prompted / replicated) voices; lang → every voice for that language */
async function list(lang) {
  const code = lang && language(lang);
  let token = "";
  do {
    const out = await api(`/voices?page_size=100${code ? `&language_code=${encodeURIComponent(code)}` : ""}${token ? `&page_token=${encodeURIComponent(token)}` : ""}`);
    for (const v of out.voices || []) {
      if (code ? v.language_code !== code : v.type === "prebuilt") continue;
      console.log([voiceId(v.id || v.name), v.type, v.language_code, v.display_name || v.description || "", v.expire_time ? `expires ${v.expire_time.slice(0, 10)}` : ""].filter(Boolean).join("  "));
    }
    token = out.next_page_token || "";
  } while (token);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "design" && args.length >= 2) {
    const [lang, ...words] = args;
    await create(lang, { type: "prompted", prompted: { input: words.join(" ") } });
  } else if (cmd === "clone" && args.length >= 1) {
    const source = flag(args, "source"), consent = flag(args, "consent");
    if (!source || !consent) throw new Error("clone needs --source <your voice recording> and --consent <your consent recording>");
    await create(args[0], { type: "replicated", replicated: { source_audio: audioFile(source), consent_audio: audioFile(consent) } });
  } else if (cmd === "say" && args.length >= 3) {
    const video = args.includes("--video");
    const [id, lang, ...words] = args.filter((a) => a !== "--video");
    await say(id, lang, words.join(" "), video);
  } else if (cmd === "list") {
    await list(args[0]);
  } else if (cmd === "delete" && args[0]) {
    await api(`/voices/${encodeURIComponent(voiceId(args[0]))}`, { method: "DELETE" });
    console.log(`deleted ${voiceId(args[0])}`);
  } else {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exitCode = cmd ? 2 : 0;
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
}
