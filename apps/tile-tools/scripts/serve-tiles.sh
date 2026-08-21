#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TILES="$PROJECT_ROOT/data/processed/tampere.mbtiles"

if [ ! -f "$TILES" ]; then
  echo "Missing $TILES; run npm run build-all in apps/tile-tools first" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
docker compose up martin
