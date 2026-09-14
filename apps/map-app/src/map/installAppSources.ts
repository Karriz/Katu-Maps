import type { Map } from 'maplibre-gl';

const APP_GEOJSON_SOURCE_IDS = [
  'selected-location',
  'search-results',
  'nearby-results',
  'favorites',
  'user-location',
  'context-menu-location',
  'selected-route',
  'route-endpoints',
  'route-transitions',
] as const;

export function installAppSources(map: Map) {
  APP_GEOJSON_SOURCE_IDS.forEach((id) => {
    map.addSource(id, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  });
}
