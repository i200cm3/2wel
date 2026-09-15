#!/usr/bin/env bash
# rsync gigaam-transcribe на любой сервер (+ опционально --deploy).
set -euo pipefail

DEPLOY=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--deploy" ]; then
    DEPLOY=1
  else
    ARGS+=("$arg")
  fi
done

REMOTE="${ARGS[0]:-vitaliy@192.168.2.6}"
REMOTE_DIR="${ARGS[1]:-/home/vitaliy/gigaam-transcribe}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Ошибка: rsync не установлен. Установите: brew install rsync"
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Ошибка: ssh не установлен"
  exit 1
fi

SSH_CONTROL_PATH="/tmp/gigaam-transcribe-%C"
SSH_OPTS=(
  -o "ControlPath=${SSH_CONTROL_PATH}"
  -o ControlMaster=auto
  -o ControlPersist=600
  -o ServerAliveInterval=30
)

cleanup_ssh() {
  ssh "${SSH_OPTS[@]}" -O exit "$REMOTE" 2>/dev/null || true
}
trap cleanup_ssh EXIT INT TERM

ssh_cmd() {
  ssh "${SSH_OPTS[@]}" -o ConnectTimeout=15 "$REMOTE" "$@"
}

rsync_ssh() {
  printf 'ssh'
  printf ' -o ControlPath=%s' "$SSH_CONTROL_PATH"
  printf ' -o ControlMaster=auto'
  printf ' -o ControlPersist=600'
  printf ' -o ServerAliveInterval=30'
}

echo "=========================================="
echo "Синхронизация GigaAM transcribe"
echo "=========================================="
echo "Источник:     $PROJECT_DIR"
echo "Назначение:   $REMOTE:$REMOTE_DIR"
echo ""

echo "Подключаюсь..."
if ! ssh_cmd "echo 'Подключение успешно'"; then
  echo "Ошибка: не удалось подключиться к $REMOTE"
  exit 1
fi

ssh_cmd "mkdir -p '$REMOTE_DIR'"

echo "Синхронизирую файлы..."
rsync -avz \
  --delete \
  --progress \
  -e "$(rsync_ssh)" \
  --exclude '.env' \
  --exclude 'cache/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '.DS_Store' \
  --exclude '**/.DS_Store' \
  --exclude '.git' \
  --exclude 'samples/*.mp3' \
  "$PROJECT_DIR/" "$REMOTE:$REMOTE_DIR/"

echo ""
echo ".env и cache/ на сервере не трогаем (модели остаются на месте)."

if [ "$DEPLOY" = 1 ]; then
  echo ""
  echo "=========================================="
  echo "Запускаю ./deploy.sh на сервере"
  echo "=========================================="
  ssh_cmd "cd '$REMOTE_DIR' && chmod +x ./deploy.sh && ./deploy.sh"
  echo ""
  echo "Готово. В .env 2wel:"
  echo "  GIGAAM_TRANSCRIBE_URL=http://HOST:3200"
  echo "  GIGAAM_TRANSCRIBE_SECRET=тот_же_что_в_gigaam/.env"
  exit 0
fi

echo ""
echo "Синхронизация завершена."
echo "Деплой: $0 --deploy $REMOTE $REMOTE_DIR"
echo "Или на сервере: cd $REMOTE_DIR && ./deploy.sh"
