import { describe, expect, it } from 'vitest';
import {
  facadeDetailOpacity,
  isLikelyTileClipEdge,
  parseBuildingColour,
  shouldRenderFacadesForViewport,
  undirectedEdgeKey,
  uniqueBuildingWalls,
  wallLengthMeters,
} from './BuildingFacadeLayer';
import { pastelizeBuildingHex } from './MapPalette';

function polygonFeature(
  id: number,
  coordinates: number[][],
  properties: Record<string, unknown> = {},
) {
  return {
    id,
    type: 'Feature',
    properties: { render_height: 12, render_min_height: 0, ...properties },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  } as never;
}

describe('building façade walls', () => {
  it('cancels tile-seam edges shared by adjacent clipped fragments', () => {
    const left = polygonFeature(42, [
      [23.76, 61.498],
      [23.761, 61.498],
      [23.761, 61.499],
      [23.76, 61.499],
      [23.76, 61.498],
    ]);
    const right = polygonFeature(42, [
      [23.761, 61.498],
      [23.762, 61.498],
      [23.762, 61.499],
      [23.761, 61.499],
      [23.761, 61.498],
    ]);

    const walls = uniqueBuildingWalls([left, right]);
    const sharedKey = undirectedEdgeKey([23.761, 61.498], [23.761, 61.499]);
    expect(walls.some((wall) => undirectedEdgeKey(wall.start, wall.end) === sharedKey)).toBe(false);
    expect(walls.length).toBeGreaterThan(0);
  });

  it('ignores likely vector-tile clip edges even when the neighbour is missing', () => {
    const west = -180 + 360 * (12 / 2 ** 14);
    expect(isLikelyTileClipEdge([west, 61.49], [west, 61.5])).toBe(true);
    expect(isLikelyTileClipEdge([23.76, 61.498], [23.761, 61.4985])).toBe(false);
  });

  it('pastelizes mapped facade colours and skips hide_3d outlines', () => {
    const colored = polygonFeature(11, [
      [23.76, 61.498],
      [23.761, 61.498],
      [23.761, 61.499],
      [23.76, 61.499],
      [23.76, 61.498],
    ], { colour: '#c47a62' });
    const hidden = polygonFeature(12, [
      [23.763, 61.498],
      [23.764, 61.498],
      [23.764, 61.499],
      [23.763, 61.499],
      [23.763, 61.498],
    ], { hide_3d: true });

    const walls = uniqueBuildingWalls([colored, hidden]);
    const raw = parseBuildingColour('#c47a62');
    const pastel = pastelizeBuildingHex(raw!);
    expect(pastel).not.toBe(raw);
    expect(walls.every((wall) => wall.color === pastel)).toBe(true);
    expect((pastel >> 16) & 255).toBeGreaterThan(190);
    expect((pastel >> 8) & 255).toBeGreaterThan(160);
    const loudGreen = pastelizeBuildingHex(0x00ff00);
    const greenGap = ((loudGreen >> 8) & 255) - ((loudGreen >> 16) & 255);
    expect(greenGap).toBeGreaterThan(10);
    expect(greenGap).toBeLessThan(70);
    expect(walls).toHaveLength(4);
  });

  it('measures wall length in metres and fades façade detail with zoom', () => {
    expect(wallLengthMeters([23.76, 61.4981], [23.7601, 61.4981])).toBeGreaterThan(4);
    expect(shouldRenderFacadesForViewport({
      west: 23.76, south: 61.498, east: 23.80, north: 61.53,
    }, 14.8)).toBe(false);
    expect(shouldRenderFacadesForViewport({
      west: 23.76, south: 61.498, east: 23.80, north: 61.53,
    }, 16.2)).toBe(true);
    expect(facadeDetailOpacity(15)).toBe(0);
    expect(facadeDetailOpacity(16.8)).toBe(1);
  });
});
