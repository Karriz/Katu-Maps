import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  aerowayWidthExpression,
  GLOBAL_CYCLING_LAYER_IDS,
  GLOBAL_HIKING_LAYER_IDS,
  GLOBAL_MAP_STYLE,
  GLOBAL_TRANSIT_LINE_LAYER_IDS,
} from './GlobalMapStyle';

describe('global map overlay styles', () => {
  it('is accepted by the MapLibre style specification', () => {
    expect(validateStyleMin(GLOBAL_MAP_STYLE)).toEqual([]);
  });

  it('keeps cycling, hiking, and rail transit emphasis visible at city-scale zooms', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));

    expect(layersById.get('global-cycling-routes')?.minzoom ?? Infinity).toBeLessThanOrEqual(5);
    expect(layersById.get('global-hiking-routes')?.minzoom ?? Infinity).toBeLessThanOrEqual(6);
    expect(layersById.get('global-local-transit-lines')?.minzoom ?? Infinity).toBeLessThanOrEqual(4);
    expect(layersById.get('global-local-transit-route-colors')?.minzoom ?? Infinity).toBeLessThanOrEqual(4);
  });

  it('defines every optional overlay layer as initially hidden', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const overlayIds = [
      ...GLOBAL_CYCLING_LAYER_IDS,
      ...GLOBAL_HIKING_LAYER_IDS,
      ...GLOBAL_TRANSIT_LINE_LAYER_IDS,
    ];

    overlayIds.forEach((layerId) => {
      expect(layersById.get(layerId)?.layout?.visibility, layerId).toBe('none');
    });
  });

  it('keeps the unsupported Näsinneula outline out of every 3D building layer', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const affectedLayerIds = [
      'global-building-shadow',
      'global-building-contact-shadow',
      'global-building-ground-storeys',
      'global-buildings',
    ];

    affectedLayerIds.forEach((layerId) => {
      const filter = (layersById.get(layerId) as { filter?: unknown } | undefined)?.filter;
      const serializedFilter = JSON.stringify(filter);
      expect(serializedFilter, layerId).toContain('6807253782');
      expect(serializedFilter, layerId).toContain('distance');
      expect(serializedFilter, layerId).toContain('render_height');
    });

    const flatFootprint = layersById.get('global-building-footprints-2d') as { filter?: unknown } | undefined;
    expect(flatFootprint?.filter).toBeUndefined();
  });

  it('uses the polygon water color for line waterways', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const waterwayPaint = layersById.get('global-waterway')?.paint as Record<string, unknown> | undefined;
    const waterPaint = layersById.get('global-water')?.paint as Record<string, unknown> | undefined;

    expect(waterwayPaint?.['line-color']).toEqual(waterPaint?.['fill-color']);
  });

  it('labels named national parks and nature reserves at regional zooms', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-major-protected-area-labels');
    const filter = (layer as { filter?: unknown } | undefined)?.filter;

    expect(layer?.minzoom ?? Infinity).toBeLessThanOrEqual(5);
    expect(filter).toEqual([
      'all',
      ['has', 'name'],
      ['in', ['get', 'class'], ['literal', ['national_park', 'nature_reserve']]],
    ]);
  });

  it('draws protected-area labels above lakes', () => {
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);

    expect(layerIds.indexOf('global-major-protected-area-labels'))
      .toBeGreaterThan(layerIds.indexOf('global-water'));
    expect(layerIds.indexOf('global-major-protected-area-labels'))
      .toBeGreaterThan(layerIds.indexOf('global-road-labels'));
  });

  it('uses physical widths for runway and taxiway centerlines', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-aeroway-lines');
    const paint = (layer as { paint?: Record<string, unknown> } | undefined)?.paint;

    expect(paint?.['line-width']).toEqual(aerowayWidthExpression(0));
  });

  it('draws runway centerlines above taxiways', () => {
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);

    expect(layerIds.indexOf('global-aeroway-runways'))
      .toBeGreaterThan(layerIds.indexOf('global-aeroway-lines'));
  });

  it('shows a plane icon for aerodrome labels', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-aerodrome-labels');
    const aerodromeLayer = layer as { layout?: Record<string, unknown>; 'source-layer'?: string } | undefined;
    const layout = aerodromeLayer?.layout;

    expect(aerodromeLayer?.['source-layer']).toBe('aerodrome_label');
    expect(layout?.['icon-image']).toBe('location-airport-icon');
  });
});
