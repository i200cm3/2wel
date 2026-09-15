#!/bin/bash

set -e

DEPLOY=0
ROLE="" # app | edge | auto
SHOW_HELP=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=1 ;;
    --app) ROLE=app ;;
    --edge) ROLE=edge ;;
    -h|--help) SHOW_HELP=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

# По умолчанию — app-хост (192.168.2.6). Edge: --edge или vitaliy@192.168.2.8
DEFAULT_APP_REMOTE="vitaliy@192.168.2.6"
DEFAULT_EDGE_REMOTE="vitaliy@192.168.2.8"
DEFAULT_DIR="/home/vitaliy/promo"

usage() {
  echo "Использование:"
  echo "  $0 [--deploy] [--app|--edge] [user@server] [/path/on/server]"
  echo ""
  echo "По умолчанию (app на 2.6):"
  echo "  $0 --deploy"
  echo "  $0 --deploy vitaliy@192.168.2.6"
  echo ""
  echo "Edge на 2.8 (прокси + guest-ssl + certbot):"
  echo "  $0 --deploy --edge"
  echo "  $0 --deploy --edge vitaliy@192.168.2.8"
  echo ""
  echo "Только rsync (без пересборки):"
  echo "  $0"
  echo "  $0 vitaliy@192.168.2.6 /home/vitaliy/promo"
  echo ""
  echo "SSH-ключ: ssh-copy-id vitaliy@192.168.2.6"
}

if [ "$SHOW_HELP" = 1 ]; then
  usage
  exit 0
fi

if [ ${#ARGS[@]} -eq 0 ]; then
  if [ "$ROLE" = "edge" ]; then
    REMOTE="$DEFAULT_EDGE_REMOTE"
  else
    REMOTE="$DEFAULT_APP_REMOTE"
    ROLE="${ROLE:-app}"
  fi
  REMOTE_DIR="$DEFAULT_DIR"
elif [ ${#ARGS[@]} -eq 1 ]; then
  REMOTE="${ARGS[0]}"
  REMOTE_DIR="$DEFAULT_DIR"
else
  REMOTE="${ARGS[0]}"
  REMOTE_DIR="${ARGS[1]}"
fi

# Роль по хосту, если не задана флагом
if [ -z "$ROLE" ]; then
  case "$REMOTE" in
    *192.168.2.11*|*@services11)
      echo "Ошибка: $REMOTE больше не app-хост. Используйте 192.168.2.6 (app) или 192.168.2.8 (edge)."
      exit 1
      ;;
    *192.168.2.8*|*@services) ROLE=edge ;;
    *192.168.2.6*) ROLE=app ;;
    *) ROLE=app ;;
  esac
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "Ошибка: rsync не установлен. Установите: brew install rsync"
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "Ошибка: ssh не установлен"
  exit 1
fi

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
echo "Синхронизация promo → $ROLE"
echo "=========================================="
echo "Источник:     $PROJECT_DIR"
echo "Назначение:   $REMOTE:$REMOTE_DIR"
echo "Роль:         $ROLE"
echo ""

echo "Подключаюсь к серверу..."
if ! ssh_cmd "echo 'Подключение успешно'"; then
  echo "Ошибка: не удалось подключиться к серверу $REMOTE"
  echo "Проверьте доступность сервера, SSH и учётные данные."
  exit 1
fi

echo "Создаю директорию на сервере..."
ssh_cmd "mkdir -p '$REMOTE_DIR'"

echo "Синхронизирую файлы..."
# Код: --delete убирает на сервере то, чего уже нет локально.
# .env на сервере НЕ трогаем (секреты + GUEST_SSL_ENSURE_URL / PROMO_UPSTREAM).
set +e
if [ "$ROLE" = "edge" ]; then
  # На 2.8 только edge: тонкий набор для proxy + guest-ssl.
  rsync -avz \
    --delete \
    --progress \
    -e "$(rsync_ssh)" \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '.env.*.local' \
    --exclude '.git' \
    --exclude '.cursor' \
    --exclude '.DS_Store' \
    --exclude '**/.DS_Store' \
    --include '.dockerignore' \
    --include '.env.example' \
    --include 'Dockerfile.edge' \
    --include 'docker-compose.edge.yml' \
    --include 'edge-nginx.conf' \
    --include 'init-letsencrypt.sh' \
    --include 'nginx-router-update.sh' \
    --include 'README.md' \
    --include 'edge/' \
    --include 'edge/package.json' \
    --include 'api/' \
    --include 'api/guestSslAgent.mjs' \
    --include 'api/guestSsl.mjs' \
    --include 'api/publicUrl.mjs' \
    --include 'api/env.ts' \
    --include 'api/auth.ts' \
    --exclude 'api/***' \
    --exclude 'edge/***' \
    --exclude '*' \
    "$PROJECT_DIR/" "$REMOTE:$REMOTE_DIR/"
  RSYNC_STATUS=$?
  set -e
  if [ "$RSYNC_STATUS" -eq 0 ] || [ "$RSYNC_STATUS" -eq 23 ] || [ "$RSYNC_STATUS" -eq 24 ]; then
    # rsync --delete не трогает excluded — подчищаем api/ вручную.
    ssh_cmd "cd '$REMOTE_DIR' && mkdir -p api && find api -mindepth 1 \\( \
      -name guestSslAgent.mjs -o -name guestSsl.mjs -o -name publicUrl.mjs -o -name env.ts -o -name auth.ts \
      \\) -prune -o -exec rm -rf {} + && rm -rf prompts"
  fi
  SYNC_SKIP_NOTE="Edge: Dockerfile.edge, edge/package.json, 5 файлов api/* (guest-ssl), compose, TLS-скрипты. .env не трогали."
