import type { Feature, FeatureCollection, Geometry, LineString, Position } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';

const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']);
const CELL = 0.00002;
const cell = (p: Position) => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)];
const distance = (a: Position, b: Position) => Math.hypot(
  (a[0] - b[0]) * Math.cos(a[1] * Math.PI / 180), a[1] - b[1],
) * 111_320;

// A tunnel endpoint alone may just be a tile cut. Only a connection to
// above-ground geometry is evidence of a mouth; missing tiles omit shadows.
export function tunnelPortals(features: readonly Feature<Geometry>[]): FeatureCollection<LineString> {
  const surface = new Map<string, Position[]>();
  const tunnels: { coordinates: Position[]; properties: NonNullable<Feature['properties']>; kind: string }[] = [];
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const kind = ROAD_CLASSES.has(properties.class) ? 'road'
      : ['rail', 'transit'].includes(properties.class) ? 'rail' : null;
    if (!kind) continue;
    const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
    for (const coordinates of lines) {
      if (coordinates.length < 2) continue;
      if (properties.brunnel === 'tunnel') {
        tunnels.push({ coordinates, properties, kind });
      } else {
        for (const point of coordinates) {
          const key = `${kind}:${cell(point)}`;
          const bucket = surface.get(key) ?? [];
          bucket.push(point);
          surface.set(key, bucket);
        }
      }
    }
  }
  const portals = new Map<string, Feature<LineString>>();
  for (const { coordinates, properties, kind } of tunnels) {
    for (const reverse of [false, true]) {
      const points = reverse ? [...coordinates].reverse() : coordinates;
      const mouth = points[0];
      const [x, y] = cell(mouth);
      let connected = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          connected ||= (surface.get(`${kind}:${[x + dx, y + dy]}`) ?? [])
            .some((point) => distance(mouth, point) < 0.75);
        }
      }
      if (!connected) continue;
      const neighbor = points.find((point) => distance(mouth, point) > 0.05);
      if (!neighbor) continue;
      const fraction = Math.min(1, 4 / distance(mouth, neighbor));
      const tip = mouth.map((value, i) => value + (neighbor[i] - value) * fraction);
      const key = `${kind}:${mouth.map((n) => n.toFixed(6))}`;
      portals.set(key, {
        type: 'Feature', properties: { ...properties, kind },
        geometry: { type: 'LineString', coordinates: [mouth, tip] },
      });
    }
  }
  return { type: 'FeatureCollection', features: [...portals.entries()]
    .sort(([a], [b]) => a.localeCompare(b)).map(([, feature]) => feature) };
}

export function installTunnelPortals(map: MapLibreMap): () => void {
  let dirty = true;
  let previous = '';
  const markDirty = () => { dirty = true; };
  const sourceData = (event: MapSourceDataEvent) => {
    if (event.sourceId === 'openfreemap') markDirty();
  };
  const update = () => {
    if (!dirty) return;
    const source = map.getSource('tunnel-portals') as GeoJSONSource | undefined;
    if (!source || !map.getSource('openfreemap')) return;
    dirty = false;
    const data = tunnelPortals(map.getZoom() < 14 ? [] : map.querySourceFeatures('openfreemap', {
      sourceLayer: 'transportation',
    }));
    const signature = JSON.stringify(data);
    if (signature === previous) return;
    previous = signature;
    source.setData(data);
  };
  map.on('sourcedata', sourceData);
  map.on('moveend', markDirty);
  map.on('idle', update);
  return () => {
    map.off('sourcedata', sourceData);
    map.off('moveend', markDirty);
    map.off('idle', update);
  };
}
