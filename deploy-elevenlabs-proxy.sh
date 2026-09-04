#!/bin/bash
# Из корня video/: rsync + deploy elevenlabs-proxy на VDS
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/elevenlabs-proxy/deploy-to-vds.sh" "$@"
