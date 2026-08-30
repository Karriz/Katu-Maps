export type Coordinates = [number, number];

export function markerFeatureCollection(coordinates: Coordinates | null, kind: string) {
  return {
    type: 'FeatureCollection' as const,
    features: coordinates ? [{
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates },
      properties: { kind },
    }] : [],
  };
}

export function availableGpsEndpoint(coordinates: Coordinates | null) {
  return coordinates ? {
    name: 'Your location',
    category: 'Current location',
    coordinates,
    source: 'map' as const,
  } : null;
}

export function normalizedLocationAccuracy(accuracy: number) {
  return Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 100;
}

export function locationZoomForAccuracy(accuracy: number) {
  const normalized = normalizedLocationAccuracy(accuracy);
  return normalized > 1_000 ? 12 : normalized > 250 ? 13 : 14;
}

export function isMeaningfullyBetterLocation(bestAccuracy: number, nextAccuracy: number) {
  return normalizedLocationAccuracy(nextAccuracy) < normalizedLocationAccuracy(bestAccuracy) * 0.75;
}
