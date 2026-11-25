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

    // the real API puts reasons in errors[] (seen live: RESOURCE_EXHAUSTED)
    replies.push({ id: "v1_2", status: "failed", errors: [{ code: "RESOURCE_EXHAUSTED", message: "There was a problem processing your request." }] });
    await assert.rejects(generateVideo({ title: "Fan" }, [], { resumeId: "v1_2", intervalMs: 1 }), /Gemini video failed: RESOURCE_EXHAUSTED: There was a problem/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

const MY_SCRIPT = {
  hook: "ကြက်သွန်လှီးရတာ လက်စပ်လို့ စိတ်ညစ်နေလား။",
  lines: ["Seagull mini ကြိတ်စက်လေးနဲ့ တစ်ချက်နှိပ်ရုံပဲ။", "ကြိုးမဲ့မို့ သယ်ရလွယ်ပြီး ဆေးရတာလည်း အဆင်ပြေတယ်။"],
  cta: "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါ။",
};
const TH_SCRIPT = { hook: "สับพริกทีไรแสบมือ", lines: ["กดปุ่มเดียวละเอียด"], cta: "กดตะกร้าเหลืองเลย" };

test("clip prompt: one SILENT clip for all languages, long enough for the longest voiceover, ≤ 15 s", async () => {
  const { clipSeconds, videoSeconds, buildClipPrompt } = await import("../src/flow-prompt.js");
  const secs = clipSeconds({ th: TH_SCRIPT, my: MY_SCRIPT });
  assert.ok(secs >= Math.ceil(videoSeconds(MY_SCRIPT, "my")) && secs <= 15, String(secs));
  assert.ok(secs > clipSeconds({ th: TH_SCRIPT }), "the longer Burmese read sets the length");
  assert.equal(clipSeconds({}), 5);
  const p = buildClipPrompt({ title: "Seagull เครื่องบดสับ 250 มล. Mini Food Chopper" }, { style: "in_action", seconds: secs });
  assert.match(p, new RegExp(`Vertical 9:16, ${secs} seconds`));
  assert.match(p, /Nobody speaks: no voice, no narration, no lip movement/);
  assert.match(p, /No music/);
  assert.match(p, /No on-screen text/);
  assert.match(p, /top and bottom fifth of the frame free/);
  assert.match(p, /never morph, duplicate or redesign it/);
  assert.match(p, /no exaggerated or instant transformations/); // in_action style
  assert.doesNotMatch(p, /[\u0E00-\u0E7F\u1000-\u109F]/); // no Thai / Burmese text in the prompt
  assert.match(p, /Shot list: 0–/);
});

test("clip prompt: title without Thai/Burmese; nothing left → generic name", async () => {
  const { promptTitle } = await import("../src/flow-prompt.js");
  assert.equal(promptTitle("Seagull เครื่องบดสับอาหารไร้สาย 250 มล. สีครีม Mini Food Chopper"), "Seagull 250. Mini Food Chopper");
  assert.equal(promptTitle("พัดลมมือถือ"), "the product in the attached photos");
  assert.equal(promptTitle("RGB Keyboard"), "RGB Keyboard");
});

test("clip prompt: the LLM writes the shot list from the script; bad replies fall back to default shots", async () => {
  const { generateClipPrompt } = await import("../src/llm.js");
  const { parseShots } = await import("../src/flow-prompt.js");
  assert.equal(parseShots('ok {"shots": "0–3s: a"}'), "0–3s: a");
  assert.equal(parseShots('{"shots": ["0–3s: a", "3–6s: b"]}'), "0–3s: a 3–6s: b");
  assert.equal(parseShots("no json"), null);
  const long = Array.from({ length: 40 }, (_, i) => `${i}–${i + 1}s: hand shows detail ${i}.`).join(" ");
  const cut = parseShots(JSON.stringify({ shots: long }));
  assert.ok(cut.length <= 900 && cut.endsWith("."));

  const realFetch = globalThis.fetch;
  const saved = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "k";
  let reply = '{"shots": "0–4s: hand presses the button. 4–9s: garlic minced."}';
  let sent;
  globalThis.fetch = async (_u, init) => {
    sent = JSON.parse(init.body).messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  };
  try {
    const good = await generateClipPrompt({ title: "Chopper" }, { style: "product", scripts: { th: TH_SCRIPT, my: MY_SCRIPT } });
    assert.equal(good.mock, false);
    assert.match(good.prompt, /Shot list: 0–4s: hand presses the button/);
    assert.match(sent, /hook: ကြက်သွန်/); // planned from the script beats
    assert.match(sent, new RegExp(`${good.seconds}-second`));
    reply = "sorry";
    const fb = await generateClipPrompt({ title: "Chopper" }, { scripts: { th: TH_SCRIPT } });
    assert.equal(fb.mock, true);
    assert.match(fb.prompt, /the full product clearly visible/);
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved;
  }
});

test("LLM chat retries 503 'high demand' and then succeeds; a 401 fails at once", async () => {
  const { generateClipPrompt } = await import("../src/llm.js");
  const realFetch = globalThis.fetch;
  const saved = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "k";
  const statuses = [503, 200];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const status = statuses.shift();
    return status === 200
      ? new Response(JSON.stringify({ choices: [{ message: { content: '{"shots": "0–5s: s1"}' } }] }), { status })
      : new Response("high demand", { status });
  };
  try {
    assert.match((await generateClipPrompt({ title: "Fan" }, { scripts: { th: TH_SCRIPT } })).prompt, /Shot list: 0–5s: s1/);
    assert.equal(calls, 2);
    calls = 0;
    statuses.push(401);
    await assert.rejects(generateClipPrompt({ title: "Fan" }, { scripts: { th: TH_SCRIPT } }), /LLM 401/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved;
  }
});

test("llmConfig: own key wins; otherwise the Gemini key, never sent to a leftover OpenAI URL", async () => {
  const { llmConfig, DEFAULT_GEMINI_TEXT_MODEL } = await import("../src/llm.js");
  assert.equal(llmConfig({}), null);
  assert.deepEqual(llmConfig({ LLM_API_KEY: "sk-1" }), { key: "sk-1", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", fallbacks: [] });
  const g = llmConfig({ GEMINI_API_KEY: "g", LLM_BASE_URL: "https://api.openai.com/v1", LLM_MODEL: "gpt-4.1-mini" });
  assert.equal(g.key, "g");
  assert.match(g.baseUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(g.model, DEFAULT_GEMINI_TEXT_MODEL);
  assert.equal(llmConfig({ GEMINI_API_KEY: "g", LLM_MODEL: "gemini-3.8-flash" }).model, "gemini-3.8-flash");
});


test("storyboard prompt: panels = script beats in time order with exact text, shots from the clip, no invented claims", async () => {
  const { buildStoryboardPrompt, storyboardPanels, parseShotSegments } = await import("../src/flow-prompt.js");
  const shots = "0–3s: hand drops garlic into the bowl. 3–7s: finger presses the button. 7–11s: close-up of the blade. 11–15s: chopper fully visible.";
  assert.equal(parseShotSegments(shots).length, 4);
  const script = { ...TH_SCRIPT, captions: ["ละเอียดในปุ่มเดียว"] };
  const panels = storyboardPanels(script, "th", { seconds: 15, shots });
  assert.deepEqual(panels.map((x) => x.role), ["hook", "intro", "cta"]);
  assert.equal(panels[0].from, 0);
  assert.equal(panels.at(-1).to, 15);
  assert.ok(panels.every((x, i) => i === 0 || x.from >= panels[i - 1].from));
  assert.equal(panels[1].text, "ละเอียดในปุ่มเดียว"); // on-screen caption wins over the spoken line
  assert.equal(panels[0].visual, "hand drops garlic into the bowl");
  const th = buildStoryboardPrompt({ title: "Seagull เครื่องบดสับ Mini Chopper", price: 299, currency: "THB" }, "th", { script, seconds: 15, shots });
  assert.match(th, /landscape 16:9 storyboard sheet for a 15-second vertical \(9:16\)/);
  assert.match(th, /1\. Label "1\. เปิดเรื่อง \(0–\d+s\)"/);
  assert.match(th, new RegExp(`On-screen text: "${TH_SCRIPT.cta}" with a yellow button "🛒 สั่งซื้อเลย!" and the price "299 THB"`));
  assert.match(th, /Seagull เครื่องบดสับ Mini Chopper/); // Thai name kept on the Thai storyboard
  assert.match(th, /Do not add prices, discounts, warranties/);
  const my = buildStoryboardPrompt({ title: "Seagull เครื่องบดสับ Mini Chopper" }, "my", { script: MY_SCRIPT, seconds: 15, shots });
  assert.doesNotMatch(my, /[\u0E00-\u0E7F]/); // no Thai on the Myanmar storyboard
  assert.doesNotMatch(my, /and the price/); // no price given → none invented
  assert.match(my, /Write every Burmese \(Myanmar\) text EXACTLY/);
});

test("scene images: plan = storyboard beats (≤ 6 scenes covering the clip), prompt without text or bands", async () => {
  const { planScenes, buildScenePrompt, MAX_SCENES } = await import("../src/scene-images.js");
  const shots = "0–3s: hand drops garlic. 3–7s: finger presses the button. 7–10s: blade close-up. 10–13s: chopper hero.";
  const plan = planScenes(MY_SCRIPT, "my", { seconds: 13, shots });
  assert.deepEqual(plan.map((s) => s.role), ["hook", "intro", "feature", "cta"]);
  assert.equal(plan[0].from, 0);
  assert.equal(plan.at(-1).to, 13);
  assert.equal(plan.reduce((a, s) => a + s.seconds, 0), 13);
  const long = { hook: "h", lines: ["a", "b", "c", "d", "e", "f"], cta: "c" };
  const merged = planScenes(long, "th", { seconds: 15 });
  assert.equal(merged.length, MAX_SCENES);
  assert.equal(merged.reduce((a, s) => a + s.seconds, 0), 15);
  assert.deepEqual(merged.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
  const p = buildScenePrompt({ title: "Seagull เครื่องบด Mini Chopper" }, { visual: "chopper hero.", role: "cta" });
  assert.match(p, /ONE photorealistic vertical 9:16 photo/);
  assert.match(p, /Never a grid, collage, split screen/);
  assert.match(p, /show only the most telling one\): chopper hero\.\n/);
  assert.match(p, /fills the entire frame edge to edge/);
  assert.match(p, /Apart from what is printed on the product itself: no text, captions/);
  assert.match(p, /fully visible, sharp/);
  assert.doesNotMatch(p, /top and bottom fifth/); // that wording made the model blur the edges
  assert.doesNotMatch(p, /[฀-๿]/);
});

test("scene images: request carries ≤ 4 reference photos + 9:16; reply image parsed; blocked reply is an error", async () => {
  const { buildImageRequest, findImage, generateSceneImage } = await import("../src/scene-images.js");
  const refs = Array.from({ length: 5 }, () => "data:image/webp;base64,AAAA");
  const req = buildImageRequest("p", refs, { size: "1K" });
  assert.equal(req.contents[0].parts.length, 5); // 4 photos + text
  assert.deepEqual(req.generationConfig, { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16", imageSize: "1K" } });
  assert.equal(findImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: "QQ==" } }] } }] }).mime, "image/jpeg");
  assert.equal(findImage({}), null);

  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "k";
  const replies = [
    [503, "busy"],
    [200, JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("png").toString("base64") } }] } }], usageMetadata: { candidatesTokenCount: 1120 } })],
    [200, JSON.stringify({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] })],
  ];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /models\/gemini-3\.1-flash-image:generateContent$/);
    assert.equal(init.headers["x-goog-api-key"], "k");
    const [status, body] = replies.shift();
    return new Response(body, { status });
  };
  try {
    const img = await generateSceneImage("p", ["data:image/png;base64,AAAA"]);
    assert.equal(img.data.toString(), "png");
    assert.equal(img.usage.candidatesTokenCount, 1120);
    assert.equal(calls, 2); // retried the 503
    await assert.rejects(generateSceneImage("p", ["data:image/png;base64,AAAA"]), /no image returned \(IMAGE_SAFETY\)/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("storyboard → video prompt: same panels and timings as the storyboard, silent, never shows its text", async () => {
  const { buildStoryboardVideoPrompt, buildStoryboardPrompt } = await import("../src/flow-prompt.js");
  const shots = "0–3s: hand drops garlic. 3–7s: finger presses the button. 7–10s: blade close-up. 10–13s: chopper hero.";
  const opts = { script: MY_SCRIPT, seconds: 13, shots, style: "product" };
  const board = buildStoryboardPrompt({ title: "Seagull เครื่องบด Mini Chopper" }, "my", opts);
  const video = buildStoryboardVideoPrompt({ title: "Seagull เครื่องบด Mini Chopper" }, "my", opts);
  const times = (t) => [...t.matchAll(/\((\d+)–(\d+)s\)/g)].map((m) => m[0]);
  assert.deepEqual(times(video), times(board)); // panel timings match the storyboard
  assert.match(video, /Vertical 9:16, 13 seconds/);
  assert.match(video, /Follow the attached STORYBOARD image: it has \d+ numbered panels/);
  assert.match(video, /Nobody speaks/);
  assert.match(video, /show NO text, subtitles, captions, buttons/);
  assert.match(video, /never the storyboard layout itself/);
  assert.doesNotMatch(video, /[฀-๿က-႟]/); // English only — no Thai/Myanmar text for Flow to copy
});

test("LLM: a busy (503) or hanging main model falls over to the next fallback model", async () => {
  const { generateClipPrompt } = await import("../src/llm.js");
  const realFetch = globalThis.fetch;
  const saved = { k: process.env.LLM_API_KEY, f: process.env.LLM_FALLBACK_MODELS, m: process.env.LLM_MODEL };
  process.env.LLM_API_KEY = "k"; process.env.LLM_MODEL = "main"; process.env.LLM_FALLBACK_MODELS = "backup-a, backup-b";
  const used = [];
  globalThis.fetch = async (_u, init) => {
    const { model } = JSON.parse(init.body);
    used.push(model);
    return model === "backup-a"
      ? new Response(JSON.stringify({ choices: [{ message: { content: '{"shots": "0–5s: ok"}' } }] }), { status: 200 })
      : new Response("high demand", { status: 503 });
  };
  try {
    const r = await generateClipPrompt({ title: "Fan" }, { scripts: { th: TH_SCRIPT } });
    assert.match(r.prompt, /Shot list: 0–5s: ok/);
    assert.deepEqual(used, ["main", "backup-a"]);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [["LLM_API_KEY", saved.k], ["LLM_FALLBACK_MODELS", saved.f], ["LLM_MODEL", saved.m]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("generateScript: a Burmese reply with Thai letters is sent back with the broken words named", async () => {
  const { generateScript, foreignWords } = await import("../src/llm.js");
  const realFetch = globalThis.fetch;
  process.env.LLM_API_KEY = "k";
  process.env.LLM_BASE_URL = "https://llm.example/v1";
  const mixed = { hook: "အဆင်ပြေမယ့် တู้เย็นလေး", lines: ["Haier ၁၄၉ လิตร ဆိုဒ်လေး"], captions: ["၁၄၉ လီတာ"], cta: "ခြင်းဝါလေးကို နှိပ်ပါ" };
  const good = { hook: "အဆင်ပြေမယ့် ရေခဲသေတ္တာလေး", lines: ["Haier ၁၄၉ လီတာ ဆိုဒ်လေး"], captions: ["၁၄၉ လီတာ"], cta: "ခြင်းဝါလေးကို နှိပ်ပါ" };
  const prompts = [];
  const replies = [{ title: "[BCD]Haier fridge 1 door 149 L", description: "" }, mixed, good]; // 1st = English translation of the Thai name
  globalThis.fetch = async (_url, init) => {
    prompts.push(JSON.parse(init.body).messages[0].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] }), { status: 200 });
  };
  try {
    assert.deepEqual(foreignWords(mixed, "my"), ["တู้เย็นလေး", "လิตร"]);
    const s = await generateScript({ title: "[BCD]Haier ตู้เย็น 149 ลิตร" }, "my");
    assert.equal(s.hook, good.hook);
    assert.equal(prompts.length, 3);
    assert.match(prompts[0], /Translate this e-commerce product name/);
    assert.match(prompts[1], /Product: \[BCD\]Haier fridge 1 door 149 L/); // the Burmese writer never sees the Thai name
    assert.doesNotMatch(prompts[1], /ตู้เย็น/);
    assert.match(prompts[2], /mixed in letters of another language in: "တู้เย็นလေး", "လิตร"/);

    replies.push(mixed, mixed, mixed); // never fixed → clear error, nothing saved
    await assert.rejects(generateScript({ title: "x" }, "my"), /kept mixing other-language letters/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
  }
});

test("storyboard video prompt: silent by default; speaking = presenter says the exact script with lip-sync", async () => {
  const { buildStoryboardVideoPrompt } = await import("../src/flow-prompt.js");
  const script = { hook: "ของดีต้องลอง", lines: ["ใช้ง่ายมาก"], captions: ["ใช้ง่าย"], cta: "กดตะกร้าเหลืองได้เลย" };
  const silent = buildStoryboardVideoPrompt({ title: "Mini fan" }, "th", { script, seconds: 10 });
  assert.match(silent, /Nobody speaks/);
  assert.doesNotMatch(silent, /Lip-sync/);
  const talk = buildStoryboardVideoPrompt({ title: "Mini fan" }, "th", { script, seconds: 10, speaking: true });
  assert.doesNotMatch(talk, /Nobody speaks/);
  assert.match(talk, /"ของดีต้องลอง ใช้งานง่ายมาก|"ของดีต้องลอง ใช้ง่ายมาก กดตะกร้าเหลืองได้เลย"/);
  assert.match(talk, /Lip-sync: .*match every syllable of the Thai speech/);
  assert.match(talk, /fictional person/);
  assert.match(talk, /No music/);
  const my = buildStoryboardVideoPrompt({ title: "Mini fan" }, "my", { script: { hook: "စမ်းကြည့်ပါ", lines: ["သုံးရလွယ်တယ်"], cta: "ဝယ်လိုက်ပါ" }, seconds: 10, speaking: true });
  assert.match(my, /Burmese \(Myanmar\)/);
  assert.match(my, /Yangon accent/);
});

test("gemini-video retryDelayMs: Retry-After wins, else 0.5 s doubling capped at 8 s", async () => {
  const { retryDelayMs } = await import("../src/gemini-video.js");
  assert.equal(retryDelayMs(1, { headers: new Headers({ "retry-after": "3" }) }), 3000);
  for (const [attempt, max] of [[1, 500], [3, 2000], [9, 8000]]) {
    const ms = retryDelayMs(attempt);
    assert.ok(ms >= max / 2 && ms <= max, `${attempt}: ${ms}`);
  }
});

test("foreignWords / hasForeignText: any non-Latin letter outside the language's own script counts", async () => {
  const { foreignWords, hasForeignText } = await import("../src/llm.js");
  assert.deepEqual(foreignWords({ hook: "အပြင်မှာ ממש ပူနေပြီလား။", lines: ["iPhone 15 ကို"], cta: "ဝယ်ပါ" }, "my"), ["ממש"]);
  assert.deepEqual(foreignWords({ hook: "ลมแรง USB-C", lines: ["เงียบ"], cta: "กดเลย" }, "th"), []);
  assert.equal(hasForeignText({ title: "小风扇 USB" }, "my"), true);
  assert.equal(hasForeignText({ title: "Fan Café 3000" }, "my"), false);
});

test("llmConfig: LLM_MODEL_MY / _TH pick the model for one language; Gemini keys stay on Gemini models", async () => {
  const { llmConfig, DEFAULT_GEMINI_TEXT_MODEL } = await import("../src/llm.js");
  const env = { GEMINI_API_KEY: "k", LLM_MODEL: "gemini-flash-lite-latest", LLM_MODEL_MY: "gemini-3.6-flash" };
  assert.equal(llmConfig(env, "my").model, "gemini-3.6-flash");
  assert.equal(llmConfig(env, "th").model, "gemini-flash-lite-latest");
  assert.equal(llmConfig(env).model, "gemini-flash-lite-latest");
  assert.equal(llmConfig({ GEMINI_API_KEY: "k", LLM_MODEL_MY: "gpt-4o" }, "my").model, DEFAULT_GEMINI_TEXT_MODEL);
});

test("withSafeCta: a CTA that doesn't mention the basket gets the known-good phrase", async () => {
  const { withSafeCta } = await import("../src/llm.js");
  assert.equal(withSafeCta({ cta: "ဝါးနီလေးကိုနှိပ်ပြီးဝယ်လိုက်ပါ" }, "my").cta, "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လို့ရပါတယ်ရှင့်");
  // an order ("buy it!") becomes a polite invitation; a polite one is kept
  assert.equal(withSafeCta({ cta: "အောက်က ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါနော်။" }, "my").cta, "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လို့ရပါတယ်ရှင့်");
  assert.equal(withSafeCta({ cta: "ခြင်းဝါလေးကို နှိပ်ပြီး အခုပဲ ဝယ်လိုက်တော့နော်။" }, "my", "drama").cta, "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လို့ရပါတယ်နော်");
  assert.equal(withSafeCta({ cta: "ခြင်းဝါလေးကို နှိပ်ပြီး မှာယူလို့ရပါတယ်ရှင့်" }, "my").cta, "ခြင်းဝါလေးကို နှိပ်ပြီး မှာယူလို့ရပါတယ်ရှင့်");
  assert.equal(withSafeCta({ cta: "สั่งเลย" }, "th").cta, "กดตะกร้าเหลืองได้เลย");
});

test("pricing: tokens, per-second video, per image, dated price changes and unknown models", async () => {
  const { priceUsage, estimateClipUsd } = await import("../src/pricing.js");
  const nov = new Date("2026-11-25T00:00:00Z"), jan = new Date("2027-01-02T00:00:00Z");
  // 1000 in + 500 out on gemini-3.6-flash: (1000 × 0.75 + 500 × 3.75) / 1M
  assert.deepEqual(priceUsage({ kind: "script", model: "gemini-3.6-flash", input_tokens: 1000, output_tokens: 500 }, nov), { usd: 0.002625, priced: true });
  assert.equal(priceUsage({ kind: "script", model: "gemini-3.6-flash", input_tokens: 1000, output_tokens: 500 }, jan).usd, 0.00525);
  // TTS without usage → 25 audio tokens per second
  assert.equal(priceUsage({ kind: "tts", model: "gemini-3.8-flash-tts", seconds: 10 }, nov).usd, 0.00225);
  assert.equal(estimateClipUsd({ provider: "gemini", model: "gemini-omni-1.2-flash", seconds: 10, resolution: "720p" }), 0.695);
  assert.equal(estimateClipUsd({ provider: "seedance", model: "dreamina-x", seconds: 10, resolution: "480p" }), 1.03);
  assert.equal(priceUsage({ kind: "image", model: "gemini-3.1-flash-image", images: 3 }).usd, 0.201);
  assert.deepEqual(priceUsage({ kind: "script", model: "some-new-model", input_tokens: 9 }), { usd: 0, priced: false });
});

test("usage: withUsage context is attached to reported rows and sent to the sink", async () => {
  const { withUsage, reportUsage, setUsageSink, geminiTokens } = await import("../src/usage.js");
  const rows = [];
  setUsageSink((r) => rows.push(r));
  await withUsage({ userId: 5 }, () => withUsage({ productId: 37 }, async () => {
    await new Promise((r) => setTimeout(r, 1));
    reportUsage({ kind: "image", provider: "gemini", model: "gemini-3.1-flash-image", images: 1 });
  }));
  reportUsage({ kind: "tts", provider: "gemini", model: "gemini-3.8-flash-tts", output_tokens: 250 });
  await new Promise((r) => setTimeout(r, 5));
  setUsageSink(null);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].userId, rows[0].productId, rows[0].usd], [5, 37, 0.067]);
  assert.equal(rows[1].userId, undefined);
  assert.deepEqual(geminiTokens({ total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 5 }), { input_tokens: 10, output_tokens: 25 });
});

test("script formats: the prompt asks for the format; a drama keeps who says each line", async () => {
  const { buildScriptPrompt, parseScript, SCRIPT_FORMATS } = await import("../src/llm.js");
  const { buildShotRequest } = await import("../src/flow-prompt.js");
  assert.deepEqual(SCRIPT_FORMATS, ["voiceover", "presenter", "drama", "montage"]);
  const p = { title: "Mini fan", description: "USB, 3 speeds" };
  assert.match(buildScriptPrompt(p, "my", 10, "auto", "drama"), /MINI DRAMA[\s\S]*"speakers"/);
  assert.match(buildScriptPrompt(p, "th", 10, "auto", "presenter"), /TALKING PRESENTER/);
  assert.match(buildScriptPrompt(p, "th", 10, "auto", "montage"), /GRAPHIC MONTAGE/);
  assert.doesNotMatch(buildScriptPrompt(p, "th", 10), /Format:|speakers/);
  const s = parseScript('{"hook":"h","lines":["a","","b"],"speakers":["B","A","x"],"captions":["","",""],"cta":"c"}');
  assert.deepEqual([s.lines, s.speakers], [["a", "b"], ["B", "A"]]);
  assert.equal(parseScript('{"hook":"h","lines":["a"],"cta":"c"}').speakers, undefined);
  // the hook repeated as line 1 is dropped (with its speaker)
  const r = parseScript('{"hook":"ပူလိုက်တာ။","lines":["ပူလိုက်တာ","b"],"speakers":["A","B"],"cta":"c"}');
  assert.deepEqual([r.lines, r.speakers], [["b"], ["B"]]);
  const shots = buildShotRequest(p, { format: "drama", script: { hook: "h", lines: ["a"], speakers: ["B"], cta: "c" } });
  assert.match(shots, /line 1 \(B\): a/);
  assert.match(shots, /two local friends/);
});
