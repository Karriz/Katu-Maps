import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  BridgeModelLayer,
  bridgeClearanceProbes,
  bridgeArchMetres,
  bridgeApproachMix,
  bridgeEntranceOpacity,
  bridgeShadowEndFade,
  shadowTerrainHeights,
  bridgeSurfaceClearance,
  bridgeWallBottom,
  bridgeBoundaryEdges,
  bridgeFasciaEdges,
  bridgeFasciaPositions,
  refineBridgeApproaches,
  refineBridgeSpan,
  terrainClearedDeck,
  lineRibbonMesh,
  lngLatsToPlan,
  bridgeDeckElevations,
  bridgePaintColors,
  bridgeRailLines,
  bridgeTexturePlan,
  bridgeTextureSections,
  bridgePartsForView,
  bridgeSurfaceStrip,
  bridgeWidthMetres,
  clusterBridgeDrawables,
  BRIDGE_SHADOW_HOVER_METRES,
  BRIDGE_SHADOW_OPACITY,
  inflatePlanPoints,
  clusterOutline,
  clusterSurfaces,
  deckAreaAllowed,
  densifyLine,
  extendClusterAbutments,
  extendPlanAbutments,
  lineOverhangStubs,
  linePartsFromGeometry,
  linesFormParallelBundle,
  mergeBridgeLines,
  paintBridgeCanvas,
  paintBridgeCluster,
  bridgePierDistances,
  bridgePierLocations,
  bridgeDeckHeightAt,
  bridgeDeckSampler,
  planBounds,
  planOriginFromLngLat,
  planToLngLat,
  pointInFilledPolygon,
  nearestPlanSegment,
  smallestHeadingDelta,
  polygonAreaMetres,
  shouldMeshClusterLines,
  shouldRenderBridgesForView,
  spanAxis,
  surfaceElevation,
  toPlanPoints,
  triangulateDeckSurface,
  type BridgeDrawable,
} from './BridgeModelLayer';
import { setDrapedElevatedBridgeLayersVisible } from './GlobalMapStyle';

describe('shouldRenderBridgesForView', () => {
  const city = { west: 23.75, south: 61.49, east: 23.78, north: 61.51 };

  it('requires terrain and a close zoom, regardless of pitch', () => {
    expect(shouldRenderBridgesForView({
      ...city, zoom: 14.2, pitch: 32, terrainEnabled: true,
    })).toBe(true);
    expect(shouldRenderBridgesForView({
      ...city, zoom: 14.2, pitch: 0, terrainEnabled: true,
    })).toBe(true);
    expect(shouldRenderBridgesForView({
      ...city, zoom: 14.2, pitch: 32, terrainEnabled: false,
    })).toBe(false);
    expect(shouldRenderBridgesForView({
      ...city, zoom: 11.5, pitch: 32, terrainEnabled: true,
    })).toBe(false);
  });

  it('skips wide regional views', () => {
    expect(shouldRenderBridgesForView({
      west: 23.0, south: 61.0, east: 24.5, north: 62.2,
      zoom: 14, pitch: 32, terrainEnabled: true,
    })).toBe(false);
  });
});

describe('bridgePartsForView', () => {
  const origin = planOriginFromLngLat(23.76, 61.5);
  const coordinate = (east: number, north = 0) => planToLngLat({ east, north }, origin);
  const view = {
    west: coordinate(-100)[0], east: coordinate(100)[0],
    south: coordinate(0, -100)[1], north: coordinate(0, 100)[1],
  };
  const part = (start: number, end: number, north = 0) => ({ coordinates: [coordinate(start, north), coordinate(end, north)] });

  it('drops disconnected distant parts but keeps whole crossing and padded parts', () => {
    const crossing = part(-1200, 1200);
    const padded = part(400, 500, 400);
    const far = part(2000, 2100, 2000);
    expect(bridgePartsForView([far, crossing, padded], view)).toEqual([crossing, padded]);
    expect(crossing.coordinates).toEqual([coordinate(-1200), coordinate(1200)]);
  });

  it('retains a chain of tile fragments beyond the margin in source order', () => {
    const visible = part(0, 680);
    const middle = part(700, 1100);
    const end = part(1120, 1800);
    const distant = part(1900, 2100);
    expect(bridgePartsForView([end, distant, middle, visible], view)).toEqual([end, middle, visible]);
  });

  it('retains enclosing polygons and their holes even with all vertices offscreen', () => {
    const polygon = {
      coordinates: [coordinate(-900, -900), coordinate(900, -900), coordinate(900, 900), coordinate(-900, 900)],
      holes: [[coordinate(-20, -20), coordinate(20, -20), coordinate(0, 20)]],
    };
    expect(bridgePartsForView([polygon], view)[0]).toBe(polygon);
  });

  it('handles oversized bounds without allocating an unbounded grid', () => {
    const crossing = part(-1_000_000, 1_000_000);
    const continuation = part(1_000_020, 1_000_100);
    expect(bridgePartsForView([crossing, continuation], view)).toEqual([crossing, continuation]);
  });

  it('does not introduce culling at wrapped-world seams', () => {
    const parts = [part(0, 10)];
    expect(bridgePartsForView(parts, { ...view, west: 179, east: -179 })).toBe(parts);
    expect(bridgePartsForView(parts, { ...view, west: 181, east: 182 })).toBe(parts);
  });
});

describe('bridge terrain clearance', () => {
  it('keeps polygon triangles close to the smooth arch instead of spanning the whole deck', () => {
    const outer = [{ east: 0, north: 0 }, { east: 600, north: 0 },
      { east: 600, north: 12 }, { east: 0, north: 12 }];
    const holes = [[{ east: 240, north: 4 }, { east: 360, north: 4 },
      { east: 360, north: 8 }, { east: 240, north: 8 }]];
    const original = triangulateDeckSurface({ outer, holes }, false)!;
    const mesh = refineBridgeSpan(original.points, original.indices, original.points.map((p) => p.east / 600), 600);
    expect(mesh.indices.length / 3).toBeLessThan(1000);
    let area = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const vertices = mesh.indices.slice(i, i + 3);
      const parameters = vertices.map((index) => mesh.t[index]);
      expect(Math.max(...parameters) - Math.min(...parameters)).toBeLessThanOrEqual(1 / 60 + 1e-9);
      const t = parameters.reduce((sum, value) => sum + value, 0) / 3;
      const actual = parameters.reduce((sum, value) => sum + surfaceElevation(value, 0, 5, 7, 8), 0) / 3;
      expect(Math.abs(actual - surfaceElevation(t, 0, 5, 7, 8))).toBeLessThan(0.02);
      const points = vertices.map((index) => mesh.points[index]);
      area += polygonAreaMetres(points);
      const center = { east: points.reduce((sum, p) => sum + p.east, 0) / 3,
        north: points.reduce((sum, p) => sum + p.north, 0) / 3 };
      expect(pointInFilledPolygon(center, outer, holes)).toBe(true);
    }
    expect(area).toBeCloseTo(600 * 12 - 120 * 4);
    const long = refineBridgeSpan(outer, [0, 1, 2, 0, 2, 3], [0, 1, 1, 0], 10000);
    expect(new Set(long.t.map((value) => value.toFixed(8))).size).toBe(65);
  });

  it('uses physical distance for irregular OSM line vertices', () => {
    const ribbon = lineRibbonMesh([{ east: 0, north: 0 }, { east: 1, north: 0 },
      { east: 100, north: 0 }], 6);
    ribbon.points.forEach((point, index) => expect(ribbon.t[index]).toBeCloseTo(point.east / 100));
    const refined = refineBridgeApproaches(ribbon.points, ribbon.indices, ribbon.t, 100);
    for (const metres of [3, 7.5, 12, 15, 85, 88, 92.5, 97]) {
      expect(refined.points.some((point) => Math.abs(point.east - metres) < 1e-8)).toBe(true);
    }
  });

  it('adds shared approach stations without subdividing the middle of a span', () => {
    const points = [{ east: 0, north: 0 }, { east: 0, north: 6 },
      { east: 100, north: 0 }, { east: 100, north: 6 }];
    const refined = refineBridgeApproaches(points, [0, 1, 2, 1, 3, 2], [0, 0, 1, 1], 100);
    for (const station of [0.03, 0.075, 0.12, 0.15, 0.85, 0.88, 0.925, 0.97]) {
      expect(refined.t.some((value) => Math.abs(value - station) < 1e-9)).toBe(true);
    }
    expect(refined.t.some((value) => value > 0.150001 && value < 0.849999)).toBe(false);
    let area = 0;
    for (let i = 0; i < refined.indices.length; i += 3) {
      area += polygonAreaMetres(refined.indices.slice(i, i + 3).map((index) => refined.points[index]));
    }
    expect(area).toBeCloseTo(600);
    expect(refined.points.slice(0, 4)).toEqual(points);
    expect(refineBridgeApproaches(points, [0, 1, 2, 1, 3, 2], [0, 0, 1, 1], 100)).toEqual(refined);
  });

  it('eases approaches to a small terrain offset while retaining span clearance', () => {
    for (const length of [12, 80, 1000]) {
      expect(bridgeApproachMix(0, length)).toBe(0);
      expect(bridgeApproachMix(1, length)).toBe(0);
      expect(bridgeApproachMix(0.5, length)).toBe(1);
      expect(bridgeSurfaceClearance(0, length)).toBeCloseTo(0.06);
      expect(bridgeSurfaceClearance(1, length)).toBeCloseTo(0.06);
      expect(bridgeSurfaceClearance(0.5, length)).toBeCloseTo(0.7);
      const t = [0, 0.01, 0.025, 0.05, 0.1, 0.5, 0.9, 0.95, 0.975, 0.99, 1];
      const heights = t.map((value) => bridgeSurfaceClearance(value, length));
      expect(terrainClearedDeck(t, heights, t.map(() => 0), length)).toBe(heights);
    }
    expect(bridgeApproachMix(0.075, 100)).toBeCloseTo(0.5);
    expect(bridgeApproachMix(0.15, 100)).toBe(1);
    // The 5m overlap no longer has to absorb the whole vertical transition.
    expect(bridgeApproachMix(0.05, 100)).toBeLessThan(0.3);
    const profile = Array.from({ length: 16 }, (_, metres) => bridgeApproachMix(metres / 100, 100));
    const slopes = profile.slice(1).map((height, index) => height - profile[index]);
    expect(Math.max(...slopes)).toBeLessThan(0.1);
    expect(slopes[0]).toBeLessThan(0.02);
    expect(slopes.at(-1)).toBeLessThan(0.02);
  });

  it('leaves an already clear deck unchanged', () => {
    const deck = [0.7, 2.7, 0.7];
    expect(terrainClearedDeck([0, 0.5, 1], deck, [0, 0, 0], 200)).toBe(deck);
  });

  it('clears intermediate terrain with a gradual lift and level cross-sections', () => {
    const t = Array.from({ length: 21 }, (_, index) => [index / 20, index / 20]).flat();
    const base = t.map(() => 1);
    const ground = t.map((value, index) => value === 0.5 && index % 2 === 0 ? 5 : 0);
    const deck = terrainClearedDeck(t, base, ground, 200);
    expect(deck[20]).toBeCloseTo(5.7);
    expect(deck[21]).toBe(deck[20]);
    expect(deck[18]).toBeGreaterThan(base[18]);
    expect(deck[0]).toBe(base[0]);
    expect(deck[deck.length - 1]).toBe(base[base.length - 1]);
    deck.forEach((height, index) => {
      expect(height).toBeGreaterThanOrEqual(ground[index] + 0.7);
      expect(height).toBeGreaterThanOrEqual(base[index]);
      if (index >= 2) expect(Math.abs(height - deck[index - 2])).toBeLessThanOrEqual(1.200001);
    });
  });

  it('clears sampled triangle interiors even when all original vertices clear terrain', () => {
    const points = [{ east: 20, north: 0 }, { east: 80, north: 0 }, { east: 50, north: 8 }];
    const probes = bridgeClearanceProbes(points, [0, 1, 2], 100).map((probe) => ({ ...probe, ground: 8 }));
    const deck = terrainClearedDeck([0.2, 0.8, 0.5], [1, 1, 1], [0, 0, 0], 100, probes);
    for (const probe of probes) {
      const interpolated = probe.vertices.reduce((sum, vertex, index) => sum + deck[vertex] * probe.weights[index], 0);
      const probeT = probe.vertices.reduce((sum, vertex, index) => sum + [0.2, 0.8, 0.5][vertex] * probe.weights[index], 0);
      expect(interpolated).toBeGreaterThanOrEqual(8 + bridgeSurfaceClearance(probeT, 100) - 1e-9);
    }
  });

  it('keeps ground contacts attached when nearby terrain raises the span', () => {
    const t = [0, 0.02, 0.05, 0.08, 0.1, 0.5, 0.9, 0.92, 0.95, 0.98, 1];
    const ground = t.map((value) => value === 0.1 || value === 0.9 ? 8 : 0);
    const base = t.map((value) => bridgeSurfaceClearance(value, 100));
    const deck = terrainClearedDeck(t, base, ground, 100);
    expect(deck[0]).toBeCloseTo(0.06);
    expect(deck.at(-1)).toBeCloseTo(0.06);
    deck.forEach((height, index) => {
      expect(height).toBeGreaterThanOrEqual(base[index] + ground[index] * bridgeApproachMix(t[index], 100) ** 2 - 1e-9);
    });
    expect(deck[1] - base[1]).toBeLessThan(deck[2] - base[2]);
    expect(deck.at(-2)! - base.at(-2)!).toBeLessThan(deck.at(-3)! - base.at(-3)!);
  });

  it('softens approach probes without amplifying their lift beside a pinned ground contact', () => {
    const t = [0, 0.02, 0.05];
    const base = t.map((value) => bridgeSurfaceClearance(value, 100));
    const probe = { point: { east: 2, north: 0 }, vertices: [0, 1, 2] as [number, number, number],
      weights: [1 / 3, 1 / 3, 1 / 3] as [number, number, number], ground: 2 };
    const deck = terrainClearedDeck(t, base, [0, 0, 0], 100, [probe]);
    expect(deck[0]).toBeCloseTo(0.06);
    expect(deck[2]).toBeGreaterThan(base[2]);
    expect(Math.max(...deck.map((height, index) => height - base[index]))).toBeLessThan(0.2);
  });

  it('spreads a required approach lift into the deck without an immediate dip', () => {
    const t = [0, 0.03, 0.05, 0.075, 0.1, 0.15, 0.5, 0.85, 0.9, 0.925, 0.95, 0.97, 1];
    const base = t.map((value) => bridgeSurfaceClearance(value, 100));
    const ground = t.map((value) => value === 0.05 || value === 0.95 ? 4 : 0);
    const deck = terrainClearedDeck(t, base, ground, 100);
    const lift = deck.map((height, index) => height - base[index]);
    expect(lift[2]).toBeCloseTo(4 * bridgeApproachMix(0.05, 100) ** 2);
    expect(lift[2]).toBeLessThan(0.3);
    expect(lift[2] - lift[3]).toBeLessThanOrEqual(0.300001);
    expect(lift[10] - lift[9]).toBeLessThanOrEqual(0.300001);
    expect(deck[0]).toBeCloseTo(0.06);
    expect(deck.at(-1)).toBeCloseTo(0.06);
    deck.forEach((height, index) => expect(height)
      .toBeGreaterThanOrEqual(base[index] + ground[index] * bridgeApproachMix(t[index], 100) ** 2 - 1e-9));
  });

  it('bounds and deterministically spreads extra samples on very long spans', () => {
    const ribbon = lineRibbonMesh([{ east: 0, north: 0 }, { east: 10_000, north: 0 }], 8);
    const probes = bridgeClearanceProbes(ribbon.points, ribbon.indices, 10_000);
    expect(probes).toHaveLength(128);
    expect(bridgeClearanceProbes(ribbon.points, ribbon.indices, 10_000)).toEqual(probes);
    expect(probes[0].point.east).toBeLessThan(10);
    expect(probes[probes.length - 1].point.east).toBeGreaterThan(9990);
    expect(bridgeClearanceProbes([], [], 0)).toEqual([]);
  });
});

