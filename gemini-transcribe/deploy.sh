#!/bin/bash
# На VDS: docker compose build && up + health-check
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=========================================="
echo "Деплой Gemini transcribe"
echo "=========================================="

if [ ! -f ".env" ]; then
  echo "Ошибка: .env не найден. Скопируйте с ноутбука или: cp .env.example .env"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Ошибка: docker не установлен"
  echo "На VDS: sudo apt update && sudo apt install -y docker.io docker-compose-plugin"
  exit 1
fi

pick_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  echo "Ошибка: docker compose не найден"
  exit 1
}

ensure_docker_access() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if getent group docker >/dev/null 2>&1 && ! id -nG | grep -qw docker; then
    echo "Нет доступа к Docker — пробую добавить $(whoami) в группу docker..."
    if sudo usermod -aG docker "$(whoami)"; then
      echo "Группа обновлена, продолжаю через sg docker..."
      exec sg docker -c "bash \"$0\""
    fi
  fi

  if sudo docker info >/dev/null 2>&1; then
    echo "Docker доступен через sudo (рекомендуется: sudo usermod -aG docker $(whoami))"
    DOCKER="sudo docker"
    if $DOCKER compose version >/dev/null 2>&1; then
      DOCKER_COMPOSE="sudo docker compose"
    else
      DOCKER_COMPOSE="sudo docker-compose"
    fi
    return 0
  fi

  echo "Ошибка: нет доступа к Docker API (unix:///var/run/docker.sock)"
  echo ""
  echo "На VDS выполните один раз:"
  echo "  sudo usermod -aG docker $(whoami)"
  echo "  newgrp docker"
  echo "  ./deploy.sh"
  exit 1
}

DOCKER="docker"
DOCKER_COMPOSE="$(pick_docker_compose)"
ensure_docker_access
[ -z "${DOCKER_COMPOSE:-}" ] && DOCKER_COMPOSE="$(pick_docker_compose)"

echo "Собираю и запускаю контейнер..."
$DOCKER_COMPOSE build
$DOCKER_COMPOSE up -d

echo ""
echo "Статус:"
$DOCKER_COMPOSE ps

wait_for_health() {
  local port="${PORT:-3100}"
  local url="http://127.0.0.1:${port}/health"
  echo ""
  echo "Health:"
  for _ in $(seq 1 30); do
    if command -v curl >/dev/null 2>&1; then
      if body="$(curl -sf "$url" 2>/dev/null)"; then
        echo "$body"
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if body="$(wget -qO- "$url" 2>/dev/null)"; then
        echo "$body"
        return 0
      fi
    elif $DOCKER exec pclip-gemini-transcribe node -e \
      "fetch('http://127.0.0.1:${port}/health').then(r=>r.text().then(t=>{process.stdout.write(t);process.exit(r.ok?0:1)})).catch(()=>process.exit(1))" \
      2>/dev/null; then
      echo ""
      return 0
    fi
    sleep 1
  done
  echo "Предупреждение: health-check не ответил за 30 с"
  $DOCKER_COMPOSE logs --tail 30 gemini-transcribe 2>/dev/null || true
  return 0
}

wait_for_health

echo ""
echo "=========================================="
echo "Готово. Сервис слушает :${PORT:-3100}"
echo "=========================================="
