# Browser map application

The application uses the global, keyless hosted-data stack by default:

- OpenFreeMap vector tiles: `https://tiles.openfreemap.org/planet`
- Mapterhorn Terrarium DEM tiles: `https://tiles.mapterhorn.com/tilejson.json`

No API keys or local tile server are required. Start the map with:

```sh
npm install
npm run dev
```

Global mode retains MapLibre terrain, hillshade, OpenMapTiles building
extrusions, water styling, and deterministic procedural trees sampled from
`landcover`, `landuse`, and `park`. Detailed roof geometry, mapped individual trees,
specialized infrastructure, and the custom bridge models depend on fields in
the local Tilemaker schema and are intentionally unavailable in global mode.

The global style starts at world scale using MapLibre's adaptive globe
projection. Continents use a continuous green base while OpenMapTiles ocean and
inland-water polygons provide the blue surface. Between zooms 10 and 12 the
`globe` preset transitions to Mercator; buildings and procedural trees appear
at that close-map scale, where the existing 3D rendering remains compatible.
The Globe control can switch the global view to a conventional Mercator map.

Mapterhorn guarantees full-planet terrain through zoom 12. The app caps the
global DEM there and lets MapLibre overzoom it at closer camera levels. Higher
resolution Mapterhorn tiles have regional coverage and can be introduced later
through a coverage-aware provider without changing the rendering layers.

## Local high-detail provider

The original Tampere Tilemaker and NLS terrain pipeline remains available.
After building and serving its MBTiles as described in
`../tile-tools/README.md`, select it when starting or building the app:

```sh
VITE_MAP_DATA_PROVIDER=local npm run dev
VITE_MAP_DATA_PROVIDER=local npm run build
```

Any value other than `local`, including an unset variable, selects the global
provider. This keeps the hosted and self-managed data contracts separate while
allowing the same UI and MapLibre renderer to support both.

## Attribution and service expectations

MapLibre's attribution control displays the OpenFreeMap, OpenMapTiles,
OpenStreetMap, and Mapterhorn credits supplied by the sources. Keep this control
enabled in deployed builds. The hosted endpoints do not require accounts or API
keys, but they do not provide an SLA; production deployments should retain the
provider switch or point an equivalent provider adapter at self-hosted data.
