import { describe, expect, it } from 'vitest';
import { createMapDeepLink, parseMapDeepLink } from './DeepLink';

describe('map deep links', () => {
  it('round trips the compact, versioned stop payload', () => {
    const url = createMapDeepLink('https://example.test/Maps/?old=yes#hash', {
      type: 'stop', coordinates: [23.77123456, 61.49123456], zoom: 15.65,
      provider: 'digitransit', id: 'nysse:1234', name: 'Central stop',
    });
    expect(parseMapDeepLink(new URL(url).search)).toEqual({
      type: 'stop', coordinates: [23.771235, 61.491235], zoom: 15.7,
      provider: 'digitransit', id: 'nysse:1234', name: 'Central stop',
    });
    expect(url).not.toContain('old=yes');
  });

  it.each(['?v=2&type=position&lat=1&lon=2', '?v=1&type=poi&lat=no&lon=2', '?v=1&type=stop&lat=91&lon=2'])('safely ignores malformed input: %s', (search) => {
    expect(parseMapDeepLink(search)).toBeNull();
  });

  it('accepts coordinate-only entity links and clamps zoom', () => {
    expect(parseMapDeepLink('?v=1&type=poi&lat=61.5&lon=23.7&z=99')).toMatchObject({
      type: 'poi', coordinates: [23.7, 61.5], zoom: 18, id: undefined,
    });
  });
});
