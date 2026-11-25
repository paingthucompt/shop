// A 1080×1920 (9:16) start frame from one product photo: the photo whole in the middle, the same photo
// blurred behind it. Image-to-video models keep the aspect of the frame they start from, so the AI clip
// comes out vertical even from square shop photos.
import { spawnSync } from "node:child_process";

export function buildPortraitFrameArgs(input, out, { width = 1080, height = 1920 } = {}) {
  const fc = [
    `[0:v]split[a][b]`,
    `[a]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=40:4,eq=brightness=-0.06[bg]`,
    `[b]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuvj420p[v]`,
  ].join(";");
  return ["-v", "error", "-y", "-i", input, "-filter_complex", fc, "-map", "[v]", "-frames:v", "1", "-q:v", "2", out];
}

export function makePortraitFrame({ input, out }) {
  const r = spawnSync("ffmpeg", buildPortraitFrameArgs(input, out), { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed (portrait frame): ${(r.stderr || "").slice(-300)}`);
  return out;
}
