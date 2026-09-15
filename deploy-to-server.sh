#!/bin/bash
# rsync + docker compose на сервере.
# По умолчанию — app на 2.6. Edge: ./deploy-to-server.sh --edge
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/sync-to-server.sh" --deploy "$@"
