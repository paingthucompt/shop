// Gemini TTS response → playable audio bytes.
// Same handling as Google's gemini-api CLI (Apache-2.0, internal/cli/custom/tts.go + wav.go):
// a reply may hold several audio blocks (joined in order), and raw PCM ("audio/L16;rate=24000")
// has no file header, so it gets a 44-byte WAV header to be playable.

/** BCP-47 hint sent in speech_config.language, per app language */
export const GEMINI_TTS_LANGUAGE = { th: "th-TH", my: "my-MM" };

/** how the voiceover is spoken in the videos (sent as a speech_metadata style note, not read aloud) */
export const GEMINI_STYLE = {
  th: "a real Thai TikTok Shop creator talking to a friend: warm, upbeat, natural and conversational, lively but not shouting, a little fast-paced",
  my: "a real Burmese (Myanmar) TikTok / Facebook seller talking to a friend: warm, upbeat, natural and conversational, lively but not shouting, a little fast-paced",
};

/** every audio block anywhere in an interaction, in document order */
function audioBlocks(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "audio" && typeof node.data === "string") out.push(node);
  else for (const v of Array.isArray(node) ? node : Object.values(node)) audioBlocks(v, out);
  return out;
}

/** "audio/L16;codec=pcm;rate=24000" → { base, rate, channels, pcm } */
export function parseAudioMime(mime = "") {
  const [base, ...params] = String(mime).split(";").map((s) => s.trim());
  const f = { base: base.toLowerCase(), rate: 0, channels: 0, pcm: false };
  for (const p of params) {
    const [k, v] = p.split("=").map((s) => s.trim().toLowerCase());
    const n = Number(v);
    if (!(n > 0)) continue;
    if (["rate", "samplerate", "sample_rate"].includes(k)) f.rate = n;
    if (["channels", "channelcount", "channel_count"].includes(k)) f.channels = n;
  }
  f.pcm = ["audio/l16", "audio/pcm", "audio/raw"].includes(f.base);
  return f;
}

/** canonical 44-byte RIFF/WAVE header for 16-bit little-endian PCM */
export function wavHeader(pcmLen, rate = 24000, channels = 1) {
  const h = Buffer.alloc(44);
  const blockAlign = channels * 2;
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcmLen, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * blockAlign, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcmLen, 40);
  return h;
}

/**
 * interaction JSON → { audio: Buffer, ext: "wav" | "mp3" | … }, or null when it holds no audio.
 * Blocks in different formats cannot be joined → throws.
 */
export function geminiAudio(interaction) {
  const blocks = audioBlocks(interaction);
  if (!blocks.length) return null;
  const mime = blocks[0].mime_type || "audio/wav";
  if (blocks.some((b) => (b.mime_type || "audio/wav") !== mime)) throw new Error("Gemini TTS returned audio blocks in different formats");
  const f = parseAudioMime(mime);
  const raw = Buffer.concat(blocks.map((b) => Buffer.from(b.data, "base64")));
  if (f.pcm) {
    const rate = f.rate || blocks[0].sample_rate || 24000;
    const channels = f.channels || blocks[0].channels || 1;
    return { audio: Buffer.concat([wavHeader(raw.length, rate, channels), raw]), ext: "wav" };
  }
  // already a container (WAV / MP3 / …): several blocks of one container can't simply be concatenated
  if (blocks.length > 1 && f.base !== "audio/mpeg") throw new Error(`Gemini TTS returned ${blocks.length} ${mime} blocks`);
  const ext = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/flac": "flac" }[f.base] || "wav";
  return { audio: raw, ext };
}
