#!/bin/bash
# Только генерация + pull (прокси уже задеплоен с network_mode: host).
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${1:-vitaliy@156.229.27.67}"
REMOTE_DIR="${2:-/home/vitaliy/elevenlabs-proxy}"

echo "Генерация демо на VDS..."
ssh "$REMOTE" "set -e
  cd '$REMOTE_DIR'
  rm -rf demo-output && mkdir -p demo-output
  docker run --rm --network host \
    -v \"\$(pwd)/demo-output:/out\" \
    --env-file .env \
    elevenlabs-proxy-elevenlabs-proxy:latest \
    node generate-demos.mjs --output /out --force || true
  COUNT=\$(ls -1 demo-output/*.mp3 2>/dev/null | wc -l | tr -d ' ')
  echo \"MP3: \$COUNT\"
  if [ \"\$COUNT\" -eq 0 ]; then
    echo 'Нет ни одного MP3 — прерываю' >&2
    exit 1
  fi
"

"$ROOT/scripts/pull-elevenlabs-demos-from-vds.sh" "$REMOTE" "$REMOTE_DIR/demo-output"
echo "Готово: web/public/media/tts/demos/elevenlabs/"
