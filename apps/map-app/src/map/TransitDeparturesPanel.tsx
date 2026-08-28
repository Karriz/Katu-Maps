import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, BusFront, ChevronRight, LocateFixed, RefreshCw, TrainFront, TrainFrontTunnel, TramFront, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MAP_COLORS } from './MapPalette';
import type { TransitStopSelection } from './TransitStopsLayer';
import {
  fetchTransitDepartures,
  fetchTransitTrip,
  transitProviderLabel,
  type TransitDeparture as Departure,
  type TransitTripPlace as TripPlace,
} from './transit';

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizedColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const color = value.startsWith('#') ? value : `#${value}`;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function modeLabel(mode: string) {
  if (mode === 'TRAM') return 'Tram';
  if (mode === 'BUS') return 'Bus';
  if (mode === 'SUBWAY') return 'Metro';
  return 'Train';
}

function modeIcon(mode: string) {
  if (mode === 'TRAM') return TramFront;
  if (mode === 'BUS') return BusFront;
  if (mode === 'SUBWAY') return TrainFrontTunnel;
  return TrainFront;
}

function modeColor(mode: string) {
  if (mode === 'TRAM') return '#8554c7';
  if (mode === 'BUS') return MAP_COLORS.transitBlue;
  if (mode === 'SUBWAY') return '#e87524';
  return '#4f9b70';
}

