import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  aerowayWidthExpression,
  GLOBAL_CYCLING_LAYER_IDS,
  GLOBAL_HIKING_LAYER_IDS,
  GLOBAL_MAP_STYLE,
  GLOBAL_TRANSIT_LINE_LAYER_IDS,
  MOUNTAIN_PEAK_ICON_ID,
  pathWidthExpression,
} from './GlobalMapStyle';
import { HIKING_POI_CLASSES } from './PoiClasses';
import { globeBiomeColor } from './GlobeBiomeStyle';

describe('global map overlay styles', () => {
  it('is accepted by the MapLibre style specification', () => {
    expect(validateStyleMin(GLOBAL_MAP_STYLE)).toEqual([]);
  });

  it('keeps subdued biome colors beneath detailed OSM areas at city scale', () => {
    const layers = GLOBAL_MAP_STYLE.layers;
    const index = layers.findIndex((layer) => layer.id === 'global-globe-biomes');
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThan(layers.findIndex((layer) => layer.id === 'global-water'));
    expect(layers[index].maxzoom ?? 24).toBeGreaterThan(20);
    for (const id of ['global-landcover', 'global-landuse', 'global-landuse-overlays']) {
      expect(index).toBeLessThan(layers.findIndex((layer) => layer.id === id));
    }
    const opacity = (layers[index].paint as Record<string, unknown>)['fill-opacity'] as unknown[];
    const localOpacity = opacity[opacity.length - 1] as number;
    expect(localOpacity).toBeGreaterThan(0.5);
    expect(localOpacity).toBeLessThan(0.9);
    const tintedStyle = {
      ...GLOBAL_MAP_STYLE,
      layers: layers.map((layer) => layer.id === 'global-globe-biomes' && layer.type === 'fill'
        ? { ...layer, paint: { ...layer.paint, 'fill-color': globeBiomeColor('#10253a', 0.8) } }
        : layer),
    };
    expect(validateStyleMin(tintedStyle)).toEqual([]);
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

  it('keeps mountain peak markers on the labeled symbol layer', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-mountain-peak-labels') as {
      layout?: Record<string, unknown>;
      'source-layer'?: string;
    } | undefined;
    const circleLayer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-mountain-peaks');

    expect(circleLayer).toBeUndefined();
    expect(layer?.['source-layer']).toBe('mountain_peak');
    expect(layer?.layout?.['icon-image']).toBe(MOUNTAIN_PEAK_ICON_ID);
    expect(layer?.layout?.['text-optional']).toBeUndefined();
  });

  it('includes leftover outdoor amenities on the hiking POI overlay', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-hiking-pois') as {
      filter?: unknown;
      layout?: Record<string, unknown>;
    } | undefined;
    const serializedFilter = JSON.stringify(layer?.filter);
    const serializedIcons = JSON.stringify(layer?.layout?.['icon-image']);

    expect(HIKING_POI_CLASSES).toEqual(expect.arrayContaining(['dog_park', 'bbq', 'winter_sports']));
    ['dog_park', 'bbq', 'winter_sports'].forEach((className) => {
      expect(serializedFilter).toContain(className);
      expect(serializedIcons).toContain(`location-${className}-icon`);
    });
    expect(serializedFilter).not.toContain('playground');
    expect(serializedFilter).not.toContain('sports_centre');
  });

  it('paints parks and site overlays above residential landuse', () => {
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);
    const indexOf = (layerId: string) => layerIds.indexOf(layerId);
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));

    expect(indexOf('global-protected-areas')).toBeLessThan(indexOf('global-landuse'));
    expect(indexOf('global-landuse')).toBeLessThan(indexOf('global-landcover-parks'));
    expect(indexOf('global-landcover-parks')).toBeLessThan(indexOf('global-landuse-overlays'));
    expect(indexOf('global-landuse-overlays')).toBeLessThan(indexOf('global-parks'));

    const landcover = layersById.get('global-landcover') as {
      filter?: unknown[];
      paint?: Record<string, unknown>;
    } | undefined;
    const landcoverParks = layersById.get('global-landcover-parks') as {
      filter?: unknown;
      'source-layer'?: string;
      paint?: Record<string, unknown>;
    } | undefined;
    const landuse = layersById.get('global-landuse') as { filter?: unknown[] } | undefined;
    const overlays = layersById.get('global-landuse-overlays') as {
      filter?: unknown;
      layout?: Record<string, unknown>;
    } | undefined;

    expect(landcover?.filter?.[0]).toBe('!');
    expect(landuse?.filter?.[0]).toBe('!');
    expect(landcoverParks?.['source-layer']).toBe('landcover');
    expect(JSON.stringify(landcoverParks?.filter)).toContain('park');
    expect(JSON.stringify(landcover?.paint?.['fill-color'])).not.toContain('"park"');
    expect(JSON.stringify(landcoverParks?.paint?.['fill-color'])).toContain('"park"');
    expect(JSON.stringify(overlays?.filter)).toContain('pitch');
    expect(overlays?.layout?.['fill-sort-key']).toBeDefined();
  });

  it('keeps globe and continental zooms free of dense overview geometry', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const filterOf = (layerId: string) => JSON.stringify(
      (layersById.get(layerId) as { filter?: unknown } | undefined)?.filter,
    );

    expect(layersById.get('global-overview-roads')?.minzoom).toBe(2.2);
    expect(filterOf('global-overview-roads')).toContain('motorway');
    expect(filterOf('global-overview-roads')).toContain('trunk');
    expect(filterOf('global-overview-roads')).not.toContain('secondary');
    expect(layersById.get('global-overview-regional-roads')?.minzoom).toBe(8);
    expect(filterOf('global-overview-regional-roads')).toContain('primary');
    expect(layersById.get('global-overview-railways')?.minzoom).toBe(6);
    expect(layersById.get('global-waterway')?.minzoom).toBe(7);
    expect(layersById.get('global-landuse')?.minzoom).toBe(5);
    expect(layersById.get('global-boundaries-regional')?.minzoom).toBe(5);
    expect(filterOf('global-boundaries')).toContain('admin_level');
    expect(layersById.get('global-road-labels-regional')?.minzoom).toBe(11);
    expect(layersById.get('global-town-labels')?.minzoom).toBe(8);
    expect(layersById.get('global-locality-labels')?.minzoom).toBe(11);
    expect(filterOf('global-place-labels')).toContain('city');
    expect(filterOf('global-place-labels')).not.toContain('village');
  });

  it('pastelizes mapped building colours and a deterministic ivory fallback', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const colorOf = (layerId: string) => JSON.stringify(
      (layersById.get(layerId)?.paint as Record<string, unknown> | undefined)?.['fill-extrusion-color']
      ?? (layersById.get(layerId)?.paint as Record<string, unknown> | undefined)?.['fill-color'],
    );

    expect(colorOf('global-buildings')).toContain('colour');
    expect(colorOf('global-building-ground-storeys')).toContain('colour');
    expect(colorOf('global-buildings')).toContain('0.72');
    expect(colorOf('global-buildings')).toContain('interpolate-hcl');
    expect(colorOf('global-buildings')).toContain('fffdf8');
    expect(colorOf('global-building-ground-storeys')).toContain('dedad1');
  });

  it('draws dual rail strokes over a physical track bed at close zoom', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);

    expect(layersById.get('global-railway-rail-left')?.minzoom).toBe(15);
    expect(layersById.get('global-railway-rail-right')?.minzoom).toBe(15);
    expect(layerIds.indexOf('global-railway-rail-left')).toBeGreaterThan(layerIds.indexOf('global-railway-bed'));
    expect(layerIds.indexOf('global-railways')).toBeGreaterThan(layerIds.indexOf('global-railway-sleepers'));
    const railsPaint = layersById.get('global-railway-rail-left')?.paint as Record<string, unknown> | undefined;
    expect(JSON.stringify(railsPaint?.['line-color'])).toContain('4a5254');
    const centerlinePaint = layersById.get('global-railways')?.paint as Record<string, unknown> | undefined;
    expect(JSON.stringify(centerlinePaint?.['line-opacity'])).toContain('17.4');
  });

  it('uses physical widths for close-up footpaths, cycleways and tracks', () => {
    const layersById = new Map(GLOBAL_MAP_STYLE.layers.map((layer) => [layer.id, layer]));
    const widthOf = (layerId: string) => (
      layersById.get(layerId)?.paint as Record<string, unknown> | undefined
    )?.['line-width'];

    expect(widthOf('global-footways')).toEqual(pathWidthExpression(1.8, 61.4981));
    expect(widthOf('global-cycleways')).toEqual(pathWidthExpression(2.5, 61.4981));
    expect(widthOf('global-tracks')).toEqual(pathWidthExpression(3, 61.4981));
  });
});
