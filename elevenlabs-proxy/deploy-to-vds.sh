#!/bin/bash
# rsync + ./deploy.sh на VDS 156.229.27.67
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/sync-to-vds.sh" --deploy "$@"
