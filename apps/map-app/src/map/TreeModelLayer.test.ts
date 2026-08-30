import { describe, expect, it } from 'vitest';
import { treeViewportSignature } from './TreeModelLayer';

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
});