else
  # App на 2.6: полный проект без секретов и без runtime-медиа.
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
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '.env.*.local' \
    --exclude 'scripts/.env' \
    --exclude 'elevenlabs-proxy/.env' \
    --exclude 'gigaam-transcribe/.env' \
    --exclude 'gigaam-transcribe/cache/' \
    --exclude '*.pyc' \
    --exclude '__pycache__' \
    --exclude '.pytest_cache' \
    --exclude 'video-project.zip' \
    --exclude '*.zip' \
    --exclude 'imports/' \
    --exclude 'promo-migrate.dump' \
    --exclude 'promo-backups/' \
    --exclude 'web/public/s/' \
    --exclude 'web/public/media/projects/' \
    --include 'web/public/media/tts/demos/***' \
    --include 'web/public/media/tts/starter/***' \
    --exclude 'web/public/media/tts/**' \
    "$PROJECT_DIR/" "$REMOTE:$REMOTE_DIR/"
  RSYNC_STATUS=$?
  SYNC_SKIP_NOTE="Не копировались: .env, web/public/media/projects/, web/public/media/tts/* кроме demos/starter, web/public/s/, imports/"
fi
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

echo "Серверный .env не трогали (секреты остаются на хосте)."

if [ "$ROLE" = "app" ]; then
  echo "Удаляю legacy-медиа (не project-scoped) на сервере..."
  ssh_cmd "MEDIA='$REMOTE_DIR/web/public/media'
rm -rf \"\$MEDIA/library\" \"\$MEDIA/intro\" \"\$MEDIA/about\" \"\$MEDIA/rooms\" \"\$MEDIA/treatment\" \"\$MEDIA/leisure\" \"\$MEDIA/fun\" \"\$MEDIA/park\"
rm -f \"\$MEDIA/library-manifest.json\" \"\$MEDIA/tts-manifest.json\"
if [ -d \"\$MEDIA/tts\" ]; then
  find \"\$MEDIA/tts\" -maxdepth 1 -type f \\( -name '*.mp3' -o -name '*.wav' -o -name '*.ogg' -o -name '*.m4a' \\) -delete
fi"

  echo "Выставляю права на статичные медиа..."
  ssh_cmd "find '$REMOTE_DIR/web/public/media' -mindepth 1 -maxdepth 1 ! -name projects ! -name tts -exec chmod -R a+rX {} + 2>/dev/null" || true
  ssh_cmd "chmod -R a+rX '$REMOTE_DIR/web/public/media/tts/demos' '$REMOTE_DIR/web/public/media/tts/starter' 2>/dev/null" || true
fi

remote_deploy() {
  if [ "$ROLE" = "edge" ]; then
    echo "Compose: docker-compose.edge.yml (proxy + guest-ssl + certbot)"
    ssh_cmd "cd '$REMOTE_DIR' && \
      export EDGE_CACHEBUST=\$(date +%s) && \
      docker compose -f docker-compose.edge.yml up -d --build && \
      docker compose -f docker-compose.edge.yml ps && \
      curl -fsS -m 10 http://127.0.0.1:\${PROMO_PORT:-8086}/health && echo && \
      curl -fsS -m 5 http://127.0.0.1:9299/health 2>/dev/null || curl -fsS -m 5 http://192.168.2.8:9299/health"
    echo
  else
    echo "Compose: docker-compose.app.yml (db + api + web)"
    ssh_cmd "cd '$REMOTE_DIR' && \
      export API_CACHEBUST=\$(date +%s) && \
      docker compose -f docker-compose.app.yml build && \
      docker compose -f docker-compose.app.yml up -d --force-recreate --no-deps api && \
      docker compose -f docker-compose.app.yml up -d && \
      docker compose -f docker-compose.app.yml ps && \
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
        st=\$(docker inspect -f '{{.State.Health.Status}}' promo-api 2>/dev/null || echo starting); \
        echo api=\$st; \
        [ \"\$st\" = healthy ] && break; \
        sleep 2; \
      done && \
      curl -fsS -m 10 http://127.0.0.1:\${PROMO_PORT:-8086}/health && echo"
  fi
}

if [ "$DEPLOY" = 1 ]; then
  echo ""
  echo "=========================================="
  echo "Деплой ($ROLE) на $REMOTE"
  echo "=========================================="
  echo ""
  remote_deploy
  echo ""
  echo "=========================================="
  echo "Синхронизация и деплой завершены!"
  echo "=========================================="
  echo ""
  echo "На сервере: $REMOTE:$REMOTE_DIR ($ROLE)"
  echo "$SYNC_SKIP_NOTE"
  if [ "$ROLE" = "app" ]; then
    echo "Публично: https://2wel.ru (через edge 2.8 → этот app)"
  else
    echo "Edge: host nginx → :8086 → app 192.168.2.6"
  fi
  echo ""
  exit 0
fi

echo ""
echo "=========================================="
echo "Синхронизация завершена!"
echo "=========================================="
echo ""
echo "На сервере: $REMOTE:$REMOTE_DIR ($ROLE)"
echo "$SYNC_SKIP_NOTE"
echo ""
echo "Деплой:"
if [ "$ROLE" = "edge" ]; then
  echo "  $0 --deploy --edge"
  echo "  # или на сервере: docker compose -f docker-compose.edge.yml up -d --build"
else
  echo "  $0 --deploy"
  echo "  # или: $0 --deploy $REMOTE $REMOTE_DIR"
  echo "  # на сервере: docker compose -f docker-compose.app.yml up -d --build"
fi
echo ""
