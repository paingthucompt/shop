import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildAuthorization } from "../src/shopee.js";
import { buildCreateBody, buildProductPrompt, CLIP_STYLES } from "../src/seedance.js";
import { parseScript, buildScriptPrompt, generateScript, SCRIPT_ANGLES } from "../src/llm.js";

test("shopee signature = sha256(appId + ts + payload + secret)", () => {
  const payload = JSON.stringify({ query: "{x}" });
  const sig = crypto.createHash("sha256").update(`123${1712000000}${payload}s`).digest("hex");
  assert.equal(buildAuthorization("123", "s", payload, 1712000000), `SHA256 Credential=123, Timestamp=1712000000, Signature=${sig}`);
});

test("seedance body: 9:16, audio on, no watermark, max 4 reference images", () => {
  const b = buildCreateBody({ title: "Keyboard" }, ["a", "b", "c", "d", "e"], { model: "m" });
  assert.equal(b.ratio, "9:16");
  assert.equal(b.generate_audio, true);
  assert.equal(b.watermark, false);
  assert.equal(b.content.filter((c) => c.role === "reference_image").length, 4);
  assert.match(b.content[0].text, /Never sacrifice product accuracy/);
});

test("seedance presenter style: a person demonstrates, never speaks, no on-screen text", () => {
  const p = buildProductPrompt({ title: "Fan" }, { style: "presenter" });
  assert.match(p, /Presenter:/);
  assert.match(p, /does NOT talk/);
  assert.match(p, /No on-screen text/);
  assert.match(p, /Product: Fan/);
  const body = buildCreateBody({ title: "Fan" }, ["x"], { model: "m", style: "presenter" });
  assert.match(body.content[0].text, /does NOT talk/);
  // default stays the product-only demo
  assert.doesNotMatch(buildProductPrompt({ title: "Fan" }), /Presenter:/);
});

test("script prompt is single-language", () => {
  assert.match(buildScriptPrompt({ title: "x" }, "my"), /Write ONLY in Burmese/);
  assert.match(buildScriptPrompt({ title: "x" }, "th"), /Write ONLY in Thai/);
});

test("parseScript extracts JSON from chatty output", () => {
  const s = parseScript('Sure!\n```json\n{"hook":"h","lines":["a"," b "],"cta":"c"}\n```');
  assert.deepEqual(s, { hook: "h", lines: ["a", "b"], captions: ["", ""], cta: "c" });
});

test("parseScript keeps captions aligned with lines", () => {
  const s = parseScript('{"hook":"h","lines":["a","","c"],"captions":["A","B"],"cta":"x"}');
  assert.deepEqual(s.lines, ["a", "c"]);
  assert.deepEqual(s.captions, ["A", ""]);
});

test("script prompt asks for on-screen key phrases", () => {
  assert.match(buildScriptPrompt({ title: "x" }, "th"), /captions: one on-screen key phrase per line/);
});

test("mock script without API key", async () => {
  delete process.env.LLM_API_KEY;
  const s = await generateScript({ title: "Test" }, "th");
  assert.equal(s.mock, true);
  assert.ok(s.lines.length >= 1);
});

test("every clip style keeps the product-accuracy rules and differs in look", () => {
  const prompts = CLIP_STYLES.map((style) => buildProductPrompt({ title: "Fan" }, { style }));
  for (const p of prompts) {
    assert.match(p, /STRICTLY on the supplied PRODUCT REFERENCE IMAGES/);
    assert.match(p, /Product consistency: it is ONE single product/);
    assert.match(p, /No on-screen text/);
    assert.match(p, /Never sacrifice product accuracy/);
  }
  assert.equal(new Set(prompts).size, CLIP_STYLES.length);
  assert.match(buildProductPrompt({ title: "Fan" }, { style: "hero" }), /No people, no hands/);
  // unknown style falls back to the product demo
  assert.equal(buildProductPrompt({ title: "Fan" }, { style: "x" }), buildProductPrompt({ title: "Fan" }));
});

test("script angle is added to the prompt; auto adds nothing; hard sell forbids invented urgency", () => {
  const base = buildScriptPrompt({ title: "x" }, "th", 10);
  assert.equal(buildScriptPrompt({ title: "x" }, "th", 10, "auto"), base);
  assert.doesNotMatch(base, /Angle:/);
  for (const a of SCRIPT_ANGLES.filter((a) => a !== "auto")) {
    assert.match(buildScriptPrompt({ title: "x" }, "my", 10, a), /Angle:/);
  }
  assert.match(buildScriptPrompt({ title: "x" }, "th", 10, "hard_sell"), /never invent urgency/);
  assert.match(buildScriptPrompt({ title: "x" }, "th", 10, "review"), /never pretend to quote other customers/);
});

