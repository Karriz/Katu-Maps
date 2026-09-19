# OSM Detail Dataset Plan

## Purpose

Build a small supplementary global dataset containing OpenStreetMap attributes
that are useful to Katu Maps but are not exposed by the OpenFreeMap tile schema.
The first targets are detailed roof attributes and bridge metadata.

This dataset complements OpenFreeMap rather than replacing it. OpenFreeMap
continues to provide the general basemap; the detail dataset supplies geometry
and tags to the procedural roof and bridge renderers at close zoom levels.

## Candidate attributes

### Buildings and roofs

- `building` and `building:part`
- `height`, `building:levels`, and `min_height`
- `roof:shape`, `roof:height`, and `roof:levels`
- `roof:direction` and `roof:orientation`
- `roof:material` and `roof:colour`
- Optionally `building:material` and `building:colour`

### Bridges

- `bridge`, `bridge:structure`, and `bridge:support`
- `layer` and `level`
- `height`, `min_height`, and `maxheight`
- `width` and `lanes`
- `covered`, `movable`, and `bridge:movable`
- `name`, `ref`, `material`, and `surface`
- Road, railway, path, and separately mapped bridge-outline geometry where
  relevant

Every feature should carry a stable identifier containing both its OSM element
type and ID, such as `w12345` or `r67890`. This permits deduplication across tile
boundaries and avoids node, way, and relation ID collisions.

## Scale estimate

As of 19 September 2026, the complete OSM planet PBF is approximately 88 GB.
Current global Taginfo counts include approximately:

- 9.7 million objects with `roof:shape`
- 2.36 million with `roof:material`
- 2.62 million with `roof:colour`
- 571,000 with `roof:height`
- 175,000 with `roof:direction`
- 171,000 with `bridge:structure`
- 50,000 with `bridge:support`

The roof counts overlap substantially. The dataset is therefore expected to
contain roughly ten million roof-enriched objects rather than the sum of these
counts.

Preliminary storage estimates are:

| Artifact | Estimated size |
| --- | ---: |
| Original planet input | 88 GB |
| Filtered roof and bridge OSM PBF | 3-12 GB |
| Compact GeoParquet or FlatGeobuf intermediate | 2-8 GB |
| PMTiles with one native geometry level and overzooming | 3-10 GB |
| Conventional tiles repeated through zoom 16 | 10-40 GB |
| Bridge-only PMTiles | Likely below 500 MB |
| Temporary global build space | 150-400 GB |

These are planning estimates. Geometry complexity, tile buffer, retained
building parts, and maximum native zoom can materially change the result. A
regional prototype should be used to obtain measured figures before committing
to a global build.

## Proposed architecture

Publish a supplementary MapLibre vector source with two source layers:

- `building_detail`
- `bridge_detail`

The application loads OpenFreeMap and the detail source independently. The
procedural roof and bridge layers query the detail source for visible features.
They should not attempt to join the data to OpenFreeMap features because
OpenFreeMap may merge building polygons, replace source IDs, or omit source IDs.

Detailed tiles only need to exist at close zoom levels. Generate a single high
native zoom, initially zoom 14 or 15, and allow MapLibre to overzoom it. This
avoids duplicating complex geometry at every higher zoom.

The renderers must deduplicate features by the stable typed OSM ID because
`querySourceFeatures()` can return the same feature from adjacent tiles.

## Distribution format

### Preferred: PMTiles

Publish the global tile pyramid as one versioned archive, for example:

```text
osm-detail-2026-09.pmtiles
```

PMTiles permits the browser to retrieve only byte ranges for the tiles in the
current viewport. It does not download the full archive. Benefits include:

- One object to upload, version, cache, and roll back
- No database or continuously running tile server
- No millions of small files
- Efficient CDN caching and HTTP range access
- Atomic releases using versioned object names

The static host must support HTTP `Range` requests and CORS. Suitable targets
include Cloudflare R2, S3 with CloudFront, and Backblaze B2.

Katu Maps would register the PMTiles protocol and add a vector source similar
to:

```ts
map.addSource('osm-detail', {
  type: 'vector',
  url: 'pmtiles://https://data.example.com/osm-detail-2026-09.pmtiles',
});
```

### Alternative: static XYZ tile directory

A directory containing `{z}/{x}/{y}.pbf` can be served by any static web host:

```text
osm-detail/
  14/9321/4876.pbf
  14/9321/4877.pbf
```

This requires no PMTiles client integration but can create millions of small
objects, making upload, invalidation, and filesystem management less convenient.
It remains useful for an early regional prototype.

## Build pipeline

