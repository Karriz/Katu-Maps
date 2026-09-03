# MapLibre GL JS v6 migration

## Changes

The map application was upgraded from MapLibre GL JS 5.24.0 to 6.6.0, then to
6.7.0. Version 6 no longer exposes a default TypeScript export, so the map and
both custom Three.js layers now use the package's namespace export. No terrain,
projection, or custom-layer API changes were otherwise required.

The existing compatibility settings already meet the v6 requirements:

- TypeScript targets ES2022 and includes the ES2022 library.
- Vite emits a separate MapLibre chunk and processes the v6 package normally.
- The Mapterhorn raster DEM source remains capped at `maxzoom: 12`.
- Terrain is still toggled with `setTerrain`, and model altitude is still
  sampled with `queryTerrainElevation`. MapLibre 6.7.0 no longer accepts
  `{ exaggerated: false }`; the returned value is always scaled by the
  current exaggeration, so a temporary DEM sample uses exaggeration 1.
- The adaptive globe projection and the Three.js custom-layer projection data
  remain enabled.

MapLibre 6.7.0 keeps those APIs and tightens camera and terrain behaviour:

- `queryTerrainElevation` and `project()` sample the same DEM zoom as the
  rendered terrain mesh, so trees, vehicles, and position elevation stay on
  the visible surface.
- Pan and zoom gestures on terrain no longer jump the camera at the end of
  the gesture; the center elevation is taken from the rendered surface.
- The `Map` constructor throws `GPUInitializationError` when a WebGL2 context
  cannot be created, instead of emitting an `error` event that no listener
  can catch. `MapView` surfaces that failure as the existing map-unavailable
  state.

## Validation

`npm run build` passes, including the TypeScript project build and the Vite
production bundle. This validates the v6 public types used by the map, terrain,
globe, and custom layers, but it does not replace runtime GPU testing.

No physical Android device is available in the automated development
environment, so no before/after frame-rate claim has been recorded. Before
merging or releasing, compare 6.6.0 and 6.7.0 on the same Android device with
the same Tampere location, zoom, pitch, enabled layers, and network conditions.
For each version, record:

1. Smoothness and visible stutters while panning, pinch-zooming, rotating, and
   moving in a pitched view.
2. Terrain tile loading and hillshade/terrain correctness, including whether
   the camera stays on the grabbed terrain point through pan and zoom.
3. Placement of buildings, trees, and transit vehicles against the terrain.
4. Errors or retained rendering artifacts after repeatedly disabling and
   enabling terrain.
5. Globe-to-Mercator transitions and the manual Globe control.

Keep the DEM source at `maxzoom: 12` throughout the comparison so that the
MapLibre version remains the principal variable.
