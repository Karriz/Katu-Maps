import { useEffect, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, ExternalLink, Navigation, RefreshCw, Share2, X } from 'lucide-react';
import { InfoActionRow } from '../components/InfoActionRow';
import { MobileSheetHandle } from '../components/MobileSheetHandle';
import { useMobileBottomSheet } from '../lib/useMobileBottomSheet';
import { MAP_COLORS } from './MapPalette';
import {
  fetchTrafficCameraDetails,
  formatCameraMeasuredTime,
  type TrafficCameraDetails,
  type TrafficCameraPreset,
  type TrafficCameraSelection,
} from './TrafficCameras';
import type { LocationSelection } from './useRoutePlanning';

function isAbortError(error: unknown) {
  return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
}

function CameraImageCarousel({
  presets,
  stationName,
}: {
  presets: TrafficCameraPreset[];
  stationName: string;
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  if (!presets.length) return null;
  const current = presets[Math.min(index, presets.length - 1)];
  const move = (amount: number) => setIndex((value) => (value + amount + presets.length) % presets.length);
  const measured = formatCameraMeasuredTime(current.measuredTime);
  return (
    <section
      className="location-media traffic-camera-media"
      aria-label="Traffic camera views"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') move(-1);
        if (event.key === 'ArrowRight') move(1);
      }}
    >
      {failed[current.imageUrl] ? (
        <div className="traffic-camera-image-fallback">Latest image unavailable</div>
      ) : (
        <img
          key={current.imageUrl}
          src={current.imageUrl}
          alt={`${stationName}, ${current.name}`}
          loading="lazy"
          width="1280"
          height="720"
          onError={() => setFailed((currentFailed) => ({ ...currentFailed, [current.imageUrl]: true }))}
        />
      )}
      {presets.length > 1 && <>
        <button type="button" className="previous" aria-label={`Previous view, ${index + 1} of ${presets.length}`} onClick={() => move(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="next" aria-label={`Next view, ${index + 1} of ${presets.length}`} onClick={() => move(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </>}
      <div className="location-media-caption">
        <span aria-label={`View ${index + 1} of ${presets.length}`}>
          {index + 1}/{presets.length} · {current.name}{measured ? ` · ${measured}` : ''}
        </span>
        <a href={current.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Open full camera image">
          <ExternalLink size={14} /> Open
        </a>
      </div>
    </section>
  );
}

export function TrafficCameraPanel({
  selection,
  sheet,
  onClose,
  onShare,
  onDirections,
}: {
  selection: TrafficCameraSelection;
  sheet: ReturnType<typeof useMobileBottomSheet>;
  onClose: () => void;
  onShare: () => void;
  onDirections: (destination: LocationSelection) => void;
}) {
  const [details, setDetails] = useState<TrafficCameraDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const load = async (bypassCache = false) => {
      setError(null);
      if (bypassCache) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await fetchTrafficCameraDetails(selection.id, controller.signal, { bypassCache });
        if (cancelled) return;
        setDetails(next);
      } catch (caught) {
        if (cancelled || isAbortError(caught)) return;
        setError('Traffic camera images could not be loaded. Try again in a moment.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(true); }, 10 * 60_000);
    const onVisible = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selection.id]);

  const name = details?.name ?? selection.name;
  const place = [details?.municipality, details?.province].filter(Boolean).join(', ');
  const road = details?.roadNumber ? `Road ${details.roadNumber}` : undefined;
  const destination: LocationSelection = {
    name,
    category: 'Traffic camera',
    coordinates: details?.coordinates ?? selection.coordinates,
    source: 'map',
    address: place || undefined,
  };

  return (
    <aside
      className={`location-info-panel traffic-camera-panel mobile-bottom-sheet${sheet.dragging ? ' is-dragging' : ''}`}
      style={sheet.style}
      data-snap={sheet.snap}
      aria-label="Traffic camera"
    >
      <MobileSheetHandle {...sheet} closeLabel="Close traffic camera" onClose={onClose} />
      <div className="location-info-header">
        <div className="location-info-icon" aria-hidden="true" style={{ backgroundColor: MAP_COLORS.trafficCamera }}>
          <Camera size={20} strokeWidth={2.4} />
        </div>
        <div>
          <span className="location-info-category">Traffic camera</span>
          <h2>{name}</h2>
          {(place || road) && <p>{[road, place].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="location-info-content" tabIndex={0}>
        {details && <CameraImageCarousel presets={details.presets} stationName={name} />}
        {loading && !details && <p className="location-info-loading">Loading camera views…</p>}
        {error && <p className="location-info-empty" role="status">{error}</p>}
        <div className="location-info-details">
          <div>
            <strong>Station</strong>
            <span>{selection.id}</span>
          </div>
          {details?.presets.length ? <div>
            <strong>Views</strong>
            <span>{details.presets.map((preset) => preset.name).join(', ')}</span>
          </div> : null}
        </div>
        <span className="location-info-source">Finnish road weather cameras from Fintraffic Digitraffic</span>
        <a
          className="location-info-attribution"
          href="https://www.digitraffic.fi/en/road-traffic/"
          target="_blank"
          rel="noreferrer"
        >
          Source: Fintraffic / digitraffic.fi · CC BY 4.0
        </a>
      </div>
      <div className="location-info-sticky-actions">
        <InfoActionRow actions={[
          {
            label: refreshing ? 'Refreshing' : 'Refresh',
            icon: RefreshCw,
            onClick: () => {
              const controller = new AbortController();
              setRefreshing(true);
              setError(null);
              void fetchTrafficCameraDetails(selection.id, controller.signal, { bypassCache: true })
                .then((next) => setDetails(next))
                .catch((caught) => {
                  if (!isAbortError(caught)) setError('Traffic camera images could not be loaded. Try again in a moment.');
                })
                .finally(() => setRefreshing(false));
            },
            disabled: refreshing || loading,
          },
          { label: 'Share', icon: Share2, onClick: onShare },
          { label: 'Directions', icon: Navigation, tone: 'primary', onClick: () => onDirections(destination) },
        ]} />
      </div>
      <button className="location-info-close" type="button" aria-label="Close traffic camera" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
