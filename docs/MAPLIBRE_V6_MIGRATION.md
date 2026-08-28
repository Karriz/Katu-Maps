# MapLibre GL JS v6 migration

## Changes

The map application was upgraded from MapLibre GL JS 5.24.0 to 6.6.0. Version
6 no longer exposes a default TypeScript export, so the map and both custom
Three.js layers now use the package's namespace export. No terrain, projection,
or custom-layer API changes were otherwise required.

The existing compatibility settings already meet the v6 requirements:

- TypeScript targets ES2022 and includes the ES2022 library.
- Vite emits a separate MapLibre chunk and processes the v6 package normally.
- The Mapterhorn raster DEM source remains capped at `maxzoom: 12`.
- Terrain is still toggled with `setTerrain`, and model altitude is still
  sampled with `queryTerrainElevation`.
- The adaptive globe projection and the Three.js custom-layer projection data
  remain enabled.

## Validation

`npm run build` passes, including the TypeScript project build and the Vite
production bundle. This validates the v6 public types used by the map, terrain,
globe, and custom layers, but it does not replace runtime GPU testing.

No physical Android device is available in the automated development
environment, so no before/after frame-rate claim has been recorded. Before
merging or releasing, compare 5.24.0 and 6.6.0 on the same Android device with
the same Tampere location, zoom, pitch, enabled layers, and network conditions.
For each version, record:

1. Smoothness and visible stutters while panning, pinch-zooming, rotating, and
   moving in a pitched view.
2. Terrain tile loading and hillshade/terrain correctness.
3. Placement of buildings, trees, and transit vehicles against the terrain.
4. Errors or retained rendering artifacts after repeatedly disabling and
   enabling terrain.
5. Globe-to-Mercator transitions and the manual Globe control.

Keep the DEM source at `maxzoom: 12` throughout the comparison so that the
MapLibre version remains the principal variable.
