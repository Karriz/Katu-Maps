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
    { id: 'background', type: 'background', paint: { 'background-color': '#dce8e4' } },
    {
      id: 'landuse',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'landuse',
      paint: { 'fill-color': '#c9dcc9', 'fill-opacity': 0.8 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'tampere',
      'source-layer': 'water',
      paint: { 'fill-color': '#9bc9e6' },
    },
    {
      id: 'railways',
      type: 'line',
      source: 'tampere',
      'source-layer': 'railways',
      paint: { 'line-color': '#765f72', 'line-width': 2.5, 'line-opacity': 0.85 },
    },
    {
      id: 'roads',
      type: 'line',
      source: 'tampere',
      'source-layer': 'roads',
      paint: {
        'line-color': '#fffdf7',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 7],
        'line-opacity': 0.95,
      },
    },
    {
      id: 'paths',
      type: 'line',
      source: 'tampere',
      'source-layer': 'paths',
      paint: { 'line-color': '#8c9d86', 'line-width': 1.5, 'line-dasharray': [2, 2] },
    },
    {
      id: 'buildings',
      type: 'fill-extrusion',
      source: 'tampere',
      'source-layer': 'buildings',
      minzoom: 12,
      paint: {
        'fill-extrusion-color': [
          'match',
          ['get', 'height_source'],
          'height', '#c98f72',
          'building:levels', '#d2a17e',
          '#b98269',
        ],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9,
      },
    },
    {
      id: 'terrain-hillshade',
      type: 'hillshade',
      source: 'terrain',
      layout: { visibility: 'none' },
      paint: { 'hillshade-shadow-color': '#52645f' },
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
            map.setTerrain(nextEnabled ? { source: 'terrain', exaggeration: 1.25 } : null);
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
