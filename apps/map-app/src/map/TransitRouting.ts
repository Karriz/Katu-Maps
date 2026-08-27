import {
  fetchProviderTransitRoutes,
  type TransitRouteOptions,
  type TransitRouteResult,
} from './transit';

export type { TransitRouteResult } from './transit';

export function fetchTransitRoutes(
  origin: [number, number],
  destination: [number, number],
  options: TransitRouteOptions = {},
): Promise<TransitRouteResult[]> {
  return fetchProviderTransitRoutes(origin, destination, options);
}
