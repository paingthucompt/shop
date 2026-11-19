import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { renderVideo, buildConfig, makePhotoClip, buildPhotoClipArgs } from "../index.js";
import { planShots, SHOT_SECONDS } from "../photo-clip.js";

test("photo clip shot plan: full/detail alternation, ~2.2s cuts, ends on a full shot", () => {
  const one = planShots(1, 16);
  assert.equal(one.length, Math.round(16 / SHOT_SECONDS));
  assert.deepEqual(one.map((s) => s.type), ["full", "detail", "full", "detail", "full", "detail", "full"]);
  assert.ok(one.every((s) => s.photo === 0));
  const many = planShots(3, 13.2); // 6 shots
  assert.deepEqual(many.map((s) => s.photo), [0, 0, 1, 1, 2, 2]);
  assert.equal(many.at(-1).type, "full");
  assert.ok(Math.abs(many.reduce((a, s) => a + s.seconds, 0) - 13.2) < 1e-9);
  assert.equal(planShots(9, 10).filter((s) => s.photo > 3).length, 0); // max 4 photos
});

test("photo clip args: one input per shot, hard-cut concat, exact length", () => {
  const args = buildPhotoClipArgs({ images: ["a.jpg", "b.png"], out: "o.mp4", duration: 10 });
  const shots = planShots(2, 10).length;
  assert.equal(args.filter((a) => a === "-i").length, shots);
  const fc = args[args.indexOf("-filter_complex") + 1];
  assert.match(fc, new RegExp(`concat=n=${shots}:v=1:a=0`));
  assert.equal(args[args.lastIndexOf("-t") + 1], "10.000"); // output length (detail inputs have their own -t)
  assert.throws(() => buildPhotoClipArgs({ images: [], out: "o.mp4" }));
});

test("buildConfig passes on-screen captions per line (empty → none)", () => {
  const c = buildConfig({ clipPath: "a.mp4", outPath: "b.mp4", lang: "my", script: { hook: "h", lines: ["one", "two"], captions: ["ONE", " "], cta: "c" } });
  assert.deepEqual(c.lines, [{ my: "one", caption: "ONE" }, { my: "two" }]);
});

test("buildConfig speaks the hook and fits the video to the voice by default", () => {
  const c = buildConfig({ clipPath: "a.mp4", outPath: "b.mp4", lang: "th", script: { hook: "h", lines: ["x"], cta: "c" } });
  assert.equal(c.hook.speak, true);
  assert.equal(c.fitToVoice, true);
});

test("photo clip renders a 9:16 video of the requested length from photos", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-"));
  const photos = [0, 1].map((i) => {
    const p = join(dir, `p${i}.jpg`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(2 + i * 4), "-i", SAMPLE, "-frames:v", "1", p]);
    return p;
  });
  const out = await makePhotoClip({ images: photos, out: join(dir, "clip.mp4"), duration: 8 });
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", out]).toString();
  const j = JSON.parse(probe);
  assert.equal(j.streams[0].width, 720);
  assert.equal(j.streams[0].height, 1280);
  assert.ok(Math.abs(Number(j.format.duration) - 8) < 0.2, `duration ${j.format.duration}`);
});

const SAMPLE = resolve(import.meta.dirname, "../../../samples/sample-product-clip.mp4");

test("buildConfig is single-language", () => {
  const c = buildConfig({ clipPath: "a.mp4", outPath: "b.mp4", lang: "my", script: { hook: "h", lines: ["x"], cta: "c" } });
  assert.deepEqual(c.languages, ["my"]);
  assert.equal(c.voices.my, "my-MM-NilarNeural");
  assert.equal(c.lines[0].th, undefined);
});

for (const lang of ["th", "my"]) {
  test(`renders ${lang} video (no TTS)`, { timeout: 120_000 }, async () => {
    process.env.TTS_PROVIDER = "none";
    const dir = mkdtempSync(join(tmpdir(), "ve-"));
    const script = lang === "th"
      ? { hook: "คีย์บอร์ดเสียงดีมาก!", lines: ["กดแล้วเสียงนุ่ม พิมพ์เพลิน", "มีไฟ RGB กันน้ำ IPX8"], cta: "กดตะกร้าเหลืองได้เลย" }
      : { hook: "အသံကောင်းတဲ့ ကီးဘုတ်!", lines: ["နှိပ်ရတာ အသံညက်ပြီး ရိုက်ရတာကောင်းတယ်", "RGB မီးပါပြီး IPX8 ရေစိုခံပါတယ်"], cta: "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါ" };
    const r = await renderVideo({ workDir: dir, clipPath: SAMPLE, outPath: join(dir, "out.mp4"), lang, script });
    assert.equal(r.lang, lang);
    assert.ok(existsSync(r.path) && r.path.endsWith(`-${lang}.mp4`));
    assert.ok(r.duration > 5);
  });
}
