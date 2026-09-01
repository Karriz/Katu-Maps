export const MAP_VIEW_STORAGE_KEY = 'maps-viewport-v1';

export type PersistedMapView = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

const finiteInRange = (value: unknown, minimum: number, maximum: number): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
);

const clampFiniteInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
};

const normalizeLongitude = (longitude: number) => {
  if (longitude >= -180 && longitude <= 180) return longitude;
  return Number((
    ((longitude + 180) % 360 + 360) % 360 - 180
  ).toFixed(12));
};

export function parsePersistedMapView(value: string | null): PersistedMapView | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<PersistedMapView>;
    const pitch = clampFiniteInRange(candidate.pitch, 0, 85);
    if (!Array.isArray(candidate.center)
      || typeof candidate.center[0] !== 'number'
      || !Number.isFinite(candidate.center[0])
      || !finiteInRange(candidate.center[1], -90, 90)
      || !finiteInRange(candidate.zoom, 0, 18)
      || !finiteInRange(candidate.bearing, -360, 360)
      || pitch === null) return null;
    return {
      // MapLibre permits horizontal world wrapping, so an otherwise valid
      // camera can report an equivalent longitude outside [-180, 180].
      center: [normalizeLongitude(candidate.center[0]), candidate.center[1]],
      zoom: candidate.zoom,
      bearing: candidate.bearing,
      pitch,
    };
  } catch {
    return null;
  }
}

export function loadPersistedMapView(storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try {
    return parsePersistedMapView(storage.getItem(MAP_VIEW_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePersistedMapView(
  view: PersistedMapView,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({
    ...view,
    center: [normalizeLongitude(view.center[0]), view.center[1]],
  }));
}

type LifecycleEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type VisibilitySource = LifecycleEventSource & Pick<Document, 'hidden'>;

/** Flush the current camera before a page is suspended, closed, or reloaded. */
export function installPersistedMapViewFlush(
  document: VisibilitySource,
  window: LifecycleEventSource,
  persist: () => void,
) {
  const persistWhenHidden = () => {
    if (document.hidden) persist();
  };

  document.addEventListener('visibilitychange', persistWhenHidden);
  window.addEventListener('pagehide', persist);

  return () => {
    document.removeEventListener('visibilitychange', persistWhenHidden);
    window.removeEventListener('pagehide', persist);
  };
}