function formatDeparture(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatRelativeDeparture(value: string, now: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.ceil((date.getTime() - now) / 60_000);
  if (minutes <= 0) return 'Due';
  if (minutes === 1) return 'in 1 min';
  if (minutes < 60) return `in ${minutes} min`;
  return '';
}

function formatStopStatus(place: TripPlace, index: number, total: number, now: number) {
  const rawValue = index === 0
    ? (place.departure ?? place.scheduledDeparture)
    : (place.arrival ?? place.scheduledArrival);
  const value = typeof rawValue === 'number' ? String(rawValue) : text(rawValue);
  const date = new Date(typeof rawValue === 'number' && rawValue < 10_000_000_000 ? rawValue * 1000 : rawValue as string);
  if (Number.isNaN(date.getTime())) return index === 0 ? 'Board here' : index === total - 1 ? 'Terminus' : 'On route';
  const minutes = Math.ceil((date.getTime() - now) / 60_000);
  if (minutes <= 0) return index === total - 1 ? 'Arrived' : 'Passed';
  if (minutes < 60) return `in ${minutes} min`;
  return formatDeparture(value);
}

export function TransitDeparturesPanel({
  stop,
  onClose,
  onDepartureSelect,
  onDepartureBack,
  onFollowRequest,
  onSetDestination,
  isFollowing,
  onDetailOpenChange,
  navigationBackSignal = 0,
}: {
  stop: TransitStopSelection;
  onClose: () => void;
  onDepartureSelect: (departure: {
    tripId: string;
    mode: string;
    color: string;
    provider: Departure['provider'];
    serviceDate?: string;
    departure: string;
  }) => void;
  onDepartureBack?: () => void;
  onFollowRequest?: () => void;
  onSetDestination?: () => void;
  isFollowing?: boolean;
  onDetailOpenChange?: (open: boolean) => void;
  navigationBackSignal?: number;
}) {
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDepartureKey, setSelectedDepartureKey] = useState<string | null>(null);
  const [selectedDeparture, setSelectedDeparture] = useState<Departure | null>(null);
  const [routeStops, setRouteStops] = useState<TripPlace[]>([]);
  const [routeStopsLoading, setRouteStopsLoading] = useState(false);
  const [routeStopsError, setRouteStopsError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSelectedDepartureKey(null);
    setSelectedDeparture(null);
    setRouteStops([]);
    setShowAll(false);
  }, [stop]);

  useEffect(() => {
    if (!selectedDeparture) return;
    onDepartureBack?.();
    setSelectedDepartureKey(null);
    setSelectedDeparture(null);
  // This signal changes only when browser navigation requests the parent view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationBackSignal]);

  useEffect(() => {
    onDetailOpenChange?.(Boolean(selectedDeparture));
  }, [onDetailOpenChange, selectedDeparture]);

  useEffect(() => {
    if (!selectedDeparture) return;
    const tripId = text(selectedDeparture.tripId);
    if (!tripId) return;
    const controller = new AbortController();
    setRouteStopsLoading(true);
    setRouteStopsError(null);
    fetchTransitTrip(
      selectedDeparture.provider,
      tripId,
      selectedDeparture.serviceDate,
      controller.signal,
    )
      .then((payload) => {
        const stops = payload.legs
          .filter((leg) => String(leg.tripId ?? '') === tripId)
          .flatMap((leg) => [
            leg.from,
            ...(Array.isArray(leg.intermediateStops) ? leg.intermediateStops as TripPlace[] : []),
            leg.to,
          ])
          .filter((place): place is TripPlace => Boolean(place));
        setRouteStops(stops);
      })
      .catch((requestError: unknown) => {
        if ((requestError as { name?: string }).name !== 'AbortError') setRouteStopsError('Route stops are temporarily unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteStopsLoading(false);
      });
    return () => controller.abort();
  }, [selectedDeparture]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDepartures([]);
    fetchTransitDepartures(stop, controller.signal)
      .then(setDepartures)
      .catch((requestError: unknown) => {
        if ((requestError as { name?: string }).name !== 'AbortError') {
          setError('Departures are temporarily unavailable.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [stop, refreshKey]);

  const refresh = () => {
    setRefreshing(true);
    setNow(Date.now());
    setRefreshKey((value) => value + 1);
    window.setTimeout(() => setRefreshing(false), 350);
  };

  const StopIcon = modeIcon(stop.mode);
  const visibleDepartures = showAll ? departures : departures.slice(0, 6);
  const detailMode = selectedDeparture ? text(selectedDeparture.mode, stop.mode) : stop.mode;
  const detailRoute = selectedDeparture
    ? text(selectedDeparture.routeShortName, text(selectedDeparture.displayName, 'Service'))
    : '';
  const detailDestination = selectedDeparture
    ? text(selectedDeparture.headsign, text(selectedDeparture.routeLongName, ''))
    : '';

  if (selectedDeparture) {
    const DetailIcon = modeIcon(detailMode);
    return (
      <aside className="transit-departures-panel transit-trip-panel" aria-label={`${detailRoute} route details`}>
        <header className="transit-panel-header">
          <button className="transit-panel-back" type="button" onClick={() => {
            onDepartureBack?.();
            setSelectedDepartureKey(null);
            setSelectedDeparture(null);
          }}>
            <ArrowLeft aria-hidden="true" />
            <span>All departures</span>
          </button>
          <button className="transit-panel-close" type="button" aria-label="Close departures" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
          <div className="transit-trip-summary">
            <div className="transit-route-badge" style={{ backgroundColor: normalizedColor(selectedDeparture.routeColor, modeColor(detailMode)), color: '#fff' }}>
              {detailRoute}
            </div>
            <div>
              <div className="transit-panel-eyebrow" style={{ color: modeColor(detailMode) }}>
                <DetailIcon aria-hidden="true" />
                <span>{modeLabel(detailMode)} · Live trip</span>
              </div>
              <h2>{detailDestination || 'Route stops'}</h2>
              <div className="transit-panel-status"><span aria-hidden="true" />{isFollowing ? 'Following vehicle' : 'Follow paused · map is under your control'}</div>
              <button className="transit-follow-button" type="button" onClick={onFollowRequest} aria-pressed={isFollowing}>
                <LocateFixed aria-hidden="true" />
                {isFollowing ? 'Following vehicle' : 'Follow vehicle'}
              </button>
            </div>
          </div>
        </header>
        <div className="transit-trip-stop-heading"><strong>Stops on this route</strong><span>{routeStops.length ? `${routeStops.length} stops` : ''}</span></div>
        <div className="transit-route-stop-scroll">
          {routeStopsLoading && <div className="transit-panel-state">Loading route stops…</div>}
          {!routeStopsLoading && routeStopsError && <div className="transit-panel-state error">{routeStopsError}</div>}
          {!routeStopsLoading && !routeStopsError && routeStops.length === 0 && <div className="transit-panel-state">No route stops found.</div>}
          {!routeStopsLoading && !routeStopsError && routeStops.map((routeStop, index) => {
            const name = text(routeStop.name, text(routeStop.stopName, `Stop ${index + 1}`));
            const rawTime = index === 0
              ? (routeStop.departure ?? routeStop.scheduledDeparture)
              : (routeStop.arrival ?? routeStop.scheduledArrival);
            const stopTime = typeof rawTime === 'number'
              ? (rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime)
              : new Date(text(rawTime)).getTime();
            const passed = Number.isFinite(stopTime) && stopTime <= now;
            return <div className={cn('transit-route-stop', index === 0 && 'first', index === routeStops.length - 1 && 'last', passed && 'passed')} key={`${name}-${index}`}>
              <span className="transit-route-stop-marker" aria-hidden="true" />
              <div><strong>{name}</strong><span>{index === 0 ? 'Board here' : index === routeStops.length - 1 ? 'Terminus' : 'On route'}</span></div>
              <time dateTime={text(routeStop.arrival, text(routeStop.departure))}>{formatStopStatus(routeStop, index, routeStops.length, now)}</time>
            </div>;
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="transit-departures-panel" aria-label={`Departures from ${stop.name}`}>
      <header className="transit-panel-header">
        <div className="transit-panel-eyebrow" style={{ color: modeColor(stop.mode) }}>
          <StopIcon aria-hidden="true" />
          <span>Departures</span>
        </div>
        <button className="transit-panel-close" type="button" aria-label="Close departures" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <h2>{stop.name}</h2>
        <div className="transit-panel-status">
          <span aria-hidden="true" />
          Live timetable from {transitProviderLabel(stop.provider)}
        </div>
        <button className="transit-stop-destination-button" type="button" onClick={onSetDestination}>
          Use this stop as destination
        </button>
        <button className="transit-panel-refresh" type="button" aria-label="Refresh departures" onClick={refresh}>
          <RefreshCw className={refreshing ? 'spinning' : ''} aria-hidden="true" />
        </button>
      </header>

      <div className="transit-panel-section-heading">
        <strong>Next departures</strong>
        <span>{departures.length ? `${departures.length} services` : 'Live services'}</span>
      </div>

      <div className="transit-departure-scroll">
        {loading && <div className="transit-panel-state">Loading departures…</div>}
        {!loading && error && <div className="transit-panel-state error">{error}</div>}
        {!loading && !error && departures.length === 0 && <div className="transit-panel-state">No upcoming departures found.</div>}
        <div className="transit-departure-list">
          {!loading && !error && visibleDepartures.map((departure, index) => {
            const mode = text(departure.mode, stop.mode);
            const Icon = modeIcon(mode);
            const routeId = text(departure.routeId);
            const tripId = text(departure.tripId);
            const route = text(departure.routeShortName, text(departure.displayName, '—'));
            const destination = text(departure.headsign, text(departure.routeLongName, ''));
            const routeColor = mode === 'SUBWAY'
              ? modeColor(mode)
              : normalizedColor(departure.routeColor, modeColor(mode));
            const routeTextColor = normalizedColor(departure.routeTextColor, '#ffffff');
            const departureKey = `${departure.departure}-${tripId || routeId}-${index}`;
            const selected = selectedDepartureKey === departureKey;
            const cancelled = departure.cancelled === true;
            const relativeDeparture = formatRelativeDeparture(departure.departure, now);
            const cardStyle = {
              '--route-color': routeColor,
              '--route-soft': `${routeColor}12`,
            } as CSSProperties;
            return (
              <button
                aria-pressed={selected}
                className={cn('transit-departure-card', selected && 'selected', cancelled && 'cancelled')}
                disabled={!tripId || cancelled}
                key={departureKey}
                onClick={() => {
                  if (!tripId) return;
                  setSelectedDepartureKey(departureKey);
                  setSelectedDeparture(departure);
                  onDepartureSelect({
                    tripId,
                    mode,
                    color: routeColor,
                    provider: departure.provider,
                    serviceDate: departure.serviceDate,
                    departure: departure.departure,
                  });
                }}
                style={cardStyle}
                type="button"
              >
                <div className="transit-route-badge" style={{ backgroundColor: routeColor, color: routeTextColor }}>
                  {route}
                </div>
                <div className="transit-departure-copy">
                  <strong>{destination || 'Service'}</strong>
                  <span><Icon aria-hidden="true" />{cancelled ? 'Cancelled' : modeLabel(mode)}</span>
                </div>
                <div className="transit-departure-time">
                  {relativeDeparture && <span>{cancelled ? 'Cancelled' : relativeDeparture}</span>}
                  <strong>{formatDeparture(departure.departure)}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {departures.length > 6 && (
        <footer className="transit-panel-footer">
          <button type="button" onClick={() => setShowAll((current) => !current)}>
            {showAll ? 'Show fewer departures' : 'View all departures'}
            <ChevronRight className={showAll ? 'expanded' : ''} aria-hidden="true" />
          </button>
        </footer>
      )}
    </aside>
  );
}
