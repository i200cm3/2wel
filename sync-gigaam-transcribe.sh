#!/bin/bash
# Из корня video/: rsync gigaam-transcribe на сервер
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/gigaam-transcribe/sync-to-server.sh" "$@"
