// Finished videos → the user's own Telegram bot (Bot API). The user makes a bot with @BotFather, pastes its
// token in Settings, presses Start in the bot, then "Connect": we read the bot's last private chat with
// getUpdates and keep its id. Videos are sent with sendVideo (Bot API upload limit: 50 MB per file).
// Docs: https://core.telegram.org/bots/api
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const API = () => (process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/$/, "");
export const MAX_UPLOAD = 50 * 1024 * 1024;

/** a BotFather token: "123456789:AA…" */
export const isBotToken = (t) => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(t || ""));

/** never put the token in an error message (it is part of the URL) */
const hide = (text, token) => String(text).split(token).join("<token>");

async function call(token, method, body, { timeoutMs = 30_000 } = {}) {
  const init = { method: "POST", signal: AbortSignal.timeout(timeoutMs) };
  if (body instanceof FormData) init.body = body;
  else if (body) { init.body = JSON.stringify(body); init.headers = { "Content-Type": "application/json" }; }
  let res, json;
  try {
    res = await fetch(`${API()}/bot${token}/${method}`, init);
    json = await res.json().catch(() => ({}));
  } catch (err) {
    throw new Error(`Telegram ${method}: ${hide(err.message, token)}`);
  }
  if (!json.ok) throw new Error(`Telegram ${res.status} [${json.error_code || res.status}]: ${hide(json.description || "request failed", token)}`);
  return json.result;
}

/** the bot's name, or an error (token wrong / revoked) */
export const getBot = (token) => call(token, "getMe");

/**
 * the private chat that last wrote to the bot (the user pressed Start) → { id, name } | null.
 * Only private chats: a bot added to a group must not start sending videos there by accident.
 */
export async function findChat(token) {
  const updates = await call(token, "getUpdates", { limit: 100, allowed_updates: ["message"] });
  const chats = updates.map((u) => u.message?.chat).filter((c) => c?.type === "private");
  const c = chats.at(-1);
  return c ? { id: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id) } : null;
}

/** a text message (max 4096 characters); replyTo: show it as a reply to that message (e.g. the video) */
export const sendText = (token, chatId, text, { replyTo } = {}) =>
  call(token, "sendMessage", {
    chat_id: chatId, text: String(text).slice(0, 4096), disable_web_page_preview: true,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });

/** one video file with a caption (Telegram allows 1024 characters) */
export async function sendVideo(token, chatId, file, { caption = "", width = 720, height = 1280, duration } = {}) {
  const data = await readFile(file);
  if (data.length > MAX_UPLOAD) throw new Error(`Telegram: ${basename(file)} is ${(data.length / 1048576).toFixed(0)} MB — bots can send up to 50 MB`);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", new Blob([data], { type: "video/mp4" }), basename(file));
  form.append("caption", caption.slice(0, 1024));
  form.append("supports_streaming", "true");
  form.append("width", String(width));
  form.append("height", String(height));
  if (duration) form.append("duration", String(Math.round(duration)));
  return call(token, "sendVideo", form, { timeoutMs: 180_000 });
}

const FLAG = { th: "🇹🇭 ไทย", my: "🇲🇲 မြန်မာ" };

const HASHTAGS = {
  th: "#TikTokShop #ของดีบอกต่อ #รีวิวสินค้า #Shopee",
  my: "#TikTokShop #Shopee #OnlineShopping #ပစ္စည်းကောင်း",
};
const FORMAT_NAME = { voiceover: "Voiceover", presenter: "Talking presenter", drama: "Mini drama", montage: "Graphic montage" };
const link = (product) => product.affiliate_url || product.product_url || "";

/**
 * The video's caption = the post description, ready to copy into TikTok / Facebook: hook, the selling
 * points (on-screen phrases, else the spoken lines), the call to action, the link, hashtags.
 * Telegram allows 1024 characters; the link and hashtags are kept, the middle is shortened if needed.
 */
export function videoCaption({ product, lang, script }) {
  const points = (script?.lines || []).map((l, i) => script?.captions?.[i]?.trim() || l).filter(Boolean);
  const tail = [script?.cta, link(product) ? `🔗 ${link(product)}` : "", HASHTAGS[lang] || ""].filter(Boolean).join("\n");
  let body = [script?.hook, points.map((p) => `✅ ${p}`).join("\n")].filter(Boolean).join("\n\n");
  if (!body) body = `🎬 ${product.title}`;
  const room = 1024 - tail.length - 2;
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 1))}…`;
  return `${body}\n\n${tail}`;
}

/**
 * The script that was spoken, beat by beat (and who says it in a mini drama), sent as a reply to the
 * video — for re-recording, editing or posting elsewhere.
 */
export function scriptMessage({ product, lang, duration, script, jobId }) {
  const drama = script?.format === "drama";
  const who = (i) => (drama ? `${script.speakers?.[i] === "B" ? "B" : "A"}: ` : "");
  return [
    `📝 Script · ${FLAG[lang] || lang}${script?.format ? ` · ${FORMAT_NAME[script.format] || script.format}` : ""}${duration ? ` · ${Math.round(duration)} s` : ""}${jobId ? ` · #${jobId}` : ""}`,
    `🎬 ${product.title}`.slice(0, 300),
    "",
    script?.hook ? `🎯 Hook: ${drama ? "A: " : ""}${script.hook}` : null,
    ...(script?.lines || []).map((l, i) => {
      const cap = script.captions?.[i]?.trim();
      return `${i + 1}. ${who(i)}${l}${cap && cap !== l ? `\n   🔤 ${cap}` : ""}`;
    }),
    script?.cta ? `🛒 CTA: ${drama ? "B: " : ""}${script.cta}` : null,
    link(product) ? `\n🔗 ${link(product)}` : null,
  ].filter((x) => x !== null).join("\n");
}

/** one finished video: the video with its post description, then its script as a reply to it */
export async function sendJobVideo(token, chatId, { file, product, lang, duration, script, jobId }) {
  const msg = await sendVideo(token, chatId, file, { caption: videoCaption({ product, lang, script }), duration });
  if (script) await sendText(token, chatId, scriptMessage({ product, lang, duration, script, jobId }), { replyTo: msg?.message_id });
  return msg;
}