test("gemini video request: 9:16, inline reference images, clamped duration, shared style prompt", async () => {
  const { buildInteractionBody, findVideo, geminiDuration } = await import("../src/gemini-video.js");
  const body = buildInteractionBody({ title: "Fan" }, ["data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB"], { model: "m", style: "hero", duration: 99 });
  assert.equal(body.model, "m");
  assert.deepEqual(body.input.slice(0, 2), [
    { type: "image", mime_type: "image/png", data: "AAAA" },
    { type: "image", mime_type: "image/jpeg", data: "BBBB" },
  ]);
  assert.equal(body.input[2].type, "text");
  assert.match(body.input[2].text, /No people, no hands/);
  assert.equal(body.response_format.aspect_ratio, "9:16");
  assert.equal(body.response_format.duration, "15s");
  assert.equal(geminiDuration(1), 3);
  assert.equal(geminiDuration("12"), 12);
  assert.throws(() => buildInteractionBody({ title: "x" }, ["https://example.com/a.jpg"]), /inline images/);
  // REST response: video lives in steps[].content[]
  const it = { id: "v1_x", status: "completed", steps: [{ type: "user_input" }, { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: "QQ==" }] }] };
  assert.equal(findVideo(it).data, "QQ==");
  assert.equal(findVideo({ status: "in_progress" }), null);
});

test("gemini generateVideo: polls a background interaction, resumes by id, fails clearly", async () => {
  const { generateVideo } = await import("../src/gemini-video.js");
  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "k";
  const calls = [];
  const replies = [
    { id: "v1_1", status: "in_progress" },
    { id: "v1_1", status: "in_progress" },
    { id: "v1_1", status: "completed", steps: [{ type: "model_output", content: [{ type: "video", data: Buffer.from("mp4").toString("base64") }] }] },
  ];
  globalThis.fetch = async (url, init) => {
    calls.push([init?.method || "GET", String(url), init?.headers?.["x-goog-api-key"]]);
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  };
  try {
    let saved;
    const bytes = await generateVideo({ title: "Fan" }, ["data:image/png;base64,AAAA"], { onId: (id) => { saved = id; }, intervalMs: 1 });
    assert.equal(bytes.toString(), "mp4");
    assert.equal(saved, "v1_1");
    assert.deepEqual(calls.map(([m, u]) => [m, u.replace(/^.*v1beta/, "")]), [["POST", "/interactions"], ["GET", "/interactions/v1_1"], ["GET", "/interactions/v1_1"]]);
    assert.ok(calls.every(([, , key]) => key === "k"));

    // resume: never POSTs again
    calls.length = 0;
    replies.push({ id: "v1_1", status: "failed", error: { message: "safety" } });
    await assert.rejects(generateVideo({ title: "Fan" }, [], { resumeId: "v1_1", intervalMs: 1 }), /Gemini video failed: safety/);
    assert.deepEqual(calls.map(([m]) => m), ["GET"]);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("video prompt request: keeps the style's house rules, follows the script beats, English only", async () => {
  const { buildVideoPromptRequest } = await import("../src/llm.js");
  const script = { hook: "ကြက်သွန်လှီးရတာ ပင်ပန်းလား?", lines: ["ခလုတ်တစ်ချက်နှိပ်ရုံနဲ့ ကြိတ်ပြီးပြီ"], cta: "ခြင်းဝါလေးကို နှိပ်ပါ" };
  const req = buildVideoPromptRequest({ title: "Seagull Mini Chopper", description: "250 ml" }, { style: "in_action", seconds: 12, script });
  assert.match(req, /12-second vertical 9:16/);
  assert.match(req, /hook: ကြက်သွန်/);
  assert.match(req, /line 1: ခလုတ်/);
  assert.match(req, /Write in English/);
  assert.match(req, /BASE PROMPT:\nCreate a photorealistic/);
  assert.match(req, /Product consistency/);
  assert.match(req, /no exaggerated or instant transformations/); // in_action style rules included
});

test("video prompt without an LLM key = the house prompt for the style", async () => {
  const { generateVideoPrompt } = await import("../src/llm.js");
  const saved = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    const vp = await generateVideoPrompt({ title: "Fan" }, { style: "hero" });
    assert.equal(vp.mock, true);
    assert.equal(vp.prompt, buildProductPrompt({ title: "Fan" }, { style: "hero" }));
  } finally {
    if (saved !== undefined) process.env.LLM_API_KEY = saved;
  }
});

test("video prompt with an LLM: strips markdown fences and caps the length", async () => {
  const { generateVideoPrompt, VIDEO_PROMPT_MAX } = await import("../src/llm.js");
  const realFetch = globalThis.fetch;
  const saved = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "k";
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "```text\n0–3s: hands open the box. " + "x".repeat(3000) + "\n```" } }] }), { status: 200 });
  };
  try {
    const vp = await generateVideoPrompt({ title: "Fan" }, { style: "unboxing" });
    assert.ok(vp.prompt.startsWith("0–3s: hands open the box."));
    assert.ok(!vp.prompt.includes("```"));
    assert.equal(vp.prompt.length, VIDEO_PROMPT_MAX);
    assert.match(sent.messages[0].content, /Rewrite the BASE PROMPT/);
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved;
  }
});
