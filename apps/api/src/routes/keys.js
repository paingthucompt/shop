// Bring Your Own Key: each user can add their own Gemini (and Seedance) API key. With a Gemini key,
// every AI call made for them uses their keys and is billed by Google / BytePlus to them → no credits.
// Keys are stored encrypted and never returned — only a hint like "AIza…x7Qk".
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { KEY_PROVIDERS, deleteUserKey, listUserKeys, loadUserKeys, saveUserKey, loadUserPrefs, saveUserPrefs } from "@app/db";
import { keys, aiCatalog, higgsfield, geminiVideo, sceneImages, pricing, telegram } from "@app/providers";
import { ah, requireAuth, withUserKeys } from "../lib.js";
import { httpError } from "../validate.js";

const r = Router();
r.use(requireAuth);
r.use(withUserKeys); // prices below depend on the user's keys (e.g. the AI start frame needs Gemini)

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

/** what can be chosen in "AI choices" (names for the Settings page) */
const catalog = () => ({
  script: Object.entries(aiCatalog.SCRIPT_CHOICES).map(([id, c]) => ({ id, name: c.name, provider: c.provider })),
  voices: Object.entries(aiCatalog.VOICES).map(([id, desc]) => ({ id, desc })),
  // US$ of one AI clip with each choice (same price table as the quote and cost tracking)
  gemini_video: Object.entries(aiCatalog.GEMINI_VIDEO).map(([id, name]) => {
    const c = geminiVideo.geminiSettings(id);
    return { id, name, seconds: c.duration, usd: pricing.estimateClipUsd({ provider: "gemini", model: c.model, seconds: c.duration, resolution: id }) };
  }),
  higgsfield_models: Object.entries(higgsfield.MODELS).map(([id, m]) => {
    const c = higgsfield.higgsfieldSettings(id);
    return { id, name: m.name, seconds: c.duration, usd: pricing.estimateClipUsd({ provider: "higgsfield", model: id, seconds: c.duration, resolution: c.resolution }) + sceneImages.startFrameUsd() };
  }),
});

/**
 * GET /api/keys → { keys: [{ provider, hint, verified_at, updated_at }], own_keys_only, using_own_keys,
 *                   prefs: the user's AI choices, catalog: what can be chosen }
 */
r.get("/", ah(async (req, res) => {
  const list = await listUserKeys(req.userId);
  res.json({
    prefs: aiCatalog.cleanPrefs(await loadUserPrefs(req.userId)),
    catalog: catalog(),
    keys: list,
    own_keys_only: keys.ownKeysOnly(),
    // only a Gemini key switches the user to their own keys (it does the scripts, voices and pictures)
    using_own_keys: list.some((k) => k.provider === "gemini"),
  });
}));

/** PUT /api/keys/prefs { script?, voice?, voice_b?, video_provider?, gemini_video?, higgsfield_model? } → prefs */
r.put("/prefs", ah(async (req, res) => {
  // the Telegram chat is set by "Connect", not by this form: keep it
  const { telegram_chat_id, telegram_chat_name } = aiCatalog.cleanPrefs(await loadUserPrefs(req.userId));
  const { telegram_chat_id: _i, telegram_chat_name: _n, ...body } = req.body || {};
  const prefs = aiCatalog.cleanPrefs({ ...body, telegram_chat_id, telegram_chat_name });
  res.json({ prefs: aiCatalog.cleanPrefs(await saveUserPrefs(req.userId, prefs)) });
}));

/**
 * POST /api/keys/telegram/connect — after the user pressed Start in their bot: find that chat, keep it,
 * and send a test message there. → { chat_name }
 */
r.post("/telegram/connect", saveLimiter, ah(async (req, res) => {
  const token = (await loadUserKeys(req.userId)).telegram;
  if (!token) throw httpError(400, "add your Telegram bot token first");
  const chat = await telegram.findChat(token).catch((e) => { throw httpError(400, e.message); });
  if (!chat) {
    throw Object.assign(httpError(400, "open your bot in Telegram and press Start (or send it any message), then connect again"), { code: "telegram_no_chat" });
  }
  const prefs = aiCatalog.cleanPrefs(await loadUserPrefs(req.userId));
  await saveUserPrefs(req.userId, { ...prefs, telegram_chat_id: chat.id, telegram_chat_name: chat.name });
  await telegram.sendText(token, chat.id, [
    "✅ Affiliate Video Studio is connected. Your finished videos will arrive here.",
    "✅ ချိတ်ဆက်ပြီးပါပြီ — ထုတ်ပြီးတဲ့ ဗီဒီယိုတွေ ဒီကို ရောက်လာပါမယ်။",
  ].join("\n"));
  res.json({ chat_name: chat.name });
}));

/** PUT /api/keys/:provider { key } → checks the key with the provider, then stores it encrypted */
r.put("/:provider", saveLimiter, ah(async (req, res) => {
  const provider = parseProvider(req.params.provider);
  const key = String(req.body.key || "").trim();
  if (provider === "telegram") {
    // a bot token from @BotFather; it works without any AI key (videos made with credits are sent too)
    if (!telegram.isBotToken(key)) throw Object.assign(httpError(400, "that doesn't look like a bot token from @BotFather (123456789:AA…)"), { code: "telegram_token" });
    const bot = await telegram.getBot(key).catch((e) => { throw Object.assign(httpError(400, `the bot token was rejected: ${e.message}`), { code: "telegram_token" }); });
    await saveUserKey(req.userId, provider, key, true);
    // a new bot → the old chat no longer applies
    const { telegram_chat_id: _i, telegram_chat_name: _n, ...prefs } = aiCatalog.cleanPrefs(await loadUserPrefs(req.userId));
    await saveUserPrefs(req.userId, prefs);
    return res.json({ ok: true, verified: true, bot: bot.username });
  }
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) throw httpError(400, "that doesn't look like an API key");
  if (provider === "seedance") throw httpError(400, "BytePlus Seedance keys are no longer used — add a Higgsfield key instead");
  // Higgsfield credentials are a key ID and a secret: stored together as "ID:SECRET"
  if (provider === "higgsfield" && !/^[^:]+:[^:]+$/.test(key)) {
    throw Object.assign(httpError(400, "paste the Higgsfield key as KEY_ID:KEY_SECRET (both parts, joined by a colon)"), { code: "key_format" });
  }
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
  // the AI keys need Gemini; the Telegram bot doesn't
  if (provider === "gemini") await Promise.all(KEY_PROVIDERS.filter((p) => !["gemini", "telegram"].includes(p)).map((p) => deleteUserKey(req.userId, p)));
  if (provider === "telegram") {
    const { telegram_chat_id: _i, telegram_chat_name: _n, ...prefs } = aiCatalog.cleanPrefs(await loadUserPrefs(req.userId));
    await saveUserPrefs(req.userId, prefs);
  }
  res.status(204).end();
}));

export default r;
