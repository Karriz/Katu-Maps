export type ElevationState =
  | { status: 'loading' }
  | { status: 'available'; metres: number }
  | { status: 'unavailable' };

export type ElevationQueryMap = {
  queryTerrainElevation: (coordinates: [number, number], options?: { exaggerated?: boolean }) => number | null;
  setTerrain: (terrain: { source: string; exaggeration: number } | null) => unknown;
  triggerRepaint: () => void;
};

export function formatCoordinates([longitude, latitude]: [number, number]) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function formatElevation(metres: number) {
  return `${Math.round(metres)} m above mean sea level`;
}

export function elevationResult(value: number | null | undefined): ElevationState {
  return typeof value === 'number' && Number.isFinite(value)
    ? { status: 'available', metres: value }
    : { status: 'unavailable' };
}

const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    window.clearTimeout(timer);
    reject(new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});

/**
 * Samples the configured DEM without permanently enabling terrain. An
 * exaggeration of zero causes MapLibre to load the DEM but leaves the map
 * visually flat; `exaggerated: false` still returns the source elevation.
 */
export async function queryTerrainElevation(
  map: ElevationQueryMap,
  coordinates: [number, number],
  source: string,
  terrainIsEnabled: () => boolean,
  signal: AbortSignal,
): Promise<number | null> {
  const alreadyEnabled = terrainIsEnabled();
  if (!alreadyEnabled) {
    map.setTerrain({ source, exaggeration: 0 });
    map.triggerRepaint();
  }

  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const elevation = map.queryTerrainElevation(coordinates, { exaggerated: false });
      if (typeof elevation === 'number' && Number.isFinite(elevation)) return elevation;
      await delay(250, signal);
    }
    return null;
  } finally {
    // Do not undo a terrain toggle made by the user while this was loading.
    if (!alreadyEnabled && !terrainIsEnabled()) {
      map.setTerrain(null);
      map.triggerRepaint();
    }
  }
}
