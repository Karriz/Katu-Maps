#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MANIFEST="$PROJECT_ROOT/data/sources/dem-manifest.json"
OUTPUT="$PROJECT_ROOT/data/sources/tampere-dem-10m.tif"

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }
[ -n "${NLS_API_KEY:-}" ] || {
  echo "NLS_API_KEY is required; create one at the NLS My Account service" >&2
  exit 1
}

read -r SOURCE COVERAGE SCALE_FACTOR BBOX < <(python3 -c '
  import json, sys
  m = json.load(open(sys.argv[1]))
  print(m["sourceUrl"], m["coverageId"], m["scaleFactor"], ",".join(map(str, m["bbox3067"])))
' "$MANIFEST")
IFS=, read -r MIN_E MIN_N MAX_E MAX_N <<< "$BBOX"

mkdir -p "$(dirname "$OUTPUT")"
TMP_OUTPUT="${OUTPUT}.part"
rm -f "$TMP_OUTPUT"
echo "Downloading NLS $COVERAGE at scale factor $SCALE_FACTOR for EPSG:3067 bbox $BBOX"
curl --fail --location --retry 3 --get "$SOURCE" \
  --data-urlencode "api-key=$NLS_API_KEY" \
  --data-urlencode 'service=WCS' \
  --data-urlencode 'version=2.0.1' \
  --data-urlencode 'request=GetCoverage' \
  --data-urlencode "CoverageID=$COVERAGE" \
  --data-urlencode "SUBSET=E($MIN_E,$MAX_E)" \
  --data-urlencode "SUBSET=N($MIN_N,$MAX_N)" \
  --data-urlencode "SCALEFACTOR=$SCALE_FACTOR" \
  --data-urlencode 'format=image/tiff' \
  --data-urlencode 'geotiff:compression=LZW' \
  --output "$TMP_OUTPUT"
mv "$TMP_OUTPUT" "$OUTPUT"

printf 'Downloaded %s (%s bytes)\n' "$OUTPUT" "$(stat -c '%s' "$OUTPUT")"
