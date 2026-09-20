import { serviceConfig } from '../ServiceConfig';
import type { TransitVehicleJourneyIdentity, TransitVehicleObservation, TransitVehiclePositionProvider } from './types';
import { finiteNumber } from './utils';

type HfpPosition = {
  lat?: unknown; long?: unknown; hdg?: unknown; tst?: unknown; veh?: unknown;
  route?: unknown; dir?: unknown; start?: unknown; oday?: unknown;
};
type HfpPayload = { VP?: HfpPosition };

function unscoped(value: string) {
  return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;
}

function hslStartTime(value: string, serviceDate: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const time = `${parts.find((p) => p.type === 'hour')?.value}:${parts.find((p) => p.type === 'minute')?.value}`;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
  return day === serviceDate ? time : undefined;
}

export function normalizeHslPosition(payload: HfpPayload, identity: TransitVehicleJourneyIdentity) {
  const position = payload.VP;
  if (!position || !identity.routeId || !identity.directionId || !identity.scheduledStartTime || !identity.serviceDate) return [];
  const start = hslStartTime(identity.scheduledStartTime, identity.serviceDate);
  const recordedAt = typeof position.tst === 'string' ? Date.parse(position.tst) : NaN;
  if (
    position.route !== unscoped(identity.routeId)
    || String(position.dir ?? '') !== String(Number(identity.directionId) + 1)
    || position.start !== start
    || position.oday !== identity.serviceDate
    || !finiteNumber(position.long)
    || !finiteNumber(position.lat)
    || !Number.isFinite(recordedAt)
  ) return [];
  return [{
    provider: 'digitransit' as const, tripId: identity.tripId, serviceDate: identity.serviceDate,
    coordinates: [position.long, position.lat] as [number, number], recordedAt,
    heading: finiteNumber(position.hdg) ? position.hdg : undefined,
    vehicleId: typeof position.veh === 'number' || typeof position.veh === 'string' ? String(position.veh) : undefined,
  }];
}

function topicFor(identity: TransitVehicleJourneyIdentity) {
  if (!identity.routeId?.startsWith('HSL:') || !identity.directionId || !identity.scheduledStartTime || !identity.serviceDate) return undefined;
  const start = hslStartTime(identity.scheduledStartTime, identity.serviceDate);
  if (!start) return undefined;
  return `/hfp/v2/journey/ongoing/vp/+/+/+/${unscoped(identity.routeId)}/${Number(identity.directionId) + 1}/+/${start}/#`;
}

export const hslVehiclePositionProvider: TransitVehiclePositionProvider = {
  async fetchObservations(identity, signal) {
    const topic = topicFor(identity);
    if (!topic) return [];
    const { default: mqtt } = await import('mqtt');
    const client = await mqtt.connectAsync(serviceConfig.hslMqttEndpoint, {
      protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 5_000,
    });
    try {
      await client.subscribeAsync(topic, { qos: 0 });
      return await new Promise<TransitVehicleObservation[]>((resolve) => {
        const finish = (observations: TransitVehicleObservation[]) => {
          clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(observations);
        };
        const timer = setTimeout(() => finish([]), 3_000);
        const abort = () => finish([]);
        signal?.addEventListener('abort', abort, { once: true });
        client.on('message', (_topic, message) => {
          try {
            const observations = normalizeHslPosition(JSON.parse(message.toString()) as HfpPayload, identity);
            if (observations.length) finish(observations);
          } catch { /* Ignore malformed broker messages. */ }
        });
      });
    } finally {
      await client.endAsync();
    }
  },
};
