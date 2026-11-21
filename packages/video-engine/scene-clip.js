// "AI scene images" clip: one AI-made 9:16 image per script beat, each shown for that beat's time with
// gentle motion (alternating push-in / pull-out, and a slow pan when a scene is long enough to be cut in
// two). Hard cuts between shots, like the free photo clip. Images are already 9:16, so they fill the frame.
import { spawn } from "node:child_process";

const FPS = 30;
const SPLIT_ABOVE = 3.5; // a longer scene becomes two shots (zoom, then a closer pan) to keep the pace
const PAN_ZOOM = 1.18;

/** Pure: shots for [{ path, seconds }] scenes */
export function planSceneShots(scenes) {
  const shots = [];
  scenes.forEach((s, i) => {
    const secs = Math.max(0.5, Number(s.seconds) || 0);
    if (secs > SPLIT_ABOVE) {
      shots.push({ scene: i, type: "zoom", zoomIn: i % 2 === 0, seconds: secs / 2 });
      shots.push({ scene: i, type: "pan", leftToRight: i % 2 === 0, seconds: secs / 2 });
    } else {
      shots.push({ scene: i, type: "zoom", zoomIn: i % 2 === 0, seconds: secs });
    }
  });
  return shots;
}

/** Pure: ffmpeg argv. Renders at 2× and scales down (supersampling = smooth slow zooms). */
export function buildSceneClipArgs({ scenes, out, width = 720, height = 1280 }) {
  if (!scenes?.length) throw new Error("scene clip needs at least one scene image");
  const shots = planSceneShots(scenes);
  const W2 = width * 2, H2 = height * 2;
  const args = ["-v", "error", "-y"];
  const parts = [];
  shots.forEach((s, i) => {
    const img = scenes[s.scene].path;
    const frames = Math.max(1, Math.round(s.seconds * FPS));
    if (s.type === "zoom") {
      args.push("-i", img);
      const z = s.zoomIn ? `1+0.10*on/${frames}` : `1.10-0.10*on/${frames}`;
      parts.push(
        `[${i}:v]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},setsar=1,` +
          `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W2}x${H2}:fps=${FPS},` +
          `scale=${width}:${height},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
      );
    } else {
      args.push("-loop", "1", "-framerate", String(FPS), "-t", s.seconds.toFixed(3), "-i", img);
      const [a, b] = s.leftToRight ? [0.3, 0.7] : [0.7, 0.3];
      const T = s.seconds.toFixed(3);
      parts.push(
        `[${i}:v]scale=${Math.round(W2 * PAN_ZOOM)}:${Math.round(H2 * PAN_ZOOM)}:force_original_aspect_ratio=increase,setsar=1,` +
          `crop=${W2}:${H2}:x='(iw-ow)*(${a}+(${b - a})*t/${T})':y='(ih-oh)*0.5',` +
          `scale=${width}:${height},format=yuv420p,fps=${FPS},setpts=PTS-STARTPTS[v${i}]`,
      );
    }
  });
  const total = shots.reduce((a, s) => a + s.seconds, 0);
  parts.push(`${shots.map((_, i) => `[v${i}]`).join("")}concat=n=${shots.length}:v=1:a=0[out]`);
  args.push("-filter_complex", parts.join(";"), "-map", "[out]", "-t", total.toFixed(3),
    "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", out);
  return args;
}

/** Render the scene clip. Resolves to `out`. */
export function makeSceneClip(opts) {
  const args = buildSceneClipArgs(opts);
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(opts.out) : reject(new Error(`scene clip ffmpeg exited ${code}: ${err.slice(-600)}`))));
  });
}
