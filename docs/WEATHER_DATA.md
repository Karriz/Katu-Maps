# Weather panel and overlays — open-data study

This note assesses whether Katu Maps can add a **weather panel for the viewed
location**, plus **cloud cover**, **snow cover**, and a **time slider** over
radar / precipitation forecasts, without adding an application backend.

Checked against live endpoints on 5 September 2026. Product constraints that
matter: the app is a static Vite build; requests originate in the browser;
MapLibre owns sources and style; one info panel is open at a time; attribution
must stay visible; provider failures must remain recoverable.

**Verdict:** a location weather panel is a good fit and can ship from existing
open JSON APIs. Visual cloud and snow overlays are feasible as optional layers.
A true **radar nowcast / forecast slider** is not globally available as open
browser tiles today. A practical slider can combine **past radar** (where
coverage exists) with **model precipitation and cloud-cover forecasts**.

Existing Digitraffic **road weather** (air/road temperature, ice, friction,
road-surface snow) should stay as the driving-layer product it already is. It
is not a substitute for location weather or sky/snow cover.

## What the app already has

| Surface | Scope | Source |
| --- | --- | --- |
| Road weather stations and panel | Finland, roads only | Fintraffic Digitraffic (`RoadWeather.ts`) |
| Traffic cameras | Finland, roads only | Digitraffic weathercam |
| Location / position panels | Global, no weather | OSM / Photon / Nominatim |
| Layer toggles | Optional overlays | `MapControls.tsx` driving group |

`usePanelCoordinator.ts` already enforces a single info panel. Weather for a
place belongs inside `LocationInformationPanel` / `PositionInformationPanel`,
not as a fifth competing exclusive panel. Map overlays belong with the other
optional layers.

## Recommended product shape

Three independent pieces, in this order:

1. **Point weather** for the selected (or pinned) location: current conditions,
   cloud cover %, precipitation, snow depth, and a short hourly strip.
2. **Optional map overlays:** past rain radar, forecast cloud cover, forecast
   snow depth / satellite snow extent.
3. **Time slider** that drives whichever overlay is on. Past radar uses ~10
   minute frames. Forecast overlays use hourly model steps.

Do **not** poll weather from the live map centre on every pan. Fetch on
selection (place, pin, shareable coordinates), with a session cache keyed by
rounded lat/lon. Continuous centre polling would leak coordinates, waste quota,
and fight the existing interaction-driven request style.

## Finland open data

