import { afterEach, describe, expect, it, vi } from 'vitest';
import { anchoredCameraOptions, smoothlyFollowVehicle } from './MapViewportLayout';

const stubViewport = (panels: DOMRect[] = []) => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.stubGlobal('document', { querySelectorAll: () => panels });
};

const stubMap = (zoom: number) => ({
  getZoom: () => zoom,
  getContainer: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }),
  calculateAnchoredCameraOptions: vi.fn(() => ({ center: { lng: 23.76, lat: 61.49 }, zoom })),
  easeTo: vi.fn(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anchored camera options', () => {
  it('anchors the selection at the visible map target point', () => {
    stubViewport();
    const map = stubMap(12);
    const camera = anchoredCameraOptions(map as any, [23.76, 61.49], 15);
    expect(map.calculateAnchoredCameraOptions).toHaveBeenCalledWith({
      anchorLocation: [23.76, 61.49],
      anchorScreenPoint: [400, 300],
      zoom: 15,
    });
    expect(camera).toEqual({ center: { lng: 23.76, lat: 61.49 }, zoom: 12 });
  });

  it('targets the map center when no panel obstructs the viewport', () => {
    stubViewport();
    const map = stubMap(12);
    anchoredCameraOptions(map as any, [23.76, 61.49]);
    expect(map.calculateAnchoredCameraOptions).toHaveBeenCalledWith({
      anchorLocation: [23.76, 61.49],
      anchorScreenPoint: [400, 300],
      zoom: 12,
    });
  });
});

describe('vehicle follow camera', () => {
  it('keeps the vehicle anchored and lifts the zoom floor while following', () => {
    stubViewport();
    const map = stubMap(13);
    smoothlyFollowVehicle(map as any, [23.76, 61.49]);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    const options = map.easeTo.mock.calls[0][0];
    expect(options.duration).toBe(350);
    expect(options.easing(0.5)).toBe(0.5);
    expect(map.calculateAnchoredCameraOptions).toHaveBeenCalledWith({
      anchorLocation: [23.76, 61.49],
      anchorScreenPoint: [400, 300],
      zoom: 14.6,
    });
  });
});
