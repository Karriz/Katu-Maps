import { describe, expect, it } from 'vitest';
import { FAVORITES_STORAGE_KEY, favoriteMapFeatures, isValidFavoriteCoordinates, loadFavorites, orderedFavorites, resolvedFavoriteEntityType, saveFavorites, upsertFavorite, type Favorite } from './Favorites';

const favorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'one', name: 'Museum', coordinates: [23.7, 61.5], category: 'Museum',
  kind: 'favorite', createdAt: 3, ...overrides,
});

it('opens legacy favorites using the safest compatible information view', () => {
  expect(resolvedFavoriteEntityType(favorite())).toBe('position');
  expect(resolvedFavoriteEntityType(favorite({ provider: 'osm' }))).toBe('place');
  expect(resolvedFavoriteEntityType(favorite({ provider: 'transit' }))).toBe('transit-stop');
  expect(resolvedFavoriteEntityType(favorite({ entityType: 'place' }))).toBe('place');
});

it('persists and restores favorites', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  saveFavorites([favorite()], storage);
  expect(values.has(FAVORITES_STORAGE_KEY)).toBe(true);
  expect(loadFavorites(storage)).toEqual([favorite()]);
});

it.each([
  [[181, 61.5]],
  [[-181, 61.5]],
  [[23.7, 91]],
  [[23.7, -91]],
  [[Number.NaN, 61.5]],
  [[23.7, Number.POSITIVE_INFINITY]],
  [['23.7', 61.5]],
  [[23.7]],
])('rejects invalid persisted favourite coordinates: %j', (coordinates) => {
  const storage = {
    getItem: () => JSON.stringify([favorite({ coordinates: coordinates as [number, number] })]),
  };
  expect(isValidFavoriteCoordinates(coordinates)).toBe(false);
  expect(loadFavorites(storage)).toEqual([]);
});

it.each([
  [[-180, -90]],
  [[0, 0]],
  [[180, 90]],
  [[23.7, 61.5]],
])('accepts valid persisted favourite coordinates: %j', (coordinates) => {
  expect(isValidFavoriteCoordinates(coordinates)).toBe(true);
});

describe('favorite matching and ordering', () => {
  it('puts Home and Work ahead of other matching favorites', () => {
    const values = [favorite(), favorite({ id: 'work', name: 'Work', category: 'Office', kind: 'work' }), favorite({ id: 'home', name: 'Home', category: 'Address', kind: 'home' })];
    expect(orderedFavorites(values).map(({ name }) => name)).toEqual(['Home', 'Work', 'Museum']);
    expect(orderedFavorites(values, 'mus')).toEqual([values[0]]);
  });

  it('updates an existing provider entity and deduplicates rounded coordinates', () => {
    const provider = favorite({ provider: 'osm', providerId: 'node:42' });
    expect(upsertFavorite([provider], favorite({ id: 'new', name: 'Renamed', provider: 'osm', providerId: 'node:42' })))
      .toEqual([{ ...provider, name: 'Renamed' }]);
    expect(upsertFavorite([favorite()], favorite({ id: 'new', coordinates: [23.700001, 61.500001] }))).toHaveLength(1);
  });

  it('keeps only one Home and one Work favorite', () => {
    const home = favorite({ id: 'home', name: 'Home', kind: 'home' });
    const movedHome = favorite({ id: 'moved', name: 'Home', kind: 'home', coordinates: [24, 62] });
    expect(upsertFavorite([home], movedHome)).toEqual([{ ...movedHome, id: 'home', createdAt: home.createdAt }]);
  });
});

it('creates map features with the favorite kind used for marker icons', () => {
  const home = favorite({ id: 'home', name: 'Home', kind: 'home', iconId: 'house' });
  expect(favoriteMapFeatures([home])).toEqual([{
    type: 'Feature',
    id: 'home',
    geometry: { type: 'Point', coordinates: home.coordinates },
    properties: {
      name: 'Home',
      class: home.category,
      city: undefined,
      iconId: 'house',
      favoriteId: 'home',
      favoriteKind: 'home',
      entityType: undefined,
      transitStopId: undefined,
      transitProvider: undefined,
      transitMode: undefined,
      osmType: undefined,
      osmId: undefined,
      openingHours: undefined,
      phone: undefined,
      email: undefined,
      website: undefined,
    },
  }]);
});

it.each([
  ['position', [23.7609, 61.4981]],
  ['place', [24.9384, 60.1699]],
  ['transit-stop', [25.7482, 62.2415]],
] as const)('keeps exact %s favourite coordinates in its map marker', (entityType, coordinates) => {
  const value = favorite({ entityType, coordinates: [...coordinates] });
  expect(favoriteMapFeatures([value])[0].geometry.coordinates).toEqual(coordinates);
});
