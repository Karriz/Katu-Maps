import { describe, expect, it } from 'vitest';
import {
  coordinateBounds,
  panelPaddingForRects,
  removeIsolatedCoordinateOutliers,
  type ViewportRect,
} from './RouteCamera';

const rect = (left: number, top: number, width: number, height: number): ViewportRect => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

describe('panelPaddingForRects', () => {
  it('reserves only the collapsed mobile sheet and leaves the useful viewport available', () => {
    expect(panelPaddingForRects(rect(0, 0, 390, 844), [rect(0, 752, 390, 92)], 48, 24)).toEqual({
      top: 48, right: 48, bottom: 116, left: 48,
    });
  });

  it('reserves a desktop side panel horizontally', () => {
    expect(panelPaddingForRects(rect(0, 0, 1200, 800), [rect(28, 28, 380, 600)], 48, 24)).toEqual({
      top: 48, right: 48, bottom: 48, left: 432,
    });
  });
});

describe('coordinateBounds', () => {
  it('frames all selected itinerary legs and endpoints', () => {
    expect(coordinateBounds([[23.7, 61.4], [23.9, 61.6], [23.6, 61.5], [24, 61.3]])).toEqual({
      minLng: 23.6, minLat: 61.3, maxLng: 24, maxLat: 61.6,
    });
  });

  it('rejects a malformed isolated geometry point before fitting', () => {
    expect(removeIsolatedCoordinateOutliers([[23.7, 61.4], [0, 0], [23.8, 61.5]])).toEqual([
      [23.7, 61.4], [23.8, 61.5],
    ]);
  });
});
