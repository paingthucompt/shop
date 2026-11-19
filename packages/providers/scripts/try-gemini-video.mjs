// A real Gemini video call outside the app, to check quality and the API with your key.
//   node --env-file=.env packages/providers/scripts/try-gemini-video.mjs [options] [photo ...]
// Options:
//   --product <id>   use a product from the DB (its title, description and up to 4 photos)
//   --style <name>   product | presenter | unboxing | hero | macro | in_action | flatlay  (default product)
//   --res <r>        360p | 720p | 1080p                                                    (default 360p)
//   --sec <n>        3–15 seconds                                                           (default 4)
// Cost ≈ US$0.023/s at 360p, ≈ 0.07/s at 720p (360p · 4 s ≈ $0.10; 720p · 10 s ≈ $0.70).
// Saves the clip to samples/gemini-<style>-<res>-<sec>s-<label>-<time>.mp4
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateVideo } from "../src/gemini-video.js";

const { values: o, positionals: photos } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    style: { type: "string", default: "product" },
    res: { type: "string", default: "360p" },
    sec: { type: "string", default: "4" },
  },
});

let product = { title: "Test product" };
let paths = photos;
if (o.product) {
  const { query, pool } = await import("../../db/index.js");
  const { rows: [p] } = await query("SELECT title, description, images FROM products WHERE id = $1", [Number(o.product)]);
  await pool.end();
  if (!p) throw new Error(`product ${o.product} not found`);
  product = { title: p.title, description: p.description };
  if (!paths.length) paths = (p.images || []).map((i) => i.path).slice(0, 4);
}
if (!paths.length) {
  console.error("give --product <id> or one or more photo paths");
  process.exit(1);
}
process.env.GEMINI_VIDEO_RESOLUTION = o.res;
process.env.GEMINI_VIDEO_DURATION = o.sec;

const MIME = { ".png": "image/png", ".webp": "image/webp" };
const images = paths.map((f) => `data:${MIME[extname(f).toLowerCase()] || "image/jpeg"};base64,${readFileSync(f).toString("base64")}`);
console.log(`${o.style} · ${o.res} · ${o.sec}s · ${images.length} photo(s) · "${product.title.slice(0, 60)}"`);

const t0 = Date.now();
const bytes = await generateVideo(product, images, {
  style: o.style,
  intervalMs: 5_000,
  onId: (id) => console.log("interaction", id),
  onStatus: (s) => console.log(`${Math.round((Date.now() - t0) / 1000)}s`, s),
});
const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "../../../samples");
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; // local time
const label = o.product ? `p${o.product}` : "photos";
const out = join(SAMPLES, `gemini-${o.style}-${o.res}-${o.sec}s-${label}-${stamp}.mp4`);
writeFileSync(out, bytes);
console.log(`✓ ${out} (${(bytes.length / 1e6).toFixed(1)} MB) in ${Math.round((Date.now() - t0) / 1000)}s`);
