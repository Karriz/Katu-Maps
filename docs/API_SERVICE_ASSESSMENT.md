# Public API service assessment

Katu Maps is a static browser application, so provider requests originate from
each user's device. This distributes per-IP traffic, but the application must
still follow each provider's fair-use policy. The default services have no SLA
unless explicitly stated otherwise.

| Service | Use | Current controls | Residual production risk |
| --- | --- | --- | --- |
| Photon | Search autocomplete | 280 ms debounce, cancellation, bounded result cache, 15 s timeout | Public instance has an undefined reasonable-use limit and may throttle without notice. |
| Nominatim | Selected-place details and reverse geocoding | No autocomplete, 1.1 s serialized request gate, cancellation, session cache, 15 s timeout | Public policy has an absolute 1 request/s limit; replace before sustained high traffic. |
| Valhalla | Walk, bicycle and car routing | Cancellation, bounded retries/timeouts, optional OSRM fallback, identifying client header | Default endpoint is a public demo server, not a production SLA. Contact its operator or replace it before material scale. |
| Transitous | Global transit stops, departures, trips and plans | Cancellation, timeouts, visibility-aware polling, identifying client header | Volunteer best-effort service; failures must remain recoverable. |
| Digitransit | Finnish transit and live positions | Subscription key, cancellation, timeout, polling only for selected journeys | Respect rate-limit responses and do not poll faster than useful source updates. |
| Digitraffic weather cameras | Finnish road camera stills | `Digitraffic-User` header, 30-minute station cache, details fetched on selection, 10-minute image refresh while the panel is open | Public road API; keep station list cached and do not poll images faster than the ~10-minute source interval. |
| Digitraffic road weather, TMS and traffic messages | Finnish road weather, congestion colouring, roadworks and incidents | `Digitraffic-User` header, 30-minute station cache, 90-second observation cache, 2-minute traffic-message cache, 2-minute refresh while the layer is visible | Public road API; gzipped bulk payloads are fetched only after the layer is enabled. |
| Open Charge Map | Optional EV charging stations | Identifying API key, viewport bounding-box queries, 5-minute cache, 280 ms debounce, max 250 results, zoom 9+ | Public registry with no SLA; register an application key and do not poll faster than useful map movement. |
| Open-Meteo | Viewed-location weather chip/panel and optional cloud/precip forecast overlay | No key, CORS `*`, 15-minute cache, coordinates rounded to 3 decimals (point) / 2 (overlay grid), 400 ms `moveend` debounce, 5×5 overlay samples, 2 forecast days | Free non-commercial API; attribute Open-Meteo. Overlay is a coarse model grid, not radar. Replace or proxy before ads, subscriptions, or high traffic. |
| OpenFreeMap | Vector map tiles | MapLibre caching and attribution | Public instance currently permits unlimited map views but has no SLA. |
| Mapterhorn | Terrain tiles | Terrain disabled by default and capped at z12 | Tile volume and availability, rather than request-policy limits. |
| Wikimedia | Optional descriptions and images | Per-location caches, cancellation and partial-failure handling | Global API rate limits; keep requests interaction-driven and cacheable. |

## Deployment controls

Public endpoints and the provider client identifier are Vite build variables
documented in `.env.example`. This permits a tagged production build to move to
a paid, proxied or self-hosted provider without source changes. These variables
are visible to users and must not contain secrets.

Selected-trip refresh defaults to 15 seconds and cannot be configured below 15
seconds. Polling stops while the document is hidden. When a journey tracks both
the current and next transit leg, each refresh may issue two provider requests.

## Scale checkpoints

- Below roughly 250 daily active users: retain the defaults, watch errors and
  confirm fair-use compliance.
- Around 250–1,000 daily active users: contact the Valhalla and Transitous
  operators, measure 429/timeouts, and arrange replacement search/geocoding.
- Before sustained traffic above 1,000 daily active users: use production-grade
  geocoding and routing endpoints and consider a cache/proxy where terms allow.
