import { apiHttpError, fetchWithTimeout } from '../ApiRequest';
import { serviceConfig } from '../ServiceConfig';
import type {
  TransitVehicleJourneyIdentity,
  TransitVehicleObservation,
  TransitVehiclePositionProvider,
} from './types';
import { finiteNumber } from './utils';

type DigitrafficTrainLocation = {
  trainNumber?: unknown;
  departureDate?: unknown;
  timestamp?: unknown;
  isGpsLocation?: unknown;
  location?: {
    type?: unknown;
    coordinates?: unknown;
  } | null;
};

function compactDate(serviceDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
    ? serviceDate.replaceAll('-', '')
    : undefined;
}

/** Digitraffic's passenger GTFS trip IDs are `<train number>_<departure date>`. */
export function digitrafficTrainNumber(identity: TransitVehicleJourneyIdentity) {
  if (identity.mode?.trim().toUpperCase() !== 'RAIL' || !identity.serviceDate) return undefined;
  const date = compactDate(identity.serviceDate);
  if (!date) return undefined;
  const unscopedTripId = identity.tripId.includes(':')
    ? identity.tripId.slice(identity.tripId.indexOf(':') + 1)
    : identity.tripId;
  const match = unscopedTripId.match(/^(\d+)_([0-9]{8})$/);
  if (!match || match[2] !== date) return undefined;
  const trainNumber = Number(match[1]);
  return Number.isSafeInteger(trainNumber) && trainNumber > 0 ? trainNumber : undefined;
}

export function isDigitrafficTrainJourney(identity: TransitVehicleJourneyIdentity) {
  return digitrafficTrainNumber(identity) !== undefined;
}

export function normalizeDigitrafficTrainLocations(
  locations: DigitrafficTrainLocation[],
  identity: TransitVehicleJourneyIdentity,
): TransitVehicleObservation[] {
  const trainNumber = digitrafficTrainNumber(identity);
  if (trainNumber === undefined || !identity.serviceDate) return [];
  const serviceDate = identity.serviceDate;
  return locations.flatMap((location): TransitVehicleObservation[] => {
    const coordinates = location.location?.coordinates;
    const recordedAt = typeof location.timestamp === 'string' ? Date.parse(location.timestamp) : NaN;
    if (
      location.trainNumber !== trainNumber
      || location.departureDate !== serviceDate
      || location.isGpsLocation !== true
      || location.location?.type !== 'Point'
      || !Array.isArray(coordinates)
      || !finiteNumber(coordinates[0])
      || !finiteNumber(coordinates[1])
      || coordinates[0] < -180
      || coordinates[0] > 180
      || coordinates[1] < -90
      || coordinates[1] > 90
      || !Number.isFinite(recordedAt)
    ) return [];
    return [{
      provider: 'digitransit',
      tripId: identity.tripId,
      serviceDate,
      coordinates: [coordinates[0], coordinates[1]],
      recordedAt,
      vehicleId: String(trainNumber),
    }];
  });
}

export const digitrafficTrainPositionProvider: TransitVehiclePositionProvider = {
  async fetchObservations(identity, signal) {
    const trainNumber = digitrafficTrainNumber(identity);
    if (trainNumber === undefined) return [];
    const response = await fetchWithTimeout(
      `${serviceConfig.digitrafficRailEndpoint}/train-locations/latest/${trainNumber}`,
      {
        signal,
        headers: {
          Accept: 'application/json',
          'Digitraffic-User': serviceConfig.clientId,
        },
      },
      10_000,
    );
    if (!response.ok) throw apiHttpError(response, 'Digitraffic train positions');
    const payload = await response.json() as unknown;
    return normalizeDigitrafficTrainLocations(Array.isArray(payload) ? payload : [], identity);
  },
};
