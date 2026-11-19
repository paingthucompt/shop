// Free "photo clip": turns 1–4 product photos into a vertical 9:16 video made of short SHOTS with
// hard cuts every ~2.2s (like top TikTok sellers' pacing) — no AI cost, the product is never altered.
//   full   — the whole photo fitted on a blurred cover of itself, slow zoom in or out
//   detail — the photo filled + enlarged ~35%, slowly panning sideways (reads as a close-up)
import { spawn } from "node:child_process";

const FPS = 30;
export const SHOT_SECONDS = 2.2;
const DETAIL_ZOOM = 1.35;

/**
 * Pure: the shot list. Each photo appears as full → detail; the cycle repeats over the photos.
 * The last shot is always a full shot (whole product on screen while the call to action plays).
 */
export function planShots(photoCount, duration) {
  const n = Math.max(1, Math.min(photoCount, 4));
  const count = Math.max(1, Math.round(duration / SHOT_SECONDS));
  const shots = [];
  for (let i = 0; i < count; i++) {
    const cycle = Math.floor(i / 2);
    shots.push({
      photo: cycle % n,
      type: i % 2 === 0 ? "full" : "detail",
      zoomIn: cycle % 2 === 0,      // full shots alternate push-in / pull-out
      leftToRight: cycle % 2 === 0, // detail shots alternate pan direction
      seconds: duration / count,
    });
  }
  const last = shots[shots.length - 1];
  if (last.type === "detail") last.type = "full";
  return shots;
}

/** Pure: ffmpeg argv for the photo clip. Renders at 2× and scales down (supersampling = no motion stutter). */
export function buildPhotoClipArgs({ images, out, duration = 10, width = 720, height = 1280 }) {
  if (!images?.length) throw new Error("photo clip needs at least one image");
  const shots = planShots(images.length, duration);
  const W2 = width * 2, H2 = height * 2;
  const args = ["-v", "error", "-y"];
  const parts = [];

  shots.forEach((s, i) => {
    const img = images[s.photo];
    const frames = Math.max(1, Math.round(s.seconds * FPS));
    if (s.type === "full") {
      args.push("-i", img); // a single frame; zoompan turns it into `frames` frames
      const z = s.zoomIn ? `1+0.08*on/${frames}` : `1.08-0.08*on/${frames}`;
      parts.push(
        `[${i}:v]split=2[b${i}][f${i}]`,
        `[b${i}]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},boxblur=40:2,eq=brightness=-0.08[bg${i}]`,
        `[f${i}]scale=${W2}:${H2}:force_original_aspect_ratio=decrease[fg${i}]`,
        `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,` +
          `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W2}x${H2}:fps=${FPS},` +
          `scale=${width}:${height},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
      );
    } else {
      // looped still → real timestamps, so crop's x can move with t
      args.push("-loop", "1", "-framerate", String(FPS), "-t", s.seconds.toFixed(3), "-i", img);
      // products are usually centred: pan across the middle 40% of the photo, not edge to edge
      const [a, b] = s.leftToRight ? [0.3, 0.7] : [0.7, 0.3];
      const T = s.seconds.toFixed(3);
      parts.push(
        `[${i}:v]scale=${Math.round(W2 * DETAIL_ZOOM)}:${Math.round(H2 * DETAIL_ZOOM)}:force_original_aspect_ratio=increase,setsar=1,` +
          `crop=${W2}:${H2}:x='(iw-ow)*(${a}+(${b - a})*t/${T})':y='(ih-oh)*0.45',` +
          `scale=${width}:${height},format=yuv420p,fps=${FPS},setpts=PTS-STARTPTS[v${i}]`,
      );
    }
  });

  const inputsLabel = shots.map((_, i) => `[v${i}]`).join("");
  parts.push(`${inputsLabel}concat=n=${shots.length}:v=1:a=0[out]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[out]", "-t", duration.toFixed(3),
    "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", out);
  return args;
}

/** Render the photo clip. Resolves to `out`. */
export function makePhotoClip(opts) {
  const args = buildPhotoClipArgs(opts);
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(opts.out) : reject(new Error(`photo clip ffmpeg exited ${code}: ${err.slice(-600)}`))));
  });
}
