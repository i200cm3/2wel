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

if [ ${#ARGS[@]} -lt 2 ]; then
  echo "Использование:"
  echo "  $0 [--deploy] user@server /path/on/server"
  echo ""
  echo "Пример:"
  echo "  $0 vitaliy@192.168.2.8 /home/vitaliy/promo"
  echo "  $0 --deploy vitaliy@192.168.2.8 /home/vitaliy/promo"
  echo ""
  echo "Чтобы не вводить пароль каждый раз:"
  echo "  ssh-copy-id vitaliy@192.168.2.8"
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Ошибка: rsync не установлен. Установите: brew install rsync"
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Ошибка: ssh не установлен"
  exit 1
fi

REMOTE="${ARGS[0]}"
REMOTE_DIR="${ARGS[1]}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Короткий путь: в $TMPDIR сокет не влезает в лимит macOS (~104 байта).
SSH_CONTROL_PATH="/tmp/promo-%C"
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
echo "Синхронизация проекта promo на сервер"
echo "=========================================="
echo "Источник:     $PROJECT_DIR"
echo "Назначение:   $REMOTE:$REMOTE_DIR"
echo ""

echo "Подключаюсь к серверу (пароль спросят один раз)..."
if ! ssh_cmd "echo 'Подключение успешно'"; then
  echo "Ошибка: не удалось подключиться к серверу $REMOTE"
  echo "Проверьте доступность сервера, SSH и учётные данные."
  exit 1
fi

echo "Создаю директорию на сервере..."
ssh_cmd "mkdir -p '$REMOTE_DIR'"

echo "Синхронизирую файлы..."
# Код: --delete убирает на сервере то, чего уже нет локально.
# Загрузки проектов, сгенерированный TTS и короткие ссылки живут только на проде —
# не копируем и не удаляем (exclude защищает от --delete).
set +e
rsync -avz \
  --delete \
  --progress \
  -e "$(rsync_ssh)" \
  --exclude 'node_modules' \
  --exclude 'web/node_modules' \
  --exclude 'web/dist' \
  --exclude 'api/node_modules' \
  --exclude '.venv' \
  --exclude '.git' \
  --exclude '.cursor' \
  --exclude '.vscode' \
  --exclude '.idea' \
  --exclude '.DS_Store' \
  --exclude '**/.DS_Store' \
  --exclude '*.log' \
  --exclude '*.swp' \
  --exclude '*.swo' \
  --exclude '*~' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude 'scripts/.env' \
  --exclude 'gemini-transcribe/.env' \
  --exclude 'elevenlabs-proxy/.env' \
  --exclude '*.pyc' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'video-project.zip' \
  --exclude '*.zip' \
  --exclude 'imports/' \
  --exclude 'web/public/s/' \
  --exclude 'web/public/media/projects/' \
  --include 'web/public/media/tts/demos/***' \
  --include 'web/public/media/tts/starter/***' \
  --exclude 'web/public/media/tts/**' \
  "$PROJECT_DIR/" "$REMOTE:$REMOTE_DIR/"
RSYNC_STATUS=$?
set -e

if [ "$RSYNC_STATUS" -eq 0 ]; then
  :
elif [ "$RSYNC_STATUS" -eq 23 ] || [ "$RSYNC_STATUS" -eq 24 ]; then
  echo ""
  echo "Предупреждение: rsync код $RSYNC_STATUS (частичный перенос / не все удаления)."
  echo "Код уже на сервере; продолжаю."
  echo ""
else
  echo "Ошибка rsync: код $RSYNC_STATUS"
  exit "$RSYNC_STATUS"
fi

if [ -f "$PROJECT_DIR/.env" ]; then
  echo "Скопирован .env (локальный файл перезаписывает версию на сервере)."
else
  echo "Локального .env нет — на сервере остаётся прежний или создайте из .env.example."
fi

echo "Удаляю legacy-медиа (не project-scoped) на сервере..."
ssh_cmd "MEDIA='$REMOTE_DIR/web/public/media'
rm -rf \"\$MEDIA/library\" \"\$MEDIA/intro\" \"\$MEDIA/about\" \"\$MEDIA/rooms\" \"\$MEDIA/treatment\" \"\$MEDIA/leisure\" \"\$MEDIA/fun\" \"\$MEDIA/park\"
rm -f \"\$MEDIA/library-manifest.json\" \"\$MEDIA/tts-manifest.json\"
if [ -d \"\$MEDIA/tts\" ]; then
  find \"\$MEDIA/tts\" -maxdepth 1 -type f \\( -name '*.mp3' -o -name '*.wav' -o -name '*.ogg' -o -name '*.m4a' \\) -delete
fi"

echo "Выставляю права на статичные медиа (nginx читает как www-data)..."
# projects/ и сгенерированный tts не трогаем — ими владеет контейнер API.
ssh_cmd "find '$REMOTE_DIR/web/public/media' -mindepth 1 -maxdepth 1 ! -name projects ! -name tts -exec chmod -R a+rX {} +" || true
ssh_cmd "chmod -R a+rX '$REMOTE_DIR/web/public/media/tts/demos' '$REMOTE_DIR/web/public/media/tts/starter' 2>/dev/null" || true

SYNC_SKIP_NOTE="Не копировались (живут только на проде): web/public/media/projects/, web/public/media/tts/* кроме demos/starter, web/public/s/. Локальные дампы: imports/"

if [ "$DEPLOY" = 1 ]; then
  echo ""
  echo "=========================================="
  echo "Запускаю ./deploy.sh на сервере"
  echo "=========================================="
  echo ""
  ssh_cmd "cd '$REMOTE_DIR' && chmod +x ./deploy.sh && ./deploy.sh"
  echo ""
  echo "=========================================="
  echo "Синхронизация и деплой завершены!"
  echo "=========================================="
  echo ""
  echo "На сервере проект находится в: $REMOTE_DIR"
  echo "$SYNC_SKIP_NOTE"
  echo ""
  exit 0
fi

echo ""
echo "=========================================="
echo "Синхронизация завершена!"
echo "=========================================="
echo ""
echo "На сервере проект находится в: $REMOTE_DIR"
echo "$SYNC_SKIP_NOTE"
echo ""
echo "Следующие шаги на сервере:"
echo "  ssh $REMOTE"
echo "  cd $REMOTE_DIR"
echo "  [ -f .env ] || cp .env.example .env"
echo "  (при первом развертывании: chmod +x init-letsencrypt.sh deploy.sh nginx-router-update.sh && ./init-letsencrypt.sh <email> 2wel.ru)"
echo "  chmod +x deploy.sh nginx-router-update.sh"
echo "  sudo ./nginx-router-update.sh   # записать /etc/nginx/conf.d/promo-router.conf и перезагрузить nginx"
echo "  ./deploy.sh"
echo ""
