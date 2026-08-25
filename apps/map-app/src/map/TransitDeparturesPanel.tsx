import { useEffect, useState } from 'react';
import { BusFront, Clock3, RefreshCw, TrainFront, TrainFrontTunnel, TramFront, X } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { cn } from '../lib/utils';
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
  if (mode === 'BUS') return '#3979c9';
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

  useEffect(() => {
    setSelectedDepartureKey(null);
  }, [stop]);

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
    setRefreshKey((value) => value + 1);
    window.setTimeout(() => setRefreshing(false), 350);
  };

  return (
    <aside className="transit-departures-panel absolute inset-y-0 right-0 z-20 flex w-[min(380px,calc(100%_-_16px))] flex-col border-l border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: modeColor(stop.mode) }} />
            Departures
          </div>
          <h2 className="truncate text-lg font-semibold text-slate-800">{stop.name}</h2>
          <p className="mt-1 text-xs text-slate-500">Live timetable from Transitous</p>
        </div>
        <Button className="shrink-0 px-2 text-slate-500" aria-label="Close departures" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator />

      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-xs text-slate-500">Next services</span>
        <Button variant="outline" className="h-8 gap-1.5 px-2.5 text-xs" onClick={refresh}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {loading && <div className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading departures…</div>}
        {!loading && error && <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-5 text-sm text-red-700">{error}</div>}
        {!loading && !error && departures.length === 0 && <div className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">No upcoming departures found.</div>}
        <div className="space-y-2">
          {!loading && !error && departures.map((departure, index) => {
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
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border bg-white px-3 py-3 text-left shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-default',
                  selected ? 'border-transparent' : 'border-slate-100',
                )}
                disabled={!tripId}
                key={departureKey}
                onClick={() => {
                  if (!tripId) return;
                  setSelectedDepartureKey(departureKey);
                  onDepartureSelect({ tripId, mode, color: routeColor });
                }}
                style={selected ? { backgroundColor: `${routeColor}0d`, boxShadow: `inset 0 0 0 2px ${routeColor}` } : undefined}
                type="button"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: routeColor, color: routeTextColor }}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className="border-transparent px-1.5" style={{ backgroundColor: routeColor, color: routeTextColor }}>{route}</Badge>
                    <span className="truncate text-xs text-slate-500">{modeLabel(mode)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-700">{destination || 'Service'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums text-slate-800">
                  <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                  {formatDeparture(departure.departure)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
