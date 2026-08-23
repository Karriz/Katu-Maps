#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE="${1:-$PROJECT_ROOT/data/sources/tampere-renumbered.osm.pbf}"
OUTPUT="${2:-$PROJECT_ROOT/data/processed/transport-surfaces.mbtiles}"

if ! command -v ogr2ogr >/dev/null 2>&1; then
  echo "ogr2ogr is required; install GDAL" >&2
  exit 1
fi
if [ ! -f "$SOURCE" ]; then
  echo "Missing $SOURCE; run the OSM tile build first" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
rm -f "$OUTPUT"
STAGING_DIR="$(mktemp -d)"
STAGING="$STAGING_DIR/transport-surfaces.gpkg"
CLEANED="$STAGING_DIR/transport-surfaces-cleaned.gpkg"
WATER_MASK="$STAGING_DIR/bridge-water-mask.gpkg"
trap 'rm -f "$STAGING" "$CLEANED" "$WATER_MASK"; rmdir "$STAGING_DIR"' EXIT

WIDTH_SQL="CASE
  WHEN CAST(hstore_get_value(other_tags, 'width') AS REAL) > 0 THEN
    MIN(CASE WHEN highway IN ('path','footway','cycleway','track','pedestrian','steps') THEN 12.0 ELSE 30.0 END,
        MAX(CASE WHEN highway IN ('path','footway','cycleway','track','pedestrian','steps') THEN 1.0 ELSE 2.5 END,
            CAST(hstore_get_value(other_tags, 'width') AS REAL)))
  WHEN highway IN ('path','footway','cycleway','track','pedestrian','steps') THEN
    CASE highway WHEN 'track' THEN 3.5 WHEN 'cycleway' THEN 3.0 WHEN 'pedestrian' THEN 4.0
      WHEN 'footway' THEN 2.0 WHEN 'steps' THEN 2.0 ELSE 1.5 END
  WHEN CAST(hstore_get_value(other_tags, 'lanes') AS REAL) > 0 THEN
    MIN(30.0, MAX(
      CASE highway WHEN 'motorway' THEN 12.0 WHEN 'trunk' THEN 10.0 WHEN 'primary' THEN 8.0
        WHEN 'secondary' THEN 7.0 WHEN 'tertiary' THEN 6.0 WHEN 'residential' THEN 5.5
        WHEN 'service' THEN 4.0 ELSE 5.0 END,
      CAST(hstore_get_value(other_tags, 'lanes') AS REAL) * 3.25))
  ELSE CASE highway WHEN 'motorway' THEN 12.0 WHEN 'trunk' THEN 10.0 WHEN 'primary' THEN 8.0
    WHEN 'secondary' THEN 7.0 WHEN 'tertiary' THEN 6.0 WHEN 'residential' THEN 5.5
    WHEN 'service' THEN 4.0 ELSE 5.0 END
END"

KIND_SQL="CASE WHEN highway IN ('path','footway','cycleway','track','pedestrian','steps') THEN 'path' ELSE 'road' END"
EDGE_SQL="CASE WHEN highway IN ('path','footway','cycleway','track','pedestrian','steps') THEN 0.35
  WHEN highway IN ('motorway','trunk') THEN 0.65 WHEN highway = 'service' THEN 0.8 ELSE 1.45 END"
FILTER_SQL="highway IS NOT NULL
  AND highway NOT IN ('construction','proposed','abandoned','platform','raceway')
  AND COALESCE(hstore_get_value(other_tags, 'area'), 'no') NOT IN ('yes','1','true')
  AND COALESCE(hstore_get_value(other_tags, 'bridge'), 'no') IN ('no','false','0')
  AND COALESCE(hstore_get_value(other_tags, 'tunnel'), 'no') IN ('no','false','0')
  AND COALESCE(hstore_get_value(other_tags, 'covered'), 'no') IN ('no','false','0')"
BRIDGE_FILTER_SQL="highway IS NOT NULL
  AND COALESCE(hstore_get_value(other_tags, 'bridge'), 'no') NOT IN ('no','false','0')
  AND COALESCE(hstore_get_value(other_tags, 'tunnel'), 'no') IN ('no','false','0')"

FIELDS_SQL="osm_id,
  highway AS class,
  $KIND_SQL AS kind,
  hstore_get_value(other_tags, 'surface') AS surface,
  hstore_get_value(other_tags, 'sidewalk') AS sidewalk,
  hstore_get_value(other_tags, 'cycleway') AS cycleway,
  $WIDTH_SQL AS width"

ogr2ogr -f GPKG "$STAGING" "$SOURCE" \
  -dialect SQLite \
  -sql "SELECT $FIELDS_SQL,
    ST_Buffer(ST_Transform(geometry, 3067), ($WIDTH_SQL) / 2.0 + ($EDGE_SQL), 4) AS geometry
    FROM lines WHERE $FILTER_SQL" \
  -nln transport_casings \
  -t_srs EPSG:3857

