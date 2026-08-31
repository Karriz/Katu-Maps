# Browser map application

The application uses the global, keyless hosted-data stack by default:

- OpenFreeMap vector tiles: `https://tiles.openfreemap.org/planet`
- Mapterhorn Terrarium DEM tiles: `https://tiles.mapterhorn.com/tilejson.json`

No API keys or local tile server are required. Start the map with:

```sh
npm install
npm run dev
```

Transit data uses Transitous globally and Digitransit automatically inside
Finland. To enable Finnish transit data, copy `.env.example` to `.env.local`
and set `VITE_DIGITRANSIT_SUBSCRIPTION_KEY` to a Digitransit developer API key.
The Vite variable is public at runtime because this is a static browser
application; use a backend proxy if the deployment requires a secret
credential.

The map retains MapLibre terrain, hillshade, OpenMapTiles building
extrusions, water styling, and deterministic procedural trees sampled from
`landcover`, `landuse`, and `park`. Building colours use mapped facade colours
where available and a stable facade-material palette otherwise. Ordinary buildings use
one non-overlapping set of estimated three-metre storey slices at every building
zoom; only their alternating detail colours fade in at close zooms. Short and
structures over 100 metres stay on a single extrusion because OpenFreeMap does
not expose storey counts or parent-building IDs. Untagged parts created together
share a coarsened deterministic colour seed. The style also distinguishes road and rail bridges,
tunnels, transport hierarchy, airports, ranked labels, peaks, parks, stations,
and close-zoom house numbers.

The style starts at world scale using MapLibre's adaptive globe
projection. Continents use a continuous green base while OpenMapTiles ocean and
inland-water polygons provide the blue surface. Between zooms 10 and 12 the
`globe` preset transitions to Mercator; buildings and procedural trees appear
at that close-map scale, where the existing 3D rendering remains compatible.
The Globe control can switch the global view to a conventional Mercator map.

The experimental terrain configuration caps Mapterhorn DEM tiles at zoom 12.
MapLibre overzooms that globally available terrain at closer camera zooms,
avoiding regional-detail probes and z13-z18 DEM requests. Water is drawn above
hillshade so lakes and oceans remain visually flat even when surrounding
terrain is enabled.

The production build separates the application, React, Three.js, MapLibre, and
other dependencies into independently cacheable chunks. This keeps ordinary
style and UI changes out of the large stable renderer bundles.

## Visual review suite

The Playwright suite renders Chromium with ANGLE/SwiftShader and checks WebGL2
explicitly before waiting for the map. Install Chromium once, then run all
scenarios or select one by its descriptive name:

```sh
npx playwright install --with-deps chromium
npm run test:visual
npm run test:visual:scenario -- phone-search-autocomplete
```

For long reload-heavy runs, the visual suite can use an externally managed
Vite process so the server lifetime is independent of Playwright:

```sh
# terminal 1
npm run test:visual:server

# terminal 2
npm run test:visual:external
```

Open `test-results/visual-report/index.html` after the run. The self-contained
gallery links to full-size PNG files and records the scenario, viewport, fixture,
browser, MapLibre and WebGL diagnostics, console errors, and failed requests.
Search, Nominatim details, Digitransit stops/departures/trips/plans, and
Valhalla routes are intercepted with the coherent `tampere-ui-v1` fixture set.
The responses still pass through the production provider parsers and UI flows;
the suite does not inject ready-made component state. Fixture times are created
relative to the test start, while the browser's global clock continues to
advance because MapLibre relies on normal timing for rendering and readiness. Hosted map tiles remain external because maintaining a
vector-tile pipeline solely for screenshots would be disproportionate; a tile
outage therefore fails readiness instead of capturing a permanently loading
screen. The CI UI scenarios use a deterministic software-rendering layer profile with
buildings and transit enabled and terrain, procedural trees, and 3D transit
models disabled. Those expensive layers are unsuitable for repeated large
SwiftShader captures and require separate focused coverage. The first readiness
failure records a screenshot, page and console errors, failed requests, HTTP
errors, WebGL details, and the visible map status. Later scenarios then fail
quickly with the same readiness-gate diagnostic rather than repeating the full
timeout. A scenario also fails if its required screenshot cannot be produced.

These images are intended to review hierarchy, spacing, responsive panels,
overlap, route fitting, and marker/label relationships. SwiftShader does not
measure phone frame rate, thermals, gestures, physical GPS, vendor GPU drivers,
or Samsung/Chromium atlas corruption. The CI workflow reports failures honestly but is not configured as a required
branch-protection check. Make it required only after tile availability and
rendering variance have been stable over a representative run history.

## Attribution and service expectations

MapLibre's attribution control displays the OpenFreeMap, OpenMapTiles,
OpenStreetMap, and Mapterhorn credits supplied by the sources. Keep this control
enabled in deployed builds. The hosted endpoints do not require accounts or API
keys, but they do not provide an SLA.
