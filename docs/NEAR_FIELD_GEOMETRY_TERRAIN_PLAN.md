# Near-Field Geometry and Infrastructure-Aware Terrain Plan

## Objective

Improve close-zoom rendering of buildings, trees, bridges, and roads by
reducing MapLibre tile-driven pop-in, adding predictive loading, and providing
an elevation surface that smooths DEM inconsistencies under infrastructure.

The global map should continue to use MapLibre. Close-range geometry and
corrected elevation should become independently managed, progressively and
behind replaceable provider interfaces.

## Target architecture

```text
Camera, route, and movement
            |
            v
    Near-field coverage planner
            |
      +-----+------+
      |            |
      v            v
 Feature loader  DEM loader
      |            |
      +-----+------+
            v
   Decoded world-cell cache
            |
   Infrastructure elevation model
            |
      +-----+----------+
      |                |
      v                v
 Corrected DEM     Scene snapshots
 for MapLibre      for Three.js
```

The unit of presentation should be a complete scene generation: features,
elevations, and meshes are committed together. The current generation remains
visible while a replacement is loading or being processed.

## Phase 0: Baseline and instrumentation

Measure the current pipeline before changing behavior:

- time from camera movement stopping to complete close-range geometry;
- visible additions/removals and geometry pop-in;
- `querySourceFeatures()` main-thread time;
- geometry generation and GPU upload time;
- DEM request count, cache size, and elevation changes between LODs;
- memory use in normal, drive, and flight modes.

Create deterministic scenarios for normal navigation, rapid zoom, drive mode,
flight mode, uneven bridge approaches, and roads crossing irregular terrain.

**Deliverable:** a baseline report and repeatable performance scenarios.

## Phase 1: Provider boundaries

Introduce interfaces without changing visual behavior:

```ts
interface NearbyFeatureProvider {
  updateCoverage(request: CoverageRequest): void;
  getSnapshot(request: FeatureRequest): FeatureSnapshot;
  subscribe(listener: () => void): () => void;
}

interface ElevationProvider {
  sampleRaw(lng: number, lat: number): number | undefined;
  sampleCorrected(lng: number, lat: number): number | undefined;
  sampleSurface(
    lng: number,
    lat: number,
    surface?: 'terrain' | 'road' | 'bridge-deck',
  ): number | undefined;
}
```

Initially implement adapters around `querySourceFeatures()` and
`queryTerrainElevation()`. Route tree, bridge, façade, roof, and vehicle
sampling through the adapters while retaining current MapLibre behavior.

Relevant current owners include:

- `TreeModelLayer.ts` for vegetation and water feature queries;
- `BridgeModelLayer.ts` for transportation features and bridge terrain
  sampling;
- `RoofModelLayer.ts` and `FacadeModelLayer.ts` for building features;
- `GlobalMapStyle.ts` for hosted vector and DEM source definitions.

**Deliverable:** provider-backed custom layers with no intended visual change.

## Phase 2: Near-field coverage manager

Build a world-cell coverage planner that requests:

- the visible viewport plus a padded ring;
- a forward corridor in drive mode;
- a wider predictive region in flight mode.

Use heading- and velocity-based prioritization, separate load/unload radii,
request cancellation, memory budgets, and stable cell identities. Retain old
complete cells until replacement coverage is ready. Commit coverage changes
atomically rather than once per arriving tile.

The first implementation may still use MapLibre as its feature provider; the
coverage manager should be independently testable.

**Deliverable:** deterministic coverage planning and generation handoff.

## Phase 3: Independent tree loading prototype

Trees are the first independent feature-loader target because their rendering
is already owned by Three.js and their procedural identity is geographic.

Implement direct vector-tile or dedicated endpoint loading, worker decoding,
water/vegetation extraction, stable geographic IDs, deterministic procedural
generation, and padded retention. Compare against the MapLibre-backed path for
network bytes, main-thread time, completion latency, replacements, memory, and
pop-in.

**Success criterion:** less visible pop-in without exceeding agreed frame-time
and memory budgets.

## Phase 4: Shared raw DEM cache

Own close-range DEM decoding before applying corrections:

- experimentally remove the explicit z12 cap in `GlobalMapStyle.ts`;
- determine the provider's actual native maximum zoom;
- decode and cache height tiles independently;
- sample seamlessly across tile boundaries;
- retain parent tiles while child coverage is incomplete;
- smooth parent-to-child elevation changes;
- key cache entries by actual tile, source revision, and zoom.

