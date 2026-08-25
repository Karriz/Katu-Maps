# 3D OSM and Public Transit Map — Architecture

## Runtime

The project is a browser-only React and TypeScript application built with Vite.
MapLibre GL JS owns the camera, vector-tile styling, terrain, labels, roads,
water, land use, and building extrusion. Three.js custom layers add procedural
vegetation and transit vehicle models.

The application uses one hosted map-data path:

- OpenFreeMap vector tiles using the OpenMapTiles schema.
- Mapterhorn Terrarium DEM tiles, including runtime probing for regional detail.
- Photon for place search and Nominatim for optional place details.
- Transitous for stops, departures, route geometry, and vehicle progress.
- Valhalla for pedestrian, bicycle, and car routes.

There is no application-owned tile server, local Tilemaker schema, MBTiles
pipeline, or provider-selection environment variable.

## Rendering boundaries

- `GlobalMapStyle.ts` defines the MapLibre style and its hosted sources.
- `TerrainCoverage.ts` discovers detailed terrain coverage and falls back to
  the guaranteed global DEM range.
- `TreeModelLayer.ts` samples hosted vegetation polygons into deterministic,
  instanced Three.js trees.
- `TransitStopsLayer.ts` manages stop markers, selected routes, and estimated
  vehicle markers.
- `TransitVehicleModelLayer.ts` renders the close-zoom Three.js vehicle model.
- `MapView.tsx` coordinates map state, data services, and custom layers.
- React UI components remain independent of source-layer parsing.

## Repository layout

```text
apps/
  map-app/                 # Browser application
docs/
  ARCHITECTURE.md          # Runtime and rendering boundaries
  MVP.md                   # Current product checklist
```

## Operational expectations

- Deployment is a static Vite build.
- Runtime providers are hosted services and do not require application API keys.
- MapLibre attribution must remain visible.
- Provider failures should remain recoverable where cached parent tiles or a
  lower-resolution terrain source are available.
- Expensive custom layers must use deterministic sampling, instancing, and hard
  object budgets rather than one scene object per feature.

## Verification

- A clean checkout must build without local map data or a tile server.
- Pan, zoom, pitch, globe transitions, terrain, buildings, and trees must remain
  usable on representative desktop browsers.
- Search, transit selection, live departures, routing, and every visible layer
  control must be exercised before release.
- Source/provider attribution must stay visible at desktop and mobile sizes.