The proposed initial pipeline is:

1. Download an OSM PBF extract.
2. Filter relevant tagged objects while retaining dependent nodes and relation
   members required to reconstruct geometry.
3. Normalize selected attributes and typed OSM IDs.
4. Generate `building_detail` and `bridge_detail` vector layers with a custom
   Planetiler profile or schema.
5. Package the output as PMTiles.
6. Validate feature counts, geometry, archive size, tile size, and browser
   behavior.
7. Upload the versioned archive to static object storage.

`osmium tags-filter` is a suitable starting point for filtering. Planetiler is
the preferred tile generator because OpenFreeMap is already based on the same
general tooling and the output can be tightly controlled.

## Prototype sequence

Start with Finland rather than the planet:

1. Define the exact allowlist of roof and bridge attributes.
2. Build a Finland filtered PBF and PMTiles archive.
3. Add an experimental `osm-detail` source to Katu Maps.
4. Adapt one procedural renderer, preferably roofs, to consume the new layer.
5. Verify feature deduplication and behavior at tile boundaries.
6. Compare output against raw OSM examples where OpenFreeMap lacks attributes.
7. Measure archive size, feature count, peak RAM, scratch disk, build time, and
   per-tile network size.
8. Repeat with a larger extract, such as the Nordic region or Europe, before
   extrapolating to the planet.

The prototype should preserve visible OpenStreetMap attribution and record the
source timestamp used to build the archive.

## Global build infrastructure

A full-planet build will probably be most convenient on a temporary cloud
machine. A reasonable initial specification is:

- 32-64 CPU cores where economical
- 64-128 GB RAM
- 300-500 GB fast NVMe scratch storage

The exact requirements should be adjusted using prototype measurements. The
machine is needed only to download, filter, and tile the planet. It can be
deleted after the resulting archive has been uploaded, so serving does not
require a persistent cloud compute instance.

## Update strategy

Roof shapes and structural bridge attributes do not require minute-level
freshness. Prefer a simple periodic rebuild over maintaining a live global
PostGIS installation.

Suggested release process:

1. Build a dated archive such as `osm-detail-2026-10.pmtiles`.
2. Run structural and application smoke checks.
3. Upload it alongside the previous archive.
4. Update the versioned application URL or a small `latest.json` manifest.
5. Retain at least one previous archive for rollback.

A monthly rebuild is a sensible starting cadence. Weekly builds can be adopted
if users benefit from faster updates. OSM minute, hourly, and daily replication
diffs remain an option if incremental freshness later becomes important, but
they introduce additional database and tile invalidation complexity.

## Alternative source: Overture Maps

Overture publishes global building data in GeoParquet and exposes normalized
fields including roof shape, height, material, colour, and direction. It may
reduce initial planet-processing work and is worth evaluating during the
prototype.

It is not a complete substitute for a raw OSM-derived dataset:

- Attributes are normalized rather than a complete raw-tag mirror.
- Source geometry and identifiers may differ from OpenFreeMap.
- It does not necessarily cover the desired bridge metadata.

A hybrid pipeline is possible, but a single OSM-derived source is initially
simpler to reason about and attribute.

## Licensing and attribution

The pipeline and distribution design must comply with the Open Database License
and preserve visible OpenStreetMap attribution. Before public release, document:

- The source and snapshot date
- The transformation and selected attributes
- The applicable ODbL notices
- How users can obtain or reproduce the derived database when required

Do not remove or obscure the existing MapLibre, OpenFreeMap, OpenMapTiles, or
OpenStreetMap attribution.

## Open decisions

- Exact attribute allowlist and normalization rules
- Whether to retain all tagged roofs or only buildings and building parts
- Whether bridge outlines and support nodes belong in separate source layers
- Native maximum zoom: 14 versus 15
- Planetiler profile versus declarative custom schema
- PMTiles integration dependency and cache policy
- Monthly versus weekly releases
- Static storage and CDN provider
- Whether Overture buildings offer enough value to join the pipeline

## Reference sources

- OSM planet PBF downloads: <https://planet.openstreetmap.org/pbf/>
- OSM replication diffs: <https://wiki.openstreetmap.org/wiki/Planet.osm/diffs>
- Roof shape tagging: <https://wiki.openstreetmap.org/wiki/Key:roof:shape>
- Bridge structure tagging:
  <https://wiki.openstreetmap.org/wiki/Key:bridge:structure>
- Bridge support tagging:
  <https://wiki.openstreetmap.org/wiki/Key:bridge:support>
- Overture building schema:
  <https://docs.overturemaps.org/schema/v1.18.0/reference/buildings/building/>

