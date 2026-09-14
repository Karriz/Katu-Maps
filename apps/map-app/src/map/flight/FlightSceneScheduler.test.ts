import { afterEach, describe, expect, it, vi } from 'vitest';
import { flightSceneNeedsRefresh, installFlightSceneScheduler, scheduleSceneJobs } from './FlightSceneScheduler';

function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
  vi.stubGlobal('cancelIdleCallback', undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const listeners = new Map<string, (...args: any[]) => void>();
  let longitude = 0;
  let heading = 0;
  const map = {
    getCenter: () => ({ lng: longitude, lat: 0 }),
    getBearing: () => heading,
    getTerrain: () => ({ source: 'dem' }),
    on: (event: string, callback: (...args: any[]) => void) => listeners.set(event, callback),
    off: (event: string) => listeners.delete(event),
  };
  const trees = vi.fn();
  const bridges = vi.fn();
  const stop = installFlightSceneScheduler(map as any, 'vector', [trees, bridges]);
  return { trees, bridges, stop, listeners,
    move: (lng: number, bearing = heading) => {
      longitude = lng;
      heading = bearing;
      listeners.get('move')?.();
    },
    source: (sourceId = 'vector') => listeners.get('sourcedata')?.({ sourceId, sourceDataType: 'content' }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('flight scene scheduler', () => {
  it('uses browser idle periods and waits for enough frame budget', () => {
    const callbacks: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> = [];
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const first = vi.fn();
    const second = vi.fn();
    scheduleSceneJobs([first, second]);

    callbacks.shift()?.({ didTimeout: false, timeRemaining: () => 1 });
    expect(first).not.toHaveBeenCalled();
    callbacks.shift()?.({ didTimeout: false, timeRemaining: () => 5 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    callbacks.shift()?.({ didTimeout: true, timeRemaining: () => 0 });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('runs layers on separate frames and coalesces tile bursts until the cooldown', () => {
    const f = fixture();
    vi.advanceTimersByTime(16);
    expect(f.trees).toHaveBeenCalledTimes(1);
    expect(f.bridges).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(f.bridges).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) f.source();
    vi.advanceTimersByTime(717);
    expect(f.trees).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(33);
    expect(f.trees).toHaveBeenCalledTimes(2);
    expect(f.bridges).toHaveBeenCalledTimes(2);
    f.stop();
  });

  it('refreshes for travel and turns, ignores unrelated sources, and cancels on exit', () => {
    const f = fixture();
    vi.advanceTimersByTime(800);
    f.source('unrelated');
    f.move(0.00001);
    vi.advanceTimersByTime(50);
    expect(f.trees).toHaveBeenCalledTimes(1);
    f.move(0.001);
    vi.advanceTimersByTime(32);
    expect(f.trees).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(800);
    f.move(0.001, 20);
    vi.advanceTimersByTime(16);
    expect(f.trees).toHaveBeenCalledTimes(3);
    f.stop(); // Cancel the bridge frame as well as future timer/event work.
    vi.advanceTimersByTime(5000);
    expect(f.bridges).toHaveBeenCalledTimes(2);
    expect(f.listeners.size).toBe(0);
  });

  it('flushes terrain arrivals while stationary and periodically retries unchanged coverage', () => {
    const f = fixture();
    vi.advanceTimersByTime(800);
    f.source('dem');
    vi.advanceTimersByTime(32);
    expect(f.trees).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3200);
    expect(f.trees).toHaveBeenCalledTimes(3);
    f.stop();
  });

  it('handles heading and longitude wrap without false movement', () => {
    expect(flightSceneNeedsRefresh(
      { longitude: 179.99999, latitude: 0, heading: 359 },
      { longitude: -179.99999, latitude: 0, heading: 1 },
    )).toBe(false);
  });
});
