import type { Map as MaplibreMap } from 'maplibre-gl';

const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export type FlightGroundBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Stable ground coverage for flight custom layers. Screen-corner bounds can
 * collapse when pitch and roll put a corner above the horizon, so this view
 * follows the chase target and reserves extra ground in the travel direction.
 */
export function flightGroundBounds(
  map: Pick<MaplibreMap, 'getCenter' | 'getBearing'>,
  radiusMeters: number,
  lookAheadMeters: number,
): FlightGroundBounds {
  const center = map.getCenter();
  const heading = map.getBearing() * DEGREES_TO_RADIANS;
  const latitudeScale = Math.max(0.01, Math.cos(center.lat * DEGREES_TO_RADIANS));
  const longitude = center.lng
    + Math.sin(heading) * lookAheadMeters / (EARTH_RADIUS_METERS * latitudeScale)
      * RADIANS_TO_DEGREES;
  const latitude = center.lat
    + Math.cos(heading) * lookAheadMeters / EARTH_RADIUS_METERS * RADIANS_TO_DEGREES;
  const longitudeRadius = radiusMeters / (EARTH_RADIUS_METERS * latitudeScale)
    * RADIANS_TO_DEGREES;
  const latitudeRadius = radiusMeters / EARTH_RADIUS_METERS * RADIANS_TO_DEGREES;
  return {
    west: longitude - longitudeRadius,
    east: longitude + longitudeRadius,
    south: latitude - latitudeRadius,
    north: latitude + latitudeRadius,
  };
}
