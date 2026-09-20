# Transit vehicle position plan

Reviewed 2026-09-20 against the current Katu Maps implementation, provider
documentation, and small live API samples.

## What the providers offer

### Digitransit and Tampere

The Digitransit routing API is a good source for route geometry, schedules, and
realtime stop predictions. It is not currently a dependable source of vehicle
coordinates:

- A live Tampere sample contained realtime predictions for 190 of 289 upcoming
  departures, but no `pattern.vehiclePositions` records.
- A Helsinki sample returned fresh vehicle records, but all sampled `lat`,
  `lon`, and `heading` values were null on both the Finland and HSL endpoints.

Tampere has separate position feeds:

- ITS Factory SIRI JSON returned 123 vehicles, all with finite coordinates and
  observations less than a minute old in the sample. It is public JSON and
  permits browser access with `Access-Control-Allow-Origin: *`.
- ITS Factory GTFS-Realtime returned a compact public protobuf feed and also
  permits browser access. In the sampled feed it carried service date, route
  ID, and start time, but omitted the documented trip ID and direction ID.
  Thirteen of 123 vehicles shared those three fields with another vehicle, so
  that feed is not sufficient for exact matching by itself.
- ITS Factory SIRI supplies route, direction, service date, and a dated journey
  reference representing the scheduled origin clock. That full composite was
  unique across the reviewed samples. It matched exactly one Digitransit route
  13 bus, and all six sampled active route 3 trams matched exactly one trip.
- The current Waltti GTFS-Realtime endpoint documents trip ID, route ID,
  direction, service date, start time, position, bearing, speed, stop sequence,
  and timestamp. It returned HTTP 407 without credentials. Waltti now requires
  a client ID and secret through HTTP Basic authentication, so a deployment
  backend is required to use it safely.

Relevant documentation:

- https://www.nysse.fi/en/developers.html
- https://dev.publictransport.tampere.fi/docs
- https://opendata.waltti.fi/getting-started
- https://wiki.itsfactory.fi/index.php/Tampere_Public_Transport_SIRI_Interface_(Realtime_JSON_at_data.itsfactory.fi)

### Transitous

Transitous supplies static schedules and consumes realtime trip updates and
alerts. Its documentation explicitly says that vehicle-position feeds are not
yet supported. It polls upstream realtime sources once per minute.

A live Berlin trip sample contained route geometry, all stop calls, scheduled
times, updated times, cancellation state, and `realTime` markers. It contained
no vehicle coordinate, observation timestamp, vehicle ID, speed, or bearing.

Transitous should therefore remain an estimated-position provider. The label
`Estimated · realtime times` accurately describes its best available result.

Relevant documentation:

- https://transitous.org/doc/#realtime-data
- https://transitous.org/api/

## Target behavior

Position selection should follow this order:

1. Use a fresh position matched to one exact dated vehicle journey.
2. If the position feed is temporarily stale, blend to an estimate based on
   fresh realtime stop predictions.
3. Otherwise estimate from the static schedule.
4. Show no vehicle when identity, route geometry, or timeline data is too
   ambiguous to support the applicable method.

The UI must continue to distinguish `Live`, `Estimated · realtime times`, and
`Estimated · schedule`. Animation between observations must not be described as
live extrapolation: the marker may interpolate to the latest fix but must not
project past it.

## Implementation phases

### 1. Separate position acquisition from trip acquisition

Add an optional vehicle-position capability alongside `TransitProvider` rather
than embedding observations in `fetchTrip`.

The position request should accept a normalized journey identity and return
zero or more `TransitVehicleObservation` values. `TransitStopsLayer` should
continue to own selection, freshness, smoothing, and fallback. Provider modules
should own transport, decoding, and normalization.

This separation allows Digitransit to remain the routing and timeline provider
while a Tampere-specific source supplies coordinates. Transitous can implement
no position capability until its upstream service exposes one.

### 2. Establish a trustworthy Tampere journey identity

The normalized trip identity now includes the fields available on both sides:

- service date / GTFS `start_date`
- scheduled origin departure / GTFS `start_time`
- feed-normalized route ID
- direction ID when available
- provider trip ID when the namespaces are proven equivalent

