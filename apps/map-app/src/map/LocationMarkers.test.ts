import { describe, expect, it } from 'vitest';
import { availableGpsEndpoint, markerFeatureCollection } from './LocationMarkers';

describe('location marker lifecycle', () => {
  it('keeps one exact context-menu point, replaces it, and clears it', () => {
    expect(markerFeatureCollection([23.1, 61.2], 'temporary').features[0].geometry.coordinates)
      .toEqual([23.1, 61.2]);
    expect(markerFeatureCollection([24.3, 62.4], 'temporary').features).toHaveLength(1);
    expect(markerFeatureCollection([24.3, 62.4], 'temporary').features[0].geometry.coordinates)
      .toEqual([24.3, 62.4]);
    expect(markerFeatureCollection(null, 'temporary').features).toEqual([]);
  });
});

describe('GPS route defaults', () => {
  it('does not invent a GPS endpoint before a location is available', () => {
    expect(availableGpsEndpoint(null)).toBeNull();
  });

  it('preserves an already available GPS position as the explicit endpoint', () => {
    expect(availableGpsEndpoint([23.7, 61.5])).toMatchObject({
      name: 'Your location',
      coordinates: [23.7, 61.5],
    });
  });
});
