import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { LiveVehicle } from './LiveVehicles';
import { fetchTransitTrip } from './transit';
import { fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';

type Stop = { name: string; time?: string };

async function trainStops(vehicle: LiveVehicle, signal: AbortSignal): Promise<Stop[]> {
  const number = Number(vehicle.tripId?.split('_')[0].replace(/^digitraffic:/, ''));
  if (!Number.isSafeInteger(number) || !vehicle.serviceDate) return [];
  const response = await fetchWithTimeout(
    `${serviceConfig.digitrafficRailEndpoint}/trains/${vehicle.serviceDate}/${number}`,
    { signal, headers: { 'Digitraffic-User': serviceConfig.clientId } },
    10_000,
  );
  if (!response.ok) throw new Error('Train timetable is unavailable.');
  const payload = await response.json() as Array<{ operatorShortCode?: string; commuterLineID?: string; trainType?: string; timeTableRows?: Array<{ stationShortCode?: string; type?: string; commercialStop?: boolean; scheduledTime?: string; liveEstimateTime?: string; actualTime?: string }> }>;
  const rows = (payload[0]?.timeTableRows ?? []).filter((row) => row.commercialStop === true);
  const stationResponse = await fetchWithTimeout(`${serviceConfig.digitrafficRailEndpoint}/metadata/stations`, {
    signal, headers: { 'Digitraffic-User': serviceConfig.clientId },
  }, 10_000);
  const stations = stationResponse.ok
    ? await stationResponse.json() as Array<{ stationShortCode?: string; stationName?: string }>
    : [];
  const names = new Map(stations.map((station) => [station.stationShortCode, station.stationName]));
  return rows.filter((row, index) => index === 0 || row.stationShortCode !== rows[index - 1].stationShortCode)
    .map((row) => ({ name: names.get(row.stationShortCode) ?? row.stationShortCode ?? 'Station', time: row.actualTime ?? row.liveEstimateTime ?? row.scheduledTime }));
}

export function LiveVehiclePanel({ vehicle, following, onFollow, onClose }: {
  vehicle: LiveVehicle;
  following: boolean;
  onFollow: () => void;
  onClose: () => void;
}) {
  const [stops, setStops] = useState<Stop[]>([]);
  const [status, setStatus] = useState('Loading trip stops…');
  useEffect(() => {
    const controller = new AbortController();
    setStops([]);
    setStatus('Loading trip stops…');
    const load = vehicle.stops?.length ? Promise.resolve(vehicle.stops)
      : vehicle.provider === 'digitraffic'
      ? trainStops(vehicle, controller.signal)
      : vehicle.tripId && vehicle.serviceDate
        ? fetchTransitTrip('digitransit', vehicle.tripId, vehicle.serviceDate, controller.signal)
          .then((trip) => trip.legs.flatMap((leg) => [leg.from, ...leg.intermediateStops ?? [], leg.to])
            .filter((place): place is NonNullable<typeof place> => Boolean(place))
            .map((place) => ({ name: place.name ?? place.stopName ?? 'Stop', time: String(place.departure ?? place.arrival ?? '') })))
        : Promise.resolve([]);
    void load.then((result) => {
      if (controller.signal.aborted) return;
      setStops(result);
      setStatus(result.length ? '' : 'Stop list is not available for this live feed.');
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('Trip stops could not be loaded.');
    });
    return () => controller.abort();
  }, [vehicle.id, vehicle.tripId, vehicle.serviceDate, vehicle.provider, vehicle.stops]);

  return <aside className="transit-departures-panel live-vehicle-panel mobile-bottom-sheet" aria-label={`${vehicle.route} live vehicle details`}>
    <header className="transit-panel-header">
      <button className="transit-panel-close" type="button" aria-label="Close live vehicle details" onClick={onClose}><X aria-hidden="true" /></button>
      <div className="transit-panel-eyebrow">Live {vehicle.kind} · {vehicle.provider === 'digitraffic' ? 'Digitraffic' : vehicle.provider.toUpperCase()}</div>
      <h2>{vehicle.route}{vehicle.destination ? ` · ${vehicle.destination}` : ''}</h2>
      <div className="transit-panel-status">Position updated {Math.max(0, Math.round((Date.now() - vehicle.recordedAt) / 1000))} seconds ago</div>
      <button className="transit-follow-button" type="button" aria-pressed={following} onClick={onFollow}>{following ? 'Following vehicle' : 'Follow vehicle'}</button>
    </header>
    <div className="live-vehicle-stops">
      <strong>Trip stops</strong>
      {status && <p>{status}</p>}
      {stops.length > 0 && <ol>{stops.map((stop, index) => <li key={`${stop.name}-${index}`}>
        <span>{stop.name}</span>
        {stop.time && Number.isFinite(Date.parse(stop.time)) && <time dateTime={stop.time}>{new Date(stop.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
      </li>)}</ol>}
    </div>
  </aside>;
}
