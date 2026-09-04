#!/bin/bash

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=========================================="
echo "Деплой проекта promo (HTTPS)"
echo "=========================================="
echo ""

if ! command -v docker &> /dev/null; then
    echo "Ошибка: docker не установлен"
    exit 1
fi

if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo "Ошибка: docker compose не установлен"
    exit 1
fi

DOCKER_COMPOSE="docker compose"
command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null && DOCKER_COMPOSE="docker-compose"

if [ ! -f "docker-compose.yml" ]; then
    echo "Ошибка: docker-compose.yml не найден"
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "Ошибка: файл .env не найден."
    echo "Скопируйте: cp .env.example .env  и задайте ELEVENLABS_API_KEY"
    exit 1
fi

set -a
# shellcheck disable=SC1091
# Значения с пробелами в .env обязаны быть в кавычках: MAIL_FROM_NAME="2wel"
if ! source .env; then
    echo "Ошибка: не удалось прочитать .env (проверьте кавычки у значений с пробелами)."
    exit 1
fi
set +a

DOMAIN="${DOMAIN:-2wel.ru}"
PROMO_PORT="${PROMO_PORT:-8086}"

# Проверка томов certbot (должны быть созданы init-letsencrypt.sh)
for vol in certbot-data certbot-www; do
    if ! docker volume inspect "$vol" &> /dev/null; then
        echo "Ошибка: том Docker '$vol' не найден."
        echo "Сначала выполните на сервере: ./init-letsencrypt.sh <email> ${DOMAIN}"
        exit 1
    fi
done

export DOMAIN
export PROMO_PORT

# nginx в контейнере не читает файлы 600 (типично для загруженных с Mac PNG).
chmod -R a+rX web/public/media 2>/dev/null || true

PORT_OWNER="$(docker ps --filter "publish=${PROMO_PORT}" --format '{{.Names}}' | paste -sd ', ' -)"
if [ -n "$PORT_OWNER" ] && [ "$PORT_OWNER" != "promo-web" ]; then
    echo "Ошибка: порт ${PROMO_PORT} уже занят контейнером: ${PORT_OWNER}"
    echo "Задайте свободный PROMO_PORT в .env и такой же порт в nginx-router-update.sh."
    exit 1
fi

echo "Собираю образы (api без кэша исходников + web)..."
export API_CACHEBUST="${API_CACHEBUST:-$(date +%s)}"
echo "API_CACHEBUST=$API_CACHEBUST"
$DOCKER_COMPOSE build api guest-ssl web

echo ""
echo "Пересоздаю api (иначе Docker оставляет старый контейнер)..."
$DOCKER_COMPOSE up -d --force-recreate --no-deps api guest-ssl
$DOCKER_COMPOSE up -d

echo ""
echo "Проверяю статус контейнеров..."
$DOCKER_COMPOSE ps

echo ""
echo "Проверка web (127.0.0.1:${PROMO_PORT})..."
web_ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null -m 15 "http://127.0.0.1:${PROMO_PORT}/"; then
        echo "OK: web отвечает"
        web_ok=1
        break
    fi
    sleep 3
done
if [ "$web_ok" != 1 ]; then
    echo "ОШИБКА: web не отвечает. Логи:"
    $DOCKER_COMPOSE logs --tail=80 web
    exit 1
fi

echo "Проверка API через nginx (/health)..."
api_ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -m 15 "http://127.0.0.1:${PROMO_PORT}/health"; then
        echo ""
        echo "OK: API отвечает"
        api_ok=1
        break
    fi
    sleep 3
done
if [ "$api_ok" != 1 ]; then
    echo "ОШИБКА: API не отвечает. Логи:"
    $DOCKER_COMPOSE logs --tail=80 api
    $DOCKER_COMPOSE logs --tail=40 db
    exit 1
fi

echo "Проверка, что в контейнере свежий backend..."
if $DOCKER_COMPOSE exec -T api test -f /app/amoLog.mjs \
  && $DOCKER_COMPOSE exec -T api grep -q 'const AMO_WEBHOOK' /app/v1.mjs; then
    echo "OK: promo-api содержит текущий код (AMO_WEBHOOK + amoLog)"
else
    echo "ОШИБКА: контейнер promo-api запущен со старым кодом."
    echo "Слои Docker не подхватили api/*.mjs — проверьте API_CACHEBUST и COPY в Dockerfile."
    exit 1
fi

echo ""
echo "=========================================="
echo "Готово. Проект promo развернут."
echo "=========================================="
echo ""
echo "  Сайт:       https://${DOMAIN}"
echo "  Конструктор: https://${DOMAIN}/editor"
echo "  Локально:   http://127.0.0.1:${PROMO_PORT}"
echo ""
echo "Логи:   $DOCKER_COMPOSE logs -f"
echo "Стоп:   $DOCKER_COMPOSE down"
echo ""
