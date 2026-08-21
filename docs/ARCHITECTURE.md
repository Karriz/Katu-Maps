# 3D OSM and Public Transit Map — Architecture Plan

Status: planning / no implementation yet

## Recommendation

Start with a browser-only React + TypeScript web application built with Vite,
using MapLibre GL JS as the map foundation. Keep the rendering and data
contracts independent of the
UI so Android can later use MapLibre Native without requiring a rewrite of the
data pipeline or application model.

Long-term, use two thin presentation/rendering adapters: MapLibre GL JS in the
browser and MapLibre Native Android in the Android application. Share the style
spec, vector tiles, terrain tiles, backend APIs, transit schema, camera model,
and feature-property conventions. Do not force the browser and Android clients
to share their rendering APIs.

Build the application in two layers:

1. A shared, platform-independent data and rendering model.
2. A browser presentation adapter initially, followed later by an Android
   native presentation adapter.

MapLibre GL JS should own the interactive map camera, style layers, vector-tile
loading, labels, roads, water, land use, terrain configuration, and initial
building extrusion. Terrain and vegetation should be isolated behind interfaces
because MapLibre is a map renderer rather than a complete 3D engine.

## Why this stack

- MapLibre GL JS has first-class browser support and provides pan, zoom,
  rotation, pitch, vector-tile styling, terrain, and building extrusion.
- A TypeScript web application can be deployed directly to browsers, keeping
  the first implementation small and easy to profile.
- WebGL custom layers can provide the initial terrain/vegetation work; the same
  provider interfaces can later target Android-native rendering.
- Shared styles, tile schemas, APIs, and domain models prevent browser and
  native Android implementations from diverging.
- MapLibre Native Android provides an embeddable `MapView`, camera/style APIs,
  vector sources, and fill extrusion, making it a reasonable production map
  foundation rather than only a fallback.

## Important design decision

Do not make the first prototype depend on a hosted OSM raster tile endpoint or
on Overpass at runtime. Use a small, reproducible Tampere extract and generate
OSM-derived vector tiles locally or in a backend. Runtime data providers should
be replaceable and configured, not hard-coded.

For the initial prototype:

- OSM: a Tampere `.osm.pbf` extract, processed with osmium/osmium-tool or
  equivalent tooling.
- Vector tiles: start with a local PMTiles/MBTiles or a small tile HTTP server;
  choose Martin or a comparable MapLibre-compatible server when the pipeline is
  stable.
- Terrain: NLS Finland Elevation Model 10 m for broad Tampere coverage. Keep the
  source CRS (EPSG:3067) in the processing pipeline and convert to the map
  coordinate system at tile generation time.
- Transit: Nysse static GTFS first, then GTFS-Realtime trip updates, vehicle
  positions, and alerts. Keep train feeds as separate providers.

All displayed OSM data needs visible OSM attribution. The NLS elevation layer
needs its own attribution and licence notice. The application must not bulk
download or use the public OSM standard tile server as an offline tile source.

## Proposed repository layout

```text
apps/
  map-app/                 # TypeScript browser app
  tile-tools/              # data preparation CLI(s)
backend/
  tile-server/             # optional local/server tile serving configuration
  transit-api/             # optional proxy/cache for GTFS and GTFS-RT
libs/
  geo-core/                # CRS, coordinates, bounds, tile IDs, geometry types
  map-data/                # vector-tile source and cache interfaces
  terrain/                 # DEM metadata, tile loading, mesh generation API
  buildings/               # height/levels normalization and building styling
  vegetation/              # forest sampling, species/leaf mapping, LOD policy
  transit/                 # GTFS model, feed adapters, realtime normalization
  routing/                 # future multimodal routing interface
styles/
  tampere.json             # MapLibre style and source-layer definitions
data/
  README.md                # acquisition/licence/version manifest; no large data
tests/
  fixtures/                # tiny deterministic OSM/DEM/GTFS samples
docs/
  ARCHITECTURE.md
  MVP.md
```

The exact directories can be created when implementation starts; the important
boundary is that the UI must not parse OSM, DEM, or GTFS formats directly.

## Rendering model

### Map foundation

MapLibre GL JS style layers should initially cover:

- land, water, parks, forests, roads, paths and railways;
- labels and points of interest;
- building footprints as `fill-extrusion`, using normalized height properties;
- transit route and stop overlays once transit is started.

The building preprocessing step should derive a single render height from
`height`, `building:levels`, or a documented fallback such as levels × 3 m.
Store the source and confidence in feature properties so styling and debugging
remain possible.

### Terrain

