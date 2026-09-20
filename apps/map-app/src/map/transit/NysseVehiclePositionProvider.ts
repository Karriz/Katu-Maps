import { fetchWithTimeout, apiHttpError } from '../ApiRequest';
import { serviceConfig } from '../ServiceConfig';
import type {
  TransitVehicleJourneyDescriptor,
  TransitVehicleJourneyIdentity,
  TransitVehicleObservation,
  TransitVehiclePositionProvider,
} from './types';
import { finiteNumber } from './utils';
import { matchVehicleJourneyDescriptor } from './vehiclePosition';

type NysseValue = { value?: unknown } | null;

type NysseVehicleActivity = {
  RecordedAtTime?: unknown;
  MonitoredVehicleJourney?: {
    LineRef?: NysseValue;
    DirectionRef?: NysseValue;
    FramedVehicleJourneyRef?: {
      DataFrameRef?: NysseValue;
      DatedVehicleJourneyRef?: unknown;
    } | null;
    VehicleLocation?: { Longitude?: unknown; Latitude?: unknown } | null;
    Bearing?: unknown;
    VehicleRef?: NysseValue;
  } | null;
};

type NyssePayload = {
  Siri?: {
    ServiceDelivery?: {
      VehicleMonitoringDelivery?: Array<{ VehicleActivity?: NysseVehicleActivity[] }>;
    };
  };
};

function text(value: unknown) {
  if (typeof value === 'string' && value) return value;
  return finiteNumber(value) ? String(value) : undefined;
}

/** Convert an absolute scheduled departure to Nysse's service-day HHmm reference. */
export function nysseJourneyReference(scheduledStartTime: string, serviceDate: string) {
  const instant = new Date(scheduledStartTime);
  if (!Number.isFinite(instant.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = Number(part('hour'));
  const minute = part('minute');
  if (!year || !month || !day || !Number.isFinite(hour) || !minute) return undefined;
  const serviceDay = Date.parse(`${serviceDate}T00:00:00Z`);
  const localDay = Date.parse(`${year}-${month}-${day}T00:00:00Z`);
  const dayOffset = Math.round((localDay - serviceDay) / 86_400_000);
  const serviceHour = hour + dayOffset * 24;
  if (serviceHour < 0 || serviceHour > 47) return undefined;
  return `${String(serviceHour).padStart(2, '0')}${minute}`;
}

type NysseCandidate = TransitVehicleJourneyDescriptor & {
  observation: TransitVehicleObservation;
};

export function normalizeNysseVehicleObservations(
  payload: NyssePayload,
  identity: TransitVehicleJourneyIdentity,
) {
  if (
    !identity.serviceDate
    || !identity.routeId?.startsWith('tampere:')
    || !identity.directionId
    || !identity.scheduledStartTime
  ) return [];
  const scheduledStartTime = identity.scheduledStartTime;
  const journeyReference = nysseJourneyReference(scheduledStartTime, identity.serviceDate);
  if (!journeyReference) return [];
  const activities = payload.Siri?.ServiceDelivery?.VehicleMonitoringDelivery
    ?.flatMap((delivery) => delivery.VehicleActivity ?? []) ?? [];
  const candidates = activities.flatMap((activity): NysseCandidate[] => {
    const journey = activity.MonitoredVehicleJourney;
    const routeId = text(journey?.LineRef?.value);
    const directionId = text(journey?.DirectionRef?.value);
    const serviceDate = text(journey?.FramedVehicleJourneyRef?.DataFrameRef?.value);
    const datedJourneyRef = text(journey?.FramedVehicleJourneyRef?.DatedVehicleJourneyRef);
    const longitude = journey?.VehicleLocation?.Longitude;
    const latitude = journey?.VehicleLocation?.Latitude;
    const recordedAtValue = activity.RecordedAtTime;
    const recordedAt = finiteNumber(recordedAtValue)
      ? recordedAtValue < 10_000_000_000 ? recordedAtValue * 1000 : recordedAtValue
      : typeof recordedAtValue === 'string' ? Date.parse(recordedAtValue) : NaN;
    if (
      !routeId
      || !directionId
      || !serviceDate
      || datedJourneyRef !== journeyReference
      || !finiteNumber(longitude)
      || !finiteNumber(latitude)
      || !Number.isFinite(recordedAt)
    ) return [];
    return [{
      serviceDate,
      routeId: `tampere:${routeId}`,
      directionId,
      scheduledStartTime,
      observation: {
        provider: 'digitransit',
        tripId: identity.tripId,
        serviceDate,
        coordinates: [longitude, latitude],
        recordedAt,
        heading: finiteNumber(journey?.Bearing) ? journey.Bearing : undefined,
        vehicleId: text(journey?.VehicleRef?.value),
      },
    }];
  });
  const matching = matchVehicleJourneyDescriptor(candidates, identity);
  return matching ? [matching.observation] : [];
}

export const nysseVehiclePositionProvider: TransitVehiclePositionProvider = {
  async fetchObservations(identity, signal) {
    const response = await fetchWithTimeout(serviceConfig.nysseVehiclePositionsEndpoint, {
      signal,
      headers: { Accept: 'application/json' },
    }, 10_000);
    if (!response.ok) throw apiHttpError(response, 'Nysse vehicle positions');
    const payload = await response.json() as NyssePayload;
    return normalizeNysseVehicleObservations(payload, identity);
  },
};
