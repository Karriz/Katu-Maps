# Open traffic data abroad — feasibility overview

Katu Maps currently paints live road congestion, weather, cameras,
roadworks, and incidents for **Finland only**, from Fintraffic
Digitraffic. This note asks whether the same products can be obtained
reliably from other **open** sources outside Finland, and what is
reasonable for a static browser application.

Probed 2026-09-05 against live endpoints from this environment. Dates and
payload sizes will drift; the access models will not.

## Short answer

There is **no global open equivalent** of Digitraffic.

European law requires each country to publish safety-related and
real-time traffic information through a National Access Point, almost
always as **DATEX II**. That is a standard for traffic-management centres,
not a map API. Feeds differ by country in transport (HTTPS pull, SOAP,
gzip dumps, mTLS), payload (XML vs JSON), authentication, coverage, and
CORS.

A few national JSON APIs are close enough to Digitraffic that a
**country adapter**, in the same spirit as Digitransit vs Transitous,
could reuse the existing layers. Worldwide Google-style road colouring is
not available as open data.

## What Digitraffic currently supplies

The optional driving layers in `apps/map-app` consume four Finnish
products, all CORS-open, gzip JSON, CC BY 4.0, identified only by a
`Digitraffic-User` header:

| Product | Endpoint pattern | App use |
| --- | --- | --- |
| TMS stations + observations | `/api/tms/v1/stations` and `/stations/data` | Speed and volume per direction, compared with free-flow, painted as coloured road segments |
| Traffic messages | `/api/traffic-message/v2/roadworks` and `traffic-announcements` | Roadworks and incidents with GeoJSON geometry |
| Road weather stations | `/api/weather/v1/stations` and `/stations/data` | Air/road temperature, friction, surface condition |
| Weather cameras | `/api/weathercam/v1/stations` + stills from `weathercam.digitraffic.fi` | Roadside stills in a panel |

Congestion is **derived in the client** (`trafficCongestion()` in
`RoadTraffic.ts`): speed / free-flow ratio, then speed, then volume.
It is not a vendor traffic-tile product. Station list is cached 30
minutes; observations 90 seconds; messages 2 minutes. Gzipped TMS
observations were about 144 KB on the wire and 3.4 MB uncompressed on
the probe date.

Those four products are the bar. Anything “abroad” has to match some of
them without breaking the static-app constraints in
`docs/API_SERVICE_ASSESSMENT.md`.

## Constraints that rule most DATEX feeds out of the browser

Katu Maps has no application backend. Every request is made from the
user’s device, so a candidate source must:

- Answer **cross-origin GET** from a browser (`Access-Control-Allow-Origin`).
- Avoid **secrets**. `VITE_*` values are public. Identifying client IDs
  and Open Charge Map-style keys are acceptable; mTLS certificates and
  DATEX consumer secrets are not.
- Stay within **payload budgets**. A 50 MB DATEX dump cannot be parsed
  on layer toggle.
- Prefer **JSON / GeoJSON**. DATEX II XML is large and awkward in the
  browser.
- Remain **recoverable** when the provider is down, and keep attribution
  visible.

DATEX II itself is fine as a *model*. Digitraffic already publishes the
same situations as DATEX II XML *and* as GeoJSON; the app uses the JSON.
Most other NAPs publish only the XML.

## The European picture: DATEX II and NAPs

EU ITS Directive 2010/40/EU and the SRTI / RTTI delegated acts require
each member state (plus several neighbours) to operate a National Access
Point. NAPCORE coordinates them. Typical DATEX publications:

- **SituationPublication** — incidents, roadworks, closures, sometimes
  queues (this is the closest match to Digitraffic traffic messages).
- **MeasuredDataPublication** — loop/radar speeds and volumes (TMS).
- **Weather / CCTV site tables** — road weather and cameras.

