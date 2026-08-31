import { describe, expect, it, vi } from 'vitest';
import {
  AUTOMATIC_RELOAD_GUARD_MS,
  BACKGROUND_RECOVERY_DELAY_MS,
  installForegroundRecovery,
} from './ForegroundRecovery';

class VisibilitySource extends EventTarget {
  hidden = false;

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  return storage;
}

function setup(storage = memoryStorage()) {
  let time = 1_000;
  const document = new VisibilitySource();
  const lifecycle = new EventTarget() as EventTarget & { sessionStorage: Storage };
  lifecycle.sessionStorage = storage;
  const canvas = new EventTarget();
  const map = { resize: vi.fn(), triggerRepaint: vi.fn() };
  const reload = vi.fn();
  const beforeReload = vi.fn();
  const remove = installForegroundRecovery({
    document,
    window: lifecycle,
    canvas,
    map,
    reload,
    beforeReload,
    now: () => time,
  });

  return {
    document,
    lifecycle,
    canvas,
    map,
    reload,
    beforeReload,
    remove,
    advance: (milliseconds: number) => { time += milliseconds; },
  };
}

describe('installForegroundRecovery', () => {
  it('resizes and repaints without reloading after a short background period', () => {
    const recovery = setup();

    recovery.document.setHidden(true);
    recovery.advance(BACKGROUND_RECOVERY_DELAY_MS - 1);
    recovery.document.setHidden(false);

    expect(recovery.map.resize).toHaveBeenCalledOnce();
    expect(recovery.map.triggerRepaint).toHaveBeenCalledOnce();
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('reloads immediately when the WebGL context is lost', () => {
    const recovery = setup();
    const event = new Event('webglcontextlost', { cancelable: true });

    recovery.canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(recovery.beforeReload).toHaveBeenCalledOnce();
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('reloads after fifteen seconds in the background despite a recent context loss', () => {
    const storage = memoryStorage();
    const previousPage = setup(storage);
    previousPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    previousPage.remove();
    const recovery = setup(storage);

    recovery.document.setHidden(true);
    recovery.advance(BACKGROUND_RECOVERY_DELAY_MS);
    recovery.document.setHidden(false);

    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('does not reload twice when visibilitychange and pageshow both fire', () => {
    const recovery = setup();

    recovery.document.setHidden(true);
    recovery.advance(BACKGROUND_RECOVERY_DELAY_MS);
    recovery.document.setHidden(false);
    recovery.lifecycle.dispatchEvent(new Event('pageshow'));
    recovery.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(recovery.reload).toHaveBeenCalledOnce();
    expect(recovery.beforeReload).toHaveBeenCalledOnce();
  });

  it('guards against an automatic reload loop across page loads', () => {
    const storage = memoryStorage();
    const firstPage = setup(storage);
    firstPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    firstPage.remove();

    const reloadedPage = setup(storage);
    reloadedPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(firstPage.reload).toHaveBeenCalledOnce();
    expect(reloadedPage.reload).not.toHaveBeenCalled();

    reloadedPage.advance(AUTOMATIC_RELOAD_GUARD_MS);
    reloadedPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(reloadedPage.reload).toHaveBeenCalledOnce();
  });
});
