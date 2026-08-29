import { describe, expect, it } from 'vitest';
import { parsePersistedMapView } from './PersistedMapView';

describe('parsePersistedMapView', () => {
  it('restores a complete valid camera', () => {
    expect(parsePersistedMapView('{"center":[23.7,61.5],"zoom":14,"bearing":-20,"pitch":45}'))
      .toEqual({ center: [23.7, 61.5], zoom: 14, bearing: -20, pitch: 45 });
  });

  it.each([
    null,
    'not json',
    '{"center":[181,0],"zoom":4,"bearing":0,"pitch":0}',
    '{"center":[0,0],"zoom":99,"bearing":0,"pitch":0}',
    '{"center":[0,0],"zoom":4,"bearing":0,"pitch":80}',
  ])('rejects invalid persisted data', (value) => {
    expect(parsePersistedMapView(value)).toBeNull();
  });
});
