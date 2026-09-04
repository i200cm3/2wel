#!/bin/bash

set -e

DEPLOY=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--deploy" ]; then
    DEPLOY=1
  else
    ARGS+=("$arg")
  fi
done

# По умолчанию — VDS-прослойка ElevenLabs
REMOTE="${ARGS[0]:-vitaliy@156.229.27.67}"
REMOTE_DIR="${ARGS[1]:-/home/vitaliy/elevenlabs-proxy}"

if ! command -v rsync >/dev/null 2>&1; then
  echo "Ошибка: rsync не установлен. Установите: brew install rsync"
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Ошибка: ssh не установлен"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SSH_CONTROL_PATH="/tmp/elevenlabs-proxy-%C"
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

ensure_remote_rsync() {
  if ssh_cmd "command -v rsync >/dev/null 2>&1"; then
    return 0
  fi
  echo "На VDS нет rsync — пробую установить..."
  if ssh_cmd "command -v apt-get >/dev/null 2>&1"; then
    ssh_cmd "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y rsync"
    return 0
  fi
  if ssh_cmd "command -v yum >/dev/null 2>&1"; then
    ssh_cmd "sudo yum install -y rsync"
    return 0
  fi
  return 1
}

sync_via_tar() {
  echo "Копирую через tar+ssh (rsync на VDS недоступен)..."
  ssh_cmd "mkdir -p '$REMOTE_DIR' && find '$REMOTE_DIR' -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf {} +"
  TAR_EXTRA=()
  tar --help 2>/dev/null | grep -q -- '--no-xattrs' && TAR_EXTRA+=(--no-xattrs)
  tar --help 2>/dev/null | grep -q -- '--disable-copyfile' && TAR_EXTRA+=(--disable-copyfile)
  COPYFILE_DISABLE=1 tar czf - "${TAR_EXTRA[@]}" \
    -C "$PROJECT_DIR" \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='._*' \
    . | ssh "${SSH_OPTS[@]}" -o ConnectTimeout=15 "$REMOTE" "tar xzf - -C '$REMOTE_DIR'"
}

sync_files() {
  if ensure_remote_rsync 2>/dev/null && ssh_cmd "command -v rsync >/dev/null 2>&1"; then
    rsync -avz \
      --delete \
      --progress \
      -e "$(rsync_ssh)" \
      --exclude '.git' \
      --exclude '.DS_Store' \
      --exclude '**/.DS_Store' \
      --exclude '.env.local' \
      --exclude '.env.*.local' \
      "$PROJECT_DIR/" "$REMOTE:$REMOTE_DIR/"
    return 0
  fi
  sync_via_tar
}

echo "=========================================="
echo "Синхронизация ElevenLabs proxy на VDS"
echo "=========================================="
echo "Источник:     $PROJECT_DIR"
echo "Назначение:   $REMOTE:$REMOTE_DIR"
echo ""

if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "Локального .env нет — создаю из .env.example"
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  echo "Заполните $PROJECT_DIR/.env и запустите снова."
  exit 1
fi

echo "Подключаюсь к VDS (пароль спросят один раз)..."
if ! ssh_cmd "echo 'Подключение успешно'"; then
  echo "Ошибка: не удалось подключиться к $REMOTE"
  exit 1
fi

echo "Создаю директорию на VDS..."
ssh_cmd "mkdir -p '$REMOTE_DIR'"

echo "Синхронизирую файлы..."
sync_files

if [ -f "$PROJECT_DIR/.env" ]; then
  echo "Скопирован .env (локальный перезаписывает версию на VDS)."
else
  echo "Локального .env нет — на VDS остаётся прежний."
fi

if [ "$DEPLOY" = 1 ]; then
  echo ""
  echo "=========================================="
  echo "Запускаю ./deploy.sh на VDS"
  echo "=========================================="
  echo ""
  ssh_cmd "cd '$REMOTE_DIR' && chmod +x ./deploy.sh && ./deploy.sh"
  echo ""
  echo "=========================================="
  echo "Синхронизация и деплой завершены!"
  echo "=========================================="
  echo ""
  echo "Прокси: http://156.229.27.67:3099/v1/synthesize"
  echo "На 2wel.ru: ELEVENLABS_PROXY_URL=http://156.229.27.67:3099"
  echo ""
  exit 0
fi

echo ""
echo "=========================================="
echo "Синхронизация завершена!"
echo "=========================================="
echo ""
echo "На VDS: $REMOTE_DIR"
echo ""
echo "Деплой:"
echo "  ./deploy-to-vds.sh"
echo "  или: $0 --deploy"
echo ""
echo "SSH-ключ (чтобы не вводить пароль):"
echo "  ssh-copy-id vitaliy@156.229.27.67"
echo ""
