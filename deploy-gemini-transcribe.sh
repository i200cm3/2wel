#!/bin/bash
# Из корня video/: rsync + deploy gemini-transcribe на VDS
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/gemini-transcribe/deploy-to-vds.sh" "$@"
