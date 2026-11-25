// What a user with their own API keys can choose, and how a choice becomes the settings the providers read.
// Prefs (users.ai_prefs): { script, voice, voice_b, video_provider, gemini_video, higgsfield_model }
import { MODELS as HIGGSFIELD_MODELS } from "./higgsfield.js";

/** who writes the scripts. "auto" = Gemini with the per-language defaults (Burmese on the bigger model) */
export const SCRIPT_CHOICES = {
  auto: { name: "Gemini (auto: Flash-Lite for Thai, 3.6 Flash for Burmese)", provider: "gemini" },
  "gemini-flash-lite-latest": { name: "Gemini Flash-Lite (fastest, cheapest)", provider: "gemini" },
  "gemini-3.6-flash": { name: "Gemini 3.6 Flash (best Burmese)", provider: "gemini" },
  "openai:gpt-4.1-mini": { name: "OpenAI GPT-4.1 mini", provider: "openai" },
  "openai:gpt-4.1": { name: "OpenAI GPT-4.1", provider: "openai" },
};

/** Gemini TTS prebuilt voices that suit a seller voiceover */
export const VOICES = {
  Leda: "female · youthful", Kore: "female · firm", Aoede: "female · breezy", Zephyr: "female · bright",
  Puck: "male · upbeat", Charon: "male · informative", Fenrir: "male · excitable", Orus: "male · firm",
};

/** Gemini Omni video: the model is fixed, the choice is the resolution (price per second in pricing.js) */
export const GEMINI_VIDEO = { "360p": "Gemini Omni 360p", "720p": "Gemini Omni 720p", "1080p": "Gemini Omni 1080p" };

export const VIDEO_PROVIDERS = ["gemini", "higgsfield"];

/** a stored / submitted prefs object → only known choices (anything else is dropped) */
export function cleanPrefs(p = {}) {
  const out = {};
  if (SCRIPT_CHOICES[p.script]) out.script = p.script;
  if (VOICES[p.voice]) out.voice = p.voice;
  if (VOICES[p.voice_b]) out.voice_b = p.voice_b;
  if (VIDEO_PROVIDERS.includes(p.video_provider)) out.video_provider = p.video_provider;
  if (GEMINI_VIDEO[p.gemini_video]) out.gemini_video = p.gemini_video;
  if (HIGGSFIELD_MODELS[p.higgsfield_model]) out.higgsfield_model = p.higgsfield_model;
  return out;
}

/** the environment overrides a user's prefs mean (on top of their own keys) */
export function prefsEnv(prefs = {}, keys = {}) {
  const e = {};
  const s = prefs.script || "auto";
  if (s.startsWith("openai:") && keys.openai) {
    Object.assign(e, { LLM_API_KEY: keys.openai, LLM_BASE_URL: "", LLM_MODEL: s.slice(7), LLM_MODEL_TH: "", LLM_MODEL_MY: "", LLM_FALLBACK_MODELS: "" });
  } else if (s !== "auto" && SCRIPT_CHOICES[s]?.provider === "gemini") {
    Object.assign(e, { LLM_MODEL: s, LLM_MODEL_TH: "", LLM_MODEL_MY: "" }); // one model for both languages
  }
  if (prefs.voice) Object.assign(e, { GEMINI_TTS_VOICE: prefs.voice, GEMINI_TTS_VOICE_TH: "", GEMINI_TTS_VOICE_MY: "" });
  if (prefs.voice_b) Object.assign(e, { GEMINI_TTS_VOICE_B: prefs.voice_b, GEMINI_TTS_VOICE_B_TH: "", GEMINI_TTS_VOICE_B_MY: "" });
  if (prefs.video_provider) e.AI_VIDEO_PROVIDER = prefs.video_provider;
  if (prefs.gemini_video) e.GEMINI_VIDEO_RESOLUTION = prefs.gemini_video;
  if (prefs.higgsfield_model) e.HIGGSFIELD_MODEL = prefs.higgsfield_model;
  return e;
}
