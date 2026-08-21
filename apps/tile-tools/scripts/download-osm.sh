#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_DIR="$PROJECT_ROOT/data/sources"
SOURCE_URL="${OSM_SOURCE_URL:-https://download.openstreetmap.fr/extracts/europe/finland/pirkanmaa-latest.osm.pbf}"
SOURCE_FILE="$SOURCE_DIR/source.osm.pbf"

mkdir -p "$SOURCE_DIR"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download the OSM extract" >&2
  exit 1
fi

curl --fail --location --continue-at - --output "$SOURCE_FILE" "$SOURCE_URL"
printf 'Downloaded %s\n' "$SOURCE_FILE"
sha256sum "$SOURCE_FILE" | tee "$SOURCE_DIR/source.sha256"