ogr2ogr -update -append "$STAGING" "$SOURCE" \
  -dialect SQLite \
  -sql "SELECT $FIELDS_SQL,
    ST_Buffer(ST_Transform(geometry, 3067), ($WIDTH_SQL) / 2.0, 4) AS geometry
    FROM lines WHERE $FILTER_SQL" \
  -nln transport_surfaces \
  -t_srs EPSG:3857

ogr2ogr -update -append "$STAGING" "$SOURCE" \
  -dialect SQLite \
  -sql "SELECT osm_id,
    ST_Buffer(ST_Transform(geometry, 3067), ($WIDTH_SQL) / 2.0 + ($EDGE_SQL) + 1.0, 4) AS geometry
    FROM lines WHERE $BRIDGE_FILTER_SQL" \
  -nln bridge_masks \
  -t_srs EPSG:3857

ogr2ogr -update -append "$STAGING" "$SOURCE" \
  -dialect SQLite \
  -sql "SELECT COALESCE(osm_way_id, osm_id) AS osm_id,
    'pedestrian' AS class,
    hstore_get_value(other_tags, 'surface') AS surface,
    geometry
    FROM multipolygons
    WHERE hstore_get_value(other_tags, 'highway') = 'pedestrian'
      AND COALESCE(hstore_get_value(other_tags, 'bridge'), 'no') IN ('no','false','0')" \
  -nln pedestrian_surfaces \
  -t_srs EPSG:3857

ogr2ogr -update -append "$STAGING" "$SOURCE" \
  -dialect SQLite \
  -sql "SELECT COALESCE(osm_way_id, osm_id) AS osm_id, geometry
    FROM multipolygons
    WHERE natural = 'water' OR landuse IN ('basin', 'reservoir')" \
  -nln water_masks \
  -t_srs EPSG:3857

ogr2ogr -f GPKG "$WATER_MASK" "$STAGING" \
  -dialect SQLite \
  -sql "SELECT 1 AS id,
    ST_CollectionExtract(
      ST_Union(ST_Intersection(bridge.geometry, water.geometry)),
      3
    ) AS geometry
    FROM bridge_masks bridge
    JOIN water_masks water ON ST_Intersects(bridge.geometry, water.geometry)" \
  -nln bridge_water_mask \
  -nlt MULTIPOLYGON

ogr2ogr -update -append "$STAGING" "$WATER_MASK" bridge_water_mask \
  -nln bridge_water_mask

clean_layer() {
  local source_layer="$1"
  local -a output_mode=(-f GPKG)
  if [ -f "$CLEANED" ]; then
    output_mode=(-update -append)
  fi
  ogr2ogr "${output_mode[@]}" "$CLEANED" "$STAGING" \
    -dialect SQLite \
    -sql "SELECT clipped.osm_id, clipped.class, clipped.kind, clipped.surface,
      clipped.sidewalk, clipped.cycleway, clipped.width, clipped.geometry
      FROM (
        SELECT t.osm_id, t.class, t.kind, t.surface, t.sidewalk, t.cycleway, t.width,
          CASE WHEN ST_Intersects(t.geometry, bridge_mask.geometry)
            THEN ST_Difference(t.geometry, bridge_mask.geometry)
            ELSE t.geometry END AS geometry
        FROM $source_layer t
        CROSS JOIN (SELECT geometry FROM bridge_water_mask LIMIT 1) bridge_mask
      ) clipped
      WHERE NOT ST_IsEmpty(clipped.geometry)" \
    -nln "$source_layer" \
    -nlt MULTIPOLYGON
}

clean_layer transport_casings
clean_layer transport_surfaces

ogr2ogr -update -append "$CLEANED" "$STAGING" \
  -dialect SQLite \
  -sql "SELECT clipped.osm_id, clipped.class, clipped.surface, clipped.geometry
    FROM (
      SELECT t.osm_id, t.class, t.surface,
        CASE WHEN ST_Intersects(t.geometry, bridge_mask.geometry)
          THEN ST_CollectionExtract(ST_Difference(t.geometry, bridge_mask.geometry), 3)
          ELSE t.geometry END AS geometry
      FROM pedestrian_surfaces t
      CROSS JOIN (SELECT geometry FROM bridge_water_mask LIMIT 1) bridge_mask
    ) clipped
    WHERE NOT ST_IsEmpty(clipped.geometry)" \
  -nln pedestrian_surfaces \
  -nlt MULTIPOLYGON

ogr2ogr -f MBTiles "$OUTPUT" "$CLEANED" \
  -dsco NAME="Tampere transport surfaces" \
  -dsco DESCRIPTION="Real-width OSM transport polygons for close zooms" \
  -dsco MINZOOM=14 \
  -dsco MAXZOOM=16 \
  -dsco BUFFER=256 \
  -dsco MAX_SIZE=2000000 \
  -lco MINZOOM=14 \
  -lco MAXZOOM=16

printf 'Generated %s\n' "$OUTPUT"
