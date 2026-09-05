# 3D OSM and Public Transit Map — Architecture

## Runtime

The project is a browser-only React and TypeScript application built with Vite.
MapLibre GL JS owns the camera, vector-tile styling, terrain, labels, roads,
water, land use, and building extrusion. Three.js custom layers add procedural
vegetation and transit vehicle models.

The application uses one hosted map-data path:

- OpenFreeMap vector tiles using the OpenMapTiles schema.
- Mapterhorn Terrarium DEM tiles capped at zoom 12 and overzoomed at close range.
- Photon for place search and Nominatim for optional place details.
- Fintraffic Digitraffic weather cameras for Finnish road camera stills.
- Fintraffic Digitraffic road weather stations, traffic measurement data,
  roadworks, and traffic incidents for optional driving layers.
- Open Charge Map for optional electric-vehicle charging stations, including
  operator, status, and connector types.
- Open-Meteo for viewed-location weather and optional cloud/precipitation
  forecast overlays.
- A provider-neutral transit service: Digitransit for locations in Finland and
  Transitous elsewhere, for stops, departures, route geometry, and vehicle
  progress.
- Valhalla for pedestrian, bicycle, and car routes.

There is no application-owned tile server, local Tilemaker schema, or MBTiles
pipeline. Transit provider selection is geographic and centralized in
`apps/map-app/src/map/transit/`.

## Rendering boundaries

- `GlobalMapStyle.ts` defines the MapLibre style and its hosted sources.
- `GlobalMapStyle.ts` defines a single z12-limited terrain source, preventing
  regional-detail probes and higher-zoom DEM requests.
- `TreeModelLayer.ts` samples hosted vegetation polygons into deterministic,
  instanced Three.js trees.
- `TransitStopsLayer.ts` manages stop markers, selected routes, and estimated
  vehicle markers.
- `TrafficCamerasLayer.ts` shows Fintraffic Digitraffic road weather cameras.
- `RoadWeatherLayer.ts` shows Finnish road weather stations with temperature
  and surface conditions.
- `RoadTrafficLayer.ts` shows TMS traffic as coloured road segments plus
  Fintraffic roadworks and incidents.
- `ChargingStationsLayer.ts` shows Open Charge Map charging stations.
- `Weather.ts` fetches Open-Meteo point forecasts and a coarse cloud/precip
  grid. `WeatherForecastLayer.ts` paints that grid as a MapLibre image overlay.
- `TransitVehicleModelLayer.ts` renders the close-zoom Three.js vehicle model.
- `MapView.tsx` coordinates map state, data services, and custom layers.
- React UI components remain independent of source-layer parsing.

## Repository layout

```text
apps/
  map-app/                 # Browser application
docs/
  ARCHITECTURE.md          # Runtime and rendering boundaries
  API_SERVICE_ASSESSMENT.md
  WEATHER_DATA.md          # Open-data study for a weather panel and overlays
  MVP.md                   # Current product checklist
```

## Operational expectations

- Deployment is a static Vite build.
- Runtime map providers are hosted services and do not require application API
  keys. Digitransit transit requests require the local Vite API-key variable.
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
