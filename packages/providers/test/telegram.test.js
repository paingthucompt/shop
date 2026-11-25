import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isBotToken, findChat, sendVideo, videoCaption, scriptMessage, sendJobVideo } from "../src/telegram.js";

const TOKEN = "123456789:AAH_example_token_example_token_ex";

test("bot tokens and captions", () => {
  assert.ok(isBotToken(TOKEN));
  assert.ok(!isBotToken("AIzaSy-not-a-bot-token") && !isBotToken(""));
  const product = { title: "Cooler 16L", affiliate_url: "https://s.shopee.co.th/x" };
  const script = { hook: "ပူလား?", lines: ["ရေခဲအိတ် ၅ ခု ပါတယ်", "တစ်ရက်လုံး အေးတယ်"], captions: ["ရေခဲအိတ် ၅ ခု", ""], cta: "ဝယ်လို့ရပါတယ်ရှင့်", format: "voiceover" };
  // the caption is the post description: hook, selling points, CTA, link, hashtags
  const c = videoCaption({ product, lang: "my", script });
  assert.equal(c, "ပူလား?\n\n✅ ရေခဲအိတ် ၅ ခု\n✅ တစ်ရက်လုံး အေးတယ်\n\nဝယ်လို့ရပါတယ်ရှင့်\n🔗 https://s.shopee.co.th/x\n#TikTokShop #Shopee #OnlineShopping #ပစ္စည်းကောင်း");
  const long = videoCaption({ product, lang: "th", script: { ...script, lines: Array(40).fill("ยาวมาก ".repeat(10)) } });
  assert.ok(long.length <= 1024 && long.endsWith("#Shopee") && long.includes("🔗 https://s.shopee.co.th/x"));
  // the script reply: every beat, the on-screen text, who speaks in a drama
  const m = scriptMessage({ product, lang: "my", duration: 13.6, script, jobId: 87 });
  assert.match(m, /📝 Script · 🇲🇲 မြန်မာ · Voiceover · 14 s · #87/);
  assert.match(m, /🎯 Hook: ပူလား\?\n1\. ရေခဲအိတ် ၅ ခု ပါတယ်\n   🔤 ရေခဲအိတ် ၅ ခု\n2\. တစ်ရက်လုံး အေးတယ်\n🛒 CTA: ဝယ်လို့ရပါတယ်ရှင့်/);
  assert.match(m, /🎬 Cooler 16L\n\n🎯/); // a blank line before the beats
  const d = scriptMessage({ product, lang: "my", script: { hook: "h", lines: ["a", "b"], speakers: ["B", "A"], cta: "c", format: "drama" } });
  assert.match(d, /Hook: A: h\n1\. B: a\n2\. A: b\n🛒 CTA: B: c/);
});

test("connect finds the last private chat; errors never show the token", async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: [
      { message: { chat: { id: -100, type: "group", title: "g" } } },
      { message: { chat: { id: 42, type: "private", first_name: "Aung", last_name: "Thu" } } },
    ] }));
    assert.deepEqual(await findChat(TOKEN), { id: "42", name: "Aung Thu" });
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: [] }));
    assert.equal(await findChat(TOKEN), null);
    globalThis.fetch = async (url) => { throw new Error(`connect failed ${url}`); };
    await assert.rejects(findChat(TOKEN), (e) => !e.message.includes(TOKEN) && e.message.includes("<token>"));
  } finally { globalThis.fetch = orig; }
});

test("sendVideo uploads the file as multipart with a caption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-"));
  const file = join(dir, "video-my.mp4");
  writeFileSync(file, Buffer.from("fake mp4"));
  const orig = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, form: init.body }; return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); };
  try {
    await sendVideo(TOKEN, "42", file, { caption: "hi", duration: 13.6 });
    assert.match(seen.url, /\/bot123456789:[^/]+\/sendVideo$/);
    assert.equal(seen.form.get("chat_id"), "42");
    assert.equal(seen.form.get("caption"), "hi");
    assert.equal(seen.form.get("duration"), "14");
    assert.equal(seen.form.get("video").name, "video-my.mp4");
  } finally { globalThis.fetch = orig; }
});

test("a finished video goes out as the video, then its script as a reply", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tg-"));
  const file = join(dir, "video-th.mp4");
  writeFileSync(file, Buffer.from("fake mp4"));
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ method: url.split("/").pop(), body: init.body instanceof FormData ? null : JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }));
  };
  try {
    await sendJobVideo(TOKEN, "42", { file, product: { title: "Fan" }, lang: "th", duration: 12, script: { hook: "h", lines: ["a"], cta: "c" }, jobId: 1 });
    assert.deepEqual(calls.map((c) => c.method), ["sendVideo", "sendMessage"]);
    assert.equal(calls[1].body.reply_parameters.message_id, 77);
    assert.match(calls[1].body.text, /📝 Script/);
  } finally { globalThis.fetch = orig; }
});
