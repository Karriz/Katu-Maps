import { digitransitProvider } from './DigitransitProvider';
import { providerForBounds, providerForRoute } from './geography';
import { transitousProvider } from './TransitousProvider';
import type {
  TransitBounds,
  TransitProvider,
  TransitProviderId,
  TransitRouteOptions,
  TransitStopSelection,
} from './types';

export type * from './types';
export { isInFinland, providerForBounds, providerForPoint, providerForRoute } from './geography';

const PROVIDERS: Record<TransitProviderId, TransitProvider> = {
  digitransit: digitransitProvider,
  transitous: transitousProvider,
};

export function transitProviderLabel(provider: TransitProviderId) {
  return PROVIDERS[provider].label;
}

export function fetchTransitStops(bounds: TransitBounds, signal?: AbortSignal) {
  return PROVIDERS[providerForBounds(bounds)].fetchStops(bounds, signal);
}

export function searchTransitStops(query: string, bounds: TransitBounds, signal?: AbortSignal) {
  return PROVIDERS[providerForBounds(bounds)].searchStops(query, bounds, signal);
}

export function fetchTransitDepartures(stop: TransitStopSelection, signal?: AbortSignal) {
  return PROVIDERS[stop.provider].fetchDepartures(stop, signal);
}

export function fetchTransitTrip(
  provider: TransitProviderId,
  tripId: string,
  serviceDate?: string,
  signal?: AbortSignal,
) {
  return PROVIDERS[provider].fetchTrip(tripId, serviceDate, signal);
}

export function fetchProviderTransitRoutes(
  origin: [number, number],
  destination: [number, number],
  options: TransitRouteOptions = {},
) {
  return PROVIDERS[providerForRoute(origin, destination)].fetchRoutes(origin, destination, options);
}
