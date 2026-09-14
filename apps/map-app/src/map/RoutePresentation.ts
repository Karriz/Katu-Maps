import type { RouteResult } from './ValhallaRouting';
import { removeIsolatedCoordinateOutliers } from './RouteCamera';

export function isValidCoordinate(coordinate: unknown): coordinate is [number, number] {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

export function routeCoordinates(result: RouteResult): [number, number][] {
  const geometries = [
    result.geometry,
    ...(result.transitLegs?.flatMap((leg) => leg.geometry ? [leg.geometry] : []) ?? []),
  ];
  return geometries.flatMap((geometry) => removeIsolatedCoordinateOutliers(
    geometry.coordinates.filter(isValidCoordinate),
  ));
}

export function mapRouteColor(value?: string) {
  if (!value) return undefined;
  const color = value.trim().replace(/^#/, '');
  return /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? `#${color}` : undefined;
}

export function routeColorForFeature(mode: string | undefined, routeColor?: string): string {
  const normalizedMode = (mode ?? '').toUpperCase();
  if (normalizedMode === 'WALK' || normalizedMode === 'FOOT' || normalizedMode === 'PEDESTRIAN') return '#64748b';
  if (normalizedMode === 'BICYCLE' || normalizedMode === 'BIKE' || normalizedMode === 'CYCLING') return '#16834b';
  if (normalizedMode === 'CAR' || normalizedMode === 'DRIVING') return '#2563eb';
  if (routeColor) return routeColor;
  if (normalizedMode === 'TRAM') return '#8b5cf6';
  if (normalizedMode === 'BUS') return '#1769e8';
  if (normalizedMode === 'SUBWAY') return '#f97316';
  if (normalizedMode === 'RAIL' || normalizedMode === 'REGIONAL_RAIL') return '#16a34a';
  return '#0ea5e9';
}
