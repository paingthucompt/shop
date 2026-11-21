#!/usr/bin/env python3
"""
Local VoxCPM2 voice server for the video engine (TTS_PROVIDER=voxcpm / TTS_PROVIDER_MY=voxcpm).

  POST /tts  {"text": "...", "lang": "my"}  →  audio/wav (48 kHz mono)
  GET  /health                               →  {"ok": true, "voice": "clone" | "design"}

Voice (environment variables):
  VOXCPM_REF_WAV    a 10–30 s voice recording (WAV/MP3) → cloned voice. Only use a voice you have the right
                    to use: your own, or one VoxCPM designed for you (tools/voxcpm-make-voice.mjs).
  VOXCPM_REF_TEXT   optional exact transcript of VOXCPM_REF_WAV → "ultimate" cloning (closest match)
  VOXCPM_REF_WAV_TH / _MY, VOXCPM_REF_TEXT_TH / _MY   the same per language (override the two above)
  VOXCPM_VOICE      voice description when no VOXCPM_REF_WAV is set (voice design)
  VOXCPM_STYLE      delivery note put in front of every line (default: warm, upbeat seller)
  VOXCPM_DEVICE     auto | mps | cpu   (auto = Apple GPU when available)
  VOXCPM_PORT       default 8808

Setup (Python 3.10–3.12):  uv venv --python 3.12 ~/voxcpm/.venv && VIRTUAL_ENV=~/voxcpm/.venv uv pip install voxcpm soundfile
Run:                        ~/voxcpm/.venv/bin/python tools/voxcpm-server.py
The model (~5 GB) is downloaded from Hugging Face on the first start.
"""
import io
import json
import os
import random
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
import torch
from voxcpm import VoxCPM

PORT = int(os.environ.get("VOXCPM_PORT", "8808"))
def ref_for(lang):
    """(reference wav, transcript) for a language: VOXCPM_REF_WAV_MY beats VOXCPM_REF_WAV"""
    up = lang.upper()
    wav = os.environ.get(f"VOXCPM_REF_WAV_{up}") or os.environ.get("VOXCPM_REF_WAV") or None
    text = os.environ.get(f"VOXCPM_REF_TEXT_{up}") if os.environ.get(f"VOXCPM_REF_WAV_{up}") else os.environ.get("VOXCPM_REF_TEXT")
    return wav, (text or None)


REFS = {l: ref_for(l) for l in ("th", "my")}
DEFAULT_VOICE = {
    "my": "A young Burmese woman in her twenties, warm, friendly and upbeat voice, natural Yangon accent",
    "th": "A young Thai woman in her twenties, warm, friendly and upbeat voice, natural Bangkok accent",
}
STYLE = os.environ.get("VOXCPM_STYLE", "natural, lively and conversational like a social-media seller talking to a friend, slightly fast")

for _l, (_wav, _) in REFS.items():
    if _wav and not os.path.exists(_wav):
        raise SystemExit(f"reference voice for {_l} not found: {_wav}")

print("loading VoxCPM2 (first run downloads ~5 GB)…", flush=True)
kwargs = {"load_denoiser": False}
if os.environ.get("VOXCPM_DEVICE"):
    kwargs["device"] = os.environ["VOXCPM_DEVICE"]
try:
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", **kwargs)
except TypeError:  # older voxcpm without a device argument
    kwargs.pop("device", None)
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", **kwargs)
RATE = model.tts_model.sample_rate
lock = threading.Lock()  # one generation at a time: the model is not thread-safe


def synthesize(text: str, lang: str, seed=None, design=False) -> bytes:
    ref_wav, ref_text = REFS.get(lang) or ref_for(lang)
    if ref_wav and not design:
        # cloning: the voice comes from the reference; the parentheses only steer delivery
        if ref_text:
            # "ultimate" cloning continues the reference recording: a "(style)" note would be read aloud
            args = {"text": text, "reference_wav_path": ref_wav, "prompt_wav_path": ref_wav, "prompt_text": ref_text}
        else:
            args = {"text": f"({STYLE}){text}", "reference_wav_path": ref_wav}
    else:
        voice = os.environ.get("VOXCPM_VOICE") or DEFAULT_VOICE.get(lang, DEFAULT_VOICE["my"])
        args = {"text": f"({voice}, {STYLE}){text}"}
    with lock:
        if seed is not None:  # voxcpm 2.0.x has no seed argument: seed the RNGs it samples from
            random.seed(int(seed)); np.random.seed(int(seed)); torch.manual_seed(int(seed))
        wav = model.generate(**args, cfg_value=2.0, inference_timesteps=10)
    buf = io.BytesIO()
    sf.write(buf, wav, RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            voices = {l: ("clone" if w else "design") for l, (w, _) in REFS.items()}
            self._send(200, json.dumps({"ok": True, "voice": voices, "sample_rate": RATE}).encode())
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        if self.path != "/tts":
            return self._send(404, b'{"error":"not found"}')
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            text = str(req.get("text") or "").strip()
            if not text:
                return self._send(400, b'{"error":"text is required"}')
            audio = synthesize(text, str(req.get("lang") or "my"), req.get("seed"), bool(req.get("design")))
            self._send(200, audio, "audio/wav")
        except Exception as e:  # report instead of dropping the connection
            self._send(500, json.dumps({"error": str(e)[:300]}).encode())

    def log_message(self, fmt, *args):
        print("[voxcpm]", fmt % args, flush=True)


if __name__ == "__main__":
    # localhost only: this server has no authentication
    kinds = ", ".join(f"{l}: {'cloned' if w else 'designed'} voice" for l, (w, _) in REFS.items())
    print(f"VoxCPM2 ready on http://127.0.0.1:{PORT} ({kinds})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
