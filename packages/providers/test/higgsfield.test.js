import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody, waitForRequest, higgsfieldSettings, DEFAULT_MODEL } from "../src/higgsfield.js";
import { aiVideoProvider, aiVideoProviders } from "../src/seedance.js";
import { withKeys, userKeyContext } from "../src/keys.js";
import { priceUsage } from "../src/pricing.js";
import { providerError, errorCode } from "../src/api-errors.js";
import { buildPortraitFrameArgs } from "../../video-engine/portrait-frame.js";

test("Higgsfield request body: documented image-to-video fields, prompt capped", () => {
  const b = buildRequestBody({ title: "Fan", description: "x".repeat(5000) }, "https://cdn/x.jpg");
  assert.equal(b.image_url, "https://cdn/x.jpg");
  assert.equal(b.duration, 10);
  assert.ok(b.prompt.length <= 2400 && b.negative_prompt);
  assert.equal(higgsfieldSettings().model, DEFAULT_MODEL);
});

test("Higgsfield is offered for AI video only with the user's key, and priced", () => {
  const saved = { g: process.env.GEMINI_API_KEY, s: process.env.SEEDANCE_API_KEY };
  process.env.GEMINI_API_KEY = "server"; process.env.SEEDANCE_API_KEY = "server-s";
  try {
    withKeys(userKeyContext({ gemini: "g", higgsfield: "id:sec" }), () => {
      assert.deepEqual(aiVideoProviders(), ["gemini", "higgsfield"]); // the server's BytePlus key is not offered
      assert.equal(aiVideoProvider("higgsfield"), "higgsfield");
      assert.equal(aiVideoProvider("seedance"), "gemini");
    });
    withKeys(userKeyContext({ gemini: "g" }), () => assert.equal(aiVideoProvider("higgsfield"), "gemini"));
  } finally {
    for (const [k, v] of [["GEMINI_API_KEY", saved.g], ["SEEDANCE_API_KEY", saved.s]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const p = priceUsage({ kind: "video", provider: "higgsfield", model: DEFAULT_MODEL, seconds: 10, resolution: "720p" });
  assert.deepEqual(p, { usd: 0.7, priced: true });
});

test("Higgsfield polling: completed → video URL; nsfw / failed → errors the app explains", async () => {
  const orig = globalThis.fetch;
  const replies = [{ status: "queued" }, { status: "in_progress" }, { status: "completed", video: { url: "https://cdn/v.mp4" } }];
  globalThis.fetch = async () => new Response(JSON.stringify(replies.shift()), { status: 200 });
  process.env.HIGGSFIELD_API_KEY = "id:sec";
  try {
    const seen = [];
    assert.equal(await waitForRequest("r1", { intervalMs: 1, onStatus: (s) => seen.push(s) }), "https://cdn/v.mp4");
    assert.deepEqual(seen, ["queued", "in_progress", "completed"]);
    globalThis.fetch = async () => new Response(JSON.stringify({ status: "nsfw" }), { status: 200 });
    await assert.rejects(waitForRequest("r2", { intervalMs: 1 }), /Higgsfield nsfw/);
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Invalid credentials" }), { status: 401 });
    await assert.rejects(waitForRequest("r3", { intervalMs: 1 }), (e) => errorCode(e.message) === "key_invalid");
  } finally {
    globalThis.fetch = orig;
    delete process.env.HIGGSFIELD_API_KEY;
  }
  assert.equal(errorCode(providerError("Higgsfield", 403, '{"detail":"Not enough balance"}')), "key_billing");
  assert.equal(errorCode(providerError("Higgsfield", 429, '{"detail":"account_queue_full"}')), "busy");
});

test("start frame: the photo fitted into a blurred 1080×1920 background", () => {
  const a = buildPortraitFrameArgs("in.jpg", "out.jpg").join(" ");
  assert.match(a, /crop=1080:1920,boxblur/);
  assert.match(a, /force_original_aspect_ratio=decrease/);
  assert.match(a, /-frames:v 1/);
});

test("AI start frame: a clean 9:16 product photo, no text, priced as one image", async () => {
  const { buildStartFramePrompt, buildImageRequest } = await import("../src/scene-images.js");
  const p = buildStartFramePrompt({ title: "Cat grass" }, { format: "presenter" });
  assert.match(p, /opening frame/);
  assert.match(p, /logo, brand name and label text stay/);
  assert.match(p, /Apart from what is printed on the product itself: no text/);
  assert.match(p, /local creator/); // the format's cast
  assert.equal(buildImageRequest(p, []).generationConfig.imageConfig.aspectRatio, "9:16");
});

test("Higgsfield models: each gets a clip length it accepts", async () => {
  const { MODELS, modelDuration, higgsfieldSettings } = await import("../src/higgsfield.js");
  assert.equal(modelDuration("kling-video/v2.5-turbo/pro/image-to-video", 12), 10);
  assert.equal(modelDuration("kling-video/v2.5-turbo/pro/image-to-video", 6), 5);
  assert.equal(modelDuration("kling-video/v4.0-flash/image-to-video", 25), 20);
  assert.equal(modelDuration("bytedance/seedance-2.5/image-to-video", 10), 10);
  assert.equal(higgsfieldSettings("kling-video/v4.0/image-to-video").name, "Kling 4.0");
  assert.equal(higgsfieldSettings("unknown/path").model, "unknown/path"); // only the API route validates the pick
  for (const id of Object.keys(MODELS)) assert.ok(priceUsage({ kind: "video", provider: "higgsfield", model: id, seconds: 10 }).priced, id);
});

test("AI video prompts: English product text only, and no written text in the clip", async () => {
  const { promptProduct } = await import("../src/llm.js");
  const { buildProductPrompt } = await import("../src/seedance.js");
  const saved = { g: process.env.GEMINI_API_KEY, l: process.env.LLM_API_KEY };
  delete process.env.GEMINI_API_KEY; delete process.env.LLM_API_KEY; // no LLM → Latin words of the title
  try {
    const p = await promptProduct({ title: "กระติกน้ำแข็ง Wthb Outdoor 16L", description: "ส่งฟรี กรุงเทพฯ" });
    assert.deepEqual([p.title, p.description], ["Wthb Outdoor 16L", null]);
    const same = { title: "Mini fan", description: "USB" };
    assert.equal(await promptProduct(same), same);
  } finally {
    if (saved.g !== undefined) process.env.GEMINI_API_KEY = saved.g;
    if (saved.l !== undefined) process.env.LLM_API_KEY = saved.l;
  }
  const prompt = buildProductPrompt({ title: "Fan", description: "x".repeat(2000) });
  assert.match(prompt.split("\n")[1], /NO ADDED TEXT/);
  assert.match(prompt.split("\n")[2], /OWN printed logo[\s\S]*MUST stay/); // the product's logo / label is kept
  assert.ok(prompt.length < 1650 + 450); // the description is cut to 400 characters
});
