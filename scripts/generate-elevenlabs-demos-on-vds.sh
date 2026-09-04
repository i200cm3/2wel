#!/bin/bash
# Генерация MP3 на VDS и копирование в web/public.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${1:-vitaliy@156.229.27.67}"
REMOTE_DIR="${2:-/home/vitaliy/elevenlabs-proxy}"

echo "1/3 Синхронизация и перезапуск прокси на VDS (network_mode: host)..."
"$ROOT/elevenlabs-proxy/sync-to-vds.sh" --deploy "$REMOTE" "$REMOTE_DIR"

echo ""
echo "2/3 Генерация демо на VDS (docker run --network host → ElevenLabs API)..."
ssh "$REMOTE" "set -e
  cd '$REMOTE_DIR'
  rm -rf demo-output
  mkdir -p demo-output

  IMAGE='elevenlabs-proxy-elevenlabs-proxy:latest'
  docker run --rm --network host \
    -v \"\$(pwd)/demo-output:/out\" \
    --env-file .env \
    \"\$IMAGE\" \
    node generate-demos.mjs --output /out --force || true

  COUNT=\$(ls -1 demo-output/*.mp3 2>/dev/null | wc -l | tr -d ' ')
  echo \"MP3 файлов: \$COUNT\"
  if [ \"\$COUNT\" -eq 0 ]; then
    echo 'Нет ни одного MP3 — прерываю' >&2
    exit 1
  fi
"

echo ""
echo "3/3 Копирование MP3 в проект..."
"$ROOT/scripts/pull-elevenlabs-demos-from-vds.sh" "$REMOTE" "$REMOTE_DIR/demo-output"

echo ""
echo "Готово. Демо: web/public/media/tts/demos/elevenlabs/"
