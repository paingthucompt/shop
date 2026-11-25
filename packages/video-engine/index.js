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

export const VOICES = {
  th: { female: "th-TH-PremwadeeNeural", male: "th-TH-NiwatNeural" },
  my: { female: "my-MM-NilarNeural", male: "my-MM-ThihaNeural" },
};

/**
 * Build a single-language engine config from a DB script row.
 * script: { hook, lines: string[], captions?: string[], cta }
 */
export function buildConfig({ clipPath, outPath, lang, script, voice = "female", rate, speed, productVolume = 0.55, speakHook = true, fitToVoice = true, tts = true }) {
  return {
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
    hook: { [lang]: script.hook, speak: speakHook },
    // captions[i]: optional on-screen key phrase for line i (empty → show the spoken line)
    lines: script.lines.map((l, i) => ({ [lang]: l, ...(script.captions?.[i]?.trim() ? { caption: script.captions[i].trim() } : {}) })),
    cta: { [lang]: script.cta, speak: true },
  };
}

/** Render one language. Resolves { lang, path, srt, duration }. outPath gets a -<lang> suffix. */
export function renderVideo({ workDir, onLog, ...opts }) {
  mkdirSync(workDir, { recursive: true });
  const cfgPath = join(workDir, `config-${opts.lang}.json`);
  writeFileSync(cfgPath, JSON.stringify(buildConfig(opts), null, 2));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, cfgPath, "--lang", opts.lang], { env: process.env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; onLog?.(String(d)); });
    child.stderr.on("data", (d) => { err += d; onLog?.(String(d)); });
    child.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) resolve(JSON.parse(line.slice(7)));
      else reject(new Error(`video-engine exited ${code}: ${(err || out).slice(-800)}`));
    });
  });
}