describe('bridgeWidthMetres', () => {
  it('matches the 2D road width estimates', () => {
    expect(bridgeWidthMetres({ className: 'motorway', layer: 0, ramp: false })).toBe(10.5);
    expect(bridgeWidthMetres({ className: 'motorway', layer: 0, ramp: true })).toBe(7.5);
    expect(bridgeWidthMetres({ className: 'service', layer: 0, ramp: false, service: 'driveway' })).toBe(3.2);
    expect(bridgeWidthMetres({ className: 'rail', layer: 1, ramp: false })).toBe(5.5);
  });

  it('uses path and cycleway widths from the 2D style', () => {
    expect(bridgeWidthMetres({ className: 'path', subclass: 'cycleway', layer: 0, ramp: false })).toBe(2.5);
    expect(bridgeWidthMetres({ className: 'path', subclass: 'footway', layer: 0, ramp: false })).toBe(1.8);
    expect(bridgeWidthMetres({ className: 'track', layer: 0, ramp: false })).toBe(3);
  });
});

describe('mergeBridgeLines', () => {
  it('stitches tile-split segments that share an endpoint', () => {
    const merged = mergeBridgeLines([
      {
        coordinates: [[23.7600, 61.4980], [23.7610, 61.4980]],
        properties: { className: 'primary', layer: 0, ramp: false },
      },
      {
        coordinates: [[23.7610, 61.4980], [23.7620, 61.4980]],
        properties: { className: 'primary', layer: 0, ramp: false },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].coordinates).toEqual([
      [23.7600, 61.4980],
      [23.7610, 61.4980],
      [23.7620, 61.4980],
    ]);
  });

  it('does not join stacked bridges on different layers', () => {
    const merged = mergeBridgeLines([
      {
        coordinates: [[23.7600, 61.4980], [23.7610, 61.4980]],
        properties: { className: 'primary', layer: 0, ramp: false },
      },
      {
        coordinates: [[23.7610, 61.4980], [23.7620, 61.4980]],
        properties: { className: 'primary', layer: 1, ramp: false },
      },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('stitches a short tile gap when the headings continue', () => {
    const merged = mergeBridgeLines([
      {
        coordinates: [[23.7600, 61.4980], [23.7610, 61.4980]],
        properties: { className: 'primary', layer: 0, ramp: false },
      },
      {
        coordinates: [[23.76105, 61.4980], [23.7621, 61.4980]],
        properties: { className: 'primary', layer: 0, ramp: false },
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].coordinates[0]).toEqual([23.7600, 61.4980]);
    expect(merged[0].coordinates[merged[0].coordinates.length - 1]).toEqual([23.7621, 61.4980]);
  });

  it('stitches collinear overpass pieces across a longer gap', () => {
    const merged = mergeBridgeLines([
      {
        coordinates: [[23.7600, 61.4980], [23.7610, 61.4980]],
        properties: { className: 'trunk', layer: 1, ramp: false },
      },
      {
        coordinates: [[23.76128, 61.4980], [23.7624, 61.4980]],
        properties: { className: 'trunk', layer: 1, ramp: false },
      },
    ]);
    expect(merged).toHaveLength(1);
  });

  it('does not stitch parallel carriageways that only sit beside each other', () => {
    const merged = mergeBridgeLines([
      {
        coordinates: [[23.7600, 61.49800], [23.7616, 61.49800]],
        properties: { className: 'motorway', layer: 1, ramp: false },
      },
      {
        coordinates: [[23.7600, 61.49810], [23.7616, 61.49810]],
        properties: { className: 'motorway', layer: 1, ramp: false },
      },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('does not chain a branching Y into one span', () => {
    const merged = mergeBridgeLines([
      {
        coordinates: [[23.7600, 61.4980], [23.7610, 61.4980]],
        properties: { className: 'path', subclass: 'footway', layer: 0, ramp: false },
      },
      {
        coordinates: [[23.7610, 61.4980], [23.7616, 61.49845]],
        properties: { className: 'path', subclass: 'footway', layer: 0, ramp: false },
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('linePartsFromGeometry', () => {
  it('keeps MultiLineString tile clips as separate pieces', () => {
    expect(linePartsFromGeometry({
      type: 'MultiLineString',
      coordinates: [
        [[23.7600, 61.4980], [23.7610, 61.4980]],
        [[23.7620, 61.4980], [23.7630, 61.4980]],
      ],
    })).toHaveLength(2);
  });
});

describe('bridge fascia and abutments', () => {
  const ribbon = lineRibbonMesh([{ east: 0, north: 0 }, { east: 80, north: 0 }], 8);

  it('keeps only exterior edges of a ribbon', () => {
    const edges = bridgeBoundaryEdges(ribbon.indices);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every(([a, b]) => a !== b)).toBe(true);
    expect(bridgeFasciaEdges(ribbon.points, ribbon.indices).length).toBe(edges.length);
  });

  it('uses a short fascia at mid-span and buries the walls into terrain at the abutments', () => {
    expect(bridgeWallBottom(10, 0, 0.5, 80)).toBeCloseTo(9.4);
    expect(bridgeWallBottom(0.06, 0, 0, 80)).toBeCloseTo(-0.85);
    expect(bridgeWallBottom(0.06, 0, 1, 80)).toBeCloseTo(-0.85);
    expect(bridgeWallBottom(8, 0, undefined, 80)).toBeCloseTo(7.4);
    expect(bridgeWallBottom(0.05, 0, 0.5, 80)).toBeCloseTo(-0.55);
  });

  it('extrudes each boundary edge as an outward wall', () => {
    const points = ribbon.points.map((point, index) => ({
      east: point.east, north: point.north, up: ribbon.t[index] === 0 || ribbon.t[index] === 1 ? 0.06 : 10,
    }));
    const t = ribbon.t;
    const bottoms = points.map((point, index) => bridgeWallBottom(point.up, 0, t[index], 80));
    const edges = bridgeFasciaEdges(ribbon.points, ribbon.indices);
    const positions = bridgeFasciaPositions(points, bottoms, edges);
    expect(positions.length).toBe(edges.length * 12);
    const end = edges.findIndex(([a, b]) => t[a] === 0 && t[b] === 0);
    expect(end).toBeGreaterThanOrEqual(0);
    expect(positions[end * 12 + 7]).toBeCloseTo(-0.85);
    const mid = edges.findIndex(([a, b]) => Math.min(t[a], t[b]) <= 0.5 && Math.max(t[a], t[b]) >= 0.5);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(positions[mid * 12 + 1]).toBeGreaterThan(9);
    expect(Math.min(positions[mid * 12 + 7], positions[mid * 12 + 10])).toBeGreaterThan(8.5);
  });
});

describe('bridge entrance feathering', () => {
  it('softens both terrain-contact ends while keeping a covered deck and hiding the end fascia', () => {
    for (const t of [0, 1]) {
      expect(bridgeEntranceOpacity(t, 100, 0.06)).toBeCloseTo(0.4);
      expect(bridgeEntranceOpacity(t, 100, 0.06, true)).toBe(0);
    }
    expect(bridgeEntranceOpacity(0.025, 100, 0.06)).toBeGreaterThan(0.4);
    expect(bridgeEntranceOpacity(0.025, 100, 0.06)).toBeLessThan(1);
    expect(bridgeEntranceOpacity(0.05, 100, 0.06)).toBe(1);
  });

  it('keeps elevated ends, interior terrain contacts and unknown approaches solid', () => {
    for (const fascia of [false, true]) {
      expect(bridgeEntranceOpacity(0, 100, 2, fascia)).toBe(1);
      expect(bridgeEntranceOpacity(0.5, 100, 0.06, fascia)).toBe(1);
      expect(bridgeEntranceOpacity(undefined, 100, 0.06, fascia)).toBe(1);
      expect(bridgeEntranceOpacity(0.25, 8, 0.06, fascia)).toBe(1);
    }
  });

  it('assigns fascia opacity to matching top and bottom edge vertices', () => {
    const layer = new BridgeModelLayer() as any;
    const bridge = { spanLength: 100, surface: [
      { t: 0, ground: 0, deck: 0.06 }, { t: 0.1, ground: 0, deck: 2 },
    ] };
    const geometry = layer.fasciaGeometry(bridge,
      [{ east: 0, north: 0, up: 0.06 }, { east: 10, north: 0, up: 2 }], [[0, 1]], 0);
    const colors = geometry.getAttribute('color');
    expect([0, 1, 2, 3].map((index) => colors.getW(index))).toEqual([0, 1, 1, 0]);
    geometry.dispose();
  });
});

describe('bridge shadows', () => {
  it('clears terrain rises inside shadow triangles without lowering neighbouring vertices', () => {
    const ground = [0, 2, 1, 8];
    const probes = [
      { vertices: [0, 1, 2], weights: [0.25, 0.25, 0.5], ground: 4 },
      { vertices: [1, 2, 3], weights: [0.25, 0.5, 0.25], ground: 6 },
    ];
    const heights = shadowTerrainHeights(ground, probes);
    for (const probe of probes) {
      expect(probe.vertices.reduce((sum, vertex, i) => sum + heights[vertex] * probe.weights[i], 0))
        .toBeGreaterThanOrEqual(probe.ground);
    }
    heights.forEach((height, i) => expect(height).toBeGreaterThanOrEqual(ground[i]));
    expect(shadowTerrainHeights(ground, [])).toEqual(ground);
  });

  it('grows the ground footprint so a blurred silhouette can fade out', () => {
    const inflated = inflatePlanPoints([
      { east: -10, north: -2 }, { east: 10, north: -2 },
      { east: 10, north: 2 }, { east: -10, north: 2 },
    ], 2);
    expect(Math.hypot(inflated[1].east, inflated[1].north))
      .toBeGreaterThan(Math.hypot(10, 2));
    expect(inflatePlanPoints([{ east: 0, north: 0 }], 2)).toEqual([{ east: 0, north: 0 }]);
  });

  it('weakens the ground shadow toward the abutments', () => {
    expect(bridgeShadowEndFade(0)).toBe(0);
    expect(bridgeShadowEndFade(0.05)).toBe(0);
    expect(bridgeShadowEndFade(2.5)).toBe(1);
    expect(bridgeShadowEndFade(0.6)).toBeGreaterThan(0);
    expect(bridgeShadowEndFade(0.6)).toBeLessThan(bridgeShadowEndFade(1.8));
  });
});

describe('extendPlanAbutments', () => {
  it('extends the span ends so the deck can meet the connecting road', () => {
    const extended = extendPlanAbutments([{ east: 0, north: 0 }, { east: 40, north: 0 }], 10);
    expect(extended[0].east).toBeCloseTo(-10);
    expect(extended[extended.length - 1].east).toBeCloseTo(50);
  });
});

describe('densifyLine', () => {
  it('inserts points along long segments', () => {
    const points = densifyLine([[23.76, 61.498], [23.78, 61.498]], 50);
    expect(points.length).toBeGreaterThan(10);
    expect(points[0]).toEqual([23.76, 61.498]);
    expect(points[points.length - 1]).toEqual([23.78, 61.498]);
  });
});

describe('plan bounds', () => {
  it('pads the 2D drawing box around the centerline', () => {
    const points = toPlanPoints([[23.76, 61.498], [23.761, 61.498]]);
    expect(points[0]).toEqual({ east: 0, north: 0 });
    expect(points[1].east).toBeGreaterThan(40);
    expect(Math.abs(points[1].north)).toBeLessThan(1);
    const bounds = planBounds(points, 5);
    expect(bounds.minEast).toBeLessThan(0);
    expect(bounds.maxEast).toBeGreaterThan(points[1].east);
  });
});

describe('smallestHeadingDelta', () => {
  it('treats opposite headings as aligned', () => {
    expect(smallestHeadingDelta(0, Math.PI)).toBeCloseTo(0);
    expect(smallestHeadingDelta(-Math.PI / 2, Math.PI / 2)).toBeCloseTo(0);
  });

  it('reports a right angle as π/2', () => {
    expect(smallestHeadingDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
});

describe('nearestPlanSegment', () => {
  it('returns distance and tangent heading of the closest segment', () => {
    const hit = nearestPlanSegment({ east: 2, north: 10 }, [
      { east: 0, north: 0 },
      { east: 0, north: 20 },
    ]);
    expect(hit?.distance).toBeCloseTo(2);
    expect(hit?.heading).toBeCloseTo(0);
  });

  it('follows a bent centerline instead of the overall chord', () => {
    const hit = nearestPlanSegment({ east: 12, north: 21 }, [
      { east: 0, north: 0 },
      { east: 0, north: 20 },
      { east: 20, north: 20 },
    ]);
    expect(hit?.distance).toBeCloseTo(1);
    expect(hit?.heading).toBeCloseTo(Math.PI / 2);
  });
});

describe('paintBridgeCanvas', () => {
  it('paints a 2D stroke that can be used as a deck texture', () => {
    if (typeof document === 'undefined') return;
    const points = [{ east: 0, north: 0 }, { east: 40, north: 0 }];
    const canvas = paintBridgeCanvas(points, planBounds(points, 6), 8, '#f1efe7', '#87918d');
    expect(canvas.width).toBeGreaterThan(8);
    expect(canvas.height).toBeGreaterThan(2);
  });
});

describe('bridgeDeckElevations', () => {
  it('adds a bounded length-based rise while preserving approach heights', () => {
    for (const [length, rise] of [[80, 1.28], [150, 2.2], [300, 4], [450, 6], [600, 8], [1000, 12], [5000, 12]]) {
      expect(bridgeArchMetres(length)).toBeCloseTo(rise);
      const { deck } = bridgeDeckElevations([10, 0, 20], 0, length);
      expect(deck[0]).toBe(10);
      expect(deck[2]).toBe(20);
      expect(deck[1]).toBeCloseTo(15 + rise);
    }
    for (const stop of [150, 300, 600, 1000]) {
      expect(bridgeArchMetres(stop + 0.001) - bridgeArchMetres(stop - 0.001)).toBeLessThan(0.001);
    }
  });
  it('keeps ends on the ground and only slightly arches the middle', () => {
    const ground = [20, 20, 20, 20, 20];
    const { deck, maxClearance } = bridgeDeckElevations(ground, 0, 80);
    expect(deck[0]).toBe(20);
    expect(deck[4]).toBe(20);
    expect(deck[2]).toBeGreaterThan(20.5);
    expect(deck[2]).toBeLessThan(23);
    expect(maxClearance).toBeLessThan(3);
  });

  it('holds a chord above a valley while staying near abutments', () => {
    const ground = [20, 18, 8, 4, 9, 17, 20];
    const { deck, maxClearance } = bridgeDeckElevations(ground, 0, 80);
    expect(deck[0]).toBe(ground[0]);
    expect(deck[deck.length - 1]).toBe(ground[ground.length - 1]);
    expect(deck[3]).toBeGreaterThan(ground[3] + 8);
    expect(maxClearance).toBeGreaterThan(10);
  });

  it('raises stacked decks by layer', () => {
    const ground = [10, 4, 10];
    const lower = bridgeDeckElevations(ground, 0);
    const upper = bridgeDeckElevations(ground, 1);
    expect(upper.deck[1]).toBeGreaterThan(lower.deck[1] + 3);
  });

  it('keeps OSM layer lift off the abutments', () => {
    const ground = [12, 12, 12, 12, 12];
    const { deck } = bridgeDeckElevations(ground, 1, 80);
    expect(deck[0]).toBe(12);
    expect(deck[4]).toBe(12);
    expect(deck[2]).toBeGreaterThan(15);
  });
});

describe('surfaceElevation', () => {
  it('pins the span ends to the abutment chord and only lifts the middle', () => {
    expect(surfaceElevation(0, 8, 20, 20, 2)).toBe(20);
    expect(surfaceElevation(1, 8, 20, 20, 2)).toBe(20);
    expect(surfaceElevation(0.5, 8, 20, 20, 2)).toBeCloseTo(22);
  });
});

describe('clustered bridge decks', () => {
  const road: BridgeDrawable = {
    kind: 'line',
    coordinates: [[23.76, 61.498], [23.7615, 61.498]],
    plan: [{ east: 0, north: 0 }, { east: 80, north: 0 }],
    properties: { className: 'primary', layer: 1, ramp: false },
    width: 9,
  };
  const path: BridgeDrawable = {
    kind: 'line',
    coordinates: [[23.76, 61.49805], [23.7615, 61.49805]],
    plan: [{ east: 0, north: 6 }, { east: 80, north: 6 }],
    properties: { className: 'path', subclass: 'footway', layer: 1, ramp: false },
    width: 1.8,
  };
  const deck: BridgeDrawable = {
    kind: 'polygon',
    coordinates: [[23.76, 61.4979], [23.7615, 61.4979], [23.7615, 61.4981], [23.76, 61.4981]],
    plan: [
      { east: 0, north: -8 },
      { east: 80, north: -8 },
      { east: 80, north: 10 },
      { east: 0, north: 10 },
    ],
    properties: { className: 'primary', layer: 1, ramp: false },
    width: 0,
  };

  it('groups a deck with its roads and paths', () => {
    const isolated: BridgeDrawable = {
      ...road,
      plan: [{ east: 400, north: 0 }, { east: 480, north: 0 }],
      coordinates: [[23.77, 61.498], [23.7715, 61.498]],
    };
    const groups = clusterBridgeDrawables([road, path, deck, isolated]);
    expect(groups).toHaveLength(2);
    const clustered = groups.find((group) => group.length === 3);
    expect(clustered).toBeDefined();
  });

  it('keeps clearly separated decks as separate bridges', () => {
    const neighbour: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 0, north: 40 },
        { east: 80, north: 40 },
        { east: 80, north: 58 },
        { east: 0, north: 58 },
      ],
    };
    const groups = clusterBridgeDrawables([deck, neighbour]);
    expect(groups).toHaveLength(2);
  });

  it('does not join a span that sits inside a deck hole', () => {
    const holed: BridgeDrawable = {
      ...deck,
      holes: [[
        { east: 20, north: -6 },
        { east: 60, north: -6 },
        { east: 60, north: 8 },
        { east: 20, north: 8 },
      ]],
    };
    const inner: BridgeDrawable = {
      kind: 'polygon',
      coordinates: [[23.7606, 61.498], [23.7608, 61.498], [23.7608, 61.49802], [23.7606, 61.49802]],
      plan: [
        { east: 38, north: 0 },
        { east: 42, north: 0 },
        { east: 42, north: 2 },
        { east: 38, north: 2 },
      ],
      properties: { className: 'path', layer: 1, ramp: false },
      width: 0,
    };
    expect(clusterBridgeDrawables([holed, inner])).toHaveLength(2);
  });

  it('keeps a compact Y deck as one polygon instead of thin path ribbons', () => {
    const yDeck: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 0, north: -8 },
        { east: 40, north: -8 },
        { east: 55, north: 22 },
        { east: 46, north: 26 },
        { east: 32, north: 4 },
        { east: 0, north: 4 },
      ],
    };
    const arm: BridgeDrawable = {
      ...path,
      plan: [{ east: 0, north: 0 }, { east: 40, north: 0 }],
    };
    const branch: BridgeDrawable = {
      ...path,
      plan: [{ east: 38, north: 0 }, { east: 52, north: 22 }],
    };
    const groups = clusterBridgeDrawables([yDeck, arm, branch]);
    expect(groups).toHaveLength(1);
    expect(groups[0].some((drawable) => drawable.kind === 'polygon')).toBe(true);
    expect(shouldMeshClusterLines(
      [arm, branch],
      [yDeck],
      clusterSurfaces([yDeck, arm, branch]),
    )).toBe(false);
  });

  it('uses the 2D deck polygon for a path Y instead of the footway ribbons', () => {
    const yDeck: BridgeDrawable = {
      ...deck,
      properties: { className: 'path', subclass: 'footway', layer: 1, ramp: false },
      plan: [
        { east: 0, north: -8 },
        { east: 40, north: -8 },
        { east: 55, north: 22 },
        { east: 46, north: 26 },
        { east: 32, north: 4 },
        { east: 0, north: 4 },
      ],
    };
    const arm: BridgeDrawable = {
      ...path,
      plan: [{ east: 0, north: 0 }, { east: 40, north: 0 }],
    };
    const branch: BridgeDrawable = {
      ...path,
      plan: [{ east: 38, north: 0 }, { east: 52, north: 22 }],
    };
    const groups = clusterBridgeDrawables([yDeck, arm, branch]);
    expect(groups).toHaveLength(1);
    expect(groups[0].some((drawable) => drawable.kind === 'polygon')).toBe(true);
    const surfaces = clusterSurfaces(groups[0]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].outer).toEqual(yDeck.plan);
    expect(shouldMeshClusterLines([arm, branch], [yDeck], surfaces)).toBe(false);
  });

  it('uses a mapped Y-shaped deck when its bent paths outlength its straight span', () => {
    const sarkanDeck: BridgeDrawable = {
      ...deck,
      properties: { className: 'bridge', layer: 1, ramp: false },
      plan: [
        { east: -55, north: 62 }, { east: -49, north: 67 }, { east: 0, north: 7 },
        { east: 3, north: 8 }, { east: 8, north: 23 }, { east: 5, north: 44 },
        { east: -1, north: 48 }, { east: 13, north: 60 }, { east: 14, north: 59 },
        { east: 12, north: 51 }, { east: 21, north: -7 }, { east: 24, north: -11 },
        { east: 7, north: -23 }, { east: 8, north: -18 }, { east: 7, north: -15 },
      ],
    };
    const longArm: BridgeDrawable = {
      ...path,
      coordinates: [
        [23.74574, 61.50443], [23.74588, 61.50405], [23.74593, 61.50380],
        [23.74563, 61.50394], [23.74464, 61.50452],
      ],
      plan: [
        { east: 6, north: 54 }, { east: 13, north: 12 }, { east: 16, north: -16 },
        { east: 0, north: 0 }, { east: -52, north: 64 },
      ],
    };
    const shortArm: BridgeDrawable = {
      ...path,
      coordinates: [[23.74563, 61.50394], [23.74586, 61.50409]],
      plan: [{ east: 0, north: 0 }, { east: 13, north: 17 }],
    };
    const surfaces = clusterSurfaces([sarkanDeck, longArm, shortArm]);
    expect(surfaces[0].outer).toEqual(sarkanDeck.plan);
    expect(shouldMeshClusterLines([longArm, shortArm], [sarkanDeck], surfaces)).toBe(false);
  });

  it('fills a compact path Y even when the deck polygon is missing', () => {
    const arm: BridgeDrawable = {
      ...path,
      plan: [{ east: 0, north: 0 }, { east: 48, north: 0 }],
    };
    const branch: BridgeDrawable = {
      ...path,
      plan: [{ east: 46, north: 0 }, { east: 62, north: 24 }],
    };
    const spur: BridgeDrawable = {
      ...path,
      plan: [{ east: 0, north: 4 }, { east: 46, north: 4 }],
    };
    const groups = clusterBridgeDrawables([arm, branch, spur]);
    expect(groups).toHaveLength(1);
    const surfaces = clusterSurfaces(groups[0]);
    expect(surfaces).toHaveLength(1);
    expect(polygonAreaMetres(surfaces[0].outer)).toBeGreaterThan(80);
    expect(shouldMeshClusterLines([arm, branch, spur], [], surfaces)).toBe(false);
  });

  it('does not inflate radial footbridges into one triangular deck', () => {
    const arms: BridgeDrawable[] = [
      [{ east: 0, north: 0 }, { east: 35, north: 0 }],
      [{ east: 0, north: 0 }, { east: -17.5, north: 30.3 }],
      [{ east: 0, north: 0 }, { east: -17.5, north: -30.3 }],
    ].map((plan) => ({ ...path, plan }));
    expect(clusterBridgeDrawables(arms)).toHaveLength(3);
  });

  it('extends overhanging lines as stubs instead of replacing the deck', () => {
    const stubs = lineOverhangStubs({
      ...path,
      plan: [{ east: -12, north: 0 }, { east: 0, north: 0 }, { east: 80, north: 0 }, { east: 96, north: 0 }],
    }, [deck]);
    expect(stubs).toHaveLength(2);
    expect(stubs[0][0].east).toBeLessThan(0);
    expect(stubs[1][stubs[1].length - 1].east).toBeGreaterThan(80);
  });

  it('does not grow a path that leaves the side of the deck', () => {
    expect(lineOverhangStubs({
      ...path,
      plan: [{ east: 40, north: 0 }, { east: 40, north: 22 }],
    }, [deck])).toEqual([]);
  });

  it('keeps a long thin deck instead of dropping it as too large', () => {
    const outer = [
      { east: 0, north: -10 },
      { east: 1200, north: -10 },
      { east: 1200, north: 10 },
      { east: 0, north: 10 },
    ];
    expect(polygonAreaMetres(outer)).toBeGreaterThan(8000);
    expect(deckAreaAllowed(outer)).toBe(true);
  });

  it('does not extend footways that sit on a deck', () => {
    const origin = planOriginFromLngLat(23.76, 61.498);
    const sidePath: BridgeDrawable = {
      ...path,
      plan: [{ east: 40, north: 0 }, { east: 40, north: 18 }],
    };
    const extended = extendClusterAbutments([deck, sidePath], origin);
    const next = extended.find((drawable) => drawable.kind === 'line');
    expect(next?.plan).toEqual(sidePath.plan);
  });

  it('overlaps cycleways and roads onto the connecting ground at the abutments', () => {
    const origin = planOriginFromLngLat(23.76, 61.498);
    const extended = extendClusterAbutments([deck, road, path], origin);
    const nextRoad = extended.find((drawable) => drawable.kind === 'line' && drawable.properties.className === 'primary');
    const nextPath = extended.find((drawable) => drawable.kind === 'line' && drawable.properties.className === 'path');
    expect(nextRoad?.plan[0].east).toBeCloseTo(-5);
    expect(nextRoad?.plan[nextRoad.plan.length - 1].east).toBeCloseTo(85);
    expect(nextPath?.plan[0].east).toBeCloseTo(-5);
    expect(nextPath?.plan[nextPath.plan.length - 1].east).toBeCloseTo(85);
    const surfaces = clusterSurfaces(extended);
    expect(planBounds(surfaces[0].outer, 0)).toEqual({ minEast: -5, maxEast: 85, minNorth: -8, maxNorth: 10 });
    expect(polygonAreaMetres(surfaces[0].outer)).toBeCloseTo(90 * 18);
    for (const line of [nextRoad!, nextPath!]) {
      expect(lineOverhangStubs(line, extended.filter((part) => part.kind === 'polygon'))).toEqual([]);
      expect(line.plan.every((point) => pointInFilledPolygon(
        { ...point, east: Math.max(-4.999, Math.min(84.999, point.east)) }, surfaces[0].outer,
      ))).toBe(true);
    }
    expect(shouldMeshClusterLines(
      extended.filter((drawable) => drawable.kind === 'line'),
      extended.filter((drawable) => drawable.kind === 'polygon'),
      surfaces,
    )).toBe(false);
  });

  it('extends polygon-only decks while preserving openings and a valid triangulated surface', () => {
    const origin = planOriginFromLngLat(23.76, 61.498);
    const holed = { ...deck, holes: [[
      { east: 1, north: -2 }, { east: 7, north: -2 },
      { east: 7, north: 2 }, { east: 1, north: 2 },
    ]] };
    const original = structuredClone(holed);
    const [extended] = extendClusterAbutments([holed], origin);
    expect(holed).toEqual(original);
    expect(planBounds(extended.plan, 0)).toEqual({ minEast: -5, maxEast: 85, minNorth: -8, maxNorth: 10 });
    const surface = { outer: extended.plan, holes: extended.holes! };
    expect(pointInFilledPolygon({ east: 2, north: 0 }, surface.outer, surface.holes)).toBe(false);
    const mesh = triangulateDeckSurface(surface, false)!;
    let area = 0;
    for (let index = 0; index < mesh.indices.length; index += 3) {
      area += polygonAreaMetres(mesh.indices.slice(index, index + 3).map((vertex) => mesh.points[vertex]));
    }
    expect(area).toBeCloseTo(polygonAreaMetres(surface.outer) - polygonAreaMetres(surface.holes[0]));
  });

  it('keeps interchange ramps as separate spans', () => {
    const trunk: BridgeDrawable = {
      ...road,
      plan: [{ east: 0, north: 0 }, { east: 80, north: 0 }],
    };
    const ramp: BridgeDrawable = {
      ...road,
      properties: { className: 'motorway', layer: 1, ramp: true },
      width: 6,
      plan: [{ east: 40, north: 0 }, { east: 70, north: 35 }],
    };
    expect(clusterBridgeDrawables([trunk, ramp])).toHaveLength(2);
  });

  it('splits a diverging interchange deck into the road ribbons', () => {
    const slab: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 0, north: -20 },
        { east: 80, north: -20 },
        { east: 80, north: 40 },
        { east: 0, north: 40 },
      ],
    };
    const trunk: BridgeDrawable = {
      ...road,
      plan: [{ east: 0, north: 0 }, { east: 80, north: 0 }],
    };
    const ramp: BridgeDrawable = {
      ...road,
      properties: { className: 'motorway', layer: 1, ramp: true },
      width: 6,
      plan: [{ east: 40, north: 0 }, { east: 70, north: 35 }],
    };
    const groups = clusterBridgeDrawables([slab, trunk, ramp]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.every((drawable) => drawable.kind === 'line'))).toBe(true);
  });

  it('drops a tile-chip deck that already sits on a longer line', () => {
    const chip: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 40, north: -4 },
        { east: 55, north: -4 },
        { east: 55, north: 4 },
        { east: 40, north: 4 },
      ],
    };
    const span: BridgeDrawable = {
      ...road,
      plan: [{ east: 0, north: 0 }, { east: 120, north: 0 }],
      coordinates: [[23.76, 61.498], [23.7622, 61.498]],
    };
    const groups = clusterBridgeDrawables([chip, span]);
    expect(groups.some((group) => group.includes(span))).toBe(true);
    expect(groups.some((group) => group.includes(chip) && group.every((drawable) => drawable.kind === 'polygon'))).toBe(false);
  });

  it('stitches abutting tile fragments of one deck', () => {
    const left: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 0, north: -4 },
        { east: 50, north: -4 },
        { east: 50, north: 4 },
        { east: 0, north: 4 },
      ],
    };
    const right: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 50, north: -4 },
        { east: 100, north: -4 },
        { east: 100, north: 4 },
        { east: 50, north: 4 },
      ],
    };
    const surfaces = clusterSurfaces([left, right]);
    expect(surfaces).toHaveLength(1);
    expect(polygonAreaMetres(surfaces[0].outer)).toBeCloseTo(800, 0);
  });

  it('does not hull an L-shaped pair of decks into one slab', () => {
    const across: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 0, north: 0 },
        { east: 80, north: 0 },
        { east: 80, north: 8 },
        { east: 0, north: 8 },
      ],
    };
    const up: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 72, north: 0 },
        { east: 80, north: 0 },
        { east: 80, north: 80 },
        { east: 72, north: 80 },
      ],
    };
    expect(clusterSurfaces([across, up])).toHaveLength(2);
  });

  it('combines parallel roads and paths into one deck', () => {
    expect(linesFormParallelBundle(road, path)).toBe(true);
    expect(clusterBridgeDrawables([road, path])).toHaveLength(1);
    expect(clusterSurfaces([road, path])).toHaveLength(1);
  });

  it('follows the longer road when a tile polygon stops short', () => {
    const stubDeck: BridgeDrawable = {
      ...deck,
      plan: [
        { east: 0, north: -8 },
        { east: 40, north: -8 },
        { east: 40, north: 8 },
        { east: 0, north: 8 },
      ],
    };
    const span: BridgeDrawable = {
      ...road,
      plan: [{ east: 0, north: 0 }, { east: 140, north: 0 }],
      coordinates: [[23.76, 61.498], [23.7626, 61.498]],
    };
    expect(shouldMeshClusterLines(
      [span],
      [stubDeck],
      clusterSurfaces([span, stubDeck]),
    )).toBe(true);
  });

  it('does not combine a diverging ramp into the main span', () => {
    const ramp: BridgeDrawable = {
      ...road,
      properties: { className: 'motorway', layer: 1, ramp: true },
      width: 6,
      plan: [{ east: 40, north: 0 }, { east: 70, north: 35 }],
    };
    expect(linesFormParallelBundle(road, ramp)).toBe(false);
    expect(clusterBridgeDrawables([road, ramp])).toHaveLength(2);
  });

  it('uses each deck polygon instead of one hull over the cluster', () => {
    const surfaces = clusterSurfaces([road, path, deck]);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].outer).toEqual(deck.plan);
    expect(polygonAreaMetres(clusterOutline([road, path, deck]))).toBe(polygonAreaMetres(deck.plan));
  });

  it('preserves holes in a deck surface', () => {
    const holed: BridgeDrawable = {
      ...deck,
      holes: [[
        { east: 30, north: -2 },
        { east: 50, north: -2 },
        { east: 50, north: 4 },
        { east: 30, north: 4 },
      ]],
    };
    const surfaces = clusterSurfaces([holed]);
    expect(surfaces[0].holes).toHaveLength(1);
    const mesh = triangulateDeckSurface(surfaces[0]);
    expect(mesh).not.toBeNull();
    const hole = surfaces[0].holes[0];
    const centroid = (a: { east: number; north: number }, b: typeof a, c: typeof a) => ({
      east: (a.east + b.east + c.east) / 3,
      north: (a.north + b.north + c.north) / 3,
    });
    for (let index = 0; index < mesh!.indices.length; index += 3) {
      const center = centroid(
        mesh!.points[mesh!.indices[index]],
        mesh!.points[mesh!.indices[index + 1]],
        mesh!.points[mesh!.indices[index + 2]],
      );
      expect(pointInFilledPolygon(center, surfaces[0].outer, surfaces[0].holes)).toBe(true);
      expect(pointInFilledPolygon(center, hole, [])).toBe(false);
    }
  });

  it('raises only the mid-span of the combined polygon', () => {
    const outline = clusterOutline([road, path, deck]);
    const strip = bridgeSurfaceStrip(outline, spanAxis(outline, { east: 1, north: 0 }), 8);
    expect(strip.t[0]).toBe(0);
    expect(strip.t[strip.t.length - 1]).toBe(1);
    const mid = strip.t.findIndex((value) => Math.abs(value - 0.5) < 0.08);
    expect(mid).toBeGreaterThan(-1);
    const ground = strip.t.map((t) => (t > 0.2 && t < 0.8 ? 8 : 20));
    const deckHeights = ground.map((value, index) => surfaceElevation(strip.t[index], value, 20, 20, 1.5));
    expect(deckHeights[mid]).toBeGreaterThan(20.5);
  });

  it('paints the clustered features onto one canvas', () => {
    if (typeof document === 'undefined') return;
    const surfaces = clusterSurfaces([road, path, deck]);
    const canvas = paintBridgeCluster(surfaces, [
      { kind: 'polygon', plan: deck.plan, width: 0, fill: '#f1efe7', edge: '#87918d' },
      { kind: 'line', plan: road.plan, width: 9, fill: '#f1efe7', edge: '#87918d' },
      { kind: 'line', plan: path.plan, width: 1.8, fill: '#ded9cd', edge: '#d8d4ca' },
    ], planBounds(deck.plan, 2));
    expect(canvas.width).toBeGreaterThan(16);
    expect(canvas.height).toBeGreaterThan(8);
  });

  it('keeps path paint on the deck and on abutment overlaps', () => {
    if (typeof document === 'undefined') return;
    const pathPlan = [{ east: -20, north: 6 }, { east: 100, north: 6 }];
    const bounds = planBounds([...deck.plan, ...pathPlan], 2);
    const canvas = paintBridgeCluster(
      [{ outer: deck.plan, holes: [] }],
      [
        { kind: 'polygon', plan: deck.plan, width: 0, fill: '#f1efe7', edge: '#87918d' },
        { kind: 'line', plan: pathPlan, width: 2.5, fill: '#e8ddd6', edge: '#b99a91' },
      ],
      bounds,
    );
    const context = canvas.getContext('2d');
    if (!context) return;
    const spanEast = Math.max(1, bounds.maxEast - bounds.minEast);
    const spanNorth = Math.max(1, bounds.maxNorth - bounds.minNorth);
    const sample = (east: number, north: number) => {
      const x = Math.floor((east - bounds.minEast) / spanEast * canvas.width);
      const y = Math.floor((bounds.maxNorth - north) / spanNorth * canvas.height);
      return context.getImageData(x, y, 1, 1).data;
    };
    const onDeck = sample(40, 6);
    const overlap = sample(-12, 6);
    expect(onDeck[3]).toBeGreaterThan(80);
    expect(onDeck[0]).toBeLessThan(235);
    expect(overlap[3]).toBeGreaterThan(80);
    expect(overlap[0]).toBeLessThan(235);
  });
});

