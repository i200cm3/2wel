#!/usr/bin/env bash
# Запускать на целевом сервере (или через sync-to-server.sh --deploy).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Создан .env из .env.example — при необходимости задайте GIGAAM_TRANSCRIBE_SECRET."
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Ошибка: Docker не установлен."
  echo "Ubuntu: sudo apt update && sudo apt install -y docker.io docker-compose-v2"
  echo "        sudo usermod -aG docker \"\$USER\"  # затем перелогиниться"
  exit 1
fi

echo "Сборка и запуск gigaam-transcribe..."
docker compose up -d --build
docker compose ps
echo ""
echo "Health:"
curl -fsS "http://127.0.0.1:${PORT:-3200}/health" || true
echo ""
