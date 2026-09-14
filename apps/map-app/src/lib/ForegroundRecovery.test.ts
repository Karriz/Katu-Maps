import { describe, expect, it, vi } from 'vitest';
import {
  AUTOMATIC_RELOAD_GUARD_MS,
  CONTEXT_RESTORE_TIMEOUT_MS,
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
  vi.useFakeTimers();

  it('resizes and repaints without reloading after a short background period', () => {
    const recovery = setup();

    recovery.document.setHidden(true);
    recovery.advance(14_999);
    recovery.document.setHidden(false);

    expect(recovery.map.resize).toHaveBeenCalledOnce();
    expect(recovery.map.triggerRepaint).toHaveBeenCalledOnce();
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('waits for restoration when the WebGL context is lost', () => {
    const recovery = setup();
    const event = new Event('webglcontextlost', { cancelable: true });

    recovery.canvas.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(recovery.reload).not.toHaveBeenCalled();

    recovery.canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(recovery.beforeReload).toHaveBeenCalledOnce();
    expect(recovery.reload).toHaveBeenCalledOnce();
  });

  it('does not reload a healthy map after a long background period', () => {
    const recovery = setup();

    recovery.document.setHidden(true);
    recovery.advance(60_000);
    recovery.document.setHidden(false);

    expect(recovery.map.resize).toHaveBeenCalledOnce();
    expect(recovery.map.triggerRepaint).toHaveBeenCalledOnce();
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('falls back to reloading when the context is not restored', () => {
    const recovery = setup();

    recovery.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS - 1);
    expect(recovery.reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(recovery.reload).toHaveBeenCalledOnce();
    expect(recovery.beforeReload).toHaveBeenCalledOnce();
  });

  it('guards against an automatic reload loop across page loads', () => {
    const storage = memoryStorage();
    const firstPage = setup(storage);
    firstPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    firstPage.canvas.dispatchEvent(new Event('webglcontextrestored'));
    firstPage.remove();

    const reloadedPage = setup(storage);
    reloadedPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    reloadedPage.canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(firstPage.reload).toHaveBeenCalledOnce();
    expect(reloadedPage.reload).not.toHaveBeenCalled();

    reloadedPage.advance(AUTOMATIC_RELOAD_GUARD_MS);
    reloadedPage.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    reloadedPage.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(reloadedPage.reload).toHaveBeenCalledOnce();
  });

  it('cancels a pending fallback when removed', () => {
    const recovery = setup();

    recovery.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    recovery.remove();
    vi.advanceTimersByTime(CONTEXT_RESTORE_TIMEOUT_MS);

    expect(recovery.reload).not.toHaveBeenCalled();
  });
});