describe('bridge support placement', () => {
  it('spaces supports along the span with approach margins and a fixed budget', () => {
    const stations = bridgePierDistances(120);
    expect(stations.length).toBe(2);
    expect(stations[0]).toBeGreaterThan(10);
    expect(stations.at(-1)).toBeLessThan(110);
    stations.slice(1).forEach((value, index) => expect(value - stations[index]).toBeCloseTo(81.6));
    expect(bridgePierDistances(18)).toEqual([]);
    expect(bridgePierDistances(5000)).toHaveLength(16);
    expect(bridgePierDistances(5000, 0)).toEqual([]);
    expect(bridgePierDistances(5000, 1)).toEqual([2500]);
  });

  it('follows a bent line by distance and avoids duplicate supports on coincident lines', () => {
    const line = [{ east: 0, north: 0 }, { east: 5, north: 0 },
      { east: 60, north: 0 }, { east: 60, north: 60 }];
    const mesh = lineRibbonMesh(line, 8);
    const locations = bridgePierLocations([line], [], mesh.points, mesh.indices, mesh.points.map(() => 12));
    expect(locations).toHaveLength(2);
    expect(locations[0].north).toBeCloseTo(0);
    expect(locations.at(-1)!.east).toBeCloseTo(60);
    expect(locations.at(-1)!.north).toBeGreaterThan(30);
    expect(bridgePierLocations([line, line], [], mesh.points, mesh.indices, mesh.points.map(() => 12))).toEqual(locations);
  });

  it('keeps polygon supports on solid deck and uses triangle heights independent of vertex order', () => {
    const outer = [{ east: 0, north: 0 }, { east: 120, north: 0 },
      { east: 120, north: 24 }, { east: 0, north: 24 }];
    const holes = [[{ east: 30, north: 8 }, { east: 90, north: 8 },
      { east: 90, north: 16 }, { east: 30, north: 16 }]];
    const mesh = triangulateDeckSurface({ outer, holes }, false)!;
    const heights = mesh.points.map((point) => 10 + point.east / 100);
    const supports = bridgePierLocations([], [{ outer, holes }], mesh.points, mesh.indices, heights);
    expect(supports.length).toBeGreaterThanOrEqual(2);
    for (const support of supports) {
      expect(pointInFilledPolygon(support, outer, holes)).toBe(true);
      expect(support.deck).toBeCloseTo(10 + (support.east - 0.675) / 100);
    }
    expect(bridgeDeckHeightAt({ east: 60, north: 12 }, mesh.points, mesh.indices, heights)).toBeUndefined();
    const reversed = mesh.points.slice().reverse();
    const indices = mesh.indices.map((index) => mesh.points.length - index - 1);
    expect(bridgePierLocations([], [{ outer, holes }], reversed, indices, heights.slice().reverse())).toEqual(supports);
  });

  it('matches exhaustive triangle sampling on a holed deck', () => {
    const outer = [{ east: 0, north: 0 }, { east: 120, north: 0 },
      { east: 120, north: 24 }, { east: 0, north: 24 }];
    const holes = [[{ east: 30, north: 8 }, { east: 90, north: 8 },
      { east: 90, north: 16 }, { east: 30, north: 16 }]];
    const mesh = triangulateDeckSurface({ outer, holes }, false)!;
    const heights = mesh.points.map((point) => 10 + point.east / 100);
    const sample = bridgeDeckSampler(mesh.points, mesh.indices);
    for (let east = 0; east <= 120; east += 6) {
      for (let north = 0; north <= 24; north += 4) {
        const point = { east, north };
        expect(sample(point, heights)).toEqual(bridgeDeckHeightAt(point, mesh.points, mesh.indices, heights));
      }
    }
  });

  it('samples ground at the support itself, skips low clearance, and retries missing terrain', () => {
    const layer = new BridgeModelLayer() as any;
    const origin = planOriginFromLngLat(23.76, 61.5);
    const locations = [{ east: 50, north: 0, deck: 15 }];
    layer.sampleElevation = vi.fn(() => 7);
    const result = layer.sampleBridgePiers({}, locations, origin, 15);
    const coordinates = planToLngLat(locations[0], origin);
    expect(layer.sampleElevation).toHaveBeenCalledWith({}, coordinates[0], coordinates[1], 15);
    expect(result).toEqual([{ longitude: coordinates[0], latitude: coordinates[1], ground: 7, deck: 15 }]);
    layer.sampleElevation.mockReturnValue(12);
    expect(layer.sampleBridgePiers({}, locations, origin, 15)).toEqual([]);
    layer.sampleElevation.mockReturnValue(null);
    expect(layer.sampleBridgePiers({}, locations, origin, 15)).toBeNull();
  });
});

