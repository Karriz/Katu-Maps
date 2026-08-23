#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE="$PROJECT_ROOT/data/sources/source.osm.pbf"
EXTRACT="$PROJECT_ROOT/data/sources/tampere.osm.pbf"
RENUMBERED="$PROJECT_ROOT/data/sources/tampere-renumbered.osm.pbf"
OUTPUT="$PROJECT_ROOT/data/processed/tampere.mbtiles"
CONFIG="$PROJECT_ROOT/apps/tile-tools/tilemaker/config.json"
PROCESS="$PROJECT_ROOT/apps/tile-tools/tilemaker/process.lua"

if ! command -v osmium >/dev/null 2>&1; then
  echo "osmium is required; install osmium-tool" >&2
  exit 1
fi
if ! command -v tilemaker >/dev/null 2>&1; then
  echo "tilemaker is required; see apps/tile-tools/README.md" >&2
  exit 1
fi
if [ ! -f "$SOURCE" ]; then
  echo "Missing $SOURCE; run npm run download first" >&2
  exit 1
fi

mkdir -p "$PROJECT_ROOT/data/processed"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read data/sources/manifest.json" >&2
  exit 1
fi
BBOX="$(node -e 'const fs = require("node:fs"); const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(m.extract.bbox.join(","));' "$PROJECT_ROOT/data/sources/manifest.json")"

osmium extract \
  --bbox "$BBOX" \
  --strategy smart \
  --set-bounds \
  "$SOURCE" \
  --output "$EXTRACT" \
  --overwrite

# tilemaker's compact node store is sensitive to very large sparse OSM IDs.
# Renumbering preserves referential integrity while giving the tile builder a
# dense local ID space. This file must never be uploaded back to OSM.
osmium renumber \
  --output "$RENUMBERED" \
  --overwrite \
  "$EXTRACT"

rm -f "$OUTPUT"
tilemaker \
  --input "$RENUMBERED" \
  --output "$OUTPUT" \
  --config "$CONFIG" \
  --process "$PROCESS" \
  --skip-integrity

"$PROJECT_ROOT/apps/tile-tools/scripts/build-transport-surfaces.sh" "$RENUMBERED"

printf 'Generated %s\n' "$OUTPUT"
