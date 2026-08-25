import { useEffect, useState, type CSSProperties } from 'react';
import { BusFront, ChevronRight, RefreshCw, TrainFront, TrainFrontTunnel, TramFront, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { MAP_COLORS } from './MapPalette';
import type { TransitStopSelection } from './TransitStopsLayer';

const STOP_TIMES_API_URL = 'https://api.transitous.org/api/v6/stoptimes';

type StopTime = {
  mode?: unknown;
  routeId?: unknown;
  tripId?: unknown;
  routeShortName?: unknown;
  displayName?: unknown;
  routeLongName?: unknown;
  headsign?: unknown;
  routeColor?: unknown;
  routeTextColor?: unknown;
  cancelled?: unknown;
  place?: { departure?: unknown; scheduledDeparture?: unknown };
};

type Departure = StopTime & { departure: string };

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

function isRailMode(mode: string) {
  return [
    'RAIL', 'SUBURBAN', 'SUBWAY', 'REGIONAL_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL',
  ].includes(mode);
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

export function TransitDeparturesPanel({
  stop,
  onClose,
  onDepartureSelect,
}: {
  stop: TransitStopSelection;
  onClose: () => void;
  onDepartureSelect: (departure: { tripId: string; mode: string; color: string }) => void;
}) {
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDepartureKey, setSelectedDepartureKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSelectedDepartureKey(null);
    setShowAll(false);
  }, [stop]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDepartures([]);
    const params = new URLSearchParams({
      stopId: stop.stopId,
      n: '10',
      mode: 'TRANSIT',
      realtimeMode: 'REALTIME',
      withAlerts: 'false',
      language: typeof navigator !== 'undefined' ? navigator.language : 'en',
    });
    if (!isRailMode(stop.mode)) {
      // Transitous otherwise includes parent/children and similarly named
      // nearby stops. Platform and roadside stop panels should be exact.
      params.set('radius', '0');
      params.set('exactRadius', 'true');
    }

    fetch(`${STOP_TIMES_API_URL}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Transitous returned HTTP ${response.status}`);
        return response.json() as Promise<{ stopTimes?: StopTime[] }>;
      })
      .then((payload) => {
        const next = (payload.stopTimes ?? [])
          .map((item) => ({
            ...item,
            departure: text(item.place?.departure ?? item.place?.scheduledDeparture),
          }))
          .filter((item): item is Departure => Boolean(item.departure));
        setDepartures(next);
      })
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
          Live timetable from Transitous
        </div>
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
                  onDepartureSelect({ tripId, mode, color: routeColor });
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
