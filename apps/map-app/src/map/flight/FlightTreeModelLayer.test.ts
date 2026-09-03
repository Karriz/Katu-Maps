import { describe, expect, it, vi } from 'vitest';
import {
  FlightTreeModelLayer,
  shouldRenderTreesForViewport,
  treeViewportSignature,
} from './FlightTreeModelLayer';

describe('treeViewportSignature', () => {
  it('ignores minor map drift while preserving meaningful zoom and terrain changes', () => {
    const baseline = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.62,
      28.4,
      'terrain',
      true,
      3,
    );
    const drift = treeViewportSignature(
      { west: 23.76092, south: 61.49812, east: 23.76513, north: 61.50125 },
      14.64,
      28.7,
      'terrain',
      true,
      3,
    );
    expect(drift).toBe(baseline);
  });

  it('changes when zoom or terrain mode crosses a meaningful threshold', () => {
    const lowZoom = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.2,
      28.4,
      'terrain',
      true,
      3,
    );
    const higherZoom = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.8,
      28.4,
      'terrain',
      true,
      3,
    );
    const terrainChanged = treeViewportSignature(
      { west: 23.7609, south: 61.4981, east: 23.7651, north: 61.5012 },
      14.2,
      28.4,
      'terrain',
      false,
      3,
    );

    expect(higherZoom).not.toBe(lowZoom);
    expect(terrainChanged).not.toBe(lowZoom);
  });

  it('disables trees once the viewport exceeds a few kilometres', () => {
    expect(shouldRenderTreesForViewport({
      west: 23.7609,
      south: 61.4981,
      east: 23.7685,
      north: 61.5025,
    }, 12.5)).toBe(true);

    expect(shouldRenderTreesForViewport({
      west: 23.7609,
      south: 61.4981,
      east: 23.8600,
      north: 61.6200,
    }, 12.5)).toBe(false);
  });
});

describe('TreeModelLayer', () => {
  it('stops rendering stale trees once the overview cutoff is exceeded', () => {
    const layer = new FlightTreeModelLayer({
      sourceId: 'openfreemap',
      waterLayers: ['water'],
      vegetationLayers: ['landcover'],
    });
    const map = {
      getZoom: () => 12.5,
      getBounds: () => ({
        getWest: () => 23.7609,
        getSouth: () => 61.4981,
        getEast: () => 23.8600,
        getNorth: () => 61.6200,
      }),
      triggerRepaint: vi.fn(),
    } as any;
    const renderer = {
      resetState: vi.fn(),
      render: vi.fn(),
    } as any;

    (layer as any).map = map;
    (layer as any).renderer = renderer;
    (layer as any).displayedTrees = new Map([['stale', {
      tree: {
        longitude: 23.78,
        latitude: 61.51,
        height: 12,
        leafType: 'broadleaved',
        vegetationType: 'broadleaf',
        rotation: 0,
        widthScale: 1,
        colorVariation: 0,
      },
      elevation: 0,
      mercatorX: 0,
      mercatorY: 0,
      east: 0,
      north: 0,
      up: 0,
      growthStart: 0,
      growthDuration: 600,
    }]]);

    layer.render({} as any, {
      defaultProjectionData: {
        mainMatrix: new Float32Array(16),
      },
    } as any);

    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('clears trees in flight mode once zoom drops below the tree minimum', () => {
    const layer = new FlightTreeModelLayer({
      sourceId: 'openfreemap',
      waterLayers: ['water'],
      vegetationLayers: ['landcover'],
    });
    const map = {
      getZoom: () => 9,
      getCenter: () => ({ lng: 23.76, lat: 61.5 }),
      getBounds: () => ({
        getWest: () => 20,
        getSouth: () => 58,
        getEast: () => 28,
        getNorth: () => 65,
      }),
      querySourceFeatures: vi.fn(() => {
        throw new Error('should not query source features at high altitude');
      }),
      triggerRepaint: vi.fn(),
    } as any;

    layer.setExtendedViewportRange(true);
    (layer as any).map = map;
    (layer as any).trunkMesh = { count: 1, instanceMatrix: { needsUpdate: false } };
    (layer as any).broadleafMesh = { count: 1, instanceMatrix: { needsUpdate: false } };
    (layer as any).coniferMesh = { count: 0, instanceMatrix: { needsUpdate: false } };
    (layer as any).shrubMesh = { count: 0, instanceMatrix: { needsUpdate: false } };
    (layer as any).shadowMesh = { count: 1, instanceMatrix: { needsUpdate: false } };
    (layer as any).displayedTrees = new Map([['keep', {
      tree: {
        longitude: 23.78,
        latitude: 61.51,
        height: 12,
        leafType: 'broadleaved',
        vegetationType: 'broadleaf',
        rotation: 0,
        widthScale: 1,
        colorVariation: 0,
      },
      elevation: 0,
      mercatorX: 0,
      mercatorY: 0,
      east: 0,
      north: 0,
      up: 0,
      growthStart: 0,
      growthDuration: 600,
    }]]);

    expect(() => layer.updateTrees()).not.toThrow();
    expect((layer as any).displayedTrees.size).toBe(0);
    expect(map.querySourceFeatures).not.toHaveBeenCalled();
    expect(map.triggerRepaint).toHaveBeenCalled();
  });
});