The Digitransit trip query returns route ID, direction ID, and the scheduled
first departure. A real bus fixture captures the confirmed composite mapping.
Before enabling positions, add the same evidence for a tram and an
after-midnight service.

Matching must never use route number, direction, or nearest coordinates alone.
Accept exactly one candidate for the dated journey; ambiguity falls back to an
estimate.

### 3. Add the public Tampere position adapter

Use the public ITS Factory SIRI JSON feed. Match its route, direction, service
date, and dated journey reference against the selected Digitransit trip. Do not
ship a line-only match or accept a composite that identifies more than one
vehicle. The initial adapter and its bus, tram, ambiguity, and after-midnight
time-normalization tests are implemented.

Fetch one full position feed for both tracked journey slots, share the result,
and filter locally. Start with a five-second refresh, pause while the document
is hidden, abort superseded requests, and retain the current 60-second maximum
observation age. The source permits one-second requests, but the map does not
need that load to look responsive with interpolation.

Expose the endpoint through configuration and add the required Tampere/Nysse
attribution beside the existing transit attribution.

### 4. Treat Waltti as the production upgrade path

If Katu Maps gains a deployment backend, proxy the authenticated Waltti feed
there. Keep the Basic credential only on the server, cache the full feed for a
few seconds, and return a small normalized JSON response for the requested
journey identity.

The browser adapter should not contain a Waltti client secret or a build-time
`VITE_*` credential. Switching from ITS Factory to the proxy should require a
configuration change, not changes to map rendering.

### 4a. Use Digitraffic GPS for Finnish trains

For Digitransit rail journeys, parse the train number and departure date from
the feed-scoped passenger GTFS trip ID and request that train's latest public
Digitraffic location. Accept only a GPS record whose train number and departure
date both match. The shared freshness check rejects old fixes, so missing or
stale train GPS data continues through the existing stop-time estimator.

The adapter uses the public per-train endpoint with the required
`Digitraffic-User` application identifier. Its endpoint is configurable and
Fintraffic / Digitraffic CC BY 4.0 attribution is visible on the map.

### 4b. Add direct HSL and Föli positions

HSL positions come from its public HFP MQTT-over-WebSocket stream because the
GTFS-RT download does not allow cross-origin browser requests. Subscribe to the
selected journey's route, direction, and scheduled start, then verify those
fields and the operating day again in the payload before accepting a point.

Föli positions come from its public CORS-enabled SIRI JSON feed. Match the
feed-scoped route ID, GTFS direction, and exact scheduled origin departure.
Reject multiple matching vehicles. Both adapters retain the shared freshness
check and estimation fallback.

### 5. Tighten estimation and polling

- Give providers separate refresh intervals. Transitous trip details should
  refresh at roughly its upstream one-minute cadence rather than every 15
  seconds. Digitransit stop predictions can retain the current 15-second
  cadence.
- Track when realtime stop predictions were received. Once they exceed a
  defined age, downgrade the estimate to schedule data and update the label.
- Project stops onto the nearest point along route segments rather than the
  nearest geometry vertex. Preserve monotonic stop order for loops.
- When a live fix expires, retain the current smooth transition to the best
  estimate, but reject implausible jumps and observations far from the route.

### 6. Verification and rollout

Add deterministic fixtures for:

- a uniquely matched Tampere bus and tram
- an after-midnight service date
- duplicate and incomplete observations
- stale timestamps and invalid coordinates
- mismatched route, direction, and start time
- loss and recovery of the position feed
- Transitous realtime and schedule-only estimates

Add provider contract tests, transition tests, and one visual scenario covering
the `Live` to `Estimated` fallback. Initially log aggregate rejection reasons in
development builds without vehicle IDs or coordinates. Roll out live Tampere
positions behind a configuration flag until several real journeys have been
checked against the Nysse map.

## Recommended first increment

Phases 1 and 2 establish the separate provider capability, normalized identity,
and exact-match contract without changing visible behavior. Complete the
identity evidence with a tram and after-midnight fixture, then implement the
dual-feed adapter in phase 3. Transitous needs no position integration today;
its useful updates are provider-specific polling and clearer realtime
freshness.
