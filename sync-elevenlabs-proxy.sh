#!/bin/bash
# Из корня video/: rsync elevenlabs-proxy на VDS
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/elevenlabs-proxy/sync-to-vds.sh" "$@"