If the provider has no higher-resolution tiles, removing the cap will not add
detail; a higher-resolution or derived close-range source will be required.

**Deliverable:** an elevation provider equivalent to the raw DEM.

## Phase 5: Infrastructure elevation model

Generate infrastructure-aware elevations separately from the raw DEM.

For ordinary roads:

1. Sample the DEM along the centerline.
2. Remove isolated noise and enforce a plausible maximum grade.
3. Build a smooth longitudinal profile and suitable cross-section.
4. Blend the correction into surrounding terrain over a class-dependent
   shoulder distance.
5. Resolve intersections as connected surfaces.

For bridges:

- preserve terrain below the suspended span;
- establish stable abutment elevations;
- connect approaches smoothly to the deck;
- maintain minimum clearance;
- distinguish decks, embankments, tunnels, and tunnel portals.

Reuse and centralize the existing bridge approach and deck-profile logic where
possible instead of maintaining separate elevation rules in the renderer.

**Deliverable:** `sampleCorrected()` and `sampleSurface()` with deterministic
road and bridge correction fixtures.

## Phase 6: Correct custom geometry and vehicles

Migrate elevation consumers in this order:

1. Transit vehicles;
2. bridge approaches, decks, and supports;
3. trees;
4. façades and roofs;
5. remaining close-range objects.

Verify that vehicles do not pitch on small DEM bumps, bridge approaches meet
decks without jumps, supports remain grounded, and raw terrain elevations are
not accidentally used where infrastructure elevations are required.

At this stage MapLibre's visible terrain can remain raw; this phase validates
the correction model safely.

## Phase 7: Corrected DEM tile experiment

Generate corrected raster-DEM tiles for one deterministic test region:

1. Decode the original DEM with a neighboring-tile border.
2. Load road, bridge, tunnel, and other infrastructure constraints.
3. Apply corrections and preserve untouched terrain outside influence areas.
4. Encode MapLibre-compatible DEM tiles.
5. Cache by source tile, infrastructure revision, and algorithm version.
6. Test as a separate MapLibre terrain source.

Validate tile-edge continuity, parent/child consistency, hillshade, draped
roads, camera elevation, road cuts, bridge clearances, and transitions between
corrected and original coverage.

**Deliverable:** one region where MapLibre and Three.js use the same corrected
surface.

## Phase 8: Independent bridge feature loading

Load transportation features independently, merge bridge segments across cell
boundaries, assign stable bridge identities, and share bridge-deck elevations
with vehicles. Preserve existing bridge CPU/GPU caches and retain the last
complete bridge scene during partial coverage.

**Deliverable:** bridges no longer depend on MapLibre's currently loaded vector
tiles in the near field.

## Phase 9: Buildings

Start conservatively: independently load building features for roofs and
façades while MapLibre continues to render ordinary wall extrusions.

Only consider full building ownership if this cannot meet visual goals. Full
ownership would additionally require wall triangulation, holes and parts,
terrain-conforming bases, picking, style parity, shadows, and distant-map
handoff.

## Phase 10: Hardening and rollout

Bound decoded-feature, DEM, mesh, and texture caches. Add worker recovery,
request cancellation, partial-network fallback, WebGL context recovery, and
mobile memory testing. Preserve MapLibre and provider attribution.

Expose independent fallbacks for feature loading, corrected elevations, and
corrected MapLibre DEM so each subsystem can be disabled without breaking the
map.

## Recommended first milestone

Independently load trees and raw close-range DEM for one viewport, retain
complete geometry while the camera moves, and use corrected road elevations for
vehicles without changing MapLibre's visible terrain yet.

This milestone tests the coverage planner, worker pipeline, caching, stable
identities, elevation sampling, and performance assumptions before committing to
corrected terrain tiles or a full building migration.

## Risks and guardrails

- Duplicate downloads while MapLibre still needs the same source tiles.
- Higher-resolution DEM increasing bandwidth, memory, and terrain rebuild cost.
- Seams between corrected and original terrain.
- Conflicting road profiles at intersections.
- Incorrect bridge/tunnel classification.
- Geometry and terrain generations becoming inconsistent.
- Retaining too many parent and child cells simultaneously.

Every phase should retain the current provider as a fallback and use measured
budgets for main-thread time, GPU memory, decoded data, and network traffic.
