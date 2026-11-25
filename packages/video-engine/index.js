// Programmatic wrapper around make-video.mjs (runs it as a child process so a crash in
// ffmpeg / fonts never takes down the worker).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "make-video.mjs");

export { makePhotoClip, buildPhotoClipArgs } from "./photo-clip.js";
export { probeClip, normalizeClip, buildNormalizeArgs } from "./normalize-clip.js";
export { makeSceneClip, buildSceneClipArgs, planSceneShots } from "./scene-clip.js";
export { ttsProviderFor, voiceEnabled } from "./tts-provider.js";
export { makePortraitFrame, buildPortraitFrameArgs } from "./portrait-frame.js";

export const VOICES = {
  th: { female: "th-TH-PremwadeeNeural", male: "th-TH-NiwatNeural" },
  my: { female: "my-MM-NilarNeural", male: "my-MM-ThihaNeural" },
};

/**
 * Build a single-language engine config from a DB script row.
 * script: { hook, lines: string[], captions?: string[], speakers?: ("A"|"B")[], cta, format? }
 * format: voiceover | presenter (as voiceover) | drama (two voices, dialogue subtitles) | montage (big centre text)
 */
export function buildConfig({ clipPath, outPath, lang, script, voice = "female", rate, speed, productVolume = 0.55, speakHook = true, fitToVoice = true, tts = true }) {
  const format = script.format || "voiceover";
  const drama = format === "drama";
  return {
    format,
    // mini drama: speaker B gets the other voice (A keeps the chosen one)
    ...(drama ? { voicesB: { [lang]: VOICES[lang]?.[voice === "male" ? "female" : "male"] } } : {}),
    video: clipPath,
    output: outPath,
    languages: [lang],
    voices: { [lang]: VOICES[lang]?.[voice] || voice },
    rates: { [lang]: rate || (lang === "th" ? "+8%" : "+0%") },
    // voiceover speed multiplier chosen by the user (1 = natural pace); absent → 1
    ...(Number(speed) > 0 ? { speeds: { [lang]: Number(speed) } } : {}),
    // false: keep the clip's own voice at full volume and add no voiceover
    ...(tts === false ? { tts: false } : {}),
    productVolume,
    fitToVoice,
    // the hook is spoken first (from ~0.15s) while it shows at the top — stops the scroll
    hook: { [lang]: script.hook, speak: speakHook, ...(drama ? { speaker: "A" } : {}) },
    // captions[i]: optional on-screen key phrase for line i (empty → show the spoken line);
    // a drama shows what is said (subtitles), so its captions are not used
    lines: script.lines.map((l, i) => ({
      [lang]: l,
      ...(!drama && script.captions?.[i]?.trim() ? { caption: script.captions[i].trim() } : {}),
      ...(drama ? { speaker: script.speakers?.[i] === "B" ? "B" : "A" } : {}),
    })),
    cta: { [lang]: script.cta, speak: true, ...(drama ? { speaker: "B" } : {}) },
  };
}

/**
 * Render one language. Resolves { lang, path, srt, duration }. outPath gets a -<lang> suffix.
 * onUsage(entry) is called for each billable API call the engine made (e.g. Gemini TTS lines).
 * env: the environment (API keys) the engine runs with — e.g. the user's own Gemini key; default process.env.
 */
export function renderVideo({ workDir, onLog, onUsage, env = process.env, ...opts }) {
  mkdirSync(workDir, { recursive: true });
  const cfgPath = join(workDir, `config-${opts.lang}.json`);
  writeFileSync(cfgPath, JSON.stringify(buildConfig(opts), null, 2));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, cfgPath, "--lang", opts.lang], { env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; onLog?.(String(d)); });
    child.stderr.on("data", (d) => { err += d; onLog?.(String(d)); });
    child.on("close", (code) => {
      // billed even when the render fails afterwards
      for (const l of out.split("\n")) {
        if (!l.startsWith("USAGE ")) continue;
        try { onUsage?.(JSON.parse(l.slice(6))); } catch { /* a cut-off line */ }
      }
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) resolve(JSON.parse(line.slice(7)));
      else reject(new Error(`video-engine exited ${code}: ${(err || out).slice(-800)}`));
    });
  });
}
