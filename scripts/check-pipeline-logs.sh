#!/bin/bash
# Логи оркестратора презентации на сервере.
# Важно: docker compose logs пишет в stderr → нужен 2>&1 до grep.
#
# Пример:
#   ./scripts/check-pipeline-logs.sh
#   ./scripts/check-pipeline-logs.sh vitaliy@192.168.2.8 /home/vitaliy/promo

set -e
REMOTE="${1:-vitaliy@192.168.2.8}"
REMOTE_DIR="${2:-/home/vitaliy/promo}"

echo "=== pipeline / webhook (filtered) ==="
ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose logs api --tail=500 2>&1" \
  | grep -E 'amo\.(pipeline\.|webhook\.(issue|hit|body|sync))|Error|error' \
  || echo "(нет совпадений в последних 500 строках)"

echo ""
echo "=== raw api tail 60 ==="
ssh "$REMOTE" "cd '$REMOTE_DIR' && docker compose logs api --tail=60 2>&1"
