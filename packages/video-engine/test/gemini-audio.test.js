import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiAudio, parseAudioMime, wavHeader } from "../gemini-audio.js";

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

test("parseAudioMime: raw PCM with rate and channels", () => {
  assert.deepEqual(parseAudioMime("audio/L16;codec=pcm;rate=24000"), { base: "audio/l16", rate: 24000, channels: 0, pcm: true });
  assert.equal(parseAudioMime("audio/wav").pcm, false);
});

test("wavHeader: 44-byte RIFF header with sizes, rate and channels", () => {
  const h = wavHeader(1000, 24000, 1);
  assert.equal(h.length, 44);
  assert.equal(h.toString("ascii", 0, 4), "RIFF");
  assert.equal(h.readUInt32LE(4), 1036);
  assert.equal(h.readUInt32LE(24), 24000);
  assert.equal(h.readUInt32LE(28), 48000);
  assert.equal(h.readUInt32LE(40), 1000);
});

test("geminiAudio: PCM blocks are joined in order and wrapped as WAV", () => {
  const it = { steps: [{ content: [
    { type: "audio", mime_type: "audio/L16;rate=16000", data: b64([1, 2]) },
    { type: "text", text: "x" },
    { type: "audio", mime_type: "audio/L16;rate=16000", data: b64([3, 4]) },
  ] }] };
  const { audio, ext } = geminiAudio(it);
  assert.equal(ext, "wav");
  assert.equal(audio.readUInt32LE(24), 16000);
  assert.deepEqual([...audio.subarray(44)], [1, 2, 3, 4]);
});

test("geminiAudio: a WAV block is passed through; no audio → null; mixed formats throw", () => {
  const wav = Buffer.concat([wavHeader(2), Buffer.from([9, 9])]);
  assert.deepEqual(geminiAudio({ steps: [{ content: [{ type: "audio", mime_type: "audio/wav", data: wav.toString("base64") }] }] }).audio, wav);
  assert.equal(geminiAudio({ steps: [] }), null);
  assert.throws(() => geminiAudio([{ type: "audio", mime_type: "audio/wav", data: "" }, { type: "audio", mime_type: "audio/L16", data: "" }]));
});
