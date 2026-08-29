import { describe, expect, it } from 'vitest';
import { FAVORITES_STORAGE_KEY, favoriteMapFeatures, loadFavorites, orderedFavorites, saveFavorites, upsertFavorite, type Favorite } from './Favorites';

const favorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'one', name: 'Museum', coordinates: [23.7, 61.5], category: 'Museum',
  kind: 'favorite', createdAt: 3, ...overrides,
});

it('persists and restores favorites', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  saveFavorites([favorite()], storage);
  expect(values.has(FAVORITES_STORAGE_KEY)).toBe(true);
  expect(loadFavorites(storage)).toEqual([favorite()]);
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
    },
  }]);
});