They are **not one API**. Germany’s Mobilithek uses mTLS. Norway’s DATEX
node returns 401 until you register. The Netherlands publishes gzip SOAP
envelopes. France mixes open DIR XML with login-gated concessionaire
feeds. Commercial aggregators (for example NAPSPAN) exist precisely
because of this fragmentation; they are paid products, not open data.

OpenStreetMap has no live congestion. TomTom, HERE, Mapbox, and Google
traffic tiles are the only sources of continuous worldwide colouring, and
they are licensed commercial APIs.

## Live probes of browser-plausible sources

All probes used `Origin: https://example.com` or a stand-in origin so
CORS behaviour is visible.

### Already in the app: Digitraffic (Finland)

- CORS `*`, gzip JSON, no key.
- TMS stations ~23 KB gzip / 209 KB raw; observations ~144 KB gzip /
  3.4 MB raw; announcements ~4 KB gzip / 27 KB raw.

### Lithuania — eismoinfo.lt (strong TMS + cameras)

- `GET https://eismoinfo.lt/traffic-intensity-service` — CORS `*`, JSON,
  no key. **886 stations**, ~623 KB. Each station has `roadSegments`
  with `averageSpeed`, `numberOfVehicles`, and `trafficType` in
  `{normal, slow, heavy, queuing}`. Coordinates are WGS84.
- `GET https://eismoinfo.lt/eismoinfo-backend/camera-info-table` — CORS
  `*`, JSON, **306 cameras**, ~72 KB. Image URLs are public
  (`/image-provider/camera/last?id=`). Camera `x`/`y` are LKS-94 metres,
  not lon/lat, so they need a projection step.
- Closest **drop-in** for the existing congestion colouring and camera
  panel. Incidents and road weather were not found as a similarly open
  JSON feed in this pass.

### Estonia — Tark Tee ArcGIS (cameras, weather, detectors)

Public MapServer queries, CORS reflects the request origin, GeoJSON, no
key:

| Layer | Count | Notes |
| --- | --- | --- |
| `road_cameras` | 179 | WGS84 points, `image_path`, air/road temp, `road_status` |
| `road_weather_stations` | 116 | **L-EST97 metres**, not WGS84. Live fields were often null on the probe |
| `traffic_detectors` | 112 | L-EST97. Forward/back speed, flow, `relative_speed_*` (1 = free flow) |

DATEX II SRTI JSON also exists (`/api/v1/datex/...`) but needs a
registered `X-DATEX-API-KEY` that must stay secret, so it does not belong
in the static bundle. Camera stills and detector speeds are usable
without that key. Coordinates on weather and detectors must be
reprojected (EPSG:3301).

### Germany — Autobahn GmbH JSON (incidents / roadworks)

- `https://verkehr.autobahn.de/o/autobahn/` — CORS `*`, JSON, no key.
- Per-motorway services: `warning`, `roadworks`, `closure`, `webcam`,
  lorry parking, charging.
- Warnings on A1 were **INRIX-sourced congestion events** with
  `averageSpeed`, delay, `abnormalTrafficType`, and a geometry extent.
  That is event-based congestion on federal motorways, not a national TMS
  lattice like Finland.
- Roadworks on A9 were ~221 KB JSON for one road. Covering the network
  means one request per Autobahn id (about 70), so the layer should fetch
  only roads in view.
- Webcam lists for A1, A2, A3, A5, A7, A8, A9, A81, A100 all returned
  `{"webcam":[]}` on the probe date. Treat cameras as currently unused or
  empty until that feed is re-checked.
- **Mobilithek** (the official NAP) is DATEX II over mTLS. It is not a
  browser source. The Autobahn JSON API is the practical German path.

### United Kingdom — WebTRIS (sites, not live colouring)

- `https://webtris.nationalhighways.co.uk/api/v1.0/sites` — CORS `*`,
  JSON, no key, **20,076 MIDAS sites**, ~1.1 MB gzip / 4.1 MB raw.
