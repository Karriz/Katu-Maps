export const NEARBY_MAX_RADIUS_METRES = 2_000;
export const NEARBY_RESULT_LIMIT = 10;

export type NearbyCategory = 'sights' | 'food' | 'services' | 'recreation' | 'transit';

export type NearbyCandidate = {
  id: string;
  name?: string;
  type: string;
  coordinates: [number, number];
  properties: Record<string, unknown>;
};

export type NearbyPlace = NearbyCandidate & {
  category: NearbyCategory;
  distance: number;
};

const CATEGORY_TYPES: Record<NearbyCategory, Set<string>> = {
  sights: new Set(['attraction', 'museum', 'gallery', 'artwork', 'historic', 'viewpoint', 'place_of_worship', 'tourism']),
  food: new Set(['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'bakery']),
  services: new Set(['shop', 'supermarket', 'marketplace', 'pharmacy', 'hospital', 'clinic', 'bank', 'atm', 'post_office', 'fuel', 'toilets']),
  recreation: new Set(['park', 'playground', 'stadium', 'sports_centre', 'picnic_site', 'zoo', 'cinema', 'theatre']),
  transit: new Set(['bus_stop', 'platform', 'station', 'tram_stop', 'subway_entrance']),
};

const USEFUL_UNNAMED = new Set(['toilets', 'drinking_water', 'viewpoint', 'bus_stop', 'platform', 'station', 'tram_stop']);

export function nearbyCategory(type: string): NearbyCategory | null {
  const normalized = type.toLowerCase().replaceAll(' ', '_');
  for (const [category, types] of Object.entries(CATEGORY_TYPES) as [NearbyCategory, Set<string>][]) {
    if (types.has(normalized)) return category;
  }
  return null;
}

export function distanceMetres(a: [number, number], b: [number, number]) {
  const radians = Math.PI / 180;
  const latitude = (a[1] + b[1]) / 2 * radians;
  const x = (b[0] - a[0]) * radians * Math.cos(latitude);
  const y = (b[1] - a[1]) * radians;
  return Math.hypot(x, y) * 6_371_000;
}

function normalizedName(value?: string) {
  return value?.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ') || '';
}

/** Distance-rank useful tile POIs while capping any one category at four results. */
export function rankNearbyPlaces(
  anchor: [number, number],
  candidates: NearbyCandidate[],
  limit = NEARBY_RESULT_LIMIT,
  radius = NEARBY_MAX_RADIUS_METRES,
): NearbyPlace[] {
  const unique = new Map<string, NearbyPlace>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.coordinates[0]) || !Number.isFinite(candidate.coordinates[1])) continue;
    const category = nearbyCategory(candidate.type);
    if (!category) continue;
    const name = candidate.name?.trim();
    if (!name && !USEFUL_UNNAMED.has(candidate.type)) continue;
    const distance = distanceMetres(anchor, candidate.coordinates);
    if (distance < 2 || distance > radius) continue;
    const key = candidate.id || `${normalizedName(name)}:${candidate.coordinates.map((value) => value.toFixed(5)).join(',')}`;
    const existing = unique.get(key);
    const place = { ...candidate, name, category, distance };
    if (!existing || place.distance < existing.distance) unique.set(key, place);
  }

  const sorted = [...unique.values()].sort((a, b) => a.distance - b.distance);
  const selected: NearbyPlace[] = [];
  const counts = new Map<NearbyCategory, number>();
  for (const place of sorted) {
    if ((counts.get(place.category) ?? 0) >= 4) continue;
    selected.push(place);
    counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
    if (selected.length === limit) break;
  }
  return selected;
}

export function formatNearbyDistance(distance: number) {
  return distance < 1_000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1_000).toFixed(1)} km`;
}
