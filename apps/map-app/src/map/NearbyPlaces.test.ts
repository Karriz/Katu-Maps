import { describe, expect, it } from 'vitest';
import { rankNearbyPlaces } from './NearbyPlaces';

describe('rankNearbyPlaces', () => {
  const anchor: [number, number] = [24, 60];
  it('deduplicates, filters and distance-ranks candidates', () => {
    const result = rankNearbyPlaces(anchor, [
      { id: 'far', name: 'Far café', type: 'cafe', coordinates: [24.01, 60], properties: {} },
      { id: 'near', name: 'Near park', type: 'park', coordinates: [24.001, 60], properties: {} },
      { id: 'near', name: 'Duplicate', type: 'park', coordinates: [24.002, 60], properties: {} },
      { id: 'bad', name: 'Road', type: 'road', coordinates: [24.0001, 60], properties: {} },
      { id: 'anchor', name: 'Anchor', type: 'cafe', coordinates: anchor, properties: {} },
    ]);
    expect(result.map((place) => place.id)).toEqual(['near', 'far']);
  });

  it('keeps an abundant category from dominating', () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      id: `food-${index}`, name: `Cafe ${index}`, type: 'cafe',
      coordinates: [24 + (index + 1) / 10_000, 60] as [number, number], properties: {},
    })).concat([{ id: 'park', name: 'Park', type: 'park', coordinates: [24.002, 60] as [number, number], properties: {} }]);
    expect(rankNearbyPlaces(anchor, candidates)).toHaveLength(5);
    expect(rankNearbyPlaces(anchor, candidates).at(-1)?.id).toBe('park');
  });

  it('ranks named playgrounds and sport facilities as recreation', () => {
    const result = rankNearbyPlaces(anchor, [
      { id: 'pool', name: 'Pyynikki outdoor pool', type: 'swimming', coordinates: [24.001, 60], properties: {} },
      { id: 'play', name: 'Sorsapuisto playground', type: 'playground', coordinates: [24.002, 60], properties: {} },
      { id: 'court', name: 'Koulukatu tennis', type: 'tennis', coordinates: [24.003, 60], properties: {} },
    ]);
    expect(result.map((place) => place.id)).toEqual(['pool', 'play']);
  });
});
