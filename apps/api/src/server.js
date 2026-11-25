import express from "express";
import helmet from "helmet";
import cors from "cors";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { query, recordUsage } from "@app/db";
import { shopee, usage } from "@app/providers";
import { ah, requireAuth, STORAGE_DIR, verifyMedia } from "./lib.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import jobRoutes from "./routes/jobs.js";
import usageRoutes from "./routes/usage.js";
import keyRoutes from "./routes/keys.js";

// cost tracking: every priced API call made while serving a request is stored in api_usage
usage.setUsageSink(recordUsage);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind nginx / Cloud Run
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: (process.env.WEB_ORIGIN || "http://localhost:5173").split(","), credentials: false }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", ah(async (_req, res) => {
  await query("SELECT 1");
  res.json({ ok: true });
}));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/usage", usageRoutes);
app.use("/api/keys", keyRoutes);

// Shopee affiliate product search (uses the platform's Shopee credentials)
app.get("/api/shopee/search", requireAuth, ah(async (req, res) => {
  if (!shopee.shopeeEnabled()) return res.status(503).json({ error: "Shopee API not configured" });
  res.json(await shopee.searchProducts(String(req.query.q || ""), { page: Number(req.query.page || 1) }));
}));

// Signed media (videos, images). URL: /api/media/<path>?exp=..&sig=..
app.get(/^\/api\/media\/(.+)$/, (req, res) => {
  let rel;
  try { rel = req.params[0].split("/").map(decodeURIComponent).join("/"); } catch { return res.status(400).end(); }
  if (!verifyMedia(rel, req.query.exp, String(req.query.sig || ""))) return res.status(403).end();
  const abs = normalize(join(STORAGE_DIR, rel));
  if (!abs.startsWith(STORAGE_DIR + sep) || !existsSync(abs)) return res.status(404).end();
  const size = statSync(abs).size;
  const type = abs.endsWith(".mp4") ? "video/mp4" : abs.endsWith(".srt") ? "text/plain; charset=utf-8" : abs.endsWith(".png") ? "image/png" : abs.endsWith(".webp") ? "image/webp" : "image/jpeg";
  if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="${abs.split(sep).pop()}"`);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) { // video seeking
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
    return createReadStream(abs, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(abs).pipe(res);
});

// Production: the built dashboard (apps/web/dist) is served by the API itself — one origin, no CORS.
// In development Vite serves it on :5173 and proxies /api here.
const WEB_DIST = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : null;
if (WEB_DIST && existsSync(join(WEB_DIST, "index.html"))) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));
  // client-side routes (/login, /products/1 …) all load index.html; unknown /api paths stay 404 JSON
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(WEB_DIST, "index.html")));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err.name === "MulterError" ? 400 : 500);
  if (status >= 500) console.error(err);
  // code: a machine-readable reason the web app acts on (e.g. "need_key" → link to Settings)
  const code = status < 500 && typeof err.code === "string" && /^[a-z_]+$/.test(err.code) ? { code: err.code } : {};
  res.status(status).json({ error: status >= 500 && !err.expose ? "server error" : err.message, ...code });
});

// Cloud Run sets PORT and needs 0.0.0.0; locally stay on loopback
const port = Number(process.env.PORT || process.env.API_PORT || 4000);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
app.listen(port, host, () => console.log(`API → http://${host}:${port}`));
