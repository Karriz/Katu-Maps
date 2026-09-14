import { deploymentStorageKey } from './Deployment';
export const AUTOMATIC_RELOAD_GUARD_MS = 60_000;
export const CONTEXT_RESTORE_TIMEOUT_MS = 5_000;

const LAST_AUTOMATIC_RELOAD_KEY = deploymentStorageKey('map:last-automatic-reload');

type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type VisibilitySource = EventSource & Pick<Document, 'hidden'>;
type LifecycleWindow = EventSource & Pick<Window, 'sessionStorage'>;
type RecoverableMap = { resize: () => void; triggerRepaint: () => void };

type ForegroundRecoveryOptions = {
  document: VisibilitySource;
  window: LifecycleWindow;
  canvas: EventSource;
  map: RecoverableMap;
  reload: () => void;
  beforeReload?: () => void;
  now?: () => number;
  reloadGuardMs?: number;
  contextRestoreTimeoutMs?: number;
};

/** Recover MapLibre after a mobile browser restores a suspended page. */
export function installForegroundRecovery({
  document,
  window,
  canvas,
  map,
  reload,
  beforeReload,
  now = Date.now,
  reloadGuardMs = AUTOMATIC_RELOAD_GUARD_MS,
  contextRestoreTimeoutMs = CONTEXT_RESTORE_TIMEOUT_MS,
}: ForegroundRecoveryOptions) {
  let reloadRequested = false;
  let contextLost = false;
  let contextRestoreTimer: ReturnType<typeof setTimeout> | undefined;

  const clearContextRestoreTimer = () => {
    if (contextRestoreTimer === undefined) return;
    clearTimeout(contextRestoreTimer);
    contextRestoreTimer = undefined;
  };

  const requestReload = () => {
    if (reloadRequested) return;

    try {
      const lastReloadAt = Number(window.sessionStorage.getItem(LAST_AUTOMATIC_RELOAD_KEY));
      if (lastReloadAt > 0 && now() - lastReloadAt < reloadGuardMs) return;
      window.sessionStorage.setItem(LAST_AUTOMATIC_RELOAD_KEY, String(now()));
    } catch { /* session storage can be disabled */ }

    reloadRequested = true;
    clearContextRestoreTimer();
    beforeReload?.();
    reload();
  };

  const returnToForeground = () => {
    if (document.hidden) return;
    map.resize();
    map.triggerRepaint();
  };

  const handleVisibilityChange = () => {
    if (!document.hidden) returnToForeground();
  };
  const handlePageShow = () => returnToForeground();
  const handleContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    clearContextRestoreTimer();
    contextRestoreTimer = setTimeout(requestReload, contextRestoreTimeoutMs);
  };
  const handleContextRestored = () => {
    if (!contextLost) return;
    clearContextRestoreTimer();
    requestReload();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pageshow', handlePageShow);
  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);

  return () => {
    clearContextRestoreTimer();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pageshow', handlePageShow);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored);
  };
}
