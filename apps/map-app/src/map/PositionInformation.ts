export type ElevationState =
  | { status: 'loading' }
  | { status: 'available'; metres: number }
  | { status: 'unavailable' };

export type AddressState =
  | { status: 'loading' }
  | { status: 'available'; address: string }
  | { status: 'unavailable' };

export type ElevationQueryMap = {
  queryTerrainElevation: (coordinates: [number, number], options?: { exaggerated?: boolean }) => number | null;
  setTerrain: (terrain: { source: string; exaggeration: number } | null) => unknown;
  triggerRepaint: () => void;
};

export function formatCoordinates([longitude, latitude]: [number, number]) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function defaultPositionName([longitude, latitude]: [number, number], address?: string) {
  return address?.trim() || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

type CoordinateComponent = { value: number; direction?: string };

function coordinatesFromComponents(components: CoordinateComponent[]): [number, number] | undefined {
  if (components.length !== 2 || components.some(({ value }) => !Number.isFinite(value))) return undefined;
  const directedLatitude = components.find(({ direction }) => direction === 'N' || direction === 'S');
  const directedLongitude = components.find(({ direction }) => direction === 'E' || direction === 'W');
  let latitude: number;
  let longitude: number;
  if (directedLatitude && directedLongitude) {
    latitude = directedLatitude.direction === 'S' ? -Math.abs(directedLatitude.value) : Math.abs(directedLatitude.value);
    longitude = directedLongitude.direction === 'W' ? -Math.abs(directedLongitude.value) : Math.abs(directedLongitude.value);
  } else if (!components[0].direction && !components[1].direction) {
    // Human-readable coordinates are conventionally latitude, longitude.
    // If only the first value exceeds the latitude range, accept GeoJSON's
    // longitude, latitude order as an unambiguous alternative.
    [latitude, longitude] = Math.abs(components[0].value) > 90
      ? [components[1].value, components[0].value]
      : [components[0].value, components[1].value];
  } else {
    return undefined;
  }
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? [longitude, latitude]
    : undefined;
}

/** Parses common decimal-degree, cardinal-direction, decimal-comma and DMS coordinate pairs. */
export function parseCoordinates(value: string): [number, number] | undefined {
  const input = value.trim()
    .replace(/^geo:\s*/i, '')
    .replace(/[−–]/g, '-');
  if (!input) return undefined;

  const decimalCommaPair = input.match(/^\(?\s*([+-]?\d{1,3},\d+)\s+([+-]?\d{1,3},\d+)\s*\)?$/);
  if (decimalCommaPair) {
    return coordinatesFromComponents(decimalCommaPair.slice(1).map((part) => ({
      value: Number(part.replace(',', '.')),
    })));
  }

  const prefixedPair = input.match(/^\(?\s*([NS])\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*[,;/]?\s*([EW])\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*\)?$/i)
    ?? input.match(/^\(?\s*([EW])\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*[,;/]?\s*([NS])\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*\)?$/i);
  if (prefixedPair) {
    return coordinatesFromComponents([
      { direction: prefixedPair[1].toUpperCase(), value: Number(prefixedPair[2].replace(',', '.')) },
      { direction: prefixedPair[3].toUpperCase(), value: Number(prefixedPair[4].replace(',', '.')) },
    ]);
  }

  const dmsPattern = /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″])?\s*([NSEW])/gi;
  const dmsMatches = [...input.matchAll(dmsPattern)];
  if (dmsMatches.length === 2 && input.replace(dmsPattern, '').match(/^[\s,;/|()\[\]]*$/)) {
    if (dmsMatches.some((match) => Number(match[2]) >= 60 || Number(match[3].replace(',', '.')) >= 60)) return undefined;
    return coordinatesFromComponents(dmsMatches.map((match) => ({
      value: Number(match[1]) + Number(match[2]) / 60 + Number(match[3].replace(',', '.')) / 3600,
      direction: match[4].toUpperCase(),
    })));
  }

  const degreeMinutePattern = /(\d{1,3})\s*[°º]\s*(\d{1,2}(?:[.,]\d+)?)\s*['′]\s*([NSEW])/gi;
  const degreeMinuteMatches = [...input.matchAll(degreeMinutePattern)];
  if (degreeMinuteMatches.length === 2 && input.replace(degreeMinutePattern, '').match(/^[\s,;/|()\[\]]*$/)) {
    if (degreeMinuteMatches.some((match) => Number(match[2].replace(',', '.')) >= 60)) return undefined;
    return coordinatesFromComponents(degreeMinuteMatches.map((match) => ({
      value: Number(match[1]) + Number(match[2].replace(',', '.')) / 60,
      direction: match[3].toUpperCase(),
    })));
  }

  const decimalPattern = /([NSEW])?\s*([+-]?(?:\d{1,3}(?:[.,]\d+)?|\.\d+))\s*°?\s*([NSEW])?/gi;
  const decimalMatches = [...input.matchAll(decimalPattern)];
  if (decimalMatches.length !== 2 || !input.replace(decimalPattern, '').match(/^[\s,;/|()@\[\]]*$/)) return undefined;
  const components = decimalMatches.map((match): CoordinateComponent => {
    const prefix = match[1]?.toUpperCase();
    const suffix = match[3]?.toUpperCase();
    return {
      value: Number(match[2].replace(',', '.')),
      direction: prefix && suffix && prefix !== suffix ? 'invalid' : prefix ?? suffix,
    };
  });
  return coordinatesFromComponents(components);
}

export function formatElevation(metres: number) {
  return `${Math.round(metres)} m above mean sea level`;
}

function addressPart(address: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = address?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function formatNominatimAddress(result: Record<string, unknown> | undefined) {
  if (!result) return undefined;
  const address = result.address && typeof result.address === 'object'
    ? result.address as Record<string, unknown>
    : undefined;
  const street = addressPart(address, 'road', 'pedestrian', 'residential', 'footway', 'path');
  const houseNumber = addressPart(address, 'house_number');
  const postcode = addressPart(address, 'postcode');
  const locality = addressPart(address, 'city', 'town', 'village', 'municipality');
  const streetAddress = [street, houseNumber].filter(Boolean).join(' ');
  const localityAddress = [postcode, locality].filter(Boolean).join(' ');
  const concise = [streetAddress, localityAddress].filter(Boolean).join(', ');
  if (concise) return concise;
  const displayName = typeof result.display_name === 'string' ? result.display_name.trim() : '';
  return displayName || undefined;
}

export function elevationResult(value: number | null | undefined): ElevationState {
  return typeof value === 'number' && Number.isFinite(value)
    ? { status: 'available', metres: value }
    : { status: 'unavailable' };
}

export function hasDisplayableElevation(
  state: ElevationState,
  is3dMode: boolean,
): state is { status: 'available'; metres: number } {
  return is3dMode && state.status === 'available' && Number.isFinite(state.metres);
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
