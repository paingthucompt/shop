import test from "node:test";
import assert from "node:assert/strict";
import { parseId, parseLangs, parseStyle, parseAngle, isShopeeUrl, publicError } from "../src/validate.js";

test("parseStyle: product by default, presenter allowed, junk rejected", () => {
  assert.equal(parseStyle(undefined), "product");
  assert.equal(parseStyle("presenter"), "presenter");
  assert.equal(parseStyle("in_action"), "in_action");
  assert.throws(() => parseStyle("cartoon"), (e) => e.status === 400);
});

test("parseAngle: auto by default, known angles allowed, junk rejected", () => {
  assert.equal(parseAngle(undefined), "auto");
  assert.equal(parseAngle("problem_solution"), "problem_solution");
  assert.throws(() => parseAngle("fake_testimonial"), (e) => e.status === 400);
});
import { validateScript, clampScript, SCRIPT_LIMITS, foreignScriptIssue, truncateText } from "../src/script-rules.js";
import { shortName, generateScript } from "../../../packages/providers/src/llm.js";

// a real product title from manual testing (long, Thai, no Myanmar)
const THAI_TITLE = "พัดลมมือถือ ปรับระดับได้ 100 พัดลมไร้สา ระดับ ประคบเย็นและลดอุณหูมิลง จอแสดงผล LED พัดลมพกพาไม่มีใบมีด ชาร์จใหม่ได้";

test("a Myanmar script with Thai text is rejected (and vice versa); Latin brand names are fine", () => {
  assert.match(foreignScriptIssue("my", { hook: "พัดลม ကို စမ်းကြည့်ပါ", lines: ["a"], cta: "c" }), /Myanmar script contains Thai/);
  assert.match(foreignScriptIssue("th", { hook: "h", lines: ["ဗူးဖွင့်"], cta: "c" }), /Thai script contains Myanmar/);
  assert.equal(foreignScriptIssue("my", { hook: "RGB Keyboard IPX8 ကို စမ်းကြည့်ပါ", lines: ["a"], cta: "c" }), null);
  assert.match(validateScript({ hook: "พัดลม", lines: ["a"], cta: "c" }, "my").error, /Thai/);
});

test("captions stay aligned with lines; empty line drops its caption; limits + language checked", () => {
  const { script } = validateScript({ hook: "h", lines: ["a", " ", "c"], captions: ["A", "lost", ""], cta: "x" }, "th");
  assert.deepEqual(script.lines, ["a", "c"]);
  assert.deepEqual(script.captions, ["A", ""]);
  // missing captions → one "" per line
  assert.deepEqual(validateScript({ hook: "h", lines: ["a", "b"], cta: "x" }).script.captions, ["", ""]);
  assert.match(validateScript({ hook: "h", lines: ["a"], captions: ["x".repeat(61)], cta: "x" }).error, /on-screen text/);
  assert.match(validateScript({ hook: "h", lines: ["a"], captions: "nope", cta: "x" }).error, /captions/);
  assert.match(validateScript({ hook: "h", lines: ["a"], captions: ["พัดลม"], cta: "x" }, "my").error, /Thai/);
  const clamped = clampScript({ hook: "h", lines: Array(8).fill("l"), captions: ["c".repeat(99)], cta: "x" });
  assert.equal(clamped.captions.length, clamped.lines.length);
  assert.ok(clamped.captions[0].length <= SCRIPT_LIMITS.caption);
});

test("truncateText never cuts inside a Thai/Myanmar word", () => {
  const t = truncateText(THAI_TITLE, 80);
  assert.ok(t.length <= 80);
  assert.ok(THAI_TITLE.startsWith(t));
  const words = new Set(Array.from(new Intl.Segmenter("th", { granularity: "word" }).segment(THAI_TITLE), (s) => s.index + s.segment.length));
  assert.ok(words.has(t.length) || words.has(t.length + 1), `cut at a word boundary: …${t.slice(-10)}`);
  assert.equal(truncateText("short", 80), "short");
});

test("mock scripts never put a Thai title into the Myanmar script", async () => {
  delete process.env.LLM_API_KEY;
  const my = await generateScript({ title: THAI_TITLE }, "my");
  assert.equal(foreignScriptIssue("my", my), null);
  const th = await generateScript({ title: THAI_TITLE }, "th");
  assert.ok(th.hook.length <= 40, th.hook);
  assert.equal(shortName("RGB Mechanical Keyboard", "my"), "RGB");
  assert.equal(shortName(THAI_TITLE, "my"), "");
});

test("parseId accepts positive integers only", () => {
  assert.equal(parseId("42"), 42);
  for (const bad of ["abc", "0", "-1", "1.5", "", undefined, "9007199254740993"]) {
    assert.throws(() => parseId(bad), (e) => e.status === 400, String(bad));
  }
});

test("parseLangs: default both, dedupe, reject junk", () => {
  assert.deepEqual(parseLangs(undefined), ["th", "my"]);
  assert.deepEqual(parseLangs(["my", "my", "xx"]), ["my"]);
  assert.deepEqual(parseLangs("th,my"), ["th", "my"]);
  assert.throws(() => parseLangs({ th: true }), (e) => e.status === 400);
  assert.throws(() => parseLangs(["en"]), (e) => e.status === 400);
});

test("isShopeeUrl only trusts real Shopee hosts over https", () => {
  for (const ok of ["https://shopee.co.th/item-i.1.2", "https://shopee.com.my/x", "https://shopee.vn/x", "https://shp.ee/abc"]) {
    assert.equal(isShopeeUrl(ok), true, ok);
  }
  for (const bad of ["https://evil.com/?shopee.co.th", "https://shopee.co.th.evil.com/", "http://shopee.co.th/x", "javascript:alert(1)", "not a url"]) {
    assert.equal(isShopeeUrl(bad), false, bad);
  }
});

test("publicError hides internal details", () => {
  const msg = publicError("video-engine exited 1: /Users/x/storage/jobs/9/work … ffmpeg failed");
  assert.equal(msg, "Video rendering failed.");
  assert.doesNotMatch(msg, /storage|ffmpeg/);
  assert.match(publicError("Seedance task failed: content policy"), /Seedance/);
});

test("validateScript trims, drops empty lines and enforces limits", () => {
  const { script } = validateScript({ hook: "  h ", lines: ["a", " ", " b  c "], cta: "c" });
  assert.deepEqual(script, { hook: "h", lines: ["a", "b c"], captions: ["", ""], cta: "c" });
  assert.match(validateScript({ hook: "h", lines: [], cta: "c" }).error, /required/);
  assert.match(validateScript({ hook: "x".repeat(SCRIPT_LIMITS.hook + 1), lines: ["a"], cta: "c" }).error, /hook/);
  assert.match(validateScript({ hook: "h", lines: Array(SCRIPT_LIMITS.maxLines + 1).fill("a"), cta: "c" }).error, /too many/);
  assert.match(validateScript({ hook: "h", lines: ["x".repeat(SCRIPT_LIMITS.line + 1)], cta: "c" }).error, /line/);
});

test("clampScript bounds runaway LLM output", () => {
  const s = clampScript({ hook: "h".repeat(500), lines: Array(20).fill("l".repeat(500)), cta: "c" });
  assert.equal(s.hook.length, SCRIPT_LIMITS.hook);
  assert.equal(s.lines.length, SCRIPT_LIMITS.maxLines);
  assert.ok(s.lines.every((l) => l.length === SCRIPT_LIMITS.line));
});
