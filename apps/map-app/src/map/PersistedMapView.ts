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

export function parsePersistedMapView(value: string | null): PersistedMapView | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<PersistedMapView>;
    if (!Array.isArray(candidate.center)
      || !finiteInRange(candidate.center[0], -180, 180)
      || !finiteInRange(candidate.center[1], -90, 90)
      || !finiteInRange(candidate.zoom, 0, 18)
      || !finiteInRange(candidate.bearing, -360, 360)
      || !finiteInRange(candidate.pitch, 0, 55)) return null;
    return {
      center: [candidate.center[0], candidate.center[1]],
      zoom: candidate.zoom,
      bearing: candidate.bearing,
      pitch: candidate.pitch,
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
  storage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(view));
}
