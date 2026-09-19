# Tampere bridge preprocessing pilot

## Objective

Move bridge topology and deck-mesh construction out of the browser for a
Tampere pilot. The browser should load stable, precomputed bridge records and
only perform work that depends on the active terrain source or Three.js scene.

This pilot will test whether preprocessing makes bridge rendering lighter and
more stable before committing to a national or global dataset.

## Why this is worth testing

The current `BridgeModelLayer` queries the visible OpenFreeMap transportation
features and then performs several topology operations in the browser. It
deduplicates tile fragments, merges bridge lines, associates lines and mapped
bridge areas, clusters related structures, constructs and triangulates deck
footprints, samples terrain, and creates Three.js resources.

Preprocessing the topology against a complete regional OSM extract avoids
making those decisions from whichever vector-tile fragments are currently
loaded. It should also eliminate changes caused by tile arrival order and
boundaries.

## Pilot boundary

Use the following initial bounding box, including a margin around Tampere:

| Edge | Coordinate |
| --- | ---: |
| West | 23.55 |
| South | 61.35 |
| East | 24.15 |
| North | 61.70 |

The boundary is a starting point, not part of the permanent data schema. The
preprocessing command should accept a configurable bounding box or polygon.

## Scope

The first pass should include:

- OSM road, rail, cycleway, footway, and other supported transport ways tagged
  as bridges.
- Explicit bridge-area polygons, including holes.
- Association of transport centerlines with the deck that carries them.
- Deduplication and merging of OSM fragments belonging to one rendered bridge.
- Stable bridge identifiers and source OSM identifiers.
- Precomputed deck footprints, triangulation, span parameters, and candidate
  pier positions.
- Rendering attributes needed by the existing bridge appearance logic.
- A static, versioned artifact served with the application.
- Use of preprocessed data inside the pilot boundary, with the current runtime
  implementation retained elsewhere and as a recoverable fallback.

The first pass should not:

- Bake terrain elevations into the dataset.
- Replace the global OpenFreeMap source.
- Require a database, tile server, or application backend at runtime.
- Modify the local tile tooling or unrelated data pipelines.
- Introduce PMTiles before the bridge schema and geometry quality are proven.

## Data source and attribution

Build from a dated OpenStreetMap extract, initially a Finland PBF filtered to
the pilot boundary. Record the source URL, source snapshot date, generation
time, preprocessing version, and schema version in the artifact metadata.

The application must retain visible OpenStreetMap attribution. Generated data
and its distribution must comply with the ODbL and any source-distribution
requirements.

## Proposed artifact

For the Tampere pilot, use compact JSON or GeoJSON compressed by the static
host. Keep the logical schema independent of that encoding so it can later be
packaged into vector tiles or PMTiles without redesigning the renderer.

Store generated pilot assets beneath:

```text
apps/map-app/public/maps/bridges/
```

Use immutable, versioned artifact names and a small manifest, for example:

```text
maps/bridges/
  tampere-manifest.json
  tampere-bridges-v1.json
```

The manifest should contain:

- Schema and preprocessing versions.
- OSM snapshot date and generation timestamp.
- Geographic bounds.
- Artifact URL and optional integrity hash.
- Bridge, vertex, triangle, path, and pier-candidate counts.

Each bridge record should contain at least:

```text
id
source OSM IDs
bounds
deck surfaces
  outer ring
  holes
mesh vertices
triangle indices
normalized span parameter per vertex
associated transport paths
  geometry
  class/subclass
  width
  layer and relevant appearance properties
candidate pier positions
```

Coordinates should initially remain easy to inspect. If payload size becomes a
problem, move to tile-local quantized integers and a binary representation
after correctness has been established.

## Preprocessing pipeline

Implement the pipeline as a reproducible command rather than checking in
manually edited bridge geometry.

1. Read the configured OSM PBF extract.
2. Clip bridge candidates and nearby connecting ways to the pilot boundary.
3. Normalize the relevant OSM tags into the properties understood by the
   renderer.
4. Resolve complete linework without vector-tile boundary splits.
5. Deduplicate and merge continuous bridge transport ways.
6. Parse explicit bridge-area polygons and polygon holes.
7. Associate bridge paths and parallel carriageways with their deck area.
8. Cluster parts that belong to one rendered bridge structure.
9. Construct fallback deck ribbons where no usable area is mapped.
10. Extend approaches and abutments consistently.
11. Triangulate each deck surface.
12. Calculate normalized span parameters and candidate pier positions.
13. Validate geometry and enforce the existing object and complexity budgets.
14. Write the versioned artifact and manifest with deterministic ordering.

