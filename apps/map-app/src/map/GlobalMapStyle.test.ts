import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  aerowayWidthExpression,
  GLOBAL_CYCLING_LAYER_IDS,
  GLOBAL_HIKING_LAYER_IDS,
  GLOBAL_MAP_STYLE,
  GLOBAL_TRANSIT_LINE_LAYER_IDS,
  MOUNTAIN_PEAK_ICON_ID,
  updateBridgeFallback,
  removeBridgeFallback,
  refreshMapRenderState,
} from './GlobalMapStyle';
import { HIKING_POI_CLASSES } from './PoiClasses';
import { globeBiomeColor } from './GlobeBiomeStyle';

describe('global map overlay styles', () => {
  it('preserves an elevated flight camera through an immediate style redraw', () => {
    let elevation = 450;
    let roll = 20;
    let renderedElevation: number | undefined;
    const map = {
      getCenter: () => ({ lng: 18.08, lat: 59.3 }),
      getCenterElevation: () => elevation,
      getZoom: () => 16,
      getBearing: () => 75,
      getPitch: () => 95,
      getRoll: () => roll,
      getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      jumpTo: (options: { elevation?: number; roll?: number }) => {
        // MapLibre samples ground before applying an explicit camera elevation.
        elevation = options.elevation ?? 30;
        roll = options.roll ?? roll;
      },
      redraw: () => { renderedElevation = elevation; },
    };
    refreshMapRenderState(map as any);
    expect(renderedElevation).toBe(450);
    expect(roll).toBe(20);
  });

  it('renders skipped bridge geometry with valid themed fallback layers and cleans them up', () => {
    const style = structuredClone(GLOBAL_MAP_STYLE);
    const data = { type: 'FeatureCollection' as const, features: [] };
    const map = {
      getStyle: () => style,
      getSource: (id: string) => style.sources[id],
      addSource: (id: string, source: any) => { style.sources[id] = source; },
      getLayer: (id: string) => style.layers.find((layer) => layer.id === id),
      addLayer: (layer: any, before: string) => { style.layers.splice(style.layers.findIndex((item) => item.id === before), 0, layer); },
      setLayoutProperty: (id: string, name: string, value: any) => { (map.getLayer(id)!.layout as any)[name] = value; },
      setPaintProperty: (id: string, name: string, value: any) => { (map.getLayer(id)!.paint as any)[name] = value; },
      removeLayer: (id: string) => { style.layers = style.layers.filter((layer) => layer.id !== id); },
      removeSource: (id: string) => { delete style.sources[id]; },
    };
    updateBridgeFallback(map as any, data, true);
    expect(style.sources['bridge-fallback']).toBeUndefined();
    const features = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const,
      properties: { class: 'primary', brunnel: 'bridge' },
      geometry: { type: 'LineString' as const, coordinates: [[18, 59], [18.01, 59]] } }] };
    updateBridgeFallback(map as any, features, true);
    expect(validateStyleMin(style)).toEqual([]);
    const road = map.getLayer('global-road-bridges-fallback')!;
    expect(road.layout?.visibility).toBe('visible');
    expect(road).not.toHaveProperty('source-layer');
    expect(map.getLayer('global-footways-fallback')).toBeTruthy();
    (map.getLayer('global-road-bridges')!.paint as any)['line-color'] = '#123456';
    updateBridgeFallback(map as any, features, false);
    expect(road.layout?.visibility).toBe('none');
    expect((road.paint as any)['line-color']).toBe('#123456');
    removeBridgeFallback(map as any);
    expect(style.sources['bridge-fallback']).toBeUndefined();
    expect(style.layers.some((layer) => layer.id.endsWith('-fallback'))).toBe(false);
  });

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
});