- Daily reports for “today” returned **204**. The public API is a
  historical counter archive, not a 90-second speed snapshot. It cannot
  drive the current congestion layer without a different product (NTIS
  DATEX, which needs registration).

### Netherlands — NDW (richest TMS, worst browser fit)

- `https://opendata.ndw.nu/trafficspeed.xml.gz` — DATEX II 2 SOAP, **no
  CORS**, ~1.1 MB gzip / **53 MB** XML.
- `actueel_beeld.xml.gz` — DATEX II 3 situations, ~407 KB gzip / 4.1 MB
  XML, also no CORS.
- This is the best open **measured speed** dataset in western Europe and
  is unusable from the map client as-is. A cache/proxy that emits
  viewport GeoJSON would be required, and redistribution terms would
  need a check.

### Norway — Vegvesen DATEX (complete, gated)

Publications for weather, CCTV, travel times, and situations exist at
`datex-server-get-v3-1.atlas.vegvesen.no`. Live GETs returned **401**.
Access is free under NLOD after email registration, XML-only. Same
products as Digitraffic, wrong delivery for a browser.

### Sweden — Trafikverket (complete JSON, needs a key)

`POST https://api.trafikinfo.trafikverket.se/v2/data.json` with an XML
query. CORS `*` (even error responses). Object types include
`TrafficFlow`, `Situation`, `WeatherStation` / `WeatherObservation`,
`Camera`, `RoadCondition`. A free key is issued after registration. The
key would be public in a Vite build, which is the same pattern as Open
Charge Map, but it still needs an application registration and fair-use
monitoring. Trafikverket documents `Content-Type: text/plain` as a way
to avoid a CORS preflight.

### France — Bison Futé / transport.data.gouv.fr

DIR speed/flow XML is described as open; concessionaire and some
safety feeds need a login. Traficolor (fluide / dense / congested) exists
for large agglomerations. Nothing probed here was a Digitraffic-shaped
JSON API with CORS. Treat as DATEX/XML, later, via a proxy if ever.

### Denmark — Vejdirektoratet NAP

A browser SDK (`Vejdirektoratet/sdk-web`) talks JSON to
`data.vd-nap.dk` with an API key for traffic, roadworks, and winter
conditions. The host did not resolve from this environment, so it was
not live-tested. Architecture looks adapter-friendly once a key is
issued.

### Canada — Open511 / DriveBC (events only)

`https://api.open511.gov.bc.ca/events` — CORS `*`, JSON, ~60 KB gzip /
229 KB raw, construction and incidents. No TMS, cameras, or weather.
Useful if an events layer is ever shown in North America; not a
congestion source.

## Comparison to the four Digitraffic products

| Source | Congestion / speed | Incidents / roadworks | Road weather | Cameras | Browser-direct? |
| --- | --- | --- | --- | --- | --- |
| Digitraffic FI | TMS + free-flow | GeoJSON messages | Stations | Stills | Yes |
| eismoinfo LT | Live `trafficType` + speed | Not found as JSON | Not found | 306 stills | Yes |
| Tark Tee EE | 112 detectors, relative speed | DATEX (key) / empty emergency layer | 116 stations | 179 stills | Yes for ArcGIS |
| Autobahn DE | INRIX warning events on motorways | Roadworks + closures | No | Empty on probe | Yes |
| WebTRIS GB | Historical counts | No | No | No | Yes, wrong product |
| NDW NL | Dense DATEX speeds | Situations XML | — | — | No (size + CORS) |
| Vegvesen NO | Travel times DATEX | Situations DATEX | Yes DATEX | Yes DATEX | No (401 + XML) |
| Trafikverket SE | `TrafficFlow` | `Situation` | Weather objects | `Camera` | Yes, with public key |
| Bison Futé FR | DIR XML / Traficolor | DATEX, often gated | — | — | No |
| Open511 BC | No | Events | No | No | Yes |
| TomTom / HERE / Mapbox | Global tiles | Often bundled | No | No | Paid licence |

