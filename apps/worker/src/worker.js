// Video pipeline worker:  clip (Seedance / Gemini, or free photo clip)  →  render:th  →  render:my  →  done
// Each stage is idempotent: after a crash/restart BullMQ re-runs the job and finished stages are skipped
// (an existing Seedance task / Gemini interaction is resumed, never paid for twice).
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, failJob, recordUsage, loadUserKeys } from "@app/db";
import { seedance, geminiVideo, usage, keys } from "@app/providers";
import { renderVideo, makePhotoClip, makeSceneClip, normalizeClip, voiceEnabled } from "@app/video-engine";

const QUEUE_NAME = "video-jobs";
usage.setUsageSink(recordUsage);
const STORAGE_DIR = resolve(process.env.STORAGE_DIR || "./storage");
const SAMPLE_CLIP = resolve(dirname(fileURLToPath(import.meta.url)), "../../../samples/sample-product-clip.mp4");

const setJob = (id, fields) => {
  const keys = Object.keys(fields);
  return query(
    `UPDATE video_jobs SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
};

/** scratch space on the local disk for ffmpeg (kept until the job succeeds so a retry can reuse it) */
const localWorkDir = (jobId) => {
  const d = join(process.env.WORK_DIR || join(tmpdir(), "avs-work"), String(jobId));
  mkdirSync(d, { recursive: true });
  return d;
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

  const mode = ["upload", "scenes", "photos"].includes(job.clip_source) ? job.clip_source
    : job.clip_source === "ai_video" ? seedance.aiVideoProvider()
    : seedance.clipMode();
  if (!mode) throw new Error("AI video is not set up (no GEMINI_API_KEY / SEEDANCE_API_KEY)");
  if (mode === "scenes") {
    // the product's AI scene images, each shown for its beat's time with zoom / pan
    const scenes = (product.scenes || []).map((s) => ({ path: s.path, seconds: Number(s.seconds) }));
    if (!scenes.length || scenes.some((s) => !s.path || !existsSync(s.path))) throw new Error("scene images are missing");
    const local = join(localWorkDir(job.id), "clip.mp4");
    await makeSceneClip({ scenes, out: local });
    console.log(`[job ${job.id}] scene clip from ${scenes.length} image(s)`);
    copyFileSync(local, clip);
  } else if (mode === "upload") {
    // the user's own clip (e.g. from Google Flow) → 9:16 720p H.264 on local disk, then into storage
    if (!product.clip_path || !existsSync(product.clip_path)) throw new Error("the uploaded clip is missing");
    const local = join(localWorkDir(job.id), "clip.mp4");
    const info = normalizeClip({ input: product.clip_path, out: local });
    console.log(`[job ${job.id}] uploaded clip ${info.duration.toFixed(1)}s → ${info.width}x${info.height}`);
    copyFileSync(local, clip);
  } else if (mode === "photos") {
    // free path: the user's own photos with Ken Burns motion (no Seedance cost)
    const images = (product.images || []).map((i) => i.path).filter((p) => existsSync(p));
    if (!images.length) throw new Error("product photos are missing on disk");
    console.log(`[job ${job.id}] photo clip from ${images.length} photo(s)`);
    // with a voiceover each language's video is cut to its own speech length (Burmese runs longer),
    // so render enough photo footage for the longest one; without voice keep the normal length
    const base = Number(process.env.SEEDANCE_DURATION || 10);
    const withVoice = voiceEnabled(job.langs);
    // ffmpeg writes to local disk first: STORAGE_DIR may be a Cloud Storage mount (no in-place seeks)
    const local = join(localWorkDir(job.id), "clip.mp4");
    await makePhotoClip({ images, out: local, duration: withVoice ? Math.max(base, 16) : base });
    copyFileSync(local, clip);
  } else if (mode === "gemini") {
    // the interaction id shares the seedance_task_id column, prefixed so it is never polled at the wrong provider
    const saved = job.seedance_task_id?.startsWith("gemini:") ? job.seedance_task_id.slice(7) : null;
    const bytes = await geminiVideo.generateVideo(product, product.images.map(toDataUrl), {
      style: job.style || "product",
      resumeId: saved,
      onId: async (id) => {
        await setJob(job.id, { seedance_task_id: `gemini:${id}` });
        console.log(`[job ${job.id}] gemini interaction ${id}`);
      },
      onStatus: (s) => console.log(`[job ${job.id}] gemini ${s}`),
    });
    writeFileSync(clip, bytes);
    const g = geminiVideo.geminiSettings();
    usage.reportUsage({ kind: "video", provider: "gemini", model: g.model, seconds: g.duration, resolution: g.resolution });
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
    const s = seedance.clipSettings("seedance");
    usage.reportUsage({ kind: "video", provider: "seedance", model: s.model, seconds: s.duration, resolution: s.resolution });
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
    // render on local disk, then copy the finished files into storage (see localWorkDir)
    const work = localWorkDir(job.id);
    const r = await renderVideo({
      workDir: join(work, "work"),
      clipPath: clip,
      outPath: join(work, "video.mp4"),
      lang,
      script,
      speed: job.voice_speed?.[lang],
      // the clip already speaks (Flow presenter with lip-sync): keep its audio, add captions only
      ...(job.clip_has_voice ? { tts: false, productVolume: 1 } : {}),
      onLog: (l) => process.env.DEBUG_ENGINE && process.stdout.write(l),
      onUsage: (u) => usage.reportUsage(u),
      env: keys.env(), // the user's own Gemini key for the voiceover, when the job uses their keys
    });
    for (const k of ["path", "srt"]) {
      if (!r[k]) continue;
      const dest = join(dir, basename(r[k]));
      copyFileSync(r[k], dest);
      r[k] = dest;
    }
    await query(
      "INSERT INTO videos (job_id, lang, path, srt_path, duration) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (job_id, lang) DO NOTHING",
      [job.id, lang, r.path, r.srt, r.duration],
    );
    console.log(`[job ${job.id}] ${lang} → ${r.path}`);
  }
  await setJob(job.id, { status: "succeeded", stage: "done", error: null });
  rmSync(localWorkDir(job.id), { recursive: true, force: true });
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
      // every API call made for this job is recorded against it (cost tracking)
      const { rows: [j] } = await query("SELECT user_id, product_id, own_key FROM video_jobs WHERE id = $1", [jobId]);
      // a job made with the user's own keys (no credits charged) must never fall back to the server's keys;
      // a job paid with credits always uses the server's keys
      let ctx = {};
      if (j?.own_key) {
        ctx = keys.userKeyContext(await loadUserKeys(j.user_id));
        if (!ctx.gemini) throw new Error("your Gemini API key was removed — add it again in Settings, then make the video again");
      }
      await keys.withKeys(ctx, () => usage.withUsage({ userId: j?.user_id, productId: j?.product_id, jobId }, () => processJob(jobId)));
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
