// Which voice engine speaks a language: TTS_PROVIDER_TH / TTS_PROVIDER_MY override TTS_PROVIDER,
// so Thai can use Gemini while Burmese uses a local VoxCPM2 voice (or the other way round).

/** "edge" | "gemini" | "azure" | "voxcpm" | "none" for one language (no lang → TTS_PROVIDER) */
export function ttsProviderFor(lang, env = process.env, fallback = "edge") {
  const own = lang ? env[`TTS_PROVIDER_${String(lang).toUpperCase()}`] : "";
  return String(own || env.TTS_PROVIDER || fallback).trim().toLowerCase();
}

/** true when at least one of the languages gets a voiceover */
export function voiceEnabled(langs = ["th", "my"], env = process.env) {
  return langs.some((l) => ttsProviderFor(l, env, "none") !== "none");
}
