// Video pipeline worker:  clip (Seedance, or free photo clip)  →  render:th  →  render:my  →  done
// Each stage is idempotent: after a crash/restart BullMQ re-runs the job and finished stages are skipped
// (an existing Seedance task is resumed, never paid for twice).
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, failJob } from "@app/db";
import { seedance } from "@app/providers";
import { renderVideo, makePhotoClip } from "@app/video-engine";

const QUEUE_NAME = "video-jobs";
const STORAGE_DIR = resolve(process.env.STORAGE_DIR || "./storage");
const SAMPLE_CLIP = resolve(dirname(fileURLToPath(import.meta.url)), "../../../samples/sample-product-clip.mp4");

const setJob = (id, fields) => {
  const keys = Object.keys(fields);
  return query(
    `UPDATE video_jobs SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
};

const toDataUrl = (img) => `data:${img.mime || "image/jpeg"};base64,${readFileSync(img.path).toString("base64")}`;

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function makeClip(job, product, dir) {
  const clip = join(dir, "clip.mp4");
  if (job.clip_path && existsSync(job.clip_path)) return job.clip_path;
  await setJob(job.id, { status: "running", stage: "clip" });

  const mode = seedance.clipMode();
  if (mode === "photos") {
    // free path: the user's own photos with Ken Burns motion (no Seedance cost)
    const images = (product.images || []).map((i) => i.path).filter((p) => existsSync(p));
    if (!images.length) throw new Error("product photos are missing on disk");
    console.log(`[job ${job.id}] photo clip from ${images.length} photo(s)`);
    // with a voiceover each language's video is cut to its own speech length (Burmese runs longer),
    // so render enough photo footage for the longest one; without voice keep the normal length
    const base = Number(process.env.SEEDANCE_DURATION || 10);
    const withVoice = (process.env.TTS_PROVIDER || "none").toLowerCase() !== "none";
    await makePhotoClip({ images, out: clip, duration: withVoice ? Math.max(base, 16) : base });
  } else if (mode === "sample") {
    console.warn(`[job ${job.id}] CLIP_MODE=sample → using samples/sample-product-clip.mp4`);
    copyFileSync(SAMPLE_CLIP, clip);
  } else {
    let taskId = job.seedance_task_id;
    if (!taskId) {
      taskId = await seedance.createTask(product, product.images.map(toDataUrl), { style: job.style || "product" });
      await setJob(job.id, { seedance_task_id: taskId });
      console.log(`[job ${job.id}] seedance task ${taskId}`);
    }
    const url = await seedance.waitForTask(taskId, { onStatus: (s) => console.log(`[job ${job.id}] seedance ${s}`) });
    await download(url, clip);
  }
  await setJob(job.id, { clip_path: clip });
  return clip;
}

async function processJob(jobId) {
  const { rows } = await query("SELECT * FROM video_jobs WHERE id = $1", [jobId]);
  const job = rows[0];
  if (!job || job.status === "succeeded") return;
  const { rows: [product] } = await query("SELECT * FROM products WHERE id = $1", [job.product_id]);
  if (!product) throw new Error("product was deleted");
  const dir = join(STORAGE_DIR, "jobs", String(job.id));
  mkdirSync(dir, { recursive: true });

  const clip = await makeClip(job, product, dir);

  for (const lang of job.langs) {
    const { rows: done } = await query("SELECT 1 FROM videos WHERE job_id = $1 AND lang = $2", [job.id, lang]);
    if (done.length) continue;
    await setJob(job.id, { status: "running", stage: `render:${lang}` });
    const { rows: [script] } = await query("SELECT hook, lines, captions, cta FROM scripts WHERE product_id = $1 AND lang = $2", [product.id, lang]);
    if (!script) throw new Error(`no ${lang} script`);
    const r = await renderVideo({
      workDir: join(dir, "work"),
      clipPath: clip,
      outPath: join(dir, "video.mp4"),
      lang,
      script,
      onLog: (l) => process.env.DEBUG_ENGINE && process.stdout.write(l),
    });
    await query(
      "INSERT INTO videos (job_id, lang, path, srt_path, duration) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (job_id, lang) DO NOTHING",
      [job.id, lang, r.path, r.srt, r.duration],
    );
    console.log(`[job ${job.id}] ${lang} → ${r.path}`);
  }
  await setJob(job.id, { status: "succeeded", stage: "done", error: null });
}

async function fail(jobId, err) {
  console.error(`[job ${jobId}] failed:`, err?.message);
  const refunded = await failJob(jobId, err?.message);
  if (refunded) console.log(`[job ${jobId}] credits refunded`);
}

const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
const worker = new Worker(
  QUEUE_NAME,
  async (bullJob) => {
    const { jobId } = bullJob.data;
    try {
      await processJob(jobId);
    } catch (err) {
      await fail(jobId, err);
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 2), lockDuration: 20 * 60_000 },
);

worker.on("ready", () => console.log(`worker ready (queue: ${QUEUE_NAME})`));
// BullMQ can fail a job without running our catch (e.g. it stalled too many times after crashes).
// failJob is idempotent, so jobs already handled above are left untouched.
worker.on("failed", (bullJob, err) => {
  const jobId = bullJob?.data?.jobId;
  if (!jobId) return;
  failJob(jobId, err?.message)
    .then((refunded) => refunded && console.log(`[job ${jobId}] failed outside the processor (${err?.message}) — credits refunded`))
    .catch((e) => console.error(`[job ${jobId}] refund error:`, e.message));
});
const shutdown = async () => { await worker.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
