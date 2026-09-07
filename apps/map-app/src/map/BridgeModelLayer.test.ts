import { describe, expect, it, vi } from 'vitest';
import {
  BridgeModelLayer,
  bridgeDeckElevations,
  bridgePaintColors,
  bridgeSurfaceStrip,
  bridgeWidthMetres,
  clusterBridgeDrawables,
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
  pierStations,
  planBounds,
  planOriginFromLngLat,
  pointInFilledPolygon,
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
});

describe('pierStations', () => {
  it('places piers only where clearance is real and away from abutments', () => {
    const clearance = [0.5, 1, 8, 12, 14, 12, 8, 1, 0.4];
    const stations = pierStations(clearance, 120);
    expect(stations.length).toBeGreaterThan(0);
    expect(stations[0]).toBeGreaterThan(0);
    expect(stations[stations.length - 1]).toBeLessThan(clearance.length - 1);
    for (const index of stations) expect(clearance[index]).toBeGreaterThanOrEqual(5);
  });

  it('skips short at-grade spans', () => {
    expect(pierStations([0.4, 0.5, 0.4], 18)).toEqual([]);
  });
});

describe('BridgeModelLayer', () => {
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
});

describe('bridgePaintColors', () => {
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