describe('BridgeModelLayer', () => {
  const terrainViewMap = () => ({
    getBounds: () => ({
      getWest: () => 23.75,
      getSouth: () => 61.49,
      getEast: () => 23.77,
      getNorth: () => 61.51,
    }),
    getZoom: () => 15,
    getPitch: () => 40,
    getTerrain: () => ({}),
    triggerRepaint: vi.fn(),
  });

  it('keeps the 2D bridge visible while the first terrain sample is pending', () => {
    const layer = new BridgeModelLayer();
    const map = terrainViewMap();
    const setDrapedVisible = vi.fn();
    (layer as any).map = map;
    (layer as any).sampleVisibleBridges = vi.fn(() => ({ bridges: [{}], pending: true }));
    (layer as any).setDrapedVisible = setDrapedVisible;
    (layer as any).writeMeshes = vi.fn();

    layer.updateBridges();

    expect((layer as any).sampledBridges).toEqual([]);
    expect(setDrapedVisible).toHaveBeenCalledWith(true);
    expect((layer as any).writeMeshes).not.toHaveBeenCalled();
  });

  it('retains the last complete bridge mesh while terrain resampling is pending', () => {
    const layer = new BridgeModelLayer();
    const map = terrainViewMap();
    const previous = { complete: true };
    const setDrapedVisible = vi.fn();
    (layer as any).map = map;
    (layer as any).sampledBridges = [previous];
    (layer as any).sampleVisibleBridges = vi.fn(() => ({ bridges: [{}], pending: true }));
    (layer as any).setDrapedVisible = setDrapedVisible;
    (layer as any).writeMeshes = vi.fn();

    layer.updateBridges();

    expect((layer as any).sampledBridges).toEqual([previous]);
    expect(setDrapedVisible).not.toHaveBeenCalled();
    expect((layer as any).writeMeshes).not.toHaveBeenCalled();
  });

  it('updates lighting without replacing bridge resources and skips unchanged lighting', () => {
    const layer = new BridgeModelLayer();
    const map = terrainViewMap();
    (layer as any).map = map;
    const texture = new THREE.Texture();
    const geometry = new THREE.BufferGeometry();
    const deckMaterial = new THREE.MeshBasicMaterial({ map: texture });
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: texture, opacity: BRIDGE_SHADOW_OPACITY, depthWrite: false });
    (layer as any).decks.add(new THREE.Mesh(geometry, deckMaterial), new THREE.Mesh(geometry, shadowMaterial));
    const rebuild = vi.spyOn(layer as any, 'writeMeshes');
    const dispose = vi.spyOn(texture, 'dispose');
    const lighting = { azimuth: 90, polar: 45, nightMix: 1 };

    layer.setDayNightLighting(lighting);
    expect(deckMaterial.color.r).toBe(1);
    expect(shadowMaterial.opacity).toBeCloseTo(BRIDGE_SHADOW_OPACITY * 0.35);
    layer.setDayNightLighting(lighting);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.setDayNightLighting(null);
    layer.setDayNightLighting(null);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
    expect(deckMaterial.color.r).toBe(1);
    expect(shadowMaterial.opacity).toBe(BRIDGE_SHADOW_OPACITY);
    layer.setTheme(true);
    layer.setTheme(true);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(3);
    expect(deckMaterial.color.r).toBe(1);
    expect(rebuild).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(deckMaterial.map).toBe(texture);
    geometry.dispose();
    deckMaterial.dispose();
    shadowMaterial.dispose();
    texture.dispose();
  });

  it('skips unchanged idle updates but refreshes for camera and source changes', () => {
    const layer = new BridgeModelLayer();
    let zoom = 15;
    const map = {
      ...terrainViewMap(),
      getZoom: () => zoom,
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      queryTerrainElevation: () => 0,
    };
    (layer as any).map = map;
    const sample = vi.fn(() => ({ bridges: [], pending: false }));
    (layer as any).sampleVisibleBridges = sample;
    (layer as any).writeMeshes = vi.fn();
    layer.updateBridges();
    layer.updateBridges();
    expect(sample).toHaveBeenCalledTimes(1);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.invalidateSource();
    layer.updateBridges();
    expect(sample).toHaveBeenCalledTimes(2);
    zoom = 15.1;
    layer.updateBridges();
    expect(sample).toHaveBeenCalledTimes(3);
    zoom = 10;
    layer.updateBridges();
    layer.updateBridges();
    expect(map.triggerRepaint).toHaveBeenCalledTimes(4);
    expect(sample).toHaveBeenCalledTimes(3);
  });

  it('does not place 3D bridges until the terrain source has loaded', () => {
    const layer = new BridgeModelLayer();
    const map = {
      ...terrainViewMap(),
      getTerrain: () => ({ source: 'terrain' }),
      isSourceLoaded: () => false,
    };
    const sample = vi.fn(() => ({ bridges: [{}], pending: false }));
    (layer as any).map = map;
    (layer as any).sampleVisibleBridges = sample;
    (layer as any).writeMeshes = vi.fn();
    const setDrapedVisible = vi.fn();
    (layer as any).setDrapedVisible = setDrapedVisible;

    layer.updateBridges();

    expect(sample).not.toHaveBeenCalled();
    expect((layer as any).writeMeshes).not.toHaveBeenCalled();
    expect((layer as any).sampledBridges).toEqual([]);
    expect(setDrapedVisible).toHaveBeenCalledWith(true);
    expect(layer.needsElevationRetry()).toBe(true);
  });

  it('waits for terrain data before retrying pending elevations', () => {
    const layer = new BridgeModelLayer();
    const map = terrainViewMap();
    (layer as any).map = map;
    const sample = vi.fn(() => ({ bridges: [], pending: true }));
    (layer as any).sampleVisibleBridges = sample;
    layer.updateBridges();
    layer.updateBridges();
    expect(sample).toHaveBeenCalledTimes(1);
    expect(map.triggerRepaint).toHaveBeenCalled();
    expect(layer.needsElevationRetry()).toBe(true);
    layer.invalidateTerrain();
    layer.updateBridges();
    expect(sample).toHaveBeenCalledTimes(2);
  });

  it('builds once terrain is enabled without needing a camera move', () => {
    const layer = new BridgeModelLayer();
    let terrain: object | null = null;
    const map = {
      ...terrainViewMap(),
      getTerrain: () => terrain,
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      queryTerrainElevation: () => 0,
    };
    const sample = vi.fn(() => ({ bridges: [{ id: 1 }], pending: false }));
    (layer as any).map = map;
    (layer as any).sampleVisibleBridges = sample;
    (layer as any).writeMeshes = vi.fn();
    layer.updateBridges();
    expect(sample).not.toHaveBeenCalled();
    expect(layer.needsElevationRetry()).toBe(true);
    terrain = {};
    layer.updateBridges();
    expect(sample).toHaveBeenCalledTimes(1);
    expect((layer as any).writeMeshes).toHaveBeenCalled();
  });

  it('hides draped bridges without waiting for a camera move', async () => {
    const layer = new BridgeModelLayer();
    const jumpTo = vi.fn();
    const redraw = vi.fn();
    const visibility: Array<[string, string]> = [];
    const map = {
      ...terrainViewMap(),
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      getBearing: () => 0,
      getCenterElevation: () => 180,
      getRoll: () => 12,
      getPadding: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      queryTerrainElevation: () => 0,
      getLayer: () => ({}),
      setLayoutProperty: (id: string, property: string, value: string) => {
        if (property === 'visibility') visibility.push([id, value]);
      },
      setFilter: vi.fn(),
      jumpTo,
      redraw,
    };
    (layer as any).map = map;
    (layer as any).sampleVisibleBridges = vi.fn(() => ({ bridges: [{ id: 1 }], pending: false }));
    (layer as any).writeMeshes = vi.fn();

    layer.updateBridges();
    await Promise.resolve();

    expect(visibility).toContainEqual(['global-road-bridges', 'none']);
    expect(visibility).toContainEqual(['global-bridge-decks', 'none']);
    expect(jumpTo).toHaveBeenCalledWith(expect.objectContaining({
      zoom: 15,
      pitch: 40,
      bearing: 0,
      elevation: 180,
      roll: 12,
    }));
    expect(redraw).toHaveBeenCalled();
  });

  it('keeps waiting when transportation tiles have not loaded yet', () => {
    const layer = new BridgeModelLayer();
    const map = {
      ...terrainViewMap(),
      getSource: () => ({}),
      isSourceLoaded: () => false,
      querySourceFeatures: () => [],
    };
    const setDrapedVisible = vi.fn();
    (layer as any).map = map;
    (layer as any).setDrapedVisible = setDrapedVisible;
    (layer as any).writeMeshes = vi.fn();

    layer.updateBridges();

    expect((layer as any).writeMeshes).not.toHaveBeenCalled();
    expect((layer as any).sampledBridges).toEqual([]);
    expect(setDrapedVisible).toHaveBeenCalledWith(true);
    expect(layer.needsElevationRetry()).toBe(true);
  });

  it('retains original fallback geometry for short bridges and bridges beyond the mesh budget', () => {
    const layer = new BridgeModelLayer() as any;
    const origin = planOriginFromLngLat(18.08, 59.3);
    const features = Array.from({ length: 242 }, (_, index) => ({
      type: 'Feature', properties: { class: 'primary', brunnel: 'bridge', layer: 1 },
      geometry: { type: 'LineString', coordinates: [
        planToLngLat({ east: 0, north: index * 25 }, origin),
        planToLngLat({ east: index === 241 ? 2 : 100, north: index * 25 }, origin),
      ] },
    }));
    const job = layer.sampleBridgeJob({ getSource: () => ({}), querySourceFeatures: () => features,
      queryTerrainElevation: () => 0 },
    { west: 18.07, east: 18.09, south: 59.29, north: 59.37, zoom: 16 });
    let result = job.next();
    while (!result.done) result = job.next();
    expect(result.value.bridges).toHaveLength(240);
    const replaced = new Set(result.value.bridges.flatMap((bridge: any) => bridge.sourceKeys));
    const skipped = [...result.value.fallbackFeatures].filter(([key]) => !replaced.has(key));
    expect(skipped).toHaveLength(2);
    expect(skipped.map(([, feature]) => feature)).toContainEqual(features[241]);
  });

  const withBridgeResources = (run: (layer: BridgeModelLayer, internal: any, bridge: any) => void) => {
    // Canvas painting is covered separately; these tests exercise resource ownership.
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
    const layer = new BridgeModelLayer();
    const internal = layer as any;
    internal.pierMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial(), 400);
    const surface = Array.from({ length: 8 }, (_, index) => ({
      longitude: 23.76 + Math.floor(index / 2) * 0.0001,
      latitude: 61.5 + (index % 2) * 0.00003,
      ground: 2, deck: 12,
      east: Math.floor(index / 2) * 5,
      north: (index % 2) * 3,
    }));
    const bridge = {
      surface, indices: [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6],
      surfaces: [], parts: [], spanLength: 15,
      bounds: { minEast: -2, minNorth: -2, maxEast: 17, maxNorth: 5 },
    };
    try {
      run(layer, internal, bridge);
    } finally {
      internal.map = undefined;
      layer.onRemove();
      vi.unstubAllGlobals();
    }
  };

  it('renders support bases at sampled terrain and updates them without rebuilding deck textures', () => {
    withBridgeResources((_layer, internal, bridge) => {
      const pier = { longitude: 23.76, latitude: 61.5, ground: 7, deck: 15 };
      internal.sampledBridges = [{ ...bridge, piers: [pier] }];
      internal.writeMeshes();
      const texture = internal.decks.children[0].material.map;
      const matrix = new THREE.Matrix4();
      internal.pierMesh.getMatrixAt(0, matrix);
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      matrix.decompose(position, new THREE.Quaternion(), scale);
      const expected = internal.toLocal(pier.longitude, pier.latitude, pier.ground);
      expect(position.x).toBeCloseTo(expected.east);
      expect(position.z).toBeCloseTo(expected.north);
      expect(position.y - scale.y / 2).toBeCloseTo(expected.up);
      expect(scale.y).toBeCloseTo(8);
      internal.sampledBridges = [{ ...bridge, piers: [{ ...pier, ground: 9 }] }];
      internal.writeMeshes();
      expect(internal.decks.children[0].material.map).toBe(texture);
      internal.pierMesh.getMatrixAt(0, matrix);
      matrix.decompose(position, new THREE.Quaternion(), scale);
      expect(scale.y).toBeCloseTo(6);
      internal.sampledBridges = [{ ...bridge, piers: Array.from({ length: 405 }, () => pier) }];
      internal.writeMeshes();
      expect(internal.pierMesh.count).toBe(400);
    });
  });

  it('moves existing bridge shadows when the sun offset changes', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.map = terrainViewMap();
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const resource = [...internal.bridgeResources.values()][0] as any;
      const positions = resource.shadow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const before = { x: positions.getX(0), z: positions.getZ(0) };
      const oldOffset = { east: internal.shadowOffsetEast, north: internal.shadowOffsetNorth };
      layer.setDayNightLighting({ azimuth: 90, polar: 45, nightMix: 0, shadowOffset: [10, -7] });
      expect(positions.getX(0) - before.x).toBeCloseTo(10 - oldOffset.east);
      expect(positions.getZ(0) - before.z).toBeCloseTo(-7 - oldOffset.north);
    });
  });

  it('continues drawing below the cutoff even before the next bridge update', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const renderer = { resetState: vi.fn(), render: vi.fn(), dispose: vi.fn() };
      internal.renderer = renderer;
      internal.map = { ...terrainViewMap(), getZoom: () => 12.9,
        getCenter: () => internal.sceneOrigin, isSourceLoaded: () => false };
      layer.render({} as any, { defaultProjectionData: { mainMatrix: new THREE.Matrix4().toArray() } } as any);
      expect(internal.drapedHandoff).toBeTruthy();
      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(internal.sampledBridges).toEqual([bridge]);
      internal.renderer = undefined;
    });
  });

  it('retains 3D bridges until draped tiles are ready, then fades and releases them', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const resource = [...internal.bridgeResources.values()][0] as any;
      const dispose = vi.spyOn(resource.deck.geometry, 'dispose');
      let ready = false;
      internal.map = { ...terrainViewMap(), getZoom: () => 12.9,
        isStyleLoaded: () => true, isSourceLoaded: () => ready };
      layer.updateBridges();
      expect(internal.drapedHandoff).toBeTruthy();
      expect(internal.sampledBridges).toEqual([bridge]);
      for (const now of [0, 16, 100, 1000]) expect(internal.advanceDrapedHandoff(now)).toBe(true);
      expect(resource.deck.material.opacity).toBe(1);
      expect(dispose).not.toHaveBeenCalled();
      ready = true;
      expect(internal.advanceDrapedHandoff(1100)).toBe(true);
      expect(internal.advanceDrapedHandoff(1210)).toBe(true);
      expect(resource.deck.material.opacity).toBeCloseTo(0.5);
      expect(internal.advanceDrapedHandoff(1320)).toBe(false);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(internal.sampledBridges).toEqual([]);
      expect(internal.lastUpdateSignature).toBeUndefined();
    });
  });

  it('waits for map frames and cancels an outgoing fade when zoom reverses', () => {
    withBridgeResources((_layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const resource = [...internal.bridgeResources.values()][0] as any;
      const dispose = vi.spyOn(resource.deck.geometry, 'dispose');
      let ready = true;
      internal.map = { ...terrainViewMap(), isStyleLoaded: () => true, isSourceLoaded: () => ready };
      internal.setDrapedVisible = vi.fn();
      internal.beginDrapedHandoff();
      internal.advanceDrapedHandoff(0);
      internal.advanceDrapedHandoff(1000);
      expect(resource.deck.material.opacity).toBe(1);
      internal.advanceDrapedHandoff(1100);
      internal.advanceDrapedHandoff(1210);
      expect(resource.deck.material.opacity).toBeCloseTo(0.5);
      ready = false;
      internal.advanceDrapedHandoff(1220);
      expect(resource.deck.material.opacity).toBe(1);
      internal.cancelDrapedHandoff();
      expect(internal.drapedHandoff).toBeUndefined();
      expect(internal.setDrapedVisible).toHaveBeenLastCalledWith(false);
      expect(dispose).not.toHaveBeenCalled();
      expect(internal.sampledBridges).toEqual([bridge]);
    });
  });

  it('reuses long-span sections for terrain and palette updates within the cache budget', () => {
    withBridgeResources((layer, internal, bridge) => {
      const surface = bridge.surface.map((point: any) => ({ ...point, east: point.east * 100,
        longitude: 23.76 + point.east * 0.001 }));
      const long = { ...bridge, surface, bounds: planBounds(surface, 2), spanLength: 1500 };
      internal.sampledBridges = [long];
      internal.writeMeshes();
      const resources = [...internal.bridgeResources.values()] as any[];
      expect(resources.length).toBeGreaterThan(1);
      const textures = resources.map((resource) => resource.deck.material.map);
      const positions = resources.map((resource) => resource.deck.geometry.getAttribute('position').getY(0));
      internal.sampledBridges = [{ ...long, surface: surface.map((point: any) => ({ ...point, deck: point.deck + 4 })) }];
      internal.writeMeshes();
      const updated = [...internal.bridgeResources.values()] as any[];
      expect(updated).toEqual(resources);
      updated.forEach((resource, index) => {
        expect(resource.deck.material.map).toBe(textures[index]);
        expect(resource.deck.geometry.getAttribute('position').getY(0)).toBeCloseTo(positions[index] + 4);
      });
      internal.map = { getLayer: () => true, getPaintProperty: () => '#123456' };
      internal.refreshDeckPaint();
      updated.forEach((resource, index) => expect(resource.deck.material.map).toBe(textures[index]));
      internal.map = undefined;
      // A full viewport gives each bridge one slot instead of dropping later bridges.
      internal.sampledBridges = Array.from({ length: 240 }, (_, index) => ({ ...long,
        surface: surface.map((point: any) => ({ ...point, longitude: point.longitude + index })) }));
      internal.writeMeshes();
      expect(internal.bridgeResources.size).toBe(240);
      expect(internal.decks.children).toHaveLength(480);
    });
  });

  it('lets scene geometry occlude bridge shadows without shadows writing depth', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const shadow = internal.decks.children[1] as THREE.Mesh;
      const material = shadow.material as THREE.MeshBasicMaterial;
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
    });
  });

  it('places shadows at their sampled footprint and updates when only shadow terrain changes', () => {
    withBridgeResources((layer, internal, bridge) => {
      bridge.surface = bridge.surface.map((point: any) => ({ ...point,
        shadowLongitude: point.longitude + 0.0001, shadowLatitude: point.latitude, shadowGround: 12 }));
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const shadow = internal.decks.children[1] as THREE.Mesh;
      const geometry = shadow.geometry;
      const expected = internal.toLocal(bridge.surface[0].shadowLongitude, bridge.surface[0].shadowLatitude, 12 + BRIDGE_SHADOW_HOVER_METRES);
      expect(geometry.getAttribute('position').getX(0) + shadow.position.x).toBeCloseTo(expected.east, 3);
      expect(geometry.getAttribute('position').getY(0) + shadow.position.y).toBeCloseTo(expected.up, 3);
      bridge.surface.forEach((point: any) => { point.shadowGround = 16; });
      internal.writeMeshes();
      expect(shadow.geometry).toBe(geometry);
      expect(geometry.getAttribute('position').getY(0) + shadow.position.y)
        .toBeCloseTo(16 - internal.sceneOriginElevation + BRIDGE_SHADOW_HOVER_METRES, 3);
    });
  });

  it('reuses resources across pans and updates terrain heights in place', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const deck = internal.decks.children[0] as THREE.Mesh;
      const shadow = internal.decks.children[1] as THREE.Mesh;
      const geometry = deck.geometry;
      const texture = (deck.material as THREE.MeshLambertMaterial).map;
      const normalVersion = (geometry.getAttribute('normal') as THREE.BufferAttribute).version;
      const newOrigin = { ...internal.sceneOrigin };
      newOrigin.lng += 0.01;
      newOrigin.lat += 0.01;
      internal.sceneOrigin = newOrigin;
      internal.sceneOriginElevation = 4;
      internal.writeMeshes();
      expect(internal.decks.children[0]).toBe(deck);
      expect((geometry.getAttribute('normal') as THREE.BufferAttribute).version).toBe(normalVersion);
      const first = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), 0);
      first.multiply(deck.scale).add(deck.position);
      const expected = internal.toLocal(bridge.surface[0].longitude, bridge.surface[0].latitude, 12);
      expect(first.x).toBeCloseTo(expected.east, 3);
      expect(first.y).toBeCloseTo(expected.up, 3);
      expect(first.z).toBeCloseTo(expected.north, 3);

      internal.sampledBridges = [{ ...bridge, surface: bridge.surface.map((point: any) => ({ ...point, ground: 5, deck: 16 })) }];
      internal.writeMeshes();
      expect(internal.decks.children[0]).toBe(deck);
      expect(deck.geometry).toBe(geometry);
      expect((deck.material as THREE.MeshLambertMaterial).map).toBe(texture);
      expect(geometry.getAttribute('position').getY(0) + deck.position.y).toBeCloseTo(12);
      expect(shadow.geometry.getAttribute('position').getY(0) + shadow.position.y)
        .toBeCloseTo(1 + BRIDGE_SHADOW_HOVER_METRES);
      expect(layer.getPerformanceStats()).toMatchObject({ built: 1, reused: 2, heightUpdates: 1 });
      const fascia = deck.children[0] as THREE.Mesh;
      expect(fascia).toBeTruthy();
      expect(fascia.geometry.getAttribute('position').count).toBeGreaterThan(0);
      const resource = [...internal.bridgeResources.values()][0] as any;
      const walls = fascia.geometry.getAttribute('position');
      const deckPositions = geometry.getAttribute('position');
      resource.fasciaEdges.forEach(([a, b]: [number, number], edge: number) => {
        [a, b].forEach((vertex, corner) => {
          const wallVertex = edge * 4 + corner;
          expect(walls.getX(wallVertex)).toBeCloseTo(deckPositions.getX(vertex), 3);
          expect(walls.getY(wallVertex)).toBeCloseTo(deckPositions.getY(vertex), 3);
          expect(walls.getZ(wallVertex)).toBeCloseTo(deckPositions.getZ(vertex), 3);
        });
      });
    });
  });

  it('recenters during rendering without rebuilding meshes or uploading instance data', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const deck = internal.decks.children[0];
      const pier = internal.pierMesh as THREE.InstancedMesh;
      const instanceVersion = pier.instanceMatrix.version;
      const instance = new THREE.Matrix4();
      pier.getMatrixAt(0, instance);
      const before = new THREE.Vector3().setFromMatrixPosition(instance);
      const previousOrigin = { ...internal.sceneOrigin };
      const center = { ...previousOrigin };
      center.lng += 0.02;
      center.lat += 0.01;
      internal.map = { ...terrainViewMap(), getCenter: () => center, queryTerrainElevation: () => 4 };
      internal.renderer = { resetState: vi.fn(), render: vi.fn(), dispose: vi.fn() };
      const rebuild = vi.spyOn(internal, 'writeMeshes');
      layer.render({} as any, { defaultProjectionData: { mainMatrix: new THREE.Matrix4().toArray() } } as any);
      expect(rebuild).not.toHaveBeenCalled();
      expect(internal.decks.children[0]).toBe(deck);
      expect(pier.instanceMatrix.version).toBe(instanceVersion);
      const translated = before.clone().multiply(pier.scale).add(pier.position);
      const offset = internal.toLocal(previousOrigin.lng, previousOrigin.lat, 0);
      expect(translated.x).toBeCloseTo(before.x * pier.scale.x + offset.east);
      expect(translated.y).toBeCloseTo(before.y - 4);
      expect(layer.getPerformanceStats().recenters).toBe(1);
    });
  });

  it('rebuilds changed OSM content and evicts inactive resources within the bridge budget', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const first = internal.decks.children[0];
      const disposed = vi.spyOn(first.geometry, 'dispose');
      const textureDisposed = vi.spyOn(first.material.map, 'dispose');
      // Same position with changed paint must not reuse the previous texture.
      internal.sampledBridges = [{ ...bridge, parts: [{ kind: 'line', plan: [{ east: 0, north: 0 }, { east: 15, north: 0 }], width: 4, fill: '#fff', edge: '#000' }] }];
      internal.writeMeshes();
      expect(internal.decks.children[0]).not.toBe(first);
      // Returning to an unchanged cluster reuses its retained resources.
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      expect(internal.decks.children[0]).toBe(first);
      for (let index = 1; index <= 240; index += 1) {
        internal.sampledBridges = [{ ...bridge, surface: bridge.surface.map((point: any) => ({ ...point, longitude: point.longitude + index * 0.001 })) }];
        internal.writeMeshes();
      }
      expect(layer.getPerformanceStats().cachedBridges).toBe(240);
      expect(internal.decks.children).toHaveLength(2);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(textureDisposed).toHaveBeenCalledTimes(1);
      internal.clearMeshes();
      expect(layer.getPerformanceStats().cachedBridges).toBe(0);
      expect(disposed).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes tile geometry and DEM elevations while retaining unchanged clusters', () => {
    withBridgeResources((layer, internal) => {
      const feature = (lng: number, length = 0.001) => ({
        properties: { brunnel: 'bridge', class: 'minor' },
        geometry: { type: 'LineString', coordinates: [[lng, 61.5], [lng + length, 61.5]] },
      });
      let features = [feature(23.76), feature(24.0)];
      let elevation: number | null = 10;
      const terrainQuery = vi.fn(() => elevation);
      internal.map = {
        ...terrainViewMap(),
        getTerrain: () => ({ source: 'terrain', exaggeration: 1 }),
        getCenter: () => ({ lng: 23.76, lat: 61.5 }),
        getLayer: () => undefined, getSource: () => ({}), querySourceFeatures: () => features,
        queryTerrainElevation: terrainQuery,
      };
      layer.updateBridges();
      const original = internal.decks.children[0];
      const originalTexture = original.material.map;
      expect(layer.getPerformanceStats()).toMatchObject({ built: 1, sourceParts: 2, retainedParts: 1 });
      // A newly loaded unrelated tile changes enumeration and the shared plan origin.
      features = [feature(23.78), ...features];
      layer.invalidateSource();
      layer.updateBridges();
      expect(internal.decks.children).toContain(original);
      expect(layer.getPerformanceStats()).toMatchObject({ built: 2, reused: 1 });
      elevation = null;
      layer.invalidateTerrain();
      layer.updateBridges();
      expect(layer.needsElevationRetry()).toBe(true);
      expect(internal.decks.children).toContain(original);
      elevation = 20;
      layer.invalidateTerrain();
      terrainQuery.mockClear();
      layer.updateBridges();
      expect(terrainQuery).toHaveBeenCalled();
      expect(original.material.map).toBe(originalTexture);
      expect(layer.getPerformanceStats()).toMatchObject({ built: 2, heightUpdates: 2 });
      expect(original.geometry.getAttribute('position').getY(0) + original.position.y).toBeCloseTo(0.06);
      // A changed tile fragment extends one bridge, requiring a new texture/mesh.
      features = [feature(23.78), feature(23.76, 0.0015)];
      layer.invalidateSource();
      layer.updateBridges();
      expect(internal.decks.children).not.toContain(original);
      expect(layer.getPerformanceStats().built).toBe(3);
    });
  });

  it('detects centre-of-deck terrain rises and retries missing interior samples', () => {
    withBridgeResources((layer, internal) => {
      const origin = planOriginFromLngLat(23.76, 61.5);
      const plan = [{ east: 0, north: 0 }, { east: 200, north: 0 }];
      const line = {
        kind: 'line', plan, width: 6,
        coordinates: plan.map((point) => planToLngLat(point, origin)),
        properties: { className: 'minor', layer: 0, ramp: false },
      };
      let ready = false;
      const terrain = vi.fn((coordinate: { lng: number; lat: number }) => {
        const point = lngLatsToPlan([[coordinate.lng, coordinate.lat]], origin)[0];
        const onRidge = point.east > 70 && point.east < 130 && Math.abs(point.north) < 1;
        return onRidge ? (ready ? 9 : null) : 0;
      });
      const map = { queryTerrainElevation: terrain };
      const sample = () => internal.sampleCluster(map, origin, [line], [], 200, 15);
      expect(sample()).toBeNull();
      expect(layer.needsElevationRetry()).toBe(true);
      ready = true;
      layer.invalidateTerrain();
      const sampled = sample();
      expect(sampled).not.toBeNull();
      expect(sampled.surface.every((point: any) => point.ground === 0)).toBe(true);
      expect(Math.max(...sampled.surface.map((point: any) => point.deck))).toBeGreaterThan(9.7);
      internal.sampledBridges = [sampled];
      internal.writeMeshes();
      const mesh = internal.decks.children[0];
      const texture = mesh.material.map;
      const queries = terrain.mock.calls.length;
      sample();
      expect(terrain).toHaveBeenCalledTimes(queries);
      // A DEM update removes the obstruction; reuse resources and restore the profile.
      terrain.mockImplementation(() => 0);
      layer.invalidateTerrain();
      internal.sampledBridges = [sample()];
      internal.writeMeshes();
      expect(internal.decks.children[0]).toBe(mesh);
      expect(mesh.material.map).toBe(texture);
      expect(layer.getPerformanceStats()).toMatchObject({ built: 1, heightUpdates: 1 });
      expect(Math.max(...internal.sampledBridges[0].surface.map((point: any) => point.deck))).toBeCloseTo(bridgeArchMetres(200) + 0.7);
    });
  });

  it('reuses cluster geometry until the source is invalidated', () => {
    withBridgeResources((layer, internal) => {
      const origin = planOriginFromLngLat(23.76, 61.5);
      const plan = [{ east: 0, north: 0 }, { east: 80, north: 0 }];
      const line = {
        kind: 'line', plan, width: 6,
        coordinates: plan.map((point) => planToLngLat(point, origin)),
        properties: { className: 'minor', layer: 0, ramp: false },
      };
      const map = { queryTerrainElevation: () => 0 };
      const sample = () => internal.sampleCluster(map, origin, [line], [], 80, 15);
      expect(sample()).not.toBeNull();
      expect(layer.getPerformanceStats()).toMatchObject({ geometryBuilds: 1, geometryCacheHits: 0 });
      expect(sample()).not.toBeNull();
      expect(layer.getPerformanceStats()).toMatchObject({ geometryBuilds: 1, geometryCacheHits: 1 });
      layer.invalidateSource();
      expect(sample()).not.toBeNull();
      expect(layer.getPerformanceStats()).toMatchObject({ geometryBuilds: 2, geometryCacheHits: 1 });
    });
  });

  it('cancels an in-flight sample when the view changes without committing it', () => {
    const layer = new BridgeModelLayer();
    const internal = layer as any;
    const previous = { keep: true };
    internal.sampledBridges = [previous];
    internal.renderer = { capabilities: { getMaxAnisotropy: () => 1 } };
    let zoom = 15;
    const feature = (lng: number) => ({
      properties: { brunnel: 'bridge', class: 'minor' },
      geometry: { type: 'LineString', coordinates: [[lng, 61.5], [lng + 0.002, 61.5]] },
    });
    const map = {
      ...terrainViewMap(),
      getZoom: () => zoom,
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      getSource: () => ({}),
      getLayer: () => undefined,
      querySourceFeatures: () => [feature(23.76), feature(23.762), feature(23.764)],
      queryTerrainElevation: () => 0,
    };
    internal.map = map;
    let now = 0;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const original = internal.sampleCluster.bind(internal);
    const sampleCluster = vi.spyOn(internal, 'sampleCluster').mockImplementation((...args: unknown[]) => {
      now += 10;
      return original(...args);
    });
    try {
      layer.updateBridges();
      expect(internal.sampledBridges).toEqual([previous]);
      expect(internal.samplingJob).toBeTruthy();
      const firstView = internal.samplingJob.view;
      zoom = 15.4;
      layer.updateBridges();
      expect(internal.sampledBridges).toEqual([previous]);
      expect(internal.samplingJob.view).not.toBe(firstView);
      expect(sampleCluster).toHaveBeenCalled();
      internal.renderer = undefined;
      layer.updateBridges();
      expect(internal.sampledBridges).not.toEqual([previous]);
      expect(internal.sampledBridges.length).toBeGreaterThan(0);
      expect(internal.samplingJob).toBeUndefined();
    } finally {
      time.mockRestore();
      sampleCluster.mockRestore();
      layer.onRemove();
    }
  });

  it('paints new deck textures across frames when a renderer is attached', () => {
    withBridgeResources((_layer, internal, bridge) => {
      internal.renderer = { capabilities: { getMaxAnisotropy: () => 1 }, dispose: vi.fn() };
      let now = 0;
      const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
      const original = internal.paintDeck.bind(internal);
      internal.paintDeck = (...args: unknown[]) => {
        now += 10;
        return original(...args);
      };
      try {
        internal.sampledBridges = [0, 1, 2].map((index) => ({
          ...bridge,
          sourceKeys: [String(index)],
          piers: [{ longitude: 23.76, latitude: 61.5, ground: 2, deck: 12 }],
          surface: bridge.surface.map((point: any) => ({ ...point, longitude: point.longitude + index })),
        }));
        internal.fallbackFeatures = new Map(['0', '1', '2', 'skipped'].map((key) => [key,
          { type: 'Feature', properties: { key }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }]));
        internal.writeMeshes();
        expect(internal.bridgeResources.size).toBe(1);
        expect(internal.fallbackData.features.map((feature: any) => feature.properties.key)).toEqual(['1', '2', 'skipped']);
        expect(internal.meshWrite).toBeTruthy();
        internal.sceneOrigin = { lng: internal.sceneOrigin.lng + 0.01, lat: internal.sceneOrigin.lat + 0.01 };
        internal.sceneOriginElevation = 4;
        internal.writeMeshes();
        expect(internal.bridgeResources.size).toBe(2);
        const matrix = new THREE.Matrix4();
        internal.pierMesh.getMatrixAt(0, matrix);
        const pierPosition = new THREE.Vector3().setFromMatrixPosition(matrix)
          .multiply(internal.pierMesh.scale).add(internal.pierMesh.position);
        const expectedPier = internal.toLocal(23.76, 61.5, 7);
        expect(pierPosition.x).toBeCloseTo(expectedPier.east, 3);
        expect(pierPosition.y).toBeCloseTo(expectedPier.up, 3);
        expect(pierPosition.z).toBeCloseTo(expectedPier.north, 3);
        expect(internal.fallbackData.features.map((feature: any) => feature.properties.key)).toEqual(['2', 'skipped']);
        internal.writeMeshes();
        expect(internal.bridgeResources.size).toBe(3);
        expect(internal.meshWrite).toBeUndefined();
        expect(internal.decks.children).toHaveLength(6);
        expect(internal.fallbackData.features.map((feature: any) => feature.properties.key)).toEqual(['skipped']);
        internal.sampledBridges = internal.sampledBridges.map((sample: any) => ({ ...sample, sourceKeys: [...sample.sourceKeys] }));
        internal.writeMeshes();
        expect(internal.fallbackData.features.map((feature: any) => feature.properties.key)).toEqual(['skipped']);
      } finally {
        time.mockRestore();
      }
    });
  });

  it('resamples after terrain source or exaggeration changes without a camera move', () => {
    const layer = new BridgeModelLayer();
    const internal = layer as any;
    let terrain = { source: 'terrain', exaggeration: 1 };
    internal.map = {
      ...terrainViewMap(), getTerrain: () => terrain,
      getCenter: () => ({ lng: 23.76, lat: 61.5 }), queryTerrainElevation: () => 0,
    };
    internal.sampleVisibleBridges = vi.fn(() => ({ bridges: [], pending: false }));
    internal.writeMeshes = vi.fn();
    layer.updateBridges();
    internal.elevationCache.set('old', 10);
    terrain = { source: 'replacement-terrain', exaggeration: 1 };
    layer.updateBridges();
    expect(internal.elevationCache.size).toBe(0);
    terrain = { ...terrain, exaggeration: 2 };
    layer.updateBridges();
    expect(internal.sampleVisibleBridges).toHaveBeenCalledTimes(3);
    layer.updateBridges();
    expect(internal.sampleVisibleBridges).toHaveBeenCalledTimes(3);
  });

  it('does not render when terrain is off', () => {
    const layer = new BridgeModelLayer();
    const map = {
      getBounds: () => ({
        getWest: () => 23.76,
        getSouth: () => 61.49,
        getEast: () => 23.78,
        getNorth: () => 61.51,
      }),
      getZoom: () => 15,
      getPitch: () => 40,
      getTerrain: () => null,
      triggerRepaint: vi.fn(),
    } as any;
    const renderer = { resetState: vi.fn(), render: vi.fn() } as any;
    (layer as any).map = map;
    (layer as any).renderer = renderer;
    (layer as any).sampledBridges = [{
      surfaces: [{
        outer: [
          { east: 0, north: 0 },
          { east: 20, north: 0 },
          { east: 20, north: 8 },
          { east: 0, north: 8 },
        ],
        holes: [],
      }],
      surface: [{ longitude: 23.77, latitude: 61.5, ground: 0, deck: 12, east: 0, north: 0 }],
      indices: [0, 1, 2],
      parts: [],
      spanLength: 20,
      bounds: { minEast: -4, minNorth: -4, maxEast: 4, maxNorth: 4 },
    }];

    layer.render({} as any, {
      defaultProjectionData: { mainMatrix: new Float32Array(16) },
    } as any);

    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('restores draped roads and skips updates when 3D bridges are disabled', () => {
    withBridgeResources((layer, internal, bridge) => {
      internal.sampledBridges = [bridge];
      internal.writeMeshes();
      const visibility: Array<[string, string]> = [];
      const filters: Array<[string, unknown]> = [];
      const sample = vi.fn(() => ({ bridges: [bridge], pending: false }));
      internal.sampleVisibleBridges = sample;
      internal.drapedVisible = false;
      internal.map = {
        ...terrainViewMap(),
        getCenter: () => ({ lng: 23.76, lat: 61.5 }),
        queryTerrainElevation: () => 0,
        getLayer: () => ({}),
        setLayoutProperty: (id: string, property: string, value: string) => {
          if (property === 'visibility') visibility.push([id, value]);
        },
        setFilter: (id: string, filter: unknown) => { filters.push([id, filter]); },
      };
      layer.setEnabled(false);
      expect(visibility).toContainEqual(['global-road-bridges', 'visible']);
      expect(visibility).toContainEqual(['global-bridge-decks', 'visible']);
      expect(filters.some(([id]) => id === 'global-footways')).toBe(true);
      expect(internal.sampledBridges).toEqual([]);
      expect(internal.drapedHandoff).toBeUndefined();
      expect(internal.decks.children).toHaveLength(0);
      layer.updateBridges();
      expect(sample).not.toHaveBeenCalled();
      layer.setEnabled(false);
      expect(sample).not.toHaveBeenCalled();
      const renderer = { resetState: vi.fn(), render: vi.fn(), dispose: vi.fn() };
      internal.renderer = renderer;
      internal.map = {
        ...internal.map,
        getCenter: () => internal.sceneOrigin,
        isStyleLoaded: () => true,
        isSourceLoaded: () => true,
        queryTerrainElevation: () => 0,
      };
      layer.render({} as any, { defaultProjectionData: { mainMatrix: new THREE.Matrix4().toArray() } } as any);
      expect(renderer.render).not.toHaveBeenCalled();
      internal.renderer = undefined;
      layer.setEnabled(true);
      expect(sample).toHaveBeenCalled();
    });
  });
});

