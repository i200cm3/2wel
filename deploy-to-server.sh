#!/bin/bash
# Синхронизация проекта и сразу ./deploy.sh на сервере — без отдельного ssh.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/sync-to-server.sh" --deploy "$@"