Where practical, extract reusable pure geometry functions from
`BridgeModelLayer.ts` rather than maintaining two subtly different algorithms.
Do not couple the preprocessing command to browser, MapLibre, or Three.js
objects.

## Frontend integration

Add a small loader owned by the map layer rather than React UI code. It should:

1. Load the Tampere manifest and artifact only when bridge rendering is enabled
   and the relevant region is approached.
2. Validate the schema version and geographic bounds.
3. Select preprocessed records intersecting the current bridge view.
4. Sample the active MapLibre terrain for prepared mesh vertices, shadow
   probes, and pier locations.
5. Apply the existing deck-profile and terrain-clearance calculations.
6. Create or reuse the existing bounded Three.js resources.
7. Continue supporting deck elevation and roadway placement queries used by
   driving and route rendering.

The preprocessed path must not render the same bridge again through the
runtime-generated path. At the boundary, select one provider for an entire
bridge record rather than clipping a bridge between providers.

If loading, validation, or terrain sampling fails, keep the failure
recoverable. Fall back to the existing OpenFreeMap-derived bridge path and do
not leave the map without draped roads.

## Terrain decision

Keep terrain elevations dynamic during the pilot. This avoids coupling the
artifact to a particular DEM snapshot, zoom level, sampling method, or vertical
datum. Precomputing topology and triangulation should remove most of the
unstable CPU work while allowing the existing Mapterhorn terrain source to
determine final deck placement.

Baked elevations can be evaluated later if measurements show that terrain
sampling remains a significant cost.

## Verification

Create deterministic preprocessing tests for representative cases:

- A simple bridge way without a mapped area.
- A path or cycleway bridge.
- Parallel carriageways sharing a deck.
- A mapped bridge polygon with one or more paths.
- A polygon containing a hole.
- Intersecting ways where one passes under the bridge and must not be attached
  to its deck.
- A multi-part interchange that should remain multiple structures.
- Geometry crossing the pilot boundary.

Compare the preprocessed and current renderers at selected Tampere locations.
Check desktop and phone behavior, terrain on and off, panning, zooming, route
overlays, and drive-mode deck placement.

Collect at least these measurements:

- Source candidate and resulting bridge counts.
- Missing, duplicated, or incorrectly grouped bridges.
- Raw and compressed artifact size.
- Vertices and triangles per bridge and in total.
- Artifact fetch and parse time.
- Terrain-sampling time.
- CPU time until a complete bridge scene is committed.
- GPU resource and retained CPU geometry counts.
- Visual stability while tiles load and while the camera moves.

## Success criteria

The pilot is successful when:

- Bridge decks remain stable while panning and zooming.
- Tile boundaries and arrival order no longer change Tampere bridge topology.
- Multi-road bridges and mapped deck areas are grouped correctly.
- Footpaths and cycleways remain associated with the correct deck.
- No duplicate deck is produced by the preprocessed and fallback paths.
- Drive-mode and route deck elevation lookups continue to work.
- Browser geometry-building time drops materially compared with the current
  implementation.
- The compressed Tampere artifact is practical to serve as a static asset.
- A missing or invalid artifact falls back cleanly to current rendering.

## Follow-up if the pilot succeeds

Preserve the same logical schema and package it as a tiled archive, preferably
PMTiles. A global archive can then live in static object storage behind a CDN
and be accessed with HTTP range requests. Use immutable archive names plus a
small version manifest, configure CORS and long-lived cache headers, and retain
the prior archive during deployments.

A planning estimate for a global archive is approximately 1–3 GB for compact
pretriangulated topology and mesh data, or 2–6 GB if terrain-dependent heights,
shadows, and support geometry are also baked. Clients would download only the
tiles intersecting their current view.

## Suggested implementation sequence

1. Define and test the bridge artifact schema.
2. Add the Tampere OSM extraction and preprocessing command.
3. Generate an inspectable local artifact and review problematic bridges.
4. Add frontend loading behind the existing 3D bridges setting.
5. Retain runtime generation as the explicit fallback.
6. Compare correctness and performance at a fixed set of Tampere locations.
7. Decide whether to refine the schema, adopt PMTiles, or stop the experiment.
