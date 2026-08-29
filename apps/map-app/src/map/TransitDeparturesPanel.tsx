import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, BusFront, ChevronRight, LocateFixed, RefreshCw, Star, TrainFront, TrainFrontTunnel, TramFront, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import type { TransitStopSelection } from './TransitStopsLayer';
import {
  fetchTransitDepartures,
  fetchTransitTrip,
  transitProviderLabel,
  type TransitDeparture as Departure,
  type TransitTripPlace as TripPlace,
} from './transit';
import { resolveSelectedTripResult } from './transit/tripTimeline';

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

function tripPlaceDepartureTime(place: TripPlace) {
  const raw = place.departure ?? place.scheduledDeparture ?? place.arrival ?? place.scheduledArrival;
  if (typeof raw === 'number') return raw < 10_000_000_000 ? raw * 1000 : raw;
  const parsed = new Date(text(raw)).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatStopStatus(
  place: TripPlace,
  index: number,
  total: number,
  now: number,
  boardingDeparture?: string,
) {
  const rawValue = boardingDeparture ?? (index === 0
    ? (place.departure ?? place.scheduledDeparture)
    : (place.arrival ?? place.scheduledArrival));
  const value = typeof rawValue === 'number' ? String(rawValue) : text(rawValue);
  const date = new Date(typeof rawValue === 'number' && rawValue < 10_000_000_000 ? rawValue * 1000 : rawValue as string);
  if (Number.isNaN(date.getTime())) return index === 0 ? 'Board here' : index === total - 1 ? 'Terminus' : 'On route';
  const minutes = Math.ceil((date.getTime() - now) / 60_000);
  if (minutes <= 0) return index === total - 1 ? 'Arrived' : 'Passed';
  if (minutes < 60) return `in ${minutes} min`;
  return formatDeparture(value);
}

export function selectedRouteStopIndex(
  routeStops: TripPlace[],
  selectedStopId: string,
  selectedDeparture?: string,
) {
  const candidates = routeStops.flatMap((routeStop, index) => (
    routeStop.stopId === selectedStopId || routeStop.parentStopId === selectedStopId ? [index] : []
  ));
  const selectedTime = selectedDeparture ? new Date(selectedDeparture).getTime() : NaN;
  if (candidates.length < 2 || !Number.isFinite(selectedTime)) return candidates[0] ?? -1;
  return candidates.reduce((closest, candidate) => {
    const closestTime = tripPlaceDepartureTime(routeStops[closest]);
    const candidateTime = tripPlaceDepartureTime(routeStops[candidate]);
    if (candidateTime === undefined) return closest;
    if (closestTime === undefined) return candidate;
    return Math.abs(candidateTime - selectedTime) < Math.abs(closestTime - selectedTime)
      ? candidate
      : closest;
  });
}

export function TransitDeparturesPanel({
  stop,
  onClose,
  onDepartureSelect,
  onDepartureBack,
  onFollowRequest,
  onSetDestination,
  onSaveFavorite,
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
    scheduledDeparture?: string;
  }) => void;
  onDepartureBack?: () => void;
  onFollowRequest?: () => void;
  onSetDestination?: () => void;
  onSaveFavorite?: () => void;
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
  const routeStopScrollRef = useRef<HTMLDivElement>(null);
  const selectedRouteStopRef = useRef<HTMLDivElement>(null);
  const hasPositionedRouteRef = useRef(false);
  const sheet = useMobileBottomSheet('half');

  useEffect(() => {
    hasPositionedRouteRef.current = false;
    setSelectedDepartureKey(null);
    setSelectedDeparture(null);
    setRouteStops([]);
    setShowAll(false);
  }, [stop]);

  useLayoutEffect(() => {
    if (hasPositionedRouteRef.current || routeStopsLoading || routeStopsError) return;
    const scrollContainer = routeStopScrollRef.current;
    const selectedRow = selectedRouteStopRef.current;
    if (!scrollContainer || !selectedRow) return;

    // Leave context above the boarding stop and upcoming calls below it without
    // moving the page or map behind the route panel.
    const contextAboveSelectedStop = 16;
    scrollContainer.scrollTop = Math.max(
      0,
      selectedRow.offsetTop - scrollContainer.offsetTop - contextAboveSelectedStop,
    );
    hasPositionedRouteRef.current = true;
  }, [routeStops, routeStopsError, routeStopsLoading, selectedDepartureKey, stop.stopId]);

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
        const resolution = resolveSelectedTripResult(payload, {
          tripId,
          provider: selectedDeparture.provider,
          serviceDate: selectedDeparture.serviceDate,
          boardingStopId: stop.stopId,
          scheduledDeparture: selectedDeparture.scheduledDeparture,
        });
        if (!resolution.ok) {
          console.warn('Selected trip could not be resolved.', { provider: selectedDeparture.provider, reason: resolution.reason });
          setRouteStops([]);
          setRouteStopsError('Live trip details are temporarily unavailable.');
          return;
        }
        const resolved = resolution.trip;
        setRouteStops(resolved.stops);
      })
      .catch((requestError: unknown) => {
        if ((requestError as { name?: string }).name !== 'AbortError') setRouteStopsError('Route stops are temporarily unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteStopsLoading(false);
      });
    return () => controller.abort();
  }, [selectedDeparture, stop.stopId]);

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
  const boardingStopIndex = selectedRouteStopIndex(
    routeStops,
    stop.stopId,
    selectedDeparture?.departure,
  );

  if (selectedDeparture) {
    const DetailIcon = modeIcon(detailMode);
    return (
      <aside className={cn("transit-departures-panel transit-trip-panel mobile-bottom-sheet", sheet.dragging && "is-dragging")} style={sheet.style} data-snap={sheet.snap} aria-label={`${detailRoute} route details`}>
        <header className="transit-panel-header mobile-sheet-header" {...sheet.handleProps}>
          <button className="transit-panel-back" type="button" onClick={() => {
            onDepartureBack?.();
            hasPositionedRouteRef.current = false;
            setSelectedDepartureKey(null);
            setSelectedDeparture(null);
            setRouteStops([]);
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
              <div className="transit-panel-status"><span aria-hidden="true" />{routeStopsError ? 'Validated live timeline unavailable' : isFollowing ? 'Following estimated vehicle' : 'Estimated position · follow paused'}</div>
              <button className="transit-follow-button" disabled={Boolean(routeStopsError)} type="button" onClick={onFollowRequest} aria-pressed={isFollowing}>
                <LocateFixed aria-hidden="true" />
                {isFollowing ? 'Following vehicle' : 'Follow vehicle'}
              </button>
            </div>
          </div>
        </header>
        <div className="transit-trip-stop-heading"><strong>Stops on this route</strong><span>{routeStops.length ? `${routeStops.length} stops` : ''}</span></div>
        <div className="transit-route-stop-scroll" ref={routeStopScrollRef}>
          {routeStopsLoading && <div className="transit-panel-state">Loading route stops…</div>}
          {!routeStopsLoading && routeStopsError && <div className="transit-panel-state error">{routeStopsError}</div>}
          {!routeStopsLoading && !routeStopsError && routeStops.length === 0 && <div className="transit-panel-state">No route stops found.</div>}
          {!routeStopsLoading && !routeStopsError && routeStops.map((routeStop, index) => {
            const isSelectedStop = index === boardingStopIndex;
            const name = text(routeStop.name, text(routeStop.stopName, `Stop ${index + 1}`));
            const rawTime = isSelectedStop
              ? selectedDeparture.departure
              : index === 0
              ? (routeStop.departure ?? routeStop.scheduledDeparture)
              : (routeStop.arrival ?? routeStop.scheduledArrival);
            const stopTime = typeof rawTime === 'number'
              ? (rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime)
              : new Date(text(rawTime)).getTime();
            const passed = Number.isFinite(stopTime) && stopTime <= now;
            return <div
              aria-current={isSelectedStop ? 'location' : undefined}
              className={cn('transit-route-stop', index === 0 && 'first', index === routeStops.length - 1 && 'last', passed && 'passed', isSelectedStop && 'selected')}
              key={`${text(routeStop.stopId, name)}-${index}`}
              ref={isSelectedStop ? selectedRouteStopRef : undefined}
            >
              <span className="transit-route-stop-marker" aria-hidden="true" />
              <div><strong>{name}</strong><span>{isSelectedStop ? 'Board here' : index === routeStops.length - 1 ? 'Terminus' : 'On route'}</span></div>
              <time dateTime={text(rawTime)}>{formatStopStatus(
                routeStop,
                index,
                routeStops.length,
                now,
                isSelectedStop ? selectedDeparture.departure : undefined,
              )}</time>
            </div>;
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className={cn("transit-departures-panel mobile-bottom-sheet", sheet.dragging && "is-dragging")} style={sheet.style} data-snap={sheet.snap} aria-label={`Departures from ${stop.name}`}>
      <header className="transit-panel-header mobile-sheet-header" {...sheet.handleProps}>
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
        <button className="transit-stop-destination-button favorite-save-button" type="button" onClick={onSaveFavorite}>
          <Star aria-hidden="true" /> Save favourite
        </button>
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
                  hasPositionedRouteRef.current = false;
                  setRouteStops([]);
                  setSelectedDepartureKey(departureKey);
                  setSelectedDeparture(departure);
                  onDepartureSelect({
                    tripId,
                    mode,
                    color: routeColor,
                    provider: departure.provider,
                    serviceDate: departure.serviceDate,
                    departure: departure.departure,
                    scheduledDeparture: departure.scheduledDeparture,
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
