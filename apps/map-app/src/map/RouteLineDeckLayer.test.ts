import { describe, it, expect, vi } from 'vitest';
import { BridgeModelLayer } from './BridgeModelLayer';
import { RouteLineDeckLayer } from './RouteLineDeckLayer';

// Simulate a bridge with a realistic surface mesh: a 40m long, 8m wide ribbon
// with surface points at 10m intervals along the span and at both edges.
function makeRealisticBridge(centerLng: number, centerLat: number, options?: { parts?: boolean }) {
  const metresPerDegLat = (Math.PI / 180) * 6_378_137;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const surface: any[] = [];
  for (let i = 0; i <= 4; i++) {
    const alongMetres = i * 10 - 20; // -20 to +20
    for (const acrossMetres of [-4, 4]) {
      const lat = centerLat + alongMetres / metresPerDegLat;
      const lng = centerLng + acrossMetres / (metresPerDegLat * cosLat);
      surface.push({
        longitude: lng,
        latitude: lat,
        ground: 8,
        deck: 8 + Math.sin((i / 4) * Math.PI) * 4,
        east: acrossMetres,
        north: alongMetres,
      });
    }
  }
  const includeParts = options?.parts !== false;
  return {
    surfaces: [],
    surface,
    indices: [],
    parts: includeParts ? [{
      kind: 'line' as const,
      plan: [{ east: 0, north: -20 }, { east: 0, north: 20 }],
      width: 8,
      fill: '#f1efe7',
      edge: '#87918d',
    }] : [],
    spanLength: 40,
    bounds: { minEast: -4, minNorth: -20, maxEast: 4, maxNorth: 20 },
  };
}

describe('RouteLineDeckLayer off-center bridge crossing', () => {
  const centerLng = 23.77;
  const centerLat = 61.5;
  const metresPerDegLat = (Math.PI / 180) * 6_378_137;
  const cosLat = Math.cos(centerLat * Math.PI / 180);

  function makeBridgeLayer() {
    const layer = new BridgeModelLayer() as any;
    layer.sampledBridges = [makeRealisticBridge(centerLng, centerLat)];
    return layer;
  }

  function lngOff(metres: number) { return metres / (metresPerDegLat * cosLat); }
  function latOff(metres: number) { return metres / metresPerDegLat; }

  it('finds deck elevation at bridge center', () => {
    const bridge = makeBridgeLayer();
    expect(bridge.deckElevationAt(centerLng, centerLat)).not.toBeNull();
  });

  it('finds deck elevation off-center along the bridge', () => {
    const bridge = makeBridgeLayer();
    const lng = centerLng + lngOff(2);
    const lat = centerLat + latOff(15);
    const elev = bridge.deckElevationAt(lng, lat);
    expect(elev).not.toBeNull();
    expect(elev!).toBeGreaterThan(8);
  });

  it('finds deck elevation at bridge edge', () => {
    const bridge = makeBridgeLayer();
    const lng = centerLng + lngOff(3.5);
    const lat = centerLat + latOff(10);
    expect(bridge.deckElevationAt(lng, lat)).not.toBeNull();
  });

  it('returns null well outside the bridge', () => {
    const bridge = makeBridgeLayer();
    expect(bridge.deckElevationAt(centerLng + lngOff(100), centerLat)).toBeNull();
  });

  function makeDeck(bridge: any) {
    const deck = new RouteLineDeckLayer('test') as any;
    deck.setBridgeDeckSource(bridge);
    deck.map = {
      getCenter: () => ({ lng: centerLng, lat: centerLat }),
      getZoom: () => 15,
      queryTerrainElevation: () => 8,
      triggerRepaint: vi.fn(),
    };
    deck.renderer = { resetState: vi.fn(), render: vi.fn() };
    deck.visible = true;
    return deck;
  }

  it('does not lift route crossing bridge perpendicularly (under it)', () => {
    const deck = makeDeck(makeBridgeLayer());
    deck.setFeatures([{
      coordinates: [
        [centerLng - lngOff(30), centerLat],
        [centerLng, centerLat],
        [centerLng + lngOff(30), centerLat],
      ],
      color: '#ff0000', widthPixels: 4.5, casingWidthPixels: 8,
    }]);
    // Route goes east-west; bridge runs north-south → not on the bridge
    expect(deck.lineGroup.children.length).toBe(0);
  });

  it('builds ribbon for route along bridge length', () => {
    const deck = makeDeck(makeBridgeLayer());
    deck.setFeatures([{
      coordinates: [
        [centerLng + lngOff(2), centerLat - latOff(30)],
        [centerLng + lngOff(2), centerLat],
        [centerLng + lngOff(2), centerLat + latOff(30)],
      ],
      color: '#ff0000', widthPixels: 4.5, casingWidthPixels: 8,
    }]);
    expect(deck.lineGroup.children.length).toBeGreaterThan(0);
  });

  it('builds ribbon for route on bridge at an angle within tolerance', () => {
    const deck = makeDeck(makeBridgeLayer());
    // Route heading ~45° from north, bridge heading 0° → 45° diff, within 60°
    deck.setFeatures([{
      coordinates: [
        [centerLng + lngOff(2) - lngOff(20), centerLat - latOff(20)],
        [centerLng + lngOff(2), centerLat],
        [centerLng + lngOff(2) + lngOff(20), centerLat + latOff(20)],
      ],
      color: '#ff0000', widthPixels: 4.5, casingWidthPixels: 8,
    }]);
    expect(deck.lineGroup.children.length).toBeGreaterThan(0);
  });

  it('builds nothing for route away from bridge', () => {
    const deck = makeDeck(makeBridgeLayer());
    deck.setFeatures([{
      coordinates: [
        [centerLng + lngOff(200), centerLat],
        [centerLng + lngOff(250), centerLat],
      ],
      color: '#ff0000', widthPixels: 4.5, casingWidthPixels: 8,
    }]);
    expect(deck.lineGroup.children.length).toBe(0);
  });

  it('does not lift a parallel street that runs under the deck', () => {
    const deck = makeDeck(makeBridgeLayer());
    deck.setFeatures([{
      coordinates: [
        [centerLng + lngOff(18), centerLat - latOff(30)],
        [centerLng + lngOff(18), centerLat],
        [centerLng + lngOff(18), centerLat + latOff(30)],
      ],
      color: '#ff0000', widthPixels: 4.5, casingWidthPixels: 8,
    }]);
    expect(deck.lineGroup.children.length).toBe(0);
  });

  it('lifts the local segment of a winding route that follows the bridge', () => {
    const deck = makeDeck(makeBridgeLayer());
    // Overall first-to-last heading is east-west, so the previous whole-route
    // check would skip this even though the middle leg travels along the span.
    deck.setFeatures([{
      coordinates: [
        [centerLng - lngOff(40), centerLat - latOff(20)],
        [centerLng + lngOff(2), centerLat - latOff(20)],
        [centerLng + lngOff(2), centerLat + latOff(20)],
        [centerLng + lngOff(40), centerLat + latOff(20)],
      ],
      color: '#ff0000', widthPixels: 4.5, casingWidthPixels: 8,
    }]);
    expect(deck.lineGroup.children.length).toBeGreaterThan(0);
  });
});

