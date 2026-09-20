import { apiHttpError, fetchWithTimeout } from '../ApiRequest';
import { serviceConfig } from '../ServiceConfig';
import type { TransitVehicleJourneyIdentity, TransitVehicleObservation, TransitVehiclePositionProvider } from './types';
import { finiteNumber } from './utils';

type FoliVehicle = {
  recordedattime?: unknown; longitude?: unknown; latitude?: unknown; vehicleref?: unknown;
  originaimeddeparturetime?: unknown; __routeref?: unknown; __directionid?: unknown;
};
type FoliPayload = { result?: { vehicles?: Record<string, FoliVehicle> } };

function unscoped(value: string) {
  return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;
}

export function normalizeFoliVehicleObservations(payload: FoliPayload, identity: TransitVehicleJourneyIdentity) {
  if (!identity.routeId || !identity.directionId || !identity.scheduledStartTime || !identity.serviceDate) return [];
  const tripId = identity.tripId;
  const serviceDate = identity.serviceDate;
  const scheduledStart = Date.parse(identity.scheduledStartTime);
  if (!Number.isFinite(scheduledStart)) return [];
  const routeId = unscoped(identity.routeId);
  const candidates = Object.values(payload.result?.vehicles ?? {}).flatMap((vehicle): TransitVehicleObservation[] => {
    const recordedAt = finiteNumber(vehicle.recordedattime) ? vehicle.recordedattime * 1000 : NaN;
    const origin = finiteNumber(vehicle.originaimeddeparturetime) ? vehicle.originaimeddeparturetime * 1000 : NaN;
    if (
      String(vehicle.__routeref ?? '') !== routeId
      || String(vehicle.__directionid ?? '') !== identity.directionId
      || origin !== scheduledStart
      || !finiteNumber(vehicle.longitude)
      || !finiteNumber(vehicle.latitude)
      || !Number.isFinite(recordedAt)
    ) return [];
    return [{
      provider: 'digitransit', tripId, serviceDate,
      coordinates: [vehicle.longitude, vehicle.latitude], recordedAt,
      vehicleId: typeof vehicle.vehicleref === 'string' ? vehicle.vehicleref : undefined,
    }];
  });
  return candidates.length === 1 ? candidates : [];
}

export const foliVehiclePositionProvider: TransitVehiclePositionProvider = {
  async fetchObservations(identity, signal) {
    const response = await fetchWithTimeout(serviceConfig.foliVehiclePositionsEndpoint, {
      signal, headers: { Accept: 'application/json' },
    }, 10_000);
    if (!response.ok) throw apiHttpError(response, 'Föli vehicle positions');
    return normalizeFoliVehicleObservations(await response.json() as FoliPayload, identity);
  },
};
