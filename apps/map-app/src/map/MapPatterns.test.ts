import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PATTERN_ID, patternImageExpression } from './GroundPatterns';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function fixture(initialZoom = 2) {
  vi.resetModules();
  const { installMapPatterns } = await import('./MapPatterns');
  let zoom = initialZoom;
  const handlers = new Map<string, () => void>();
  const registered = new Map<string, unknown>();
  const paints = new Map<string, unknown>();
  const pending = new Map<number, IdleRequestCallback>();
  let handle = 0;
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    pending.set(++handle, callback);
    return handle;
  });
  vi.stubGlobal('window', { requestIdleCallback, cancelIdleCallback: (id: number) => pending.delete(id) });
  const map = {
    getZoom: () => zoom,
    getLayer: () => ({}),
    getPaintProperty: (id: string) => paints.get(id) ?? patternImageExpression(id === 'global-water-pattern'
      ? 'water-surface-pattern' : `${id.replace('global-ground-pattern-', 'ground-pattern-')}-dark`),
    setPaintProperty: vi.fn((id: string, _property: string, value: unknown) => paints.set(id, value)),
    hasImage: (id: string) => registered.has(id),
    addImage: vi.fn((id: string, image: unknown) => { registered.set(id, image); }),
    on: (event: string, callback: () => void) => handlers.set(event, callback),
    off: (event: string) => handlers.delete(event),
  };
  const dispose = installMapPatterns(map as any);
  const tick = () => {
    const [id, callback] = [...pending][0];
    pending.delete(id);
    callback({ didTimeout: true, timeRemaining: () => 0 });
  };
  return { map, dispose, registered, pending, tick, handlers,
    zoomTo: (value: number) => { zoom = value; handlers.get('zoomend')?.(); } };
}

describe('lazy map patterns', () => {
  it('does no pixel generation at globe zoom and respects the work budget after zooming in', async () => {
    const { registered, pending, zoomTo, tick, dispose } = await fixture();
    expect([...registered.keys()]).toEqual([EMPTY_PATTERN_ID]);
    expect(pending.size).toBe(0);
    zoomTo(8);
    expect(pending.size).toBe(1);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now++);
    tick();
    expect([...registered.keys()]).toEqual([EMPTY_PATTERN_ID]);
    expect(pending.size).toBe(1);
    dispose();
    expect(pending.size).toBe(0);
  });

  it('registers the active palette first, one image per callback, and removes listeners on disposal', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { map, registered, pending, tick, dispose, handlers } = await fixture(9);
    tick();
    expect([...registered.keys()]).toEqual([EMPTY_PATTERN_ID, 'water-surface-pattern']);
    expect(map.setPaintProperty).toHaveBeenCalledWith('global-water-pattern', 'fill-pattern', 'water-surface-pattern');
    tick();
    expect([...registered.keys()].at(-1)).toBe('ground-pattern-grass-dark');
    expect(map.getPaintProperty('global-ground-pattern-grass')).toBe('ground-pattern-grass-dark');
    while (pending.size) tick();
    expect(registered.size).toBe(20);
    expect(map.getPaintProperty('global-ground-pattern-grass')).toBe('ground-pattern-grass-dark');
    dispose();
    expect(handlers.size).toBe(0);
  });

  it('uses a cancellable timer when idle callbacks are unavailable', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const { installMapPatterns } = await import('./MapPatterns');
    const addImage = vi.fn();
    const dispose = installMapPatterns({ getZoom: () => 7, hasImage: () => false,
      addImage, on: vi.fn(), off: vi.fn() } as any);
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    vi.runAllTimers();
    expect(addImage).toHaveBeenCalledTimes(1);
  });
});
