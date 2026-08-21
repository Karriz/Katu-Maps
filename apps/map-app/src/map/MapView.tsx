import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map, type StyleSpecification } from 'maplibre-gl';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const TILEJSON_URL = 'http://localhost:3000/tampere';
const TERRAIN_TILEJSON_URL = 'http://localhost:3000/terrain';

type TreeModelFeature = {
  type: 'Feature';
  properties: { kind: 'trunk' | 'canopy'; height: number; base: number; leafType: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};

function treeCoordinates(feature: ReturnType<Map['querySourceFeatures']>[number]): number[][] {
  const geometry = feature.geometry;
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates.map(Number)];
  }
  if (geometry?.type === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map((coordinates) => coordinates.map(Number));
  }
  return [];
}

function createTreeModels(map: Map, sourceFeatures: ReturnType<Map['querySourceFeatures']>) {
  const features: TreeModelFeature[] = [];
  const seen = new Set<string>();

  for (const feature of sourceFeatures) {
    for (const coordinates of treeCoordinates(feature)) {
      if (coordinates.length < 2 || seen.size >= 5000) continue;
      const longitude = coordinates[0];
      const latitude = coordinates[1];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
      const key = `${longitude.toFixed(6)}:${latitude.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const properties = feature.properties ?? {};
      const heightValue = Number(properties.height);
      const height = Number.isFinite(heightValue) && heightValue > 2 ? Math.min(heightValue, 24) : 12;
      const leafType = String(properties.leaf_type ?? 'broadleaved');
      const terrainElevation = map.queryTerrainElevation([longitude, latitude], { exaggerated: false });
      const ground = terrainElevation ?? 0;
      const metersPerDegreeLat = 1 / 111320;
      const metersPerDegreeLon = metersPerDegreeLat / Math.cos((latitude * Math.PI) / 180);
      const polygon = (radius: number, sides: number, angleOffset: number) => Array.from({ length: sides + 1 }, (_, index) => {
        const angle = angleOffset + (index / sides) * Math.PI * 2;
        return [
          longitude + Math.cos(angle) * radius * metersPerDegreeLon,
          latitude + Math.sin(angle) * radius * metersPerDegreeLat,
        ];
      });

      features.push({
        type: 'Feature',
        properties: {
          kind: 'trunk',
          height: ground + Math.min(height * 0.42, 4),
          base: ground,
          leafType,
        },
        geometry: { type: 'Polygon', coordinates: [polygon(0.65, 4, Math.PI / 4)] },
      });
      features.push({
        type: 'Feature',
        properties: {
          kind: 'canopy',
          height: ground + height,
          base: ground + Math.min(height * 0.28, 3),
          leafType,
        },
        geometry: { type: 'Polygon', coordinates: [polygon(2.5, 6, Math.PI / 6)] },
      });
    }
  }

  return { type: 'FeatureCollection' as const, features };
}

const TAMPERE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Tampere local OSM',
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    tampere: {
      type: 'vector',
      url: TILEJSON_URL,
      attribution: '© OpenStreetMap contributors',
    },
    terrain: {
      type: 'raster-dem',
      // Use the explicit template so Martin's raster TileJSON defaults cannot
      // override the DEM tile dimensions.
      tiles: [`${TERRAIN_TILEJSON_URL}/{z}/{x}/{y}`],
      // rio-rgbify's 512px PNGs are retina-style tiles for a 256px map tile.
      tileSize: 256,
      bounds: [23.55, 61.40, 24.05, 61.60],
      minzoom: 8,
      maxzoom: 14,
      encoding: 'mapbox',
      attribution: 'National Land Survey of Finland, Elevation model 10 m',
    },
    'tree-models': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 20,
      tolerance: 0,
      buffer: 256,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f4f6f2' } },
    {
      id: 'landuse',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'forest', '#d7e8d1',
          'wood', '#c9e2c2',
          'scrub', '#d5e5b4',
          'heath', '#dce3ad',
          'wetland', [
            'match',
            ['get', 'wetland'],
            'marsh', '#dbe7ae',
            'swamp', '#c6dcb2',
            'bog', '#d2dfbb',
            'fen', '#cfdfb1',
            '#d1dfb9',
          ],
          'bare_rock', '#ddd9ce',
          'sand', '#f0dfae',
          'beach', '#f2e2b7',
          'farmland', '#e9edbf',
          'farmyard', '#e8e0c8',
          'orchard', '#d5e7b3',
          'vineyard', '#d9e4ad',
          'park', '#c5e6bb',
          'recreation_ground', '#d0eabd',
          'meadow', '#dcebb4',
          'grass', '#d7eab8',
          'allotments', '#d1e5a9',
          'cemetery', '#cfe3c6',
          'nature_reserve', '#bfe0b7',
          'pitch', '#b8dfa9',
          'playground', '#d8e8aa',
          'sports_centre', '#c9e2ad',
          'stadium', '#c2dfa5',
          'track', '#d1e4ad',
          'golf_course', '#c4e2af',
          'residential', '#f1f0e8',
          'commercial', '#ece9df',
          'retail', '#f1e8d9',
          'industrial', '#e4e5e1',
          'brownfield', '#e4d9c4',
          '#edf0e8',
        ],
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: { 'fill-color': '#b9def1' },
    },
    {
      id: 'water-detail',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water_detail',
      paint: { 'fill-color': '#b9def1' },
    },
    {
      id: 'river-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'river_areas',
      paint: {
        'fill-color': '#b9def1',
        'fill-opacity': 0.96,
        'fill-outline-color': '#a4d2e8',
      },
    },
    {
      id: 'waterways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'waterways',
      paint: {
        'line-color': '#8fc9e7',
        'line-opacity': 0.9,
        'line-width': [
          'match',
          ['get', 'class'],
          'river', 2.4,
          'canal', 2,
          'stream', 1.3,
          'ditch', 0.9,
          'drain', 0.9,
          1,
        ],
      },
    },
    {
      id: 'bridges',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'bridges',
      paint: {
        'fill-color': '#d7d1c5',
        'fill-outline-color': '#b9b2a6',
        'fill-opacity': 0.98,
      },
    },
    {
      id: 'parking',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'parking',
      paint: {
        'fill-color': '#e3e0d8',
        'fill-outline-color': '#c9c5bb',
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'pedestrian-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'pedestrian_areas',
      paint: {
        'fill-color': '#eee5d3',
        'fill-outline-color': '#d7cbb6',
        'fill-opacity': 0.95,
      },
    },
    {
      id: 'aeroway-areas',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'aeroway',
      paint: { 'fill-color': '#e5e4e0', 'fill-opacity': 0.9 },
    },
    {
      id: 'aeroway-lines',
      type: 'line',
      source: 'tampere',
      'source-layer': 'aeroway',
      paint: { 'line-color': '#cbc9c2', 'line-width': 2, 'line-opacity': 0.9 },
    },
    {
      id: 'power-lines',
      type: 'line',
      source: 'tampere',
      'source-layer': 'power',
      paint: { 'line-color': '#c1c0b8', 'line-width': 1.2, 'line-opacity': 0.55 },
    },
    {
      id: 'power-points',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'power',
      paint: { 'circle-color': '#c1c0b8', 'circle-radius': 1.5, 'circle-opacity': 0.55 },
    },
    {
      id: 'barriers',
      type: 'line',
      source: 'tampere',
      'source-layer': 'barriers',
      paint: { 'line-color': '#a9a28d', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.75 },
    },
    {
      id: 'railways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      paint: { 'line-color': '#a99aa8', 'line-width': 2, 'line-opacity': 0.8 },
    },
    {
      id: 'road-casing',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      paint: {
        'line-color': '#d3d8d5',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 14, 10],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'roads',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      paint: {
        'line-color': [
          'match',
          ['get', 'surface'],
          'gravel', '#d9c9a7',
          'unpaved', '#decda9',
          'dirt', '#cdb78a',
          'ground', '#cdb78a',
          'sand', '#ead39b',
          'cobblestone', '#eee1cb',
          'paving_stones', '#f5ead2',
          'concrete', '#f3eee5',
          '#fffdf7',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 7],
        'line-opacity': 0.95,
      },
    },
    {
      id: 'road-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'roads',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 15, 13],
        'text-font': ['Open Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 20,
      },
      paint: {
        'text-color': '#59645c',
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'water',
      minzoom: 10,
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
        'text-font': ['Open Sans Regular'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#4f91ad',
        'text-halo-color': '#b9def1',
        'text-halo-width': 1.25,
      },
    },
    {
      id: 'waterway-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'waterways',
      minzoom: 12,
      filter: ['has', 'name'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-font': ['Open Sans Regular'],
        'text-max-angle': 30,
        'text-padding': 16,
      },
      paint: {
        'text-color': '#4f91ad',
        'text-halo-color': '#b9def1',
        'text-halo-width': 1.25,
      },
    },
    {
      id: 'paths',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      paint: {
        'line-color': [
          'match',
          ['get', 'surface'],
          'asphalt', '#8d9c84',
          'gravel', '#b89d70',
          'dirt', '#aa8759',
          'ground', '#aa8759',
          'sand', '#d2b878',
          '#91a989',
        ],
        'line-width': 1.4,
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 12,
      paint: {
        'fill-extrusion-color': '#d7dade',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 0.94,
      },
    },
    {
      id: 'tree-points',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'trees',
      minzoom: 13,
      paint: {
        'circle-color': '#5d9951',
        'circle-radius': 2,
        'circle-opacity': 0.8,
        'circle-stroke-color': '#39713a',
        'circle-stroke-width': 0.5,
      },
    },
    {
      id: 'tree-trunks',
      type: 'fill-extrusion',
      source: 'tree-models',
      minzoom: 13,
      filter: ['==', ['get', 'kind'], 'trunk'],
      paint: {
        'fill-extrusion-color': '#76563b',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 1,
      },
    },
    {
      id: 'tree-canopies',
      type: 'fill-extrusion',
      source: 'tree-models',
      minzoom: 13,
      filter: ['==', ['get', 'kind'], 'canopy'],
      paint: {
        'fill-extrusion-color': [
          'match',
          ['get', 'leafType'],
          'needleleaved', '#39713a',
          '#5d9951',
        ],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 1,
      },
    },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: 'terrain',
      layout: { visibility: 'none' },
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': '#66736c',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#aeb9b0',
      },
    },
    {
      id: 'places-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'places',
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 15],
        'text-font': ['Open Sans Regular'],
        'text-offset': [0, 0.8],
      },
      paint: {
        'text-color': '#4e5a52',
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'poi-circles',
      type: 'circle',
      source: 'tampere',
      'source-layer': 'pois',
      minzoom: 14,
      filter: ['has', 'name'],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 4,
        'circle-stroke-color': '#6d7a71',
        'circle-stroke-width': 1,
      },
    },
    {
      id: 'poi-labels',
      type: 'symbol',
      source: 'tampere',
      'source-layer': 'pois',
      minzoom: 14,
      filter: ['has', 'name'],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.1],
      },
      paint: {
        'text-color': '#59645c',
        'text-halo-color': '#f4f6f2',
        'text-halo-width': 1.25,
      },
    },
  ],
};

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TAMPERE_STYLE,
      center: TAMPERE,
      zoom: 11,
      pitch: 45,
      bearing: 0,
      maxPitch: 85,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    let treeSignature = '';
    let treeUpdateTimer: number | undefined;
    const updateTreeModels = () => {
      const source = map.getSource('tree-models') as GeoJSONSource | undefined;
      if (!source) return;
      if (map.getZoom() < 13) {
        if (treeSignature !== '') {
          treeSignature = '';
          source.setData({ type: 'FeatureCollection', features: [] });
        }
        return;
      }

      const loadedTrees = map.querySourceFeatures('tampere', { sourceLayer: 'trees' });
      const coordinates = loadedTrees.flatMap((feature) => treeCoordinates(feature).map(
        ([longitude, latitude]) => `${longitude.toFixed(6)}:${latitude.toFixed(6)}`,
      ));
      coordinates.sort();
      const nextSignature = coordinates.join('|');
      if (nextSignature === treeSignature) return;

      treeSignature = nextSignature;
      const treeModels = createTreeModels(map, loadedTrees);
      source.setData(treeModels);
    };
    const scheduleTreeUpdate = () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      treeUpdateTimer = window.setTimeout(updateTreeModels, 120);
    };
    map.once('load', () => {
      scheduleTreeUpdate();
      setMapLoaded(true);
    });
    map.on('moveend', scheduleTreeUpdate);
    map.on('sourcedata', scheduleTreeUpdate);
    map.on('error', (event) => {
      const message = event.error?.message ?? 'The map style could not be loaded.';
      // MapLibre can emit this while backfilling a missing edge DEM tile. It
      // is non-fatal when the map is otherwise rendering.
      if (message.toLowerCase().includes('dem dimension mismatch')) {
        console.warn(message);
        return;
      }
      setMapError(message);
    });
    mapRef.current = map;

    return () => {
      if (treeUpdateTimer !== undefined) window.clearTimeout(treeUpdateTimer);
      map.off('moveend', scheduleTreeUpdate);
      map.off('sourcedata', scheduleTreeUpdate);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} className="map-canvas">
      {!mapLoaded && !mapError && <div className="map-status">Loading map…</div>}
      {mapError && (
        <div className="map-status map-status-error">
          <strong>Map unavailable</strong>
          <span>{mapError}</span>
          <small>Check that the browser can access the configured map style.</small>
        </div>
      )}
      {mapLoaded && !mapError && (
        <button
          className="terrain-toggle"
          type="button"
          aria-pressed={terrainEnabled}
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const nextEnabled = !terrainEnabled;
            map.setTerrain(nextEnabled ? { source: 'terrain', exaggeration: 1.0 } : null);
            map.setLayoutProperty('terrain-hillshade', 'visibility', nextEnabled ? 'visible' : 'none');
            setTerrainEnabled(nextEnabled);
          }}
        >
          {terrainEnabled ? 'Disable terrain' : 'Enable terrain'}
        </button>
      )}
    </div>
  );
}
