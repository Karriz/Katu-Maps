import type { TransitBounds, TransitProviderId } from './types';

type Coordinate = [number, number];

// A deliberately conservative outline is enough for runtime provider choice:
// detailed map requests happen at city zooms, while cross-border itineraries
// remain on the global provider. Åland is represented separately.
const FINLAND_POLYGONS: Coordinate[][] = [
  [
    [20.55, 69.06], [25.0, 69.15], [28.95, 69.08], [28.5, 68.5],
    [29.55, 67.7], [30.15, 66.9], [29.6, 65.6], [30.1, 64.2],
    [29.7, 63.5], [31.55, 62.2], [30.0, 60.35], [27.8, 60.05],
    [25.0, 59.65], [22.45, 59.7], [21.15, 61.05], [20.75, 63.2],
    [21.25, 64.85], [24.15, 65.82], [23.65, 67.45], [20.55, 69.06],
  ],
  [
    [18.7, 59.65], [20.0, 59.55], [21.25, 59.9], [21.2, 60.6],
    [20.0, 60.75], [18.7, 60.45], [18.7, 59.65],
  ],
];

function pointInPolygon([longitude, latitude]: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentLongitude, currentLatitude] = polygon[current];
    const [previousLongitude, previousLatitude] = polygon[previous];
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    const boundaryLongitude = (previousLongitude - currentLongitude)
      * (latitude - currentLatitude)
      / (previousLatitude - currentLatitude || Number.EPSILON)
      + currentLongitude;
    if (crossesLatitude && longitude < boundaryLongitude) inside = !inside;
  }
  return inside;
}

export function isInFinland(coordinates: Coordinate) {
  return FINLAND_POLYGONS.some((polygon) => pointInPolygon(coordinates, polygon));
}

export function providerForPoint(coordinates: Coordinate): TransitProviderId {
  return isInFinland(coordinates) ? 'digitransit' : 'transitous';
}

export function providerForBounds(bounds: TransitBounds): TransitProviderId {
  return providerForPoint([
    (bounds.west + bounds.east) / 2,
    (bounds.south + bounds.north) / 2,
  ]);
}

export function providerForRoute(origin: Coordinate, destination: Coordinate): TransitProviderId {
  return isInFinland(origin) && isInFinland(destination) ? 'digitransit' : 'transitous';
}
