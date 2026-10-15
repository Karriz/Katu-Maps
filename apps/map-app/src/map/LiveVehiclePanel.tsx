import { useEffect, useState } from 'react';
import { LocateFixed, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import type { LiveVehicle } from './LiveVehicles';
import { fetchTransitTrip } from './transit';
import { fetchWithTimeout } from './ApiRequest';
import { serviceConfig } from './ServiceConfig';
import { MAP_COLORS } from './MapPalette';

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
  const sheet = useMobileBottomSheet('half');
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

  const color = vehicle.color ?? ({ bus: MAP_COLORS.transitBlue, tram: '#8554c7', metro: '#e87524', train: '#21845b' })[vehicle.kind];
  const now = Date.now();
  return <aside className={cn('transit-departures-panel transit-trip-panel live-vehicle-panel mobile-bottom-sheet', sheet.dragging && 'is-dragging')} style={sheet.style} data-snap={sheet.snap} aria-label={`${vehicle.route} live vehicle details`}>
    <MobileSheetHandle {...sheet} closeLabel="Close live vehicle details" onClose={onClose} />
    <header className="transit-panel-header mobile-sheet-header" {...sheet.handleProps}>
      <div className="transit-panel-actions">
        <button className="transit-panel-close" type="button" aria-label="Close live vehicle details" onClick={onClose}><X aria-hidden="true" /></button>
      </div>
      <div className="transit-trip-summary">
        <div className="transit-route-badge" style={{ backgroundColor: color, color: '#fff' }}>{vehicle.route}</div>
        <div>
          <h2>{vehicle.destination || `${vehicle.kind[0].toUpperCase()}${vehicle.kind.slice(1)} service`}</h2>
          <div className="transit-panel-status"><span aria-hidden="true" />Live position · updated {Math.max(0, Math.round((now - vehicle.recordedAt) / 1000))}s ago</div>
          <button className="transit-follow-button" type="button" aria-pressed={following} onClick={onFollow}>
            <LocateFixed aria-hidden="true" />
            {following ? 'Following live vehicle' : 'Follow live vehicle'}
          </button>
        </div>
      </div>
    </header>
    <div className="transit-trip-stop-heading"><strong>Stops on this route</strong><span>{stops.length ? `${stops.length} stops` : ''}</span></div>
    <div className="transit-route-stop-scroll">
      {status && <div className={cn('transit-panel-state', status.includes('could not') && 'error')}>{status}</div>}
      {stops.map((stop, index) => {
        const stopTime = stop.time ? Date.parse(stop.time) : NaN;
        const passed = Number.isFinite(stopTime) && stopTime <= now;
        return <div className={cn('transit-route-stop', index === 0 && 'first', index === stops.length - 1 && 'last', passed && 'passed')} key={`${stop.name}-${index}`}>
          <span className="transit-route-stop-marker" aria-hidden="true" />
          <div><strong>{stop.name}</strong><span>{index === 0 ? 'Origin' : index === stops.length - 1 ? 'Terminus' : passed ? 'Passed' : 'On route'}</span></div>
          {stop.time && Number.isFinite(stopTime) && <time dateTime={stop.time}>{new Date(stopTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
        </div>;
      })}
    </div>
  </aside>;
}
