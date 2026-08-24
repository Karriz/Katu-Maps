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
`landcover`, `landuse`, and `park`. Building colours use mapped facade colours
where available and a stable facade-material palette otherwise. Ordinary buildings use
one non-overlapping set of estimated three-metre storey slices at every building
zoom; only their alternating detail colours fade in at close zooms. Short and
structures over 100 metres stay on a single extrusion because OpenFreeMap does
not expose storey counts or parent-building IDs. Untagged parts created together
share a coarsened deterministic colour seed. The global style also distinguishes road and rail bridges,
tunnels, transport hierarchy, airports, ranked labels, peaks, parks, stations,
and close-zoom house numbers. Detailed roof geometry, mapped individual trees,
specialized infrastructure, and custom bridge meshes depend on fields in the
local Tilemaker schema and are intentionally unavailable in global mode.

The global style starts at world scale using MapLibre's adaptive globe
projection. Continents use a continuous green base while OpenMapTiles ocean and
inland-water polygons provide the blue surface. Between zooms 10 and 12 the
`globe` preset transitions to Mercator; buildings and procedural trees appear
at that close-map scale, where the existing 3D rendering remains compatible.
The Globe control can switch the global view to a conventional Mercator map.

Mapterhorn guarantees full-planet terrain through zoom 12. The app probes the
initial center for the regional terrain ceiling while still zoomed out, then
checks the center and corners after close-range moves. It keeps an installed
source when its resolution is unchanged and otherwise falls back to the global
source. Water is drawn above hillshade so lakes and oceans remain visually flat
even when surrounding terrain is enabled.

The production build separates the application, React, Three.js, MapLibre, and
other dependencies into independently cacheable chunks. This keeps ordinary
style and UI changes out of the large stable renderer bundles.

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
