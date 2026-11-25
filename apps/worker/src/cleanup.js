// Videos live on in the user's Telegram; this machine's storage only keeps them for a while.
// The worker runs removeSentVideos every 10 minutes. Only files inside <storage>/jobs/<job id>/ are deleted;
// the job, its videos rows (file_removed_at), scripts and costs stay.
import { rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

// TELEGRAM_DELETE_AFTER_MIN (default 60, 0 = never). A user can keep files with telegram_keep_local.
export const DELETE_AFTER_MIN = Number(process.env.TELEGRAM_DELETE_AFTER_MIN ?? 60);
/** only ever delete inside <storage>/jobs/<job id>/ — never a path from the DB that points elsewhere */
export const insideJob = (jobsDir, p, jobId) => {
  const dir = resolve(jobsDir, String(jobId)) + sep;
  return typeof p === "string" && resolve(p).startsWith(dir);
};

/** remove the files of videos that reached Telegram more than `afterMin` minutes ago → how many videos */
export async function removeSentVideos({ query, storageDir, afterMin = DELETE_AFTER_MIN }) {
  if (!(afterMin > 0)) return 0;
  const JOBS_DIR = join(storageDir, "jobs");
  const { rows } = await query(
    `SELECT v.id, v.job_id, v.lang, v.path, v.srt_path FROM videos v
     JOIN video_jobs j ON j.id = v.job_id JOIN users u ON u.id = j.user_id
     WHERE v.telegram_sent_at < now() - make_interval(mins => $1) AND v.file_removed_at IS NULL
       AND COALESCE((u.ai_prefs->>'telegram_keep_local')::boolean, false) = false`,
    [afterMin],
  );
  const jobs = new Set();
  for (const v of rows) {
    // a path outside its job folder is never deleted, and the video is not marked as removed either
    if (!insideJob(JOBS_DIR, v.path, v.job_id)) {
      console.warn(`[cleanup] video ${v.id}: ${v.path} is outside storage/jobs/${v.job_id} — left alone`);
      continue;
    }
    for (const f of [v.path, v.srt_path]) if (insideJob(JOBS_DIR, f, v.job_id)) rmSync(f, { force: true });
    await query("UPDATE videos SET file_removed_at = now() WHERE id = $1", [v.id]);
    jobs.add(v.job_id);
    console.log(`[cleanup] job ${v.job_id} ${v.lang}: video removed from this machine (it is in Telegram)`);
  }
  // when every video of a finished job is gone, its AI / photo clip goes too (the whole job folder)
  for (const jobId of jobs) {
    const { rows: [left] } = await query(
      "SELECT count(*)::int n FROM videos WHERE job_id = $1 AND file_removed_at IS NULL", [jobId]);
    const { rows: [job] } = await query("SELECT status FROM video_jobs WHERE id = $1", [jobId]);
    if (left.n === 0 && job?.status === "succeeded") {
      rmSync(join(JOBS_DIR, String(jobId)), { recursive: true, force: true });
      await query("UPDATE video_jobs SET clip_path = NULL, updated_at = now() WHERE id = $1", [jobId]);
    }
  }
  return rows.length;
}

