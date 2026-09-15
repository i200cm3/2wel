#!/bin/bash
# Из корня video/: rsync + docker compose на сервере GigaAM
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/gigaam-transcribe/sync-to-server.sh" --deploy "$@"