describe('deckPlacementAt', () => {
  const centerLng = 23.77;
  const centerLat = 61.5;
  const metresPerDegLat = (Math.PI / 180) * 6_378_137;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  function lngOff(metres: number) { return metres / (metresPerDegLat * cosLat); }
  function latOff(metres: number) { return metres / metresPerDegLat; }

  function makeBridgeLayer(options?: { parts?: boolean }) {
    const layer = new BridgeModelLayer() as any;
    layer.sampledBridges = [makeRealisticBridge(centerLng, centerLat, options)];
    return layer;
  }

  it('lifts a traveller on the roadway along the span', () => {
    const bridge = makeBridgeLayer();
    expect(bridge.deckPlacementAt(centerLng + lngOff(2), centerLat, 0)).not.toBeNull();
    expect(bridge.deckPlacementAt(centerLng + lngOff(2), centerLat, Math.PI)).not.toBeNull();
  });

  it('keeps a perpendicular under-crossing on terrain', () => {
    const bridge = makeBridgeLayer();
    expect(bridge.deckPlacementAt(centerLng, centerLat, Math.PI / 2)).toBeNull();
  });

  it('keeps a parallel under-street on terrain', () => {
    const bridge = makeBridgeLayer();
    expect(bridge.deckPlacementAt(centerLng + lngOff(18), centerLat, 0)).toBeNull();
  });

  it('still classifies on-vs-under from a synthetic span when line parts are missing', () => {
    const bridge = makeBridgeLayer({ parts: false });
    expect(bridge.deckPlacementAt(centerLng, centerLat, 0)).not.toBeNull();
    expect(bridge.deckPlacementAt(centerLng + lngOff(18), centerLat, 0)).toBeNull();
    expect(bridge.deckPlacementAt(centerLng, centerLat, Math.PI / 2)).toBeNull();
  });

  it('follows the local tangent of a bent centerline, not the overall chord', () => {
    const layer = new BridgeModelLayer() as any;
    const surface: any[] = [];
    for (let north = 0; north <= 40; north += 10) {
      for (const east of [-4, 4]) {
        surface.push({
          longitude: centerLng + east / (metresPerDegLat * cosLat),
          latitude: centerLat + north / metresPerDegLat,
          ground: 8, deck: 14, east, north,
        });
      }
    }
    for (let east = 10; east <= 30; east += 10) {
      for (const north of [36, 44]) {
        surface.push({
          longitude: centerLng + east / (metresPerDegLat * cosLat),
          latitude: centerLat + north / metresPerDegLat,
          ground: 8, deck: 14, east, north,
        });
      }
    }
    layer.sampledBridges = [{
      surfaces: [],
      surface,
      indices: [],
      parts: [{
        kind: 'line',
        plan: [{ east: 0, north: 0 }, { east: 0, north: 40 }, { east: 30, north: 40 }],
        width: 8, fill: '#f1efe7', edge: '#87918d',
      }],
      spanLength: 70,
      bounds: { minEast: -4, minNorth: 0, maxEast: 30, maxNorth: 44 },
    }];
    // Eastbound on the second leg: overall chord is diagonal, local heading is east.
    expect(layer.deckPlacementAt(
      centerLng + lngOff(20),
      centerLat + latOff(40),
      Math.PI / 2,
    )).not.toBeNull();
    // Northbound still matches the first leg.
    expect(layer.deckPlacementAt(centerLng, centerLat + latOff(20), 0)).not.toBeNull();
  });
});
