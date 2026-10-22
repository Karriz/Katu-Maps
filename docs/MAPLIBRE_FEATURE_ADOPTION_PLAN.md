# MapLibre GL JS feature adoption plan

The map application runs MapLibre GL JS 6.15.0 (upgraded from 6.7.0). This plan
lists the remaining 6.x features worth adopting, what they need, and what was
deliberately ruled out. It should be updated whenever MapLibre is upgraded.

## Already adopted with the 6.15.0 upgrade

- Native `contextmenu` on touch long press (6.11): `installMapInteractions.ts`
  no longer runs its own long-press timer; right click, touch/pen long press,
  and Shift+F10 share one handler.
- Terrain gesture and camera fixes (6.12-6.14): no more view sliding when
  terrain turns on mid-gesture, no camera jump at gesture end. The stale-gesture
  workaround in `MapTerrain.ts` kept only the parts still backed by MapLibre
  internals (`elevationFreeze`, `scrollZoom.reset`).
- GeoJSON source robustness (6.12, 6.15): no memory growth when `setData` is
  called faster than the worker consumes it. This covers the live-vehicle
  animation loop, which pushes a full collection roughly every 80 ms.
- Built-in complex-script shaping (6.9): Arabic, Hebrew, Devanagari and similar
  labels shape correctly without the RTL text plugin, which was never loaded.
- `Map#project` fix for points behind the camera (6.9.1): DOM markers move
  off-screen correctly while pitched or rotated.
- Symbol, triangulation, and tile-loading performance work (6.9-6.15), and the
  Safari/iPadOS blank-map and backgrounded-tab workarounds.
- `Map#calculateAnchoredCameraOptions` (6.11): the manual anchor math in
  `MapViewportLayout.ts` (`selectionCameraOffset`, `followCameraCenter`) is
  replaced by one `anchoredCameraOptions` helper that places a selection or a
  followed vehicle at the visible map target point through MapLibre's own
  transform, terrain included. `smoothlyFollowVehicle` and the selection
  cameras in `useMapCameraCoordinator.ts` ease to it. This completed the
  camera half of the manual panel-offset system; the persistent map padding
  migration it enables is still open (see Ruled out).
- `dragRotate: { around: 'pointer' }` (6.15): the `Map` constructor in
  `MapRuntime.ts` now rotates and tilts around the point under the pointer
  instead of the map center. The drive and flight simulators keep the
  handler disabled.
- `font-faces` style spec property (improved through 6.15):
  `GlobalMapStyle.ts` declares a vendored `Noto Sans Regular` webfont
  (`public/fonts/`, SIL OFL) for Latin, Greek, and Cyrillic labels, scoped
  with `unicode-range` so complex scripts still fall back to the hosted
  OpenFreeMap glyph PBFs, which remain in the style as the fallback.

## Adoptable next

Ranked by value per effort. Each item names the code it would touch.

1. `fill-extrusion-rounded-corner-distance` (v6, shading improved in 6.12).
   The fill-extrusion building footprint layer in `GlobalMapStyle.ts`
   (`global-building-footprints` family) can set it to soften building
   corners. The Three.js building models are separate and unaffected.
   Low effort: one paint property plus visual review.

2. `global-state` style expressions with `setGlobalState` (initial state in
   the constructor and `setStyle` since 6.14; paint/light/sky transitions over
   state changes since 6.11). `DayNightStyle.ts` currently flips day/night by
   looping `setPaintProperty` over each layer. With `global-state`, the style
   defines both themes and one `setGlobalState` call switches them, animated.
   Large effort: the generated style is ~3400 lines and every themed paint
   property would need an expression. Only worth it if theme switches are ever
   too slow or the style moves to a generated pipeline.

3. `GeoJSONSource#updateData` (available since mid-6.x, stabilized through
   6.15). Push vehicle position changes as diffs instead of full `setData`
   collections in `LiveVehicles.ts` (`paintAnimated`, `commitVehicles`).
   Helps most with large fleets where most-but-not-all vehicles move per
   tick. Moderate effort; the transitions, prediction, and zoom-presentation
   state make this a careful change. The 6.12 memory fix already removed the
   crash risk, so this is optimization, not correctness.

## Ruled out or not applicable

- `absolutePadding` on `fitBounds`/`cameraForBounds` (6.12): still a no-op
  today (persistent map padding is always zero, so additive equals absolute)
  and its real semantics would set the panel padding as persistent map
  padding. The camera helpers now anchor through
  `Map#calculateAnchoredCameraOptions`, which is padding-aware by itself, but
  the rest of the panel-offset system is still manual:
  `visibleMapTargetPoint` computes screen targets from panel rects and
  `fitRouteInView` passes per-call padding, so enabling `absolutePadding`
  would double-shift selection and vehicle-follow cameras. Revisit as part
  of the persistent map padding migration, not before it.
- `addProtocol` returning `ImageBitmap` (6.11): no `addProtocol` usage.
- Raster tile cross-fade when zooming out from `maxzoom` (6.12): no raster
  sources in the style.
- `GeolocateControl.zoomToUserAccuracy` (6.12): user location is tracked via
  the app's own source, not the control.
- `addProjection`/`removeProjection` and custom planar CRS (6.15,
  experimental): consumer globe/mercator map, no CRS needs.
- `CustomLayerInterface.renderToTerrainTile`/`terrainTileRevision`/
  `renderTerrainHeightMap` (6.13, experimental): these drape raster output
  over terrain; the Three.js tree, vehicle, and bridge layers render models,
  not drapes. Revisit if a draped layer (for example ground-anchored decals)
  is ever added.
- Vertical-label OpenType `vert` forms (6.15): no vertical labels in the style.

## On the horizon (MapLibre main branch, expected after 6.15)

- `Map#setMaxBounds` constraining one geographic axis without the other.
- `transformStyle` accepted in the `Map` constructor.
- `absolutePadding` becomes the default in version 7 - plan the manual offset
  migration before any v7 upgrade.
