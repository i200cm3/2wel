#!/bin/bash
# С VDS забирает demo-output/ → web/public/media/tts/demos/elevenlabs/
# На VDS нет rsync — копируем scp (один SSH, один пароль).
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${1:-vitaliy@156.229.27.67}"
REMOTE_DIR="${2:-/home/vitaliy/elevenlabs-proxy/demo-output}"
LOCAL_DIR="$ROOT/web/public/media/tts/demos/elevenlabs"

echo "Копирую демо с $REMOTE:$REMOTE_DIR → $LOCAL_DIR"
mkdir -p "$LOCAL_DIR"

scp "$REMOTE:$REMOTE_DIR/*" "$LOCAL_DIR/"

COUNT="$(ls -1 "$LOCAL_DIR"/*.mp3 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then
  echo "Ошибка: на VDS нет MP3. Сначала: ./scripts/generate-elevenlabs-demos-on-vds.sh" >&2
  exit 1
fi
echo "Готово: $COUNT mp3"
