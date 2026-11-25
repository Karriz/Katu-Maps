import { afterEach, describe, expect, it, vi } from 'vitest';
import { anchoredCameraOptions, smoothlyFollowVehicle } from './MapViewportLayout';

const stubViewport = (panels: Array<{ getBoundingClientRect: () => DOMRect }> = []) => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal('document', { querySelectorAll: () => panels });
};

const panelRect = (left: number, top: number, right: number, bottom: number) => ({
  getBoundingClientRect: () => ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }) as DOMRect,
});

const stubMap = (zoom: number) => ({
  getZoom: () => zoom,
  getContainer: () => ({
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
  }),
  easeTo: vi.fn(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anchored camera options', () => {
  it('offsets the camera target away from obstructing panels and includes explicit zoom', () => {
    stubViewport([panelRect(0, 400, 800, 600)]);
    const map = stubMap(12);
    const camera = anchoredCameraOptions(map as any, [23.76, 61.49], 15);
    expect(camera).toEqual({
      center: [23.76, 61.49],
      offset: [0, -100],
      zoom: 15,
    });
  });

  it('targets the map center without overriding zoom when no panel obstructs the viewport', () => {
    stubViewport();
    const map = stubMap(12);
    expect(anchoredCameraOptions(map as any, [23.76, 61.49])).toEqual({
      center: [23.76, 61.49],
      offset: [0, 0],
    });
  });
});

describe('vehicle follow camera', () => {
  it('keeps the vehicle anchored to the visible map area and lifts the zoom floor while following', () => {
    stubViewport([panelRect(16, 16, 300, 584)]);
    const map = stubMap(13);
    smoothlyFollowVehicle(map as any, [23.76, 61.49]);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    const options = map.easeTo.mock.calls[0][0];
    expect(options.center).toEqual([23.76, 61.49]);
    expect(options.offset).toEqual([150, 0]);
    expect(options.zoom).toBe(14.6);
    expect(options.duration).toBe(350);
    expect(options.easing(0.5)).toBe(0.5);
  });
});