## What is reasonably possible

### Reasonable now (no backend)

Keep Digitraffic as the Finnish provider. Add a **road-data provider
interface** next to `src/map/transit/`, selected by map location, so
Finland stays as-is.

First adapters that match the current access model (CORS, JSON, no
secret, layer-toggle fetch):

1. **Lithuania** — congestion colouring and cameras. Map `trafficType`
   onto the existing `free | slow | heavy | severe` enum; project camera
   coordinates.
2. **Estonia** — cameras immediately; detectors for congestion after
   EPSG:3301 → WGS84; weather if live fields stay populated.
3. **Germany Autobahn** — roadworks, closures, and INRIX warning
   events, **viewport-limited** to motorways in view. Do not promise a
   national speed lattice.

Sweden is the next-best full twin of Digitraffic if a Trafikverket
application key is acceptable as a public `VITE_` identifier.

Each adapter should fail independently. A user in Berlin should see
German motorway warnings without waiting on a Lithuanian fetch.

### Reasonable later (small cache/proxy)

A thin edge worker that pulls DATEX snapshots, keeps the last good
GeoJSON, and serves bbox queries would unlock Norway, the Netherlands,
and possibly France. That is a new operational surface (hosting, keys,
DATEX version drift, licence text). It is the only honest way to consume
NDW speeds. Do not parse 50 MB XML in MapLibre.

Denmark’s NAP JSON is worth a second look once DNS and a key are in
hand.

### Not reasonable

- **Worldwide open congestion overlay.** Probe-vehicle colouring is
  commercial. Government loops cover motorways and some trunks, country
  by country, with holes.
- **One DATEX II parser in the client** aimed at “all NAPs”. Profiles,
  versions (2.x vs 3.x), SOAP envelopes, mTLS, and dump sizes do not
  collapse into one module.
- **Putting NAP consumer secrets in the Vite bundle.**
- **Using WebTRIS as a live traffic layer.** It is a counter archive.
- **Treating Autobahn webcams as available** until the empty lists
  change.
- **Paid traffic tiles** unless product explicitly wants a licensed
  global layer. They would work; they are not open data.

## Suggested shape if this is implemented later

Mirror transit:

- `src/map/road/types.ts` — station, observation, message, camera
  records the layers already understand.
- `src/map/road/DigitrafficProvider.ts` — current code, moved.
- `src/map/road/EismoinfoProvider.ts`, `TarkTeeProvider.ts`,
  `AutobahnProvider.ts` as needed.
- Geographic selection in one place, like `src/map/transit/index.ts`.
- Attribution strings per provider (Digitraffic already has one).
- Fetch only after the layer is enabled; keep the existing TTLs;
  bbox-filter Germany; never download NDW dumps in the client.

Do not wait for a pan-European JSON NAP. It does not exist in a form
this app can call.

## Sources

- Digitraffic road traffic: https://www.digitraffic.fi/en/road-traffic/
- DATEX II / NAP map: https://datex2.eu/datex-ii-nap-map/
- NAPCORE / SRTI & RTTI: European Commission ITS pages
- Lithuania intensity: https://eismoinfo.lt/traffic-intensity-service
- Estonia Tark Tee: https://tarktee.ee/ and `/tarktee/rest/services`
- Germany Autobahn JSON: https://verkehr.autobahn.de/o/autobahn/
- NDW open data: https://opendata.ndw.nu/
- Norway DATEX: https://www.vegvesen.no/en/fag/technology/open-data/a-selection-of-open-data/what-is-datex/
- Sweden Trafikverket API: https://api.trafikinfo.trafikverket.se/
- UK WebTRIS: https://webtris.nationalhighways.co.uk/api/swagger/ui/index
- Open511 DriveBC: https://api.open511.gov.bc.ca/events
