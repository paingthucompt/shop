import crypto from "node:crypto";
import { resolve, relative, sep } from "node:path";
import jwt from "jsonwebtoken";
import { Queue } from "bullmq";
import IORedis from "ioredis";

export const STORAGE_DIR = resolve(process.env.STORAGE_DIR || "./storage");

// ---------------- secrets
// Production refuses to start with a missing/placeholder/short JWT_SECRET (it also signs media URLs).
// In development an empty secret falls back to a random one so the app still works (logins reset on restart).
const rawSecret = process.env.JWT_SECRET || "";
const weakSecret = rawSecret.length < 32 || rawSecret.startsWith("change-me");
if (weakSecret && process.env.NODE_ENV === "production") {
  console.error("✖ JWT_SECRET must be a random value of at least 32 characters in production (openssl rand -hex 32)");
  process.exit(1);
}
if (weakSecret) console.warn("⚠ JWT_SECRET is weak or missing — fine for local dev, set a strong value before going live");
export const JWT_SECRET = rawSecret || crypto.randomBytes(32).toString("hex");

// ---------------- queue (shared name with the worker)
export const QUEUE_NAME = "video-jobs";
export const redis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
export const videoQueue = new Queue(QUEUE_NAME, { connection: redis });

// ---------------- errors + input parsing
export { httpError, parseId, parseLangs, LANG_CODES } from "./validate.js";

// ---------------- auth
export const signToken = (user) => jwt.sign({ sub: String(user.id), email: user.email }, JWT_SECRET, { expiresIn: "7d" });

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "login required" });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    req.userId = Number(p.sub);
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

// ---------------- signed media URLs (so <video src> works without auth headers)
const MEDIA_TTL_S = 6 * 3600;
const mac = (path, exp) => crypto.createHmac("sha256", JWT_SECRET).update(`${path}:${exp}`).digest("base64url");

/** absolute file inside STORAGE_DIR → signed /api/media URL */
export function mediaUrl(absPath) {
  if (!absPath) return null;
  const rel = relative(STORAGE_DIR, absPath).split(sep).join("/");
  if (rel.startsWith("..")) return null;
  const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_S;
  return `/api/media/${rel.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${mac(rel, exp)}`;
}

export function verifyMedia(rel, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = mac(rel, exp);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** wrap async route handlers so errors reach the error middleware */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
