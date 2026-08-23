# Tampere tile preparation

This directory turns a reproducible OpenStreetMap extract into vector tiles
for the browser map. The raw `.osm.pbf` and generated `.mbtiles` files are
intentionally ignored by Git.

## Prerequisites

- `curl`
- `sha256sum`
- `osmium` (osmium-tool)
- `tilemaker`

The versions of the tools used for a release should be recorded in the data
manifest or release notes. The scripts accept `OSM_SOURCE_URL` so a smaller
regional extract can be used without changing the processing code.

## Build

From this directory:

```sh
npm run build-all
```

The default source is the Pirkanmaa regional extract. The script clips it to
the Tampere bounding box in `data/sources/manifest.json`, then tilemaker
creates `data/processed/tampere.mbtiles`.

To use another extract:

```sh
OSM_SOURCE_URL=https://example.invalid/tampere.osm.pbf npm run prepare
```

The source URL, source checksum, bounding box, processing configuration, and
tool versions together form the input manifest for a generated tileset.

The current Pirkanmaa provider extract contains one incomplete way at its
regional boundary. The build uses tilemaker's `--skip-integrity` for that
known boundary artifact; this should be revisited before using a larger or
production extract.

Buildings mapped as OSM `type=multipolygon` relations are assembled by
tilemaker and use the relation's building tags, including holes and multiple
outer rings. `building:part` ways are also emitted, which supports buildings
whose separate wings or sections have their own heights. Building colours are
rendered as a neutral light gray in the browser style. Parts with
`min_height` are emitted with a raised extrusion base, so features such as
antennae and rooftop structures appear above the main building.

Road and path features also retain their OSM `surface` value when mapped,
allowing asphalt, gravel, dirt, sand, paving stones, and similar surfaces to
receive distinct browser styling.

Closed `man_made=bridge` ways are emitted as bridge-deck polygons beneath the
transport lines, preventing mapped roads, rails, and paths from appearing to
float separately over the water.

Transport ways tagged with `bridge=*` retain their bridge value, transport
class, optional `bridge:structure`, and numeric `layer` tags. The browser uses
these line features to build approximate 3D bridge decks from terrain height:
roads, paths, and railways receive different widths and clearances, while
`bridge:structure=arch` produces simple curved ribs. These elevations are
visual approximations because OSM generally does not provide surveyed deck
heights.

Terrain-sensitive transport tags are retained on road, path, and railway line
features. `tunnel=*` and `covered=*` are used for dark underground/covered
segments, while `embankment=*` and `cutting=*` add earthwork styling that stays
draped over the active DEM. `barrier=retaining_wall` is emitted in the barriers
layer and receives a stronger map treatment.

Linear waterways are rendered as blue line features. Their long, narrow
`natural=water` polygon counterparts are omitted because clipping those
polygons can produce malformed triangular fills; lakes and other area water
features remain filled polygons.

The tileset also includes parking and pedestrian areas, aeroways, power and
barrier features, and named places/POIs for browser styling.

Transmission towers are available to the browser model layer. `power=tower`
points become simple low-poly supports whose crossarms follow the nearest
mapped `power=line` direction. `man_made=pier|dock|quay|breakwater|groyne` and
`waterway=dam` are emitted in the `water_structures` layer and use flat map
fills and outlines rather than 3D models.

Non-building landmarks are emitted in a separate `landmarks` layer. This
currently covers chimneys, water towers, silos, storage tanks, gasometers, and
generic or communications towers. Wind generators retain their generator type,
source, and height metadata so the browser can render simple turbines where the
extract contains `generator:source=wind` features.

Road and railway tunnel tags are retained, but their underground linework is
hidden in the browser. Validated endpoints that connect to a surface route and
enter rising terrain receive a small 2D entrance marker. Paths, covered
passages, culverts, and building passages are excluded.

## Serving the result

MBTiles is a build artifact, not a browser API. This repository uses the
open-source [Martin tile server](https://maplibre.org/martin/) for local
development. After building the tiles, start it from this directory with:

```sh
npm run serve
```

Martin will serve the `tampere.mbtiles` source on port 3000. Its TileJSON
endpoint is:

```text
http://localhost:3000/tampere
```

The vector tile URL template exposed by that document can be used as the
MapLibre vector source. The MBTiles directory is mounted read-only into the
container. The frontend should consume TileJSON/vector-tile URLs and should
never parse the PBF or SQLite file directly.

The server image is pinned in the repository root's `docker-compose.yml` so
local development is reproducible. For deployment, consider converting the
artifact to PMTiles and serving it from object storage with HTTP range
requests; Martin remains suitable when a tile server or PostGIS backend is
needed.

## Elevation model and terrain tiles

The terrain pipeline uses the National Land Survey of Finland's 2 m elevation
model sampled at a 10 m output resolution. The source is requested from the
NLS WCS endpoint as a GeoTIFF in EPSG:3067/N2000, then reprojected to EPSG:3857
and encoded as Mapbox Terrain-RGB raster MBTiles. The WCS requires a personal
NLS API key, which must never be committed to the repository.

Install GDAL and Rasterio with the `rio-rgbify` plugin, then run:

```sh
NLS_API_KEY=your-key npm run download-dem
npm run build-dem
npm run serve
```

The generated terrain TileJSON is served at:

```text
http://localhost:3000/terrain
```

The conversion uses a base value of `-10000` and a precision interval of
`0.1` metres, matching the MapLibre `encoding: "mapbox"` configuration.
The raw GeoTIFF and generated MBTiles are build artifacts and are not checked
into Git.

## Dockerized data build

The repository also includes a one-shot Docker builder with GDAL, osmium,
tilemaker, Rasterio, and rio-rgbify. Build and run it from the repository root:

```sh
export NLS_API_KEY=your-key
docker compose --profile build build tile-builder
docker compose --profile build run --rm tile-builder
docker compose up martin
```

The builder writes the generated `tampere.mbtiles` and `terrain.mbtiles` to
`data/processed`, which is mounted into Martin. The API key is supplied only at
runtime and is not copied into the image.