Define a `TerrainProvider` that returns elevation tiles and a `TerrainMesh`
that can be rendered by either MapLibre GL JS terrain or a custom renderer. The first
terrain milestone should prove only that a DEM tile, map features, and building
bases share the same horizontal coordinate system and vertical datum.

Avoid mixing WGS84 degree coordinates, EPSG:3067 metres, and Web Mercator metres
inside the same geometry API. Convert at the provider boundary and use a local
origin near the camera for custom meshes to preserve floating-point precision.

### Vegetation

Vegetation is deliberately a later experimental layer. Start with deterministic
sampling inside forest/park polygons and billboard or low-poly tree instances.
Use OSM individual trees when present, then procedurally sample eligible areas.
Encode leaf type and area class as instance attributes where available. Apply
distance-based LOD, frustum culling, tile streaming, and a hard instance budget
per frame/device tier. Do not create one scene object per tree.

## MVP sequence

### Phase 0 — technical spike

- Create a TypeScript web project that runs in a desktop browser.
- Add MapLibre GL JS and show a Tampere-centered map.
- Verify camera pitch, rotation, style loading, and local vector-tile loading.
- Defer Android packaging until the web terrain and vegetation experiments have
  produced measurable rendering and memory requirements.
- Record the exact MapLibre/browser/Android-wrapper versions and licensing notices.

### Phase 1 — map and buildings

- Prepare a small Tampere OSM extract.
- Generate only the source layers needed for the prototype.
- Show roads, water, land use, paths, railways, labels, and extruded buildings.
- Add a debug overlay for tile boundaries, feature IDs, source height, and
  coordinate/zoom information.

### Phase 2 — terrain alignment

- Acquire a small NLS DEM sample.
- Convert it into the selected terrain tile format.
- Add terrain exaggeration and a camera toggle for flat/terrain modes.
- Test building bases, roads, paths, railways, and water against sloped terrain.
- Decide whether the target MapLibre Native build is sufficient or whether the
  custom `TerrainMesh` path becomes the primary renderer.

### Phase 3 — vegetation experiment

- Add mapped tree points.
- Add deterministic forest/park sampling.
- Implement two LOD tiers and GPU instancing.
- Measure frame time, memory, and tile streaming on a representative Android
  device before expanding the area.

### Phase 4 — transit foundation

- Import Nysse GTFS into a normalized local database/cache.
- Display stops, route geometry, route colors, and a selected stop timetable.
- Add feed freshness and provider attribution.
- Add GTFS-Realtime as a separate polling/streaming adapter only after static
  GTFS is reliable.

### Phase 5 — routing and scale

- Add walking and transit routing behind a provider interface.
- Add service alerts and vehicle positions.
- Add incremental updates, region manifests, cache eviction, and more cities.

## Non-goals for the first implementation

- Full-city or country-wide offline downloads.
- Photorealistic tree models or individual meshes for every tree.
- Full OSM editing.
- Turn-by-turn navigation.
- Ticketing, account management, or fare sales.
- A custom map renderer replacing MapLibre before the alignment and performance
  risks are measured.

## Acceptance criteria for the first useful prototype

- Browser build starts from a clean checkout and displays the Tampere extract.
- The browser build displays the Tampere extract from a clean checkout.
- Pan, zoom, pitch, and rotation remain usable while buildings are visible.
- A reproducible DEM tile visibly changes the terrain, with roads and buildings
  aligned to it.
- The prototype can switch between flat and terrain modes for debugging.
- Data source, OSM, NLS, and any third-party tile/provider attribution is visible.
- No runtime component needs the entire Tampere dataset in memory.
- A short performance report exists for representative desktop browsers.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Browser/WebView/native terrain differs by platform/version | Keep terrain behind `TerrainProvider` and test Android early |
| Map features float or sink on terrain | Use one CRS/vertical datum and automated alignment fixtures |
| Forest rendering overwhelms Android | Tile streaming, instance buffers, LOD, culling, device budgets |
| OSM/DEM providers are unsuitable for app traffic | Self-host/process extracts; configure providers and cache policies |
| GTFS feeds change or have inconsistent IDs | Normalize into an internal schema and retain source IDs |
| Large-region updates become expensive | Tile-scoped preprocessing and versioned region manifests |

## Initial implementation order

1. Project skeleton and build verification.
2. MapLibre style with a tiny local Tampere vector-tile fixture.
3. Real Tampere extract and building extrusion.
4. DEM tile and terrain alignment test.
5. Vegetation experiment with profiling.
6. Static Nysse GTFS overlay.

This order keeps the difficult rendering/data alignment question ahead of transit
features while leaving every later subsystem with a stable interface.
