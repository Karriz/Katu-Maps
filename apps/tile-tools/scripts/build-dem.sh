#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INPUT="$PROJECT_ROOT/data/sources/tampere-dem-10m.tif"
REPROJECTED="$PROJECT_ROOT/data/processed/tampere-dem-10m-3857.tif"
OUTPUT="$PROJECT_ROOT/data/processed/terrain.mbtiles"

for command_name in gdalwarp python3; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required; see apps/tile-tools/README.md" >&2
    exit 1
  }
done
[ -f "$INPUT" ] || { echo "Missing $INPUT; run npm run download-dem first" >&2; exit 1; }

mkdir -p "$PROJECT_ROOT/data/processed"
rm -f "$REPROJECTED" "$OUTPUT"

gdalwarp -s_srs EPSG:3067 -t_srs EPSG:3857 -r bilinear \
  -dstnodata 0 -co TILED=YES -co COMPRESS=DEFLATE \
  "$INPUT" "$REPROJECTED"

python3 "$PROJECT_ROOT/apps/tile-tools/scripts/rgbify-dem.py" \
  --base-val -10000 --interval 0.1 \
  --min-z 8 --max-z 14 \
  "$REPROJECTED" "$OUTPUT"

printf 'Generated %s\n' "$OUTPUT"
