import { createExpression, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  aerowayWidthExpression,
  roadWidthExpression,
  buildingColorPaint,
  GLOBAL_CYCLING_LAYER_IDS,
  GLOBAL_HIKING_LAYER_IDS,
  GLOBAL_MAP_STYLE,
  GLOBAL_TRANSIT_LINE_LAYER_IDS,
  GLOBAL_BASE_LABEL_LAYER_IDS,
  MOUNTAIN_PEAK_ICON_ID,
  pastelBuildingColor,
  updatePhysicalLineCaps,
  updateBridgeFallback,
  removeBridgeFallback,
  refreshMapRenderState,
} from './GlobalMapStyle';
import { HIKING_POI_CLASSES } from './PoiClasses';
import { globeBiomeColor } from './GlobeBiomeStyle';

describe('global map overlay styles', () => {
  it('renders tunnel shadows from entrance geometry instead of full tunnel lines', () => {
    const layers = GLOBAL_MAP_STYLE.layers;
    expect(layers.some((layer) => ['global-road-tunnels', 'global-railway-tunnels'].includes(layer.id))).toBe(false);
    for (const id of ['global-road-tunnel-portals', 'global-railway-tunnel-portals']) {
      const layer = layers.find((item) => item.id === id);
      expect(layer).toMatchObject({ type: 'line', source: 'tunnel-portals', minzoom: 14 });
      expect(layer).not.toHaveProperty('source-layer');
    }
    for (const id of ['global-overview-roads', 'global-overview-regional-roads', 'global-overview-railways']) {
      expect(layers.find((layer) => layer.id === id)).toMatchObject({
        filter: expect.arrayContaining([['!=', ['get', 'brunnel'], 'tunnel']]),
      });
    }
  });

  it('selectively pastellizes vivid OSM building colours without washing out soft colours', () => {
    const expression = pastelBuildingColor('#fffdf8') as any;
    const compiled = createExpression(expression, 'building-color-test');
    if (compiled.result !== 'success') throw new Error('Invalid building color expression');
    const vivid = compiled.value.evaluate({ zoom: 16 }, { properties: { colour: '#ff0000' } } as any);
    const vividYellow = compiled.value.evaluate({ zoom: 16 }, { properties: { colour: '#ffff00' } } as any);
    const darkGray = compiled.value.evaluate({ zoom: 16 }, { properties: { colour: '#303030' } } as any);
    const darkRed = compiled.value.evaluate({ zoom: 16 }, { properties: { colour: '#7f1818' } } as any);
    const saturatedGreen = compiled.value.evaluate({ zoom: 16 }, { properties: { colour: '#20a020' } } as any);
    const soft = compiled.value.evaluate({ zoom: 16 }, { properties: { colour: '#f3caca' } } as any);
    const untagged = (id?: number) => compiled.value.evaluate(
      { zoom: 16 },
      { id, properties: {} } as any,
    ).toString();
    expect(vivid.r).toBeGreaterThan(vivid.g);
    expect(vivid.g).toBeGreaterThan(0.75);
    expect(vividYellow.b).toBeGreaterThan(0.75);
    expect(darkGray.r).toBeGreaterThan(0.7);
    expect(darkRed.g).toBeGreaterThan(0.65);
    expect(saturatedGreen.r).toBeGreaterThan(0.7);
    expect(saturatedGreen.b).toBeGreaterThan(0.7);
    expect(soft.r).toBeCloseTo(0xf3 / 255, 2);
    expect(soft.g).toBeCloseTo(0xca / 255, 2);
    expect(untagged()).toBe('rgba(255,253,248,1)');
    expect(untagged(12)).toBe('rgba(255,253,248,1)');
    expect(untagged(22)).toBe('rgba(245,239,230,1)');
    expect(untagged(32)).toBe('rgba(241,243,244,1)');
    expect(untagged(22)).toBe(untagged(22));
    expect(new Set(Array.from({ length: 8 }, (_, id) => untagged(id * 10 + 2))).size).toBe(7);
    expect(buildingColorPaint('#fffdf8', false)).toBe('#fffdf8');
  });

  it('caps road widths at z18 in map mode and z19 in flight mode', () => {
    for (const latitude of [0, 61.4981]) {
      for (const casing of [false, true]) {
        const compile = (maxZoom?: number) =>
          createExpression(roadWidthExpression(latitude, casing, maxZoom), 'flight-road-width');
        const mapCompiled = compile();
        const flightCompiled = compile(19);
        if (mapCompiled.result !== 'success' || flightCompiled.result !== 'success') {
          throw new Error('Invalid road width expression');
        }
        expect(JSON.stringify(roadWidthExpression(latitude, casing))).not.toContain('"get"');
        expect(JSON.stringify(roadWidthExpression(latitude, casing, 19))).not.toContain('"get"');
        for (const properties of [{ class: 'motorway' }, { class: 'minor' }, { class: 'service', service: 'driveway' }]) {
          const evaluate = (compiled: typeof mapCompiled, zoom: number) =>
            compiled.value.evaluate({ zoom }, { properties } as any) as number;

          // Map mode: widths plateau at z18.
          const mapRef = evaluate(mapCompiled, 18);
          for (const zoom of [18.5, 19, 20, 21, 22]) {
            expect(evaluate(mapCompiled, zoom)).toBeCloseTo(mapRef, 6);
          }

          // Flight mode: widths scale one step to z19, then plateau.
          const flightRef18 = evaluate(flightCompiled, 18);
          expect(evaluate(flightCompiled, 19)).toBeCloseTo(flightRef18 * 2, 6);
          const flightRef19 = evaluate(flightCompiled, 19);
          for (const zoom of [19.5, 20, 21, 22]) {
            expect(evaluate(flightCompiled, zoom)).toBeCloseTo(flightRef19, 6);
          }
        }
      }
    }
  });

  it('uses camera-only widths for every close-up road cohort', () => {
    for (const baseId of [
      'global-road-tunnel-portals',
      'global-road-casing',
      'global-roads',
      'global-road-bridge-shadow',
      'global-road-bridge-casing',
      'global-road-bridges',
    ]) {
      const layers = GLOBAL_MAP_STYLE.layers.filter((layer) => (
        layer.id === baseId || layer.id.startsWith(`${baseId}-`)
      ));
      expect(layers).toHaveLength(6);
      const widths = layers.map((layer) => {
        const expression = (layer.paint as any)['line-width'];
        expect(JSON.stringify(expression)).not.toContain('"get"');
        const compiled = createExpression(expression, `${layer.id}-width`);
        if (compiled.result !== 'success') throw new Error(`Invalid width for ${layer.id}`);
        return compiled.value.evaluate({ zoom: 18 }, { properties: {} } as any) as number;
      });
      expect(new Set(widths.map((width) => width.toFixed(6)))).toHaveLength(6);
    }
  });

  it('defaults ground-level roads and taxiways to round caps while runways stay square', () => {
    const wideSurfaceIds = GLOBAL_MAP_STYLE.layers
      .map((layer) => layer.id)
      .filter((id) => (
        id === 'global-road-casing' || id.startsWith('global-road-casing-')
        || id === 'global-roads' || id.startsWith('global-roads-')
        || id === 'global-aeroway-lines' || id.startsWith('global-aeroway-lines-')
        || id === 'global-aeroway-runways'
      ));
    expect(wideSurfaceIds).toHaveLength(16);
    for (const id of wideSurfaceIds) {
      const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === id) as any;
      expect(layer.layout?.['line-cap']).toBe(id === 'global-aeroway-runways' ? 'square' : 'round');
      expect(layer.layout?.['line-join']).toBe('round');
    }
  });

  it('uses square physical-line caps only during flight', () => {
    const updates: Array<[string, string]> = [];
    const map = {
      getLayer: () => ({}),
      setLayoutProperty: (id: string, _property: string, value: string) => updates.push([id, value]),
    };
    updatePhysicalLineCaps(map as any, true);
    expect(updates).toHaveLength(15);
    expect(updates.every(([, cap]) => cap === 'square')).toBe(true);
    expect(updates.some(([id]) => id === 'global-aeroway-runways')).toBe(false);

    updates.length = 0;
    updatePhysicalLineCaps(map as any, false);
    expect(updates).toHaveLength(15);
    expect(updates.every(([, cap]) => cap === 'round')).toBe(true);
  });

  it('caps aeroway widths at z18 in map mode and z19 in flight mode', () => {
    const feature = { properties: { class: 'runway' } } as any;
    const evaluate = (expression: any, zoom: number, label: string) => {
      const compiled = createExpression(expression, label);
      if (compiled.result !== 'success') throw new Error('Invalid aeroway width expression');
      return compiled.value.evaluate({ zoom }, feature) as number;
    };

    // Map mode: aeroway widths plateau at z18.
    const mapRef = evaluate(aerowayWidthExpression(61.4981), 18, 'aeroway-map-width');
    expect(JSON.stringify(aerowayWidthExpression(61.4981))).not.toContain('"get"');
    for (const zoom of [18.5, 19, 20, 21, 22]) {
      expect(evaluate(aerowayWidthExpression(61.4981), zoom, 'aeroway-map-width')).toBeCloseTo(mapRef, 6);
    }

    // Flight mode: aeroway widths scale one step to z19, then plateau.
    const flightRef18 = evaluate(aerowayWidthExpression(61.4981, 19), 18, 'aeroway-flight-width');
    expect(evaluate(aerowayWidthExpression(61.4981, 19), 19, 'aeroway-flight-width')).toBeCloseTo(flightRef18 * 2, 6);
    const flightRef19 = evaluate(aerowayWidthExpression(61.4981, 19), 19, 'aeroway-flight-width');
    for (const zoom of [19.5, 20, 21, 22]) {
      expect(evaluate(aerowayWidthExpression(61.4981, 19), zoom, 'aeroway-flight-width')).toBeCloseTo(flightRef19, 6);
    }
  });

  it('keeps path widths in ground metres at close zooms', () => {
    const path = GLOBAL_MAP_STYLE.layers.find((layer) => layer.id === 'global-path-casing') as any;
    if (!path) throw new Error('Missing path layer');
    const compiled = createExpression(path.paint['line-width'], 'path-surface-width');
    if (compiled.result !== 'success') throw new Error('Invalid path width expression');
    const feature = { properties: { class: 'track' } } as any;
    expect(compiled.value.evaluate({ zoom: 22 }, feature)
      / compiled.value.evaluate({ zoom: 18 }, feature)).toBeCloseTo(16, 6);
  });

  it('uses metre-scaled paired rails inside the ground railway bed at close zoom', () => {
    const rail = GLOBAL_MAP_STYLE.layers.find((layer) => layer.id === 'global-railways') as any;
    const bed = GLOBAL_MAP_STYLE.layers.find((layer) => layer.id === 'global-railway-bed') as any;
    const evaluate = (expression: any, zoom: number) => {
      const compiled = createExpression(expression, 'railway-width-test');
      if (compiled.result !== 'success') throw new Error('Invalid railway expression');
      return compiled.value.evaluate({ zoom });
    };
    expect(evaluate(rail.paint['line-gap-width'], 14)).toBe(0);
    for (const zoom of [16, 18, 20]) {
      const width = evaluate(rail.paint['line-width'], zoom);
      const gap = evaluate(rail.paint['line-gap-width'], zoom);
      const bedWidth = evaluate(bed.paint['line-width'], zoom);
      expect((gap + width) / bedWidth).toBeCloseTo(1.5 / 5.5);
      expect(gap + 2 * width).toBeLessThan(bedWidth);
    }
  });

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

  it('delays named protected areas until after towns appear', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-major-protected-area-labels');
    const filter = (layer as { filter?: unknown } | undefined)?.filter;

    expect(layer?.minzoom).toBe(9);
    expect(filter).toEqual([
      'all',
      ['has', 'name'],
      ['in', ['get', 'class'], ['literal', ['national_park', 'nature_reserve']]],
    ]);
  });

  it('reserves regional water labels for lakes and seas before adding straits and bays', () => {
    const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-water-labels');
    const expression = createExpression((layer as { filter: unknown }).filter, 'water-label-filter-test');
    expect(expression.result).toBe('success');
    if (expression.result !== 'success') return;

    const visible = (zoom: number, waterClass: string) => expression.value.evaluate(
      { zoom }, { type: 1, properties: { name: 'Named water', class: waterClass } },
    );
    for (const waterClass of ['bay', 'strait']) {
      expect(visible(6, waterClass)).toBe(false);
      expect(visible(8, waterClass)).toBe(false);
      expect(visible(9, waterClass)).toBe(true);
    }
    for (const waterClass of ['lake', 'sea', 'ocean']) {
      expect(visible(6, waterClass)).toBe(true);
    }
    expect(visible(9, 'fountain')).toBe(false);
  });

  it('draws protected-area labels above lakes', () => {
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);

    expect(layerIds.indexOf('global-major-protected-area-labels'))
      .toBeGreaterThan(layerIds.indexOf('global-water'));
    expect(layerIds.indexOf('global-major-protected-area-labels'))
      .toBeGreaterThan(layerIds.indexOf('global-road-labels'));
  });

  it('uses camera-only physical widths for aeroway centerline cohorts', () => {
    const expectedMetres = new Map([
      ['global-aeroway-lines', 6],
      ['global-aeroway-lines-apron', 12],
      ['global-aeroway-lines-taxiway', 23],
      ['global-aeroway-runways', 45],
    ]);
    for (const [id, metres] of expectedMetres) {
      const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === id);
      const width = (layer as { paint?: Record<string, unknown> } | undefined)?.paint?.['line-width'];
      expect(width).toEqual(aerowayWidthExpression(0, 18, metres));
      expect(JSON.stringify(width)).not.toContain('"get"');
    }
  });

  it('draws runway centerlines above taxiways', () => {
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);

    expect(layerIds.indexOf('global-aeroway-lines'))
      .toBeGreaterThan(layerIds.indexOf('global-paths-under-construction'));
    expect(layerIds.indexOf('global-aeroway-runways'))
      .toBeGreaterThan(layerIds.indexOf('global-aeroway-lines-taxiway'));
  });

  it('draws camera-only runway and taxiway markings above aeroway surfaces', () => {
    const layerIds = GLOBAL_MAP_STYLE.layers.map((layer) => layer.id);
    const markings = [
      ['global-aeroway-taxiway-centerlines', 'taxiway'],
      ['global-aeroway-runway-centerlines', 'runway'],
    ] as const;

    for (const [id, aerowayClass] of markings) {
      const layer = GLOBAL_MAP_STYLE.layers.find((item) => item.id === id) as any;
      expect(layer).toMatchObject({ type: 'line', 'source-layer': 'aeroway', minzoom: 14 });
      expect(JSON.stringify(layer.filter)).toContain(`"${aerowayClass}"`);
      expect(JSON.stringify(layer.paint['line-width'])).not.toContain('"get"');
      const compiled = createExpression(layer.paint['line-width'], `${id}-width`);
      if (compiled.result !== 'success') throw new Error(`Invalid width for ${id}`);
      expect(compiled.value.evaluate({ zoom: 20 }, { properties: {} } as any))
        .toBeCloseTo(compiled.value.evaluate({ zoom: 18 }, { properties: {} } as any), 6);
      expect(layerIds.indexOf(id)).toBeGreaterThan(layerIds.indexOf('global-aeroway-runways'));
    }
    const runway = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-aeroway-runway-centerlines') as any;
    const taxiway = GLOBAL_MAP_STYLE.layers.find((item) => item.id === 'global-aeroway-taxiway-centerlines') as any;
    expect(runway.paint['line-dasharray']).toEqual([60, 40]);
    expect(taxiway.paint).not.toHaveProperty('line-dasharray');
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
    expect(layersById.get('global-town-labels')?.minzoom).toBe(6);
    expect(layersById.get('global-locality-labels')?.minzoom).toBe(11);
    expect(filterOf('global-place-labels')).toContain('city');
    expect(filterOf('global-place-labels')).not.toContain('village');
    for (const layerId of GLOBAL_BASE_LABEL_LAYER_IDS) {
      expect(layersById.has(layerId), layerId).toBe(true);
    }
  });
});
