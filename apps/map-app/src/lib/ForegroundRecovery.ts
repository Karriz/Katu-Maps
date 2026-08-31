export const BACKGROUND_RECOVERY_DELAY_MS = 15_000;
export const AUTOMATIC_RELOAD_GUARD_MS = 60_000;

const LAST_AUTOMATIC_RELOAD_KEY = 'map:last-automatic-reload';

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
  backgroundDelayMs?: number;
  reloadGuardMs?: number;
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
  backgroundDelayMs = BACKGROUND_RECOVERY_DELAY_MS,
  reloadGuardMs = AUTOMATIC_RELOAD_GUARD_MS,
}: ForegroundRecoveryOptions) {
  let backgroundAt: number | null = document.hidden ? now() : null;
  let reloadRequested = false;

  const requestReload = (ignoreRecentReload = false) => {
    if (reloadRequested) return;

    try {
      const lastReloadAt = Number(window.sessionStorage.getItem(LAST_AUTOMATIC_RELOAD_KEY));
      if (!ignoreRecentReload && lastReloadAt > 0 && now() - lastReloadAt < reloadGuardMs) return;
      window.sessionStorage.setItem(LAST_AUTOMATIC_RELOAD_KEY, String(now()));
    } catch { /* session storage can be disabled */ }

    reloadRequested = true;
    beforeReload?.();
    reload();
  };

  const enterBackground = () => {
    backgroundAt ??= now();
  };

  const returnToForeground = () => {
    if (document.hidden) return;
    const elapsed = backgroundAt === null ? 0 : now() - backgroundAt;
    backgroundAt = null;
    map.resize();
    map.triggerRepaint();
    if (elapsed >= backgroundDelayMs) requestReload(true);
  };

  const handleVisibilityChange = () => {
    if (document.hidden) enterBackground();
    else returnToForeground();
  };
  const handlePageShow = () => returnToForeground();
  const handleContextLost = (event: Event) => {
    event.preventDefault();
    requestReload();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', enterBackground);
  window.addEventListener('pageshow', handlePageShow);
  canvas.addEventListener('webglcontextlost', handleContextLost);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', enterBackground);
    window.removeEventListener('pageshow', handlePageShow);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
  };
}