Finnish Meteorological Institute (FMI) open data is CC BY 4.0
([licence](https://en.ilmatieteenlaitos.fi/open-data-licence)). The useful
browser surface is the JSON **timeseries** plugin, not WFS XML.

### Point observations and forecasts (good for a panel)

`https://opendata.fmi.fi/timeseries` returns JSON, sends
`Access-Control-Allow-Origin: *`, and caches for 60 seconds. A Helsinki
HARMONIE request on 5 September 2026 returned 12 hourly steps with
`Temperature`, `TotalCloudCover` / low/mid/high, `Precipitation1h`, wind, and
`WeatherSymbol3`.

| Product | Access | Notes |
| --- | --- | --- |
| HARMONIE / MEPS point forecast | `timeseries?producer=harmonie_scandinavia_surface` or WFS `fmi::forecast::harmonie::surface::point::simple` | Nordic ~2.5 km surface model. Cloud cover and precipitation work in JSON. Prefer timeseries over WFS XML in the browser. |
| ECMWF point forecast | WFS `ecmwf::forecast::surface::point::simple` | Coarser global backup inside FMI. |
| Station observations | WFS `fmi::observations::weather::simple` (`t2m`, `snow_aws`, cloud `n_man`, …) | Snow depth parameter `snow_aws` is live. A small Lapland bbox returned thousands of XML members; always bound time, parameters, and `maxlocations`. |
| Daily snow depth | WFS `fmi::observations::weather::daily::simple` (`snow`) | Station snow, not a map of cover. |

HARMONIE `SnowDepth` in timeseries was `null` for a northern point in this
September sample. Treat modelled snow depth as optional and fall back to
`snow_aws` observations or a global model.

### Radar (excellent data, poor direct-browser fit)

FMI publishes composites every ~5 minutes, retained ~6 days:

- Reflectivity `dbz`, rain rate `rr`, 1/12/24 h accumulation
- Hydrometeor class `hclass` (rain, wet/dry snow, graupel, hail)
- Cloud-top height `etop_20`
- GeoTIFF / HDF5 on AWS (`fmi-opendata-radar-geotiff`), CC BY 4.0
- WFS stored queries `fmi::radar::composite::*`

**FMI WMS must not be used as the production tile source.** The institute
states that WMS is for evaluation only, and that web/mobile apps must download
via WFS (or S3) and **host the images themselves**
([WMS manual](https://en.ilmatieteenlaitos.fi/open-data-manual-fmi-wms-services)).
That implies a tile/cache service, which the current architecture does not
have.

Radar layer names are also being renewed; old names are scheduled to retire
around November 2026. Any FMI radar pipeline should use current product names.

### Nowcast / rain-radar forecast

MetCoOp nowcast (`metcoop_scandinavia_nowcast_surface`) is documented on FMI’s
**commercial** SmartMet host. `opendata.fmi.fi` rejected that producer name in
this check. Do not plan a Finnish radar-nowcast slider on open data until that
product is confirmed on the open endpoint.

### Snow cover maps (satellite, daily)

| Product | Access | Notes |
| --- | --- | --- |
| SYKE fractional snow cover | WMS `eo:EO_FSC` at `https://geoserver2.ymparisto.fi/geoserver/eo/wms` | Northern/Central Europe since 2014, daily optical FSC. GetCapabilities sent `Access-Control-Allow-Origin: *`. |
| FMI/SYKE NDSI | `https://data.nsdc.fmi.fi/geoserver/wms` layer `PTA:s2m_ndsi` | Sentinel-2 snow index; `TIME=` date. |
| Copernicus HR-S&I | WEkEO / Copernicus Land | 20 m European snow extent, wet/dry snow. Account-oriented, not a drop-in browser tile API. |

These are **yesterday’s satellite snow**, not a forecast, and they fail under
cloud. They complement, rather than replace, modelled `snow_depth`.

### What not to use from Finland for this app

- FMI Open WMS as a live MapLibre raster source.
- Unbounded WFS observation dumps (multi-megabyte XML).
- Digitraffic road sensors as “weather for this park / neighbourhood”.
- HARMONIE GRIB grids fetched in the browser (`fmi::forecast::harmonie::surface::grid`).

## Global open data

### Point weather — Open-Meteo (best default)

[Open-Meteo Forecast API](https://open-meteo.com/en/docs): no key, CORS `*`,
JSON, CC BY 4.0 data, HTTPS.

Helsinki sample (5 September 2026): `current.cloud_cover` 98%,
`snow_depth` 0 m, WMO `weather_code` 3, plus 48 hourly `cloud_cover` /
`precipitation` / `snowfall` / `snow_depth` values.

| Variable | Use in Katu Maps |
| --- | --- |
| `weather_code`, `temperature_2m`, `wind_speed_10m` | Panel header |
| `cloud_cover` (+ low/mid/high) | Cloud % and hourly strip |
| `precipitation`, `precipitation_probability` | Rain strip / slider |
| `snowfall`, `snow_depth` (metres) | Snow at the point |
| `minutely_15=precipitation` | Short-range strip; native 15 min only in parts of Europe and North America, interpolated elsewhere |

**Terms:** free tier is **non-commercial** (no ads, no subscriptions),
10 000 calls/day, 5 000/hour, 600/minute **per client IP**. Katu Maps as a
keyless, ad-free GitHub Pages app fits. If the product later takes ads or
paid plans, a paid Open-Meteo plan is required.

Attribute with a visible “Weather data by Open-Meteo.com” link. Cache by
rounded coordinates. Identify with the existing `VITE_API_CLIENT_ID` header
where the API accepts it.

### Point weather — MET Norway / yr.no (Nordic quality, awkward in-browser)

`api.met.no` locationforecast is CC BY 4.0, global, with the best updates in
the Nordic/Arctic region. Cloud fraction, precipitation, and symbols are in
the JSON model.

MET’s terms say **browsers and apps should not call the API directly**; they
want a caching proxy, a contactable `User-Agent`, max 4 decimal coordinates,
and `Expires` / `If-Modified-Since` caching. CORS for authenticated/custom
headers is not supported. That fights the no-backend rule. Prefer Open-Meteo
(which already ingests MET/ECMWF/DWD) unless a proxy is added later.

### Cloud and snow **forecast maps** — Open-Meteo spatial files

Open-Meteo publishes model grids as `.om` files on public S3, including
`cloud_cover`, `cloud_cover_low/mid/high`, `precipitation`, `rain`,
`snow_depth`, and `snowfall_water_equivalent`. Example metadata:
`https://openmeteo.s3.amazonaws.com/data_spatial/dwd_icon/latest.json`
(123 variables, 113 hourly steps in this check).

[maps.open-meteo.com](https://maps.open-meteo.com/) renders those files in
MapLibre via a custom `om://` protocol. The helper package
`@openmeteo/weather-map-layer` is **GPL-2.0**, marked not production-ready,
and the convenience CDN `data-spatial.open-meteo.com` only allows
`localhost` / `*.open-meteo.com` referers. The **S3 bucket itself is public**.

Fit for Katu Maps: optional overlay, **if** the protocol reader is a small
MIT-licensed implementation (or a later non-GPL API), not the GPL package.
Budget GPU/time like other custom layers. Hourly slider over `valid_times`
gives cloud and snow **forecast** visualization without a tile server.

This is model cloud fraction and snow depth, not a photograph of clouds and
not a radar nowcast.

### Past rain radar tiles — RainViewer

[RainViewer Weather Maps API](https://www.rainviewer.com/api/weather-maps-api.html)
returns a JSON index of the last **2 hours** at 10-minute steps, plus XYZ PNG
tiles (`maxNativeZoom` 7). CORS `*`. Official MapLibre example exists.

Live index on 5 September 2026: 13 past frames, **`nowcast: []`**,
**`satellite.infrared: []`**. Since 1 January 2026 the public API dropped
nowcast, IR satellite, most colour schemes, and capped zoom at 7
([transition FAQ](https://www.rainviewer.com/api/transition-faq.html)). Rate
headers on a tile were `500 / 60 s` (docs also mention 100/IP/minute).

Terms: **personal, educational, and small-scale community use**; no
availability contract; attribution + link required. Confirm with RainViewer
before relying on this in production. Coverage is a mosaic of national radars
(Finland is typically included via FMI), with gaps over oceans and some
countries.

This is the only **global, CORS-friendly, past-radar tile** API that matches
the current static-app model. It is **not** a forecast.

### Regional radar (open, not global)

| Region | Source | Browser tiles? | Forecast? |
| --- | --- | --- | --- |
| Germany | DWD WMS `maps.dwd.de` (`Niederschlagsradar`, `Radar_wn-product_1x1km_ger`) | Often used as WMS; fair-use unclear at map-tile volume | ~2 h RADVOR nowcast |
| CONUS | Iowa Environmental Mesonet NEXRAD/MRMS WMS/TMS | Yes, permissive CORS | No (archive + current) |
| Europe OPERA | EUMETNET Open Radar Data / MeteoGate | Volume/ODIM, not XYZ | No |
| Finland | FMI GeoTIFF/S3 | Only after self-hosted tiles | Open nowcast not confirmed |

DWD nowcast is the rare **open radar forecast**, but it is not a Finland/global
product.

### ECMWF open data — not forecast radar

[ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data) is a
CC BY 4.0 subset of IFS and AIFS **numerical weather prediction**, in GRIB2 at
**0.25°** (about 28 km north–south, 14 km east–west at Helsinki). It is worth
using as the *physics behind* a precipitation/cloud forecast overlay. It is
not a radar product and is a poor direct source for a MapLibre “forecast
radar” layer.

What the catalogue actually has that looks rain-related:

| Field | Meaning |
| --- | --- |
| `tp` | Total precipitation (accumulated) |
| `tprate` | Instantaneous precipitation rate |
| `ptype` | Precipitation type (rain/snow/…) |
| `sf` | Snowfall water equivalent |
| `tcc` | Total cloud cover |
| `sd` | Snow depth water equivalent |

Time steps are **3-hourly** to +144 h, then 6-hourly to +15 days (AIFS is
6-hourly throughout). Operational IFS HRES is ~9 km; that higher-resolution
feed is **not** in the free open-data subset (it is a paid dissemination
product). The portal keeps only ~12 recent runs, is GRIB2/CCSDS, and is
capped at 500 simultaneous connections. A full day’s files are on the order of
hundreds of GiB. AWS / Azure / GCP replicas exist; the Python client
`ecmwf-opendata` is the intended access path.

Putting this on the map ourselves would mean a backend: download GRIB →
difference accumulations → colourise → XYZ or `.om` tiles. That is the job
Open-Meteo already does. Their public spatial files already expose ECMWF
grids as map-ready arrays (checked 5 September 2026):

| Open-Meteo model | Grid | Steps in `latest.json` | Rain/cloud fields |
| --- | --- | --- | --- |
| `ecmwf_ifs025` | 0.25° (the open dataset) | 49 | precipitation, precipitation_type, cloud_cover, snow |
| `ecmwf_aifs025_single` | 0.25° AIFS | 61 | precipitation, cloud_cover, snowfall |
| `ecmwf_ifs` | ~9 km HRES (Open-Meteo’s own ingest) | 109 | precipitation, cloud_cover, snowfall |
| `dwd_icon` | ~13 km global, finer over Europe | 113 | precipitation, rain, cloud, snow |

For Finland, DWD ICON / FMI HARMONIE (~2.5 km) beat 0.25° ECMWF for a close
map. Direct ECMWF GRIB is only worth a custom pipeline if we later need
CC BY data **without** Open-Meteo’s non-commercial API terms, or ensemble
spread from `enfo` members.

Copernicus EFAS/TAMIR layers that *blend* OPERA radar nowcasts with the ECMWF
ensemble for ~6 h, then NWP to 120 h, are closer to “forecast radar” — but
they are European flood-service WMS, experimental, and **not** this open
GRIB catalogue. Do not plan on them as a Katu Maps tile source.

### Satellite cloud and snow (daily, observed)

[NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) WMTS in
EPSG:3857, CORS `*`, no key. Useful layers:

- VIIRS / MODIS corrected reflectance (true colour — visible clouds)
- MODIS/VIIRS NDSI snow cover (daily)

A 2026-09-04 true-colour tile returned HTTP 200 with
`access-control-allow-origin: *`. These are **daily observations**, often
hours stale, unusable under polar night / heavy cloud for snow, and not a
forecast. Fine as an advanced “satellite” layer with a date control; poor as
the default cloud overlay.

### Sources that do not fit (yet)

| Source | Why not |
| --- | --- |
| OpenWeather, Tomorrow.io, Mapbox Weather | Proprietary, keys, not open data |
| ECMWF open GRIB (direct) | NWP precipitation, not radar; GRIB2 needs a backend. Already ingested by Open-Meteo — see below |
| Copernicus CAMS WMS | Air quality, not rain/snow radar |
| MET Norway radar images | Cache/host yourself at scale |
| RainViewer nowcast / IR | Removed from the public API (2026) |

## Fit to Katu Maps architecture

| Constraint | Implication |
| --- | --- |
| No app backend | Use CORS JSON + XYZ/WMTS only. No FMI GeoTIFF→PNG pipeline, no MET proxy. |
| `ServiceConfig.ts` + `.env.example` | New endpoints must be overridable public URLs, no secrets. |
| Attribution | Open-Meteo, FMI, RainViewer, NASA, SYKE, MapLibre — keep the existing attribution row readable on phone. |
| Privacy | Lat/lon go to the weather host. Document in `privacy.md`. Round coordinates (~3–4 decimals). Fetch on interaction, not every `move`. |
| Fair use | Session cache, debounce, cancel in-flight, hide-document pause — same pattern as Nominatim / charging stations. |
| One panel | Weather **section** in location/position sheets; overlay controls in Layers. |
| Custom-layer budgets | Radar/cloud rasters at zoom 7–12. Do not add a Three.js cloud volume. |
| Licences | Do not take `@openmeteo/weather-map-layer` (GPL-2) into this MIT app. FMI/Open-Meteo **data** is CC BY 4.0. |
| Commercial future | Open-Meteo free tier and RainViewer community terms both break if the app gains ads or subscriptions. |

## Suggested implementation phases

### Phase 1 — Location weather panel (low risk)

- On open of location or position information, request Open-Meteo
  `current` + 24–48 `hourly` values.
- Show temperature, WMO summary, cloud %, precipitation, wind, snow depth,
  “updated” time, and a compact hourly strip (this **is** the first time
  slider, but for the point, not the map).
- Inside Finland, optionally also request FMI HARMONIE timeseries and prefer
  it when it succeeds; fall back to Open-Meteo.
- Attribution + recoverable error string. No new exclusive panel.
- Tests: JSON parsing, cache key, Finland vs rest-of-world provider choice.

This matches existing panel CSS, `fetchWithTimeout`, and
`RequestRateGate` patterns. No MapLibre source changes.

### Phase 2 — Past radar overlay (medium risk)

- Layer toggle “Rain radar”.
- RainViewer index + raster source swap on a 10-minute slider (see their
  MapLibre example: keep two layers, opacity cross-fade, `maxzoom` 7).
- Disable or show “no coverage” from their coverage mask.
- Confirm terms; keep the layer off by default.

### Phase 3 — Forecast cloud / snow overlay + unified slider (higher risk)

- Optional layers “Cloud cover” and “Snow depth” from Open-Meteo S3 spatial
  files via a small in-repo `addProtocol` reader (not the GPL package).
- Slider range: past 2 h radar frames, then hourly forecast steps for cloud /
  precipitation / snow. Label radar vs forecast clearly so it is not mistaken
  for a radar nowcast.
- Finland winter: SYKE `EO_FSC` as an extra “satellite snow” date layer, not
  on the forecast slider.

### Deferred

- Self-hosted FMI radar GeoTIFF tiles (needs a backend or CDN job).
- Direct ECMWF Open Data GRIB ingest (Open-Meteo already republishes it).
- MET Norway direct API.
- 3D / globe cloud volumes.
- Global radar **nowcast**.

## Practical answers

**Can we add a weather panel for the viewed location?**
Yes. Open-Meteo is the global default; FMI HARMONIE timeseries is a strong
Finland enhancement. Both were reachable from this environment with CORS and
no API key.

**Can we visualise cloud cover?**
Yes, as a percentage in the panel immediately; as a map, via Open-Meteo
`cloud_cover` grids (forecast) or NASA GIBS true colour (daily satellite).
FMI WMS radar/cloud-top is not allowed as a production tile URL.

**Can we visualise snow cover?**
Point snow depth: Open-Meteo `snow_depth`, FMI `snow_aws`. Map: Open-Meteo
`snow_depth` forecast grid, plus SYKE/NASA daily satellite snow extent.
Road-surface snow remains Digitraffic.

**Can we have a time slider with cloud and rain-radar forecasts?**
A slider is feasible. **Rain-radar forecast** is the weak leg: RainViewer
nowcast is gone; FMI nowcast is not on the open JSON API; DWD nowcast is
Germany-only; ECMWF open data is 0.25°/3-hourly NWP, not radar. Ship the
slider as **past radar + model precipitation/cloud forecast**, and do not
describe it as a radar nowcast. Prefer Open-Meteo’s already-ingested ECMWF
(and ICON) spatial files over downloading ECMWF GRIB in-app.

## Live checks (5 September 2026)

- Open-Meteo Helsinki forecast JSON 200, CORS `*`.
- FMI `timeseries` HARMONIE Helsinki JSON 200, CORS `*`, `TotalCloudCover` 98.
- FMI WFS HARMONIE point simple XML 200, `totalcloudcover` 98.4.
- FMI WFS observations `snow_aws` present (0.0 cm at the sampled Lapland station).
- FMI `metcoop_scandinavia_nowcast_surface` on `opendata.fmi.fi`: unknown producer.
- RainViewer `weather-maps.json` 200, CORS `*`, 13 past frames, empty nowcast.
- Open-Meteo S3 `dwd_icon/latest.json` includes `cloud_cover` and `snow_depth`.
- Open-Meteo S3 `ecmwf_ifs025`, `ecmwf_ifs`, and `ecmwf_aifs025_single` `latest.json` 200, with precipitation and cloud_cover.
- NASA GIBS sample tile 200, CORS `*`.
- SYKE EO WMS GetCapabilities 200, CORS `*`.

## Implementation note (v1)

Shipped as an optional **Weather** layer (on by default): a chip for the
**map centre**, a dedicated forecast panel, and a cloud/precip **model**
time slider. Open-Meteo only; overlay is a 5×5 in-app canvas, not FMI WMS
or radar. Fetch is debounced on `moveend` with rounded coordinates.
