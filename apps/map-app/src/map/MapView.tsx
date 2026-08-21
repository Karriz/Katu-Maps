import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map, type StyleSpecification } from 'maplibre-gl';

const TAMPERE: [number, number] = [23.7609, 61.4981];
const TILEJSON_URL = 'http://localhost:3000/tampere';
const TERRAIN_TILEJSON_URL = 'http://localhost:3000/terrain';

const TAMPERE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Tampere local OSM',
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
          'wetland', '#c8e2d2',
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
    map.once('load', () => setMapLoaded(true));
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
