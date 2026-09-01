import { describe, expect, it, vi } from 'vitest';
import {
  installPersistedMapViewFlush,
  MAP_VIEW_STORAGE_KEY,
  parsePersistedMapView,
  savePersistedMapView,
} from './PersistedMapView';

class VisibilitySource extends EventTarget {
  hidden = false;

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('parsePersistedMapView', () => {
  it('restores a complete valid camera', () => {
    expect(parsePersistedMapView('{"center":[23.7,61.5],"zoom":14,"bearing":-20,"pitch":45}'))
      .toEqual({ center: [23.7, 61.5], zoom: 14, bearing: -20, pitch: 45 });
  });

  it.each([
    null,
    'not json',
    '{"center":[null,0],"zoom":4,"bearing":0,"pitch":0}',
    '{"center":[0,0],"zoom":99,"bearing":0,"pitch":0}',
  ])('rejects invalid persisted data', (value) => {
    expect(parsePersistedMapView(value)).toBeNull();
  });

  it('accepts pitch slightly above the map maxPitch due to floating-point drift', () => {
    expect(parsePersistedMapView('{"center":[23.7,61.5],"zoom":14,"bearing":0,"pitch":55.000000001}'))
      .toEqual({ center: [23.7, 61.5], zoom: 14, bearing: 0, pitch: 55.000000001 });
  });

  it('restores MapLibre longitudes wrapped beyond the canonical world', () => {
    expect(parsePersistedMapView('{"center":[383.7,61.5],"zoom":14,"bearing":0,"pitch":0}'))
      .toEqual({ center: [23.7, 61.5], zoom: 14, bearing: 0, pitch: 0 });
  });
});

describe('savePersistedMapView', () => {
  it('stores a canonical longitude', () => {
    let storedValue: string | null = null;
    savePersistedMapView(
      { center: [-336.3, 61.5], zoom: 14, bearing: 0, pitch: 0 },
      { setItem: (key, value) => {
        expect(key).toBe(MAP_VIEW_STORAGE_KEY);
        storedValue = value;
      } },
    );

    expect(parsePersistedMapView(storedValue)).toEqual({
      center: [23.7, 61.5], zoom: 14, bearing: 0, pitch: 0,
    });
  });
});

describe('installPersistedMapViewFlush', () => {
  it('persists when the page is hidden or unloaded and removes its listeners', () => {
    const document = new VisibilitySource();
    const window = new EventTarget();
    const persist = vi.fn();
    const remove = installPersistedMapViewFlush(document, window, persist);

    document.setHidden(false);
    expect(persist).not.toHaveBeenCalled();
    document.setHidden(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(persist).toHaveBeenCalledTimes(2);

    remove();
    document.setHidden(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
