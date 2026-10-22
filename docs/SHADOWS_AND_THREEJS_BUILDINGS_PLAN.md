# Shadows and Three.js Building Plan

## Objective

Give terrain, buildings, trees, bridges, and vehicles real directional
shadows and baked ambient occlusion, in place of the current per-layer fakes:
paint-property shadow translates on fill-extrusion buildings, fixed-azimuth
hillshade for terrain, and offset blob-shadow decals on Three.js models.

The global map keeps its cartoon diorama look: soft, colored shadows driven by
the existing sun model, not black raytraced shading.

## Current state

| Surface | Owner | Current fake | Limit |
|---|---|---|---|
| Buildings (body) | MapLibre `fill-extrusion` (`global-buildings`, `global-building-ground-storeys`) | shadow-translate paint prop, pastel color bands | Cannot cast or receive real shadows; MapLibre exposes no shadow pass or scene depth buffer |
| Terrain | MapLibre terrain (Mapterhorn) + `terrain-hillshade` | `hillshade-illumination-direction` fixed at `CARTOON_SUN_AZIMUTH_DEGREES` | Hillshade is slope shading, not cast shadows |
| Trees, bridges, facades, roofs, vehicles | Three.js custom layers | Blob shadow quads offset along sun azimuth, `MeshLambertMaterial` + hemisphere and directional lights | `castShadow` unused; no shadow maps |

Shared foundations that already exist:

- `CartoonLighting.ts`: single sun model (azimuth, polar, colors) shared by
  MapLibre extrusions and Three.js layers.
- `DayNightSun.ts` / `DayNightShadeLayer.ts`: real solar direction and the
  day/night terminator.
- Terrain sampling: `sampleGround` / `shadowTerrainHeights` used by
  `BridgeModelLayer`, plus scene-origin elevation handling in
  `FacadeModelLayer`.
- `BuildingModelWork.ts`: view tracking, overlap ratio, frame-budget
  generators, geometry merging.
- `FacadeModelLayer` / `RoofModelLayer`: the incremental
  `querySourceFeatures` -> generator (4ms frame budget) -> merged mesh
  pipeline, with flight mode and dark mode support.
- Buildings are not hit-tested for info panels (`locationLayers` in
  `MapView.tsx` is icons/labels only), so moving building geometry does not
  break interaction.

## Phase 1: Shadow catcher on the ground

One Three.js custom layer owning a draped ground mesh built from the terrain
DEM, slightly above the map ground with polygon offset, rendered with
`THREE.ShadowMaterial`.

- Enable `castShadow` on existing Three.js meshes: trees, bridge decks,
  facades, roofs, vehicles.
- One `THREE.DirectionalLight` with `castShadow`, PCF soft shadow map
  (1024–2048px), orthographic shadow camera refit to the viewport each frame.
- Shadow color and night fade reuse `CARTOON_SHADOW_COLOR` /
  `CARTOON_NIGHT_SHADOW_COLOR` and the existing `treeShadowOpacity` fade so
  the catcher replaces, not duplicates, the blob decals.
- Existing blob-shadow decals for casters are retired once the catcher is
  stable, or kept as a low-quality fallback.

Deliverable: trees, bridges, facades, roofs, and vehicles cast real
directional shadows onto terrain.

Risks:

- Draped mesh must track terrain tile updates and LOD switches; reuse the
  elevation sampling already used for bridge shadow probes.
- One extra depth pass of casters; keep the caster set culled to the viewport
  and the shadow map within the existing object/performance budgets.

## Phase 2: Sun-coupled direction and length

Replace the fixed 225°/35° cartoon sun for shadowing with the solar direction
from `DayNightSun`:

- shadow azimuth and elevation follow the time slider / day cycle;
- hillshade `illumination-direction` updated to match;
- shadow length follows sun elevation (long at dawn/dusk, short at noon);
- at night, shadows fade with the existing `nightMix` handling instead of
  switching off abruptly.

Deliverable: shadow geometry agrees with the day/night terminator and
hillshade.

## Phase 3: Building casters (footprint projection)

Fill-extrusion buildings cannot participate in the Three.js shadow pass.
Interim solution: project building footprints as caster quads extruded along
the sun vector, using the footprint machinery already built for bridge shadow
plans:

