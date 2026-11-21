#!/bin/sh
# Start the local VoxCPM2 voice server with the saved AI voices (tools/voxcpm-make-voice.mjs made them).
#   npm run voice                 → ~/voxcpm/voices/{th,my}-seed42.wav
#   VOICE_SEED=7 npm run voice    → another saved voice
V="${VOICE_DIR:-$HOME/voxcpm/voices}"; S="${VOICE_SEED:-42}"
for l in th my; do
  U=$(echo $l | tr a-z A-Z)
  if [ -f "$V/$l-seed$S.wav" ]; then
    export "VOXCPM_REF_WAV_$U=$V/$l-seed$S.wav" "VOXCPM_REF_TEXT_$U=$(cat "$V/$l-seed$S.txt")"
  fi
done
exec "${VOXCPM_PYTHON:-$HOME/voxcpm/.venv/bin/python}" -u "$(dirname "$0")/voxcpm-server.py"
