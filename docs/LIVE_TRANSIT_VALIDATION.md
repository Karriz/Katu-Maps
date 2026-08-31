# Live transit identity validation

Read-only checks were performed on 2026-08-29. Committed fixtures are reduced and sanitized; no key or full response is stored.

Position-specific checks were repeated on 2026-08-31. The ignored local key was read only by `curl`; it was not printed or copied into a fixture.

## Queries

Digitransit used `POST https://api.digitransit.fi/routing/v2/finland/gtfs/v1`: `stop(id: $id) { stoptimesWithoutPatterns { serviceDay scheduledDeparture realtimeDeparture realtime trip { gtfsId } } }`, then `trip(id: $id) { onServiceDate(date: $date) { stopCalls { stopLocation { ... on Stop { gtfsId parentStation { gtfsId } } } schedule { time { ... on ArrivalDepartureTime { arrival departure } } } realTime { arrival { time delay } departure { time delay } } } } }`. Tampere stop `tampere:0001` returned several 40-series departures, including a realtime estimate differing from schedule.

Transitous was validated in **Berlin, Germany**, where usable schedule-only data was available: `GET https://api.transitous.org/api/v6/map/stops?min=52.51,13.37&max=52.53,13.41&grouped=false&modes=TRANSIT&language=en`, `GET /api/v6/stoptimes?stopId=de-VBB_de%3A11000%3A900100527%3A%3A1&n=3&mode=TRANSIT&realtimeMode=REALTIME&radius=0&exactRadius=true`, then `GET /api/v6/trip?tripId=20260829_08%3A42_de-VBB_304113288&detailedLegs=true&joinInterlinedLegs=false&language=en`.

On 2026-08-31, Tampere stop `tampere:0001` returned five upcoming realtime departures with exact trip IDs, service day, and separate scheduled and realtime departure seconds. Querying each trip's `pattern.vehiclePositions` confirmed that the deployed Finland GraphQL schema supports `trip.gtfsId`, `lat`, `lon`, `heading`, `lastUpdate`, `lastUpdated`, and a dated `trip.onServiceDate`. None of those five current 40-series trips had a vehicle-position entry at the time of the check, so the expected runtime result for that sample was the route-based fallback.

Berlin stop `de-VBB_de:11000:900100031::2` returned both a realtime bus 200 trip (`20260831_16:49_de-VBB_304112902`) and a schedule-only bus 100 trip. The matching trip response retained geometry, absolute realtime and scheduled stop clocks, plus `scheduledStartTime`/`scheduledEndTime`. Transitous currently applies trip updates but does not expose vehicle-position coordinates through the API used here, so its marker remains estimated.

## Observed rules

Digitransit has a separate service day, scheduled/realtime seconds, exact GTFS trip ID, and platform/parent IDs. Transitous has absolute scheduled/realtime timestamps and currently date-bearing trip IDs, but no distinct trip-leg service date. Adapters therefore keep both clocks separate. Shared resolution requires provider/trip identity, compares service date only when both sides provide it, and identifies repeated calls by stop relationship plus scheduled time. Realtime never establishes identity.

Observed Digitransit coordinates are accepted only after exact provider/trip, requested service-date instance, scheduled boarding call, freshness, and uniqueness checks. The GraphQL vehicle object does not expose its GTFS-RT `start_date` directly; the match therefore uses the exact trip's requested `onServiceDate` instance and boarding departure. A fresh duplicate claiming the same dated trip is treated as ambiguous and rejected.

Route identity is independent of vehicle estimation. Missing or non-monotonic timestamps disable only the marker; route geometry and calls remain visible. The one-minute scheduled tolerance covers minute-resolution timetable serialization, not realtime drift.
