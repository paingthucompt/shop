// Bring Your Own Key: each user can add their own Gemini (and Seedance) API key. With a Gemini key,
// every AI call made for them uses their keys and is billed by Google / BytePlus to them → no credits.
// Keys are stored encrypted and never returned — only a hint like "AIza…x7Qk".
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { KEY_PROVIDERS, deleteUserKey, listUserKeys, saveUserKey } from "@app/db";
import { keys } from "@app/providers";
import { ah, requireAuth } from "../lib.js";
import { httpError } from "../validate.js";

const r = Router();
r.use(requireAuth);

// each save asks Google / BytePlus whether the key works → don't let the app be used as a key tester
const saveLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: (req) => `user:${req.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many key changes — try again in a while" },
});

const parseProvider = (p) => {
  if (!KEY_PROVIDERS.includes(p)) throw httpError(400, `provider must be one of: ${KEY_PROVIDERS.join(", ")}`);
  return p;
};

/** GET /api/keys → { keys: [{ provider, hint, verified_at, updated_at }], own_keys_only, using_own_keys } */
r.get("/", ah(async (req, res) => {
  const list = await listUserKeys(req.userId);
  res.json({
    keys: list,
    own_keys_only: keys.ownKeysOnly(),
    // only a Gemini key switches the user to their own keys (it does the scripts, voices and pictures)
    using_own_keys: list.some((k) => k.provider === "gemini"),
  });
}));

/** PUT /api/keys/:provider { key } → checks the key with the provider, then stores it encrypted */
r.put("/:provider", saveLimiter, ah(async (req, res) => {
  const provider = parseProvider(req.params.provider);
  const key = String(req.body.key || "").trim();
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) throw httpError(400, "that doesn't look like an API key");
  if (provider !== "gemini" && !(await listUserKeys(req.userId)).some((k) => k.provider === "gemini")) {
    throw httpError(400, "add your Gemini key first — it writes the scripts and makes the voices");
  }
  const check = await keys.checkKey(provider, key);
  if (check.ok === false) throw Object.assign(httpError(400, `the key was rejected: ${check.reason}`), { code: check.code });
  await saveUserKey(req.userId, provider, key, check.ok === true);
  res.json({ ok: true, verified: check.ok === true, note: check.ok === null ? `saved, but it couldn't be checked now (${check.reason})` : undefined });
}));

/** DELETE /api/keys/:provider — removing the Gemini key also removes the others (they can't be used alone) */
r.delete("/:provider", ah(async (req, res) => {
  const provider = parseProvider(req.params.provider);
  await deleteUserKey(req.userId, provider);
  if (provider === "gemini") await Promise.all(KEY_PROVIDERS.filter((p) => p !== "gemini").map((p) => deleteUserKey(req.userId, p)));
  res.status(204).end();
}));

export default r;