describe('bridgePaintColors', () => {
  it('preserves source levels without deriving height offsets from incomplete layer tags', () => {
    const layer = new BridgeModelLayer() as any;
    const origin = planOriginFromLngLat(18.08, 59.3);
    const plan = [{ east: 0, north: 0 }, { east: 100, north: 0 }];
    const coordinates = plan.map((point) => planToLngLat(point, origin));
    const features = [undefined, 3].map((level) => ({
      type: 'Feature', properties: { class: 'primary', brunnel: 'bridge', ...(level === undefined ? {} : { layer: level }) },
      geometry: { type: 'LineString', coordinates },
    }));
    const job = layer.sampleBridgeJob({ getSource: () => ({}), querySourceFeatures: () => features,
      queryTerrainElevation: () => 0 },
    { west: 18.07, east: 18.09, south: 59.29, north: 59.31, zoom: 16 });
    let result = job.next();
    while (!result.done) result = job.next();
    expect(result.value.bridges).toHaveLength(2);
    const peaks = result.value.bridges.map((bridge: any) => Math.max(...bridge.surface.map((p: any) => p.deck)));
    expect(peaks[1]).toBeCloseTo(peaks[0], 6);

    const polygon = (level: number): BridgeDrawable => ({ kind: 'polygon', coordinates,
      plan: [{ east: 0, north: -5 }, { east: 100, north: -5 }, { east: 100, north: 5 }, { east: 0, north: 5 }],
      width: 0, properties: { className: 'bridge', layer: level, ramp: false } });
    expect(clusterBridgeDrawables([polygon(0), polygon(3)])).toHaveLength(1);
    const line: BridgeDrawable = { kind: 'line', plan, coordinates, width: 9,
      properties: { className: 'primary', layer: 3, ramp: false } };
    expect(clusterBridgeDrawables([polygon(0), line])).toHaveLength(1);
  });

  it('uses path and cycleway colors from the 2D style', () => {
    expect(bridgePaintColors({ className: 'path', subclass: 'cycleway', layer: 0, ramp: false })).toEqual({
      fill: '#e8ddd6',
      edge: '#b99a91',
    });
    expect(bridgePaintColors({ className: 'path', subclass: 'footway', layer: 0, ramp: false }).fill).toBe('#ded9cd');
    expect(bridgePaintColors({ className: 'primary', layer: 0, ramp: false }).fill).toBe('#f1efe7');
  });
});

