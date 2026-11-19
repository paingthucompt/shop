import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildAuthorization } from "../src/shopee.js";
import { buildCreateBody, buildProductPrompt } from "../src/seedance.js";
import { parseScript, buildScriptPrompt, generateScript } from "../src/llm.js";

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
