// Video pipeline worker:  clip (Seedance / Gemini, or free photo clip)  →  render:th  →  render:my  →  done
// Each stage is idempotent: after a crash/restart BullMQ re-runs the job and finished stages are skipped
// (an existing Seedance task / Gemini interaction is resumed, never paid for twice).
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { query, failJob, recordUsage, loadUserKeys, loadUserPrefs } from "@app/db";
import { seedance, geminiVideo, higgsfield, sceneImages, llm, usage, keys, aiCatalog, telegram } from "@app/providers";
import { removeSentVideos, DELETE_AFTER_MIN } from "./cleanup.js";
import { renderVideo, makePhotoClip, makeSceneClip, normalizeClip, makePortraitFrame, voiceEnabled } from "@app/video-engine";

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

/**
 * The 9:16 frame an image-to-video model starts from. With a Gemini key: a clean AI photo of the product
 * (no shop-banner text for the model to garble, no blurred bars; ~US$0.07). Otherwise, or if that fails,
 * the main photo fitted into a blurred 9:16 background. HIGGSFIELD_START_FRAME=photo skips the AI photo.
 */
async function startFrame(job, product, photos, work) {
  if (process.env.HIGGSFIELD_START_FRAME !== "photo" && sceneImages.sceneImagesEnabled()) {
    try {
      const prompt = sceneImages.buildStartFramePrompt(await llm.promptProduct(product), { style: job.style || "product", format: product.clip_prompt?.format });
      const img = await sceneImages.generateSceneImage(prompt, photos.slice(0, 4).map(toDataUrl));
      writeFileSync(join(work, `start-frame${img.mime === "image/png" ? ".png" : ".jpg"}`), img.data);
      console.log(`[job ${job.id}] AI start frame (${img.mime}, ${(img.data.length / 1024).toFixed(0)} KB)`);
      return { data: img.data, mime: img.mime };
    } catch (err) {
      console.warn(`[job ${job.id}] AI start frame failed (${err.message.slice(0, 120)}) — using the main photo`);
    }
  }
  const frame = makePortraitFrame({ input: photos[0].path, out: join(work, "start-frame.jpg") });
  return { data: readFileSync(frame), mime: "image/jpeg" };
}

