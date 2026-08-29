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
