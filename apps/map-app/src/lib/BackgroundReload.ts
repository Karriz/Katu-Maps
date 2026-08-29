export const BACKGROUND_RELOAD_DELAY_MS = 5 * 60_000;

type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

/**
 * Reload after a prolonged hidden period so WebGL starts with a fresh context.
 */
export function installBackgroundReload(
  document: VisibilitySource,
  reload: () => void,
  now: () => number = Date.now,
  delayMs = BACKGROUND_RELOAD_DELAY_MS,
) {
  let hiddenAt: number | null = document.hidden ? now() : null;

  const handleVisibilityChange = () => {
    if (document.hidden) {
      hiddenAt = now();
      return;
    }

    if (hiddenAt !== null && now() - hiddenAt >= delayMs) reload();
    hiddenAt = null;
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}
