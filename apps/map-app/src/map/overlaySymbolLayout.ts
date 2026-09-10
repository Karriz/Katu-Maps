import type { DataDrivenPropertyValueSpecification, ExpressionSpecification, Map } from 'maplibre-gl';

const originalTextFields = new WeakMap<Map, Record<string, unknown>>();

/** Roomier collision at city scale; tight at street scale so nearby icons can both show. */
export function overlayIconCollisionLayout() {
  return {
    'icon-allow-overlap': false as const,
    'icon-ignore-placement': false as const,
    'icon-padding': [
      'interpolate', ['linear'], ['zoom'],
      8, 18,
      13, 14,
      15, 6,
      16.5, 1.5,
      17.5, 0.5,
    ] as ExpressionSpecification,
  };
}

export function overlayIconLabelLayout() {
  return {
    'icon-optional': false as const,
    'text-optional': true as const,
    'text-allow-overlap': false as const,
    'text-ignore-placement': false as const,
  };
}

export type IconLabelZoomBand = {
  iconLayerId: string;
  labelLayerId: string;
  minzoom: number;
  labelMinzoom: number;
};

export const ICON_LABEL_ZOOM_BANDS: IconLabelZoomBand[] = [
  { iconLayerId: 'location-poi-icons', labelLayerId: 'location-poi-labels', minzoom: 14, labelMinzoom: 15.5 },
  { iconLayerId: 'transit-train-stop-icons', labelLayerId: 'transit-train-stop-labels', minzoom: 10, labelMinzoom: 11 },
  { iconLayerId: 'transit-metro-stop-icons', labelLayerId: 'transit-metro-stop-labels', minzoom: 10, labelMinzoom: 12 },
  { iconLayerId: 'transit-tram-stop-icons', labelLayerId: 'transit-tram-stop-labels', minzoom: 12, labelMinzoom: 14 },
  { iconLayerId: 'transit-bus-stop-icons', labelLayerId: 'transit-bus-stop-labels', minzoom: 14, labelMinzoom: 16 },
  { iconLayerId: 'traffic-cameras-icons', labelLayerId: 'traffic-cameras-labels', minzoom: 7, labelMinzoom: 10 },
  { iconLayerId: 'charging-stations-icons', labelLayerId: 'charging-stations-labels', minzoom: 10, labelMinzoom: 13 },
  { iconLayerId: 'road-weather-icons', labelLayerId: 'road-weather-labels', minzoom: 7, labelMinzoom: 8 },
];

export const RUNTIME_LABEL_LAYER_IDS = ICON_LABEL_ZOOM_BANDS.map((band) => band.labelLayerId);

export const COMBINED_SYMBOL_TEXT_LAYER_IDS = [
  'favorite-icons',
  'global-aerodrome-labels',
  'global-mountain-peak-labels',
  'global-hiking-pois',
];

export function syncIconLabelZoomBands(map: Map, labelsVisible: boolean) {
  ICON_LABEL_ZOOM_BANDS.forEach((band) => {
    if (!map.getLayer(band.iconLayerId)) return;
    map.setLayerZoomRange(band.iconLayerId, band.minzoom, labelsVisible ? band.labelMinzoom : 24);
  });
}

export function setLayerTextVisible(map: Map, layerIds: string[], visible: boolean) {
  let cache = originalTextFields.get(map);
  if (!cache) {
    cache = {};
    originalTextFields.set(map, cache);
  }
  layerIds.forEach((layerId) => {
    if (!map.getLayer(layerId)) return;
    if (!(layerId in cache)) {
      cache[layerId] = map.getLayoutProperty(layerId, 'text-field');
    }
    map.setLayoutProperty(
      layerId,
      'text-field',
      (visible ? cache[layerId] : '') as DataDrivenPropertyValueSpecification<string>,
    );
  });
}