describe('setDrapedElevatedBridgeLayersVisible', () => {
  it('hides draped road, rail, path, and area bridge paint', () => {
    const visibility: Array<[string, string]> = [];
    const filters: Array<[string, unknown]> = [];
    const map = {
      getLayer: () => ({}),
      setLayoutProperty: (id: string, _property: 'visibility', value: 'visible' | 'none') => {
        visibility.push([id, value]);
      },
      setFilter: (id: string, filter: unknown) => {
        filters.push([id, filter]);
      },
    };

    setDrapedElevatedBridgeLayersVisible(map, false);

    expect(visibility).toContainEqual(['global-road-bridges', 'none']);
    expect(visibility).toContainEqual(['global-railway-bridges', 'none']);
    expect(visibility).toContainEqual(['global-path-bridge-edge', 'none']);
    expect(visibility).toContainEqual(['global-bridge-decks', 'none']);
    expect(filters.some(([id]) => id === 'global-footways')).toBe(true);
    expect(filters.some(([id]) => id === 'global-cycleways')).toBe(true);
    expect(filters.some(([id]) => id === 'global-road-center-markings')).toBe(true);
  });
});


describe('bridge active style paint', () => {
  it('follows class and surface expressions, theme and cycle palette changes in place', () => {
    const strokes: string[] = [];
    const context = { setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, strokeStyle: '',
      stroke() { strokes.push(this.strokeStyle); } };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const layer = new BridgeModelLayer() as any;
      let road: unknown = ['case', ['==', ['get', 'surface'], 'unpaved'], '#d9cbaa',
        ['match', ['get', 'class'], 'motorway', '#f9f7ef', '#f4f2eb']];
      layer.map = { getLayer: () => true, getZoom: () => 16,
        getPaintProperty: (id: string) => id === 'global-roads' ? road : '#adb8af' };
      const bridge = { surfaces: [], bounds: { minEast: 0, minNorth: 0, maxEast: 20, maxNorth: 5 },
        parts: [{ kind: 'line', width: 5, plan: [{ east: 0, north: 0 }, { east: 20, north: 0 }],
          fill: '#f1efe7', edge: '#87918d', properties: { className: 'motorway', layer: 0, ramp: false } }] };
      layer.refreshDeckPaint();
      layer.paintDeck(bridge);
      expect(strokes.slice(-2)).toEqual(['#adb8af', 'rgba(249,247,239,1)']);
      bridge.parts[0].properties = { ...bridge.parts[0].properties, surface: 'unpaved' } as any;
      layer.paintDeck(bridge);
      expect(strokes.slice(-2)).toEqual(['#adb8af', 'rgba(217,203,170,1)']);
      const texture = new THREE.Texture();
      const resource = { deck: { material: { map: texture } }, paintBridge: bridge, paintSignature: '' };
      layer.bridgeResources.set('test', resource);
      for (const paletteColor of ['#b8aa80', '#304050', '#f7f5ee']) {
        road = paletteColor;
        layer.refreshDeckPaint();
        expect(strokes.slice(-2)).toEqual(['#adb8af', paletteColor]);
        expect(resource.deck.material.map).toBe(texture);
        const version = texture.version;
        layer.refreshDeckPaint();
        expect(texture.version).toBe(version);
      }
      texture.dispose();
    } finally { vi.unstubAllGlobals(); }
  });

  it('uses the cycleway fill and its own casing across active palettes', () => {
    const strokes: string[] = [];
    const context = { setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, strokeStyle: '',
      stroke() { strokes.push(this.strokeStyle); } };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const layer = new BridgeModelLayer() as any;
      const colors: Record<string, string> = {
        'global-cycleways': '#b99a91', 'global-cycleway-casing': '#f3f0e9',
        'global-path-casing': '#d8d4ca',
      };
      layer.map = { getLayer: (id: string) => id in colors, getZoom: () => 16,
        getPaintProperty: (id: string) => colors[id] };
      const bridge = { surfaces: [], bounds: { minEast: 0, minNorth: 0, maxEast: 20, maxNorth: 5 },
        parts: [{ kind: 'line', width: 2.5, plan: [{ east: 0, north: 0 }, { east: 20, north: 0 }],
          fill: '#e8ddd6', edge: '#b99a91',
          properties: { className: 'path', subclass: 'cycleway', layer: 0, ramp: false } }] };
      for (const [fill, casing] of [['#b99a91', '#f3f0e9'], ['#b99a91', '#8b9e9d'], ['#926e68', '#556677']]) {
        colors['global-cycleways'] = fill;
        colors['global-cycleway-casing'] = casing;
        layer.refreshDeckPaint();
        layer.paintDeck(bridge);
        const expectedFill = `#${new THREE.Color(fill).lerp(new THREE.Color('#ffffff'), 0.12).getHexString()}`;
        expect(strokes.slice(-2)).toEqual([casing, expectedFill]);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps railway rails distinct from the bridge bed across palettes', () => {
    const strokes: string[] = [];
    const context = { setTransform() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      strokeStyle: '', stroke() { strokes.push(this.strokeStyle); } };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const layer = new BridgeModelLayer() as any;
      const colors: Record<string, string> = {
        'global-railways': '#8ea097',
        'global-railway-bed': '#d5dad6',
        'global-bridge-decks': '#dedede',
      };
      layer.map = { getLayer: (id: string) => id in colors, getZoom: () => 16,
        getPaintProperty: (id: string) => colors[id] };
      const bridge = { surfaces: [], bounds: { minEast: 0, minNorth: 0, maxEast: 20, maxNorth: 5 },
        parts: [{ kind: 'line', width: 5.5, plan: [{ east: 0, north: 0 }, { east: 20, north: 0 }],
          fill: '#c8ceca', edge: '#6f7874',
          properties: { className: 'rail', layer: 0, ramp: false } }] };
      layer.refreshDeckPaint();
      layer.paintDeck(bridge);
      const dayDeck = '#d5dad6';
      expect(strokes.slice(-4)).toEqual([dayDeck, dayDeck, '#8ea097', '#8ea097']);
      colors['global-railways'] = '#6b8295';
      colors['global-railway-bed'] = '#3d5163';
      colors['global-bridge-decks'] = '#10253a';
      layer.refreshDeckPaint();
      layer.paintDeck(bridge);
      const nightDeck = '#3d5163';
      expect(strokes.slice(-4)).toEqual(['#3d5163', nightDeck, '#6b8295', '#6b8295']);
    } finally { vi.unstubAllGlobals(); }
  });

  it('allocates a narrow texture for a diagonal span without moving its geometry', () => {
    const outer = [{ east: 0, north: 0 }, { east: 400, north: 400 },
      { east: 404, north: 396 }, { east: 4, north: -4 }];
    const bridge = { surfaces: [{ outer, holes: [] }], surface: outer.map((point) => ({ ...point,
      longitude: 23, latitude: 61, ground: 0, deck: 5 })), parts: [], indices: [0, 1, 2, 0, 2, 3],
      spanLength: 566, bounds: planBounds(outer, 2) };
    const projected = bridgeTexturePlan(bridge);
    const widths = [projected.bounds.maxEast - projected.bounds.minEast,
      projected.bounds.maxNorth - projected.bounds.minNorth];
    expect(Math.min(...widths)).toBeLessThan(11);
    expect(Math.max(...widths)).toBeGreaterThan(560);
    expect(projected.surface.map(({ longitude, latitude, deck }) => [longitude, latitude, deck]))
      .toEqual(bridge.surface.map(({ longitude, latitude, deck }) => [longitude, latitude, deck]));
  });
});


