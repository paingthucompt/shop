// Cost tracking: what the AI / API calls really cost (US$), from the api_usage table.
import { Router } from "express";
import { query } from "@app/db";
import { ah, requireAuth } from "../lib.js";

const r = Router();
r.use(requireAuth);

// months follow the sellers' clock (Thailand / Myanmar ≈ UTC+7)
const TZ = "Asia/Bangkok";
const MONTH_START = `date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`;
const num = (v) => Math.round(Number(v || 0) * 1e4) / 1e4;

/**
 * GET /api/usage → this month's API spend by kind, videos made, average per video, and the last 6 months.
 *   { month: { usd, videos, usd_per_video, by_kind: [{ kind, usd, calls, unpriced }], unpriced_calls },
 *     months: [{ month: "2026-11", usd, videos }] }
 */
r.get("/", ah(async (req, res) => {
  const uid = req.userId;
  const [{ rows: kinds }, { rows: [vids] }, { rows: months }] = await Promise.all([
    query(
      `SELECT kind, sum(usd) AS usd, count(*)::int AS calls, count(*) FILTER (WHERE NOT priced)::int AS unpriced
       FROM api_usage WHERE user_id = $1 AND created_at >= ${MONTH_START} GROUP BY kind ORDER BY sum(usd) DESC`, [uid]),
    query(
      `SELECT count(*)::int AS n FROM videos v JOIN video_jobs j ON j.id = v.job_id
       WHERE j.user_id = $1 AND v.created_at >= ${MONTH_START}`, [uid]),
    query(
      `WITH spend AS (
         SELECT to_char(created_at AT TIME ZONE '${TZ}', 'YYYY-MM') AS month, sum(usd) AS usd
         FROM api_usage WHERE user_id = $1 GROUP BY 1),
       made AS (
         SELECT to_char(v.created_at AT TIME ZONE '${TZ}', 'YYYY-MM') AS month, count(*)::int AS videos
         FROM videos v JOIN video_jobs j ON j.id = v.job_id WHERE j.user_id = $1 GROUP BY 1)
       SELECT s.month, s.usd, COALESCE(m.videos, 0) AS videos
       FROM spend s LEFT JOIN made m USING (month) ORDER BY s.month DESC LIMIT 6`, [uid]),
  ]);
  const usd = kinds.reduce((a, k) => a + Number(k.usd), 0);
  res.json({
    month: {
      usd: num(usd),
      videos: vids.n,
      // everything spent this month (scripts, scene images, clips, voices) spread over the videos made
      usd_per_video: vids.n ? num(usd / vids.n) : null,
      by_kind: kinds.map((k) => ({ kind: k.kind, usd: num(k.usd), calls: k.calls, unpriced: k.unpriced })),
      unpriced_calls: kinds.reduce((a, k) => a + k.unpriced, 0),
    },
    months: months.map((m) => ({ month: m.month, usd: num(m.usd), videos: m.videos })),
  });
}));

export default r;