async function makeClip(job, product, dir) {
  const clip = join(dir, "clip.mp4");
  if (job.clip_path && existsSync(job.clip_path)) return job.clip_path;
  await setJob(job.id, { status: "running", stage: "clip" });

  const mode = ["upload", "scenes", "photos"].includes(job.clip_source) ? job.clip_source
    : job.clip_source === "ai_video" ? seedance.aiVideoProvider(job.ai_provider)
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
    // English name / details only: Thai text in the prompt ends up painted into the clip
    const bytes = await geminiVideo.generateVideo(saved ? product : await llm.promptProduct(product), product.images.map(toDataUrl), {
      style: job.style || "product",
      resolution: job.ai_model, // the resolution picked for this video (else the user's / server default)
      resumeId: saved,
      onId: async (id) => {
        await setJob(job.id, { seedance_task_id: `gemini:${id}` });
        console.log(`[job ${job.id}] gemini interaction ${id}`);
      },
      onStatus: (s) => console.log(`[job ${job.id}] gemini ${s}`),
    });
    writeFileSync(clip, bytes);
    const g = geminiVideo.geminiSettings(job.ai_model);
    usage.reportUsage({ kind: "video", provider: "gemini", model: g.model, seconds: g.duration, resolution: g.resolution });
  } else if (mode === "higgsfield") {
    // the main product photo as a 9:16 start frame (the model keeps the frame's aspect) → image-to-video
    const work = localWorkDir(job.id);
    mkdirSync(work, { recursive: true });
    let requestId = job.higgsfield_request_id;
    if (!requestId) {
      const photos = (product.images || []).filter((i) => existsSync(i.path));
      if (!photos.length) throw new Error("product photos are missing on disk");
      const { data, mime } = await startFrame(job, product, photos, work);
      requestId = await higgsfield.createRequest(await llm.promptProduct(product), data, { mime, style: job.style || "product", model: job.ai_model, idempotencyKey: `job-${job.id}` });
      await setJob(job.id, { higgsfield_request_id: requestId });
      console.log(`[job ${job.id}] higgsfield request ${requestId}`);
    }
    const url = await higgsfield.waitForRequest(requestId, { onStatus: (s) => console.log(`[job ${job.id}] higgsfield ${s}`) });
    const raw = join(work, "higgsfield.mp4");
    await download(url, raw);
    // whatever size the model returned → 9:16 720p like every other clip
    const local = join(work, "clip.mp4");
    const info = normalizeClip({ input: raw, out: local });
    console.log(`[job ${job.id}] higgsfield clip ${info.duration.toFixed(1)}s → ${info.width}x${info.height}`);
    copyFileSync(local, clip);
    const h = higgsfield.higgsfieldSettings(job.ai_model);
    usage.reportUsage({ kind: "video", provider: "higgsfield", model: h.model, seconds: h.duration, resolution: h.resolution }); // billed per requested second
  } else if (mode === "sample") {
    console.warn(`[job ${job.id}] CLIP_MODE=sample → using samples/sample-product-clip.mp4`);
    copyFileSync(SAMPLE_CLIP, clip);
  } else {
    let taskId = job.seedance_task_id;
    if (!taskId) {
      taskId = await seedance.createTask(await llm.promptProduct(product), product.images.map(toDataUrl), { style: job.style || "product" });
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
    const { rows: [script] } = await query("SELECT hook, lines, captions, speakers, cta, format FROM scripts WHERE product_id = $1 AND lang = $2", [product.id, lang]);
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
  await sendToTelegram(job, product);
}

/**
 * Finished videos → the user's own Telegram bot (if they connected one in Settings). Never fails the
 * job: a video that couldn't be sent stays unsent (telegram_sent_at null) and can be sent again later.
 */
async function sendToTelegram(job, product) {
  try {
    const token = (await loadUserKeys(job.user_id)).telegram;
    const chatId = aiCatalog.cleanPrefs(await loadUserPrefs(job.user_id)).telegram_chat_id;
    if (!token || !chatId) return;
    const { rows: vids } = await query("SELECT id, lang, path, duration FROM videos WHERE job_id = $1 AND telegram_sent_at IS NULL ORDER BY lang", [job.id]);
    for (const v of vids) {
      const { rows: [script] } = await query("SELECT hook, lines, captions, speakers, cta, format FROM scripts WHERE product_id = $1 AND lang = $2", [product.id, v.lang]);
      // the video with its post description, then the script as a reply to it
      await telegram.sendJobVideo(token, chatId, { file: v.path, product, lang: v.lang, duration: Number(v.duration), script, jobId: job.id });
      await query("UPDATE videos SET telegram_sent_at = now() WHERE id = $1", [v.id]);
      console.log(`[job ${job.id}] ${v.lang} sent to Telegram`);
    }
  } catch (err) {
    console.warn(`[job ${job.id}] Telegram: ${err.message}`);
  }
}

async function fail(jobId, err) {
  console.error(`[job ${jobId}] failed:`, err?.message);
  const refunded = await failJob(jobId, err?.message);
  if (refunded) console.log(`[job ${jobId}] credits refunded`);
}

const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
// ---------------------------------------------------------------- remove files that reached Telegram
const cleanup = () => removeSentVideos({ query, storageDir: STORAGE_DIR }).catch((err) => console.warn(`[cleanup] ${err.message}`));
if (DELETE_AFTER_MIN > 0) {
  cleanup();
  setInterval(cleanup, 10 * 60_000).unref(); // every 10 minutes → removed 60–70 min after sending
}

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
        ctx = keys.userKeyContext(await loadUserKeys(j.user_id), aiCatalog.cleanPrefs(await loadUserPrefs(j.user_id)));
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
