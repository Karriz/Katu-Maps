import {
  digitransitProvider,
  digitransitVehiclePositionProvider,
  fetchDigitransitRoute,
} from './DigitransitProvider';
import { providerForBounds, providerForRoute } from './geography';
import { nysseVehiclePositionProvider } from './NysseVehiclePositionProvider';
import { digitrafficTrainPositionProvider, isDigitrafficTrainJourney } from './DigitrafficTrainPositionProvider';
import { foliVehiclePositionProvider } from './FoliVehiclePositionProvider';
import { hslVehiclePositionProvider } from './HslVehiclePositionProvider';
import { transitousProvider } from './TransitousProvider';
import type {
  TransitBounds,
  TransitProvider,
  TransitProviderId,
  TransitRouteOptions,
  TransitStopSelection,
  TransitVehicleJourneyIdentity,
  TransitVehiclePositionProvider,
} from './types';

export type * from './types';
export { isInFinland, providerForBounds, providerForPoint, providerForRoute } from './geography';
export { resolveJourneyVehicleLegs, journeyVehicleKey } from './journeyVehicles';

const PROVIDERS: Record<TransitProviderId, TransitProvider> = {
  digitransit: digitransitProvider,
  transitous: transitousProvider,
};

const VEHICLE_POSITION_PROVIDERS: Partial<Record<TransitProviderId, TransitVehiclePositionProvider>> = {
  digitransit: {
    fetchObservations(identity, signal) {
      if (identity.routeId?.startsWith('tampere:')) {
        return nysseVehiclePositionProvider.fetchObservations(identity, signal);
      }
      if (identity.routeId?.startsWith('HSL:')) {
        return hslVehiclePositionProvider.fetchObservations(identity, signal);
      }
      if (identity.routeId?.toUpperCase().startsWith('FOLI:')) {
        return foliVehiclePositionProvider.fetchObservations(identity, signal);
      }
      if (isDigitrafficTrainJourney(identity)) {
        return digitrafficTrainPositionProvider.fetchObservations(identity, signal);
      }
      return digitransitVehiclePositionProvider.fetchObservations(identity, signal);
    },
  },
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

export function fetchTransitVehicleObservations(
  identity: TransitVehicleJourneyIdentity,
  signal?: AbortSignal,
) {
  return VEHICLE_POSITION_PROVIDERS[identity.provider]?.fetchObservations(identity, signal)
    ?? Promise.resolve([]);
}

export function fetchProviderTransitRoutes(
  origin: [number, number],
  destination: [number, number],
  options: TransitRouteOptions = {},
) {
  return PROVIDERS[providerForRoute(origin, destination)].fetchRoutes(origin, destination, options);
}

export { fetchDigitransitRoute };