- one merged caster mesh per view, rebuilt under the existing frame-budget
  generator pattern;
- heights from the CPU-side equivalents of `GLOBAL_BUILDING_HEIGHT` /
  `GLOBAL_BUILDING_BASE` (`render_height` / `render_min_height`);
- only buildings within the shadow-camera frustum participate.

Deliverable: MapLibre-owned buildings cast plausible shadows without their
geometry moving.

This phase becomes unnecessary for near-field buildings once Phase 4 lands;
it may remain as the far-field fallback.

## Phase 4: Near-field Three.js building bodies

Promote near buildings (z15+, within view) to Three.js extruded bodies,
keeping fill-extrusion as the far-field and low-zoom LOD. This mirrors what
`FacadeModelLayer` already does for window details.

- New body extruder next to `FacadeGeometry`: walls from
  `render_min_height` to `render_height`, cap triangulation, holes and
  multi-polygons (ring parsing reusable from `FacadeGeometry.ts`).
- Port the paint expressions (`GLOBAL_BUILDING_HEIGHT`,
  `GLOBAL_BUILDING_FIRST_STORY_TOP` story bands, pastel color variation,
  z13 opacity fade) from style expressions to CPU-side values.
- New layer cloned from the `FacadeModelLayer` pipeline:
  `querySourceFeatures` -> frame-budget generator -> merged mesh, with
  terrain-elevated origin and flight mode support.
- Fade the MapLibre twin of promoted buildings with `feature-state` opacity
  so the two renderers never double-draw the same building.
- Buildings become real casters and receivers in the Phase 1 shadow pass;
  building-on-building shadows come free.

Deliverable: near-field buildings participate fully in shadows and AO.

Explicitly rejected: full replacement of fill-extrusion at all zooms. MapLibre
extrudes on the GPU from 2D footprint buffers cached per tile with no rebuild
on camera movement; a Three.js full replacement would need tile-granular
caching, LOD, and streaming to reach parity, and a z13 viewport over a metro
(tens of thousands of buildings) defeats the recenter-rebuild pattern. The
near-field promotion design gets the shadow benefits where they are visible
and keeps MapLibre doing what it is better at.

## Phase 5: Ambient occlusion (no SSAO)

True screen-space AO needs the full-scene depth buffer, which MapLibre does
not expose. Hard blocker; do not attempt a post-process pipeline.

What works instead, all deterministic and instanced-friendly:

- Baked vertex AO on procedural models: darken wall bases, roof edges,
  trunk/canopy junctions, eaves.
- Widen the existing ground-contact decals into soft radial contact darkening
  where the shadow catcher does not already cover contact.
- Terrain: hillshade already approximates slope AO; optionally add a
  multi-directional or sky-view-factor pass only if terrain shading still
  reads flat after real shadows land.

Deliverable: grounded contact darkening consistent with the shadow direction.

## Cross-cutting constraints

- Shadow maps render under SwiftShader for visual tests; keep shadows off
  elapsed-time animation in deterministic fixtures (existing rule).
- Preserve the day/night appearance contracts in `DayNightAppearance.test.ts`
  and the palette in `MapPalette.ts`.
- One extra depth pass and one merged caster mesh are the steady-state GPU
  costs; rebuild CPU spikes stay bounded by the frame-budget generators and
  are visible in the existing `performanceStats`.
- Lighting seam risk: at the promotion boundary, Lambert-shaded Three.js
  bodies sit next to fill-extrusion shading of the same building. The facade
  layer already tolerates this; bodies are larger surfaces, so ported paint
  colors may need tuning against the Three.js light intensities.

## Suggested order and rough effort

| Phase | Scope | Effort |
|---|---|---|
| 1 | Shadow catcher layer | days |
| 2 | Sun-coupled direction | days |
| 3 | Building footprint casters | ~1 week |
| 4 | Near-field Three.js building bodies (~800–1,500 LOC) | ~1–2 weeks |
| 5 | Baked AO | days, can interleave |

Phases 1–3 deliver the visible payoff (real directional shadows on terrain
from trees, bridges, and buildings) without moving any building geometry.
Phase 4 is the largest single step and should only start once the shadow
catcher is proven stable in drive and flight modes.
