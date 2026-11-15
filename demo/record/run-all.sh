#!/usr/bin/env bash
# One command: narration -> recording on the live site (real Mezo testnet transactions) -> final video.
#   MERCHANT_PK=0x… CUSTOMER_PK=0x… bash demo/record/run-all.sh
# MERCHANT_PK: a NEW wallet with ~0.00001 testnet BTC (it registers a store, so it must not be registered yet).
# CUSTOMER_PK: a wallet with ~0.001 testnet BTC and at least 12.50 MUSD (it pays the demo order).
# Keys stay in Node; the pages only see a provider that asks Node to sign.
# Output: demo/out/mezocommerce-demo.mp4 and .srt (work files in demo/out/work).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../out"
WORK="$OUT/work"
mkdir -p "$WORK"
cd "$HERE"
[ -d node_modules/playwright ] || npm install --no-audit --no-fund
npx playwright install chromium >/dev/null
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
if [ -n "${FORCE_TTS:-}" ] || [ ! -f "$WORK/audio/outro.json" ]; then
  .venv/bin/python tts.py "$WORK"
fi
node "$HERE/record.mjs" "$WORK"
.venv/bin/python "$HERE/assemble.py" "$WORK" "$OUT"
