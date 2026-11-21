#!/usr/bin/env node
// Make a fixed AI reference voice per language with the running VoxCPM2 server (voice design + a fixed
// seed), so every later line is CLONED from the same voice and sounds consistent. The voice is
// VoxCPM's own design, not a real person.
//
//   node tools/voxcpm-make-voice.mjs [outDir=~/voxcpm/voices] [seed=42] [langs=th,my]
// then start the server with VOXCPM_REF_WAV_TH / _MY and VOXCPM_REF_TEXT_TH / _MY (printed at the end).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] || join(homedir(), "voxcpm", "voices"));
const seed = Number(process.argv[3] || 42);
const langs = (process.argv[4] || "th,my").split(",");
const base = (process.env.VOXCPM_URL || "http://127.0.0.1:8808").replace(/\/$/, "");

// ~10–12 s of neutral, natural seller talk (no product claims) — the clone copies its timbre and pace
const TEXT = {
  th: "สวัสดีค่ะ วันนี้จะมาแนะนำของใช้ในบ้านชิ้นเล็กๆ ที่ใช้ง่ายมาก ราคาก็ไม่แพง ใครกำลังมองหาอยู่ ลองดูกันเลยค่ะ",
  my: "မင်္ဂလာပါရှင်။ ဒီနေ့ အိမ်မှာ အသုံးဝင်တဲ့ ပစ္စည်းလေးတစ်ခုကို မိတ်ဆက်ပေးချင်ပါတယ်။ သုံးရတာလည်း လွယ်ပြီး ဈေးလည်း သင့်တင့်ပါတယ်။",
};

mkdirSync(outDir, { recursive: true });
const env = [];
for (const lang of langs) {
  if (!TEXT[lang]) throw new Error(`no reference text for ${lang}`);
  const res = await fetch(`${base}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: TEXT[lang], lang, seed, design: true }),
  });
  if (!res.ok) throw new Error(`VoxCPM ${res.status}: ${await res.text()}`);
  const wav = join(outDir, `${lang}-seed${seed}.wav`);
  writeFileSync(wav, Buffer.from(await res.arrayBuffer()));
  writeFileSync(wav.replace(/\.wav$/, ".txt"), TEXT[lang]);
  console.log(`${lang}: ${wav}`);
  env.push(`VOXCPM_REF_WAV_${lang.toUpperCase()}=${wav}`, `VOXCPM_REF_TEXT_${lang.toUpperCase()}="${TEXT[lang]}"`);
}
console.log(`\nListen to them; if you like a voice, start the server with:\n${env.join("\n")}`);