describe('long bridge texture sections', () => {
  const fixture = (length: number, width = 8, hole = false) => {
    const outer = [{ east: 0, north: 0 }, { east: length, north: 0 },
      { east: length, north: width }, { east: 0, north: width }];
    const holes = hole ? [[{ east: length * 0.3, north: width * 0.3 },
      { east: length * 0.7, north: width * 0.3 }, { east: length * 0.7, north: width * 0.7 },
      { east: length * 0.3, north: width * 0.7 }]] : [];
    const mesh = triangulateDeckSurface({ outer, holes })!;
    return { surfaces: [{ outer, holes }], surface: mesh.points.map((point) => ({ ...point,
      longitude: 23 + point.east / 50000, latitude: 61 + point.north / 100000,
      ground: 0, deck: 5 + point.east / length })), indices: mesh.indices,
      bounds: planBounds(outer, 2), spanLength: length, parts: [] };
  };
  const area = (bridge: Pick<ReturnType<typeof fixture>, 'surface' | 'indices'>) => {
    let sum = 0;
    for (let i = 0; i < bridge.indices.length; i += 3) {
      sum += polygonAreaMetres(bridge.indices.slice(i, i + 3).map((index) => bridge.surface[index]));
    }
    return sum;
  };

  it('preserves mesh area, holes, and identical shared-edge elevations', () => {
    const bridge = fixture(1200, 30, true);
    const sections = bridgeTextureSections(bridge);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.reduce((sum, section) => sum + area(section.bridge), 0)).toBeCloseTo(area(bridge), 5);
    for (let i = 1; i < sections.length; i += 1) {
      const left = sections[i - 1].bridge.surface;
      const right = sections[i].bridge.surface;
      const edge = Math.max(...left.map((point) => point.east));
      const boundary = (points: typeof left) => points.filter((point) => Math.abs(point.east - edge) < 1e-7)
        .map(({ longitude, latitude, deck, ground }) => [longitude, latitude, deck, ground])
        .sort((a, b) => a[1] - b[1]);
      expect(boundary(left).length).toBeGreaterThan(1);
      expect(boundary(right)).toEqual(boundary(left));
      expect(sections[i - 1].paintBridge.bounds.maxEast).toBeGreaterThan(sections[i].paintBridge.bounds.minEast);
    }
    expect(bridgeTextureSections(bridge)).toEqual(sections);
  });

  it('limits section count and total texture pixels, including wide decks', () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
    try {
      for (const bridge of [fixture(1200), fixture(5000, 100), fixture(1200, 600)]) {
        const sections = bridgeTextureSections(bridge);
        expect(sections.length).toBeLessThanOrEqual(8);
        let pixels = 0;
        for (const { paintBridge } of sections) {
          const canvas = paintBridgeCluster(paintBridge.surfaces, paintBridge.parts, paintBridge.bounds,
            undefined, paintBridge.texturePixelBudget);
          pixels += canvas.width * canvas.height;
          expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(2048);
        }
        expect(pixels).toBeLessThanOrEqual(2048 * 512);
        expect(bridgeTextureSections(bridge, 1)).toHaveLength(1);
      }
      expect(bridgeTextureSections(fixture(100))).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('bridge rails', () => {
  it('draws sleepers below paired rails when sleeper detail is enabled', () => {
    const strokes: string[] = [];
    const context = { setTransform() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      strokeStyle: '', stroke() { strokes.push(this.strokeStyle); } };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const plan = [{ east: 0, north: 0 }, { east: 100, north: 0 }];
      paintBridgeCluster([], [{ kind: 'line', plan, width: 5.5, fill: '#d5dad6', edge: '#d5dad6',
        properties: { className: 'rail', layer: 0, ramp: false } }], planBounds(plan, 4),
        () => ({ fill: '#d5dad6', edge: '#d5dad6', rail: '#828c8d', sleeper: '#b4bdb7', sleeperOpacity: 0.7 }));
      expect(strokes).toEqual(['#d5dad6', '#d5dad6', '#b4bdb7', '#828c8d', '#828c8d']);
    } finally { vi.unstubAllGlobals(); }
  });

  it('offsets both rails along bends without spikes or duplicate-point errors', () => {
    const plan = [{ east: 0, north: 0 }, { east: 0, north: 0 }, { east: 20, north: 0 }, { east: 20, north: 20 }];
    const rails = bridgeRailLines(plan);
    expect(rails).toHaveLength(2);
    expect(rails[0]).toHaveLength(3);
    expect(Math.abs(rails[0][0].north - rails[1][0].north)).toBeCloseTo(1.5);
    expect(Math.abs(rails[0][2].east - rails[1][2].east)).toBeCloseTo(1.5);
    for (const line of rails) expect(Math.hypot(line[1].east - 20, line[1].north)).toBeLessThan(1.51);
    expect(bridgeRailLines([{ east: 0, north: 0 }])).toEqual([]);
  });

  it('paints two rails in the active rail color only for railway and transit lines', () => {
    const strokes: string[] = [];
    const context = { setTransform() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
      strokeStyle: '', stroke() { strokes.push(this.strokeStyle); } };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    try {
      const plan = [{ east: 0, north: 0 }, { east: 100, north: 0 }];
      for (const className of ['rail', 'transit', 'track', 'path', 'primary']) {
        strokes.length = 0;
        paintBridgeCluster([], [{ kind: 'line', plan, width: 5.5, fill: '#dedede', edge: '#aabbcc',
          properties: { className, layer: 0, ramp: false } }], planBounds(plan, 4),
          () => ({ fill: '#dedede', edge: '#aabbcc', rail: '#6b8295' }));
        expect(strokes).toEqual(className === 'rail' || className === 'transit'
          ? ['#aabbcc', '#dedede', '#6b8295', '#6b8295'] : ['#aabbcc', '#dedede']);
      }
    } finally { vi.unstubAllGlobals(); }
  });
});
