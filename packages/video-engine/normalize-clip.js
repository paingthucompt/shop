// A user-uploaded product clip (e.g. made in Google Flow) → the engine's input format:
// 720×1280 (9:16, centre-cropped if needed), 30 fps, H.264, AAC (silent track added when missing).
import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || "").split("\n").filter(Boolean).slice(-3).join(" ")}`);
  return r.stdout;
};

/** { duration, width, height, hasAudio } of a media file; throws if it has no video stream */
export function probeClip(file) {
  const j = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]));
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  if (!v) throw new Error("no video stream");
  return {
    duration: Number(j.format?.duration || v.duration || 0),
    width: v.width,
    height: v.height,
    hasAudio: (j.streams || []).some((s) => s.codec_type === "audio"),
  };
}

export function buildNormalizeArgs({ input, out, hasAudio = true, width = 720, height = 1280, maxSeconds = 60 }) {
  return [
    "-v", "error", "-y",
    "-i", input,
    ...(hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]),
    "-t", String(maxSeconds),
    "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0",
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    ...(hasAudio ? [] : ["-shortest"]),
    "-movflags", "+faststart",
    out,
  ];
}

/** normalise `input` into `out`; returns the probe of the result */
export function normalizeClip({ input, out }) {
  const src = probeClip(input);
  run("ffmpeg", buildNormalizeArgs({ input, out, hasAudio: src.hasAudio }));
  return probeClip(out);
}
