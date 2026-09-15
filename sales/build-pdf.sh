#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-first-run \
  --no-pdf-header-footer \
  --hide-scrollbars \
  --virtual-time-budget=12000 \
  --run-all-compositor-stages-before-draw \
  --print-to-pdf="$ROOT/2wel-leave-behind.pdf" \
  "file://$ROOT/2wel-leave-behind.html"
echo "Wrote $ROOT/2wel-leave-behind.pdf"
