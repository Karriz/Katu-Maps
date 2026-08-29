import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_RELOAD_DELAY_MS, installBackgroundReload } from './BackgroundReload';

function visibilitySource(initiallyHidden = false) {
  let listener: (() => void) | undefined;
  const source = {
    hidden: initiallyHidden,
    addEventListener: vi.fn((_event: string, nextListener: EventListenerOrEventListenerObject) => {
      listener = nextListener as () => void;
    }),
    removeEventListener: vi.fn(),
  };

  return {
    source,
    setHidden(hidden: boolean) {
      source.hidden = hidden;
      listener?.();
    },
  };
}

describe('installBackgroundReload', () => {
  it('reloads when the page returns after five minutes in the background', () => {
    let time = 1_000;
    const page = visibilitySource();
    const reload = vi.fn();
    installBackgroundReload(page.source, reload, () => time);

    page.setHidden(true);
    time += BACKGROUND_RELOAD_DELAY_MS;
    page.setHidden(false);

    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload after a shorter hidden period', () => {
    let time = 1_000;
    const page = visibilitySource();
    const reload = vi.fn();
    installBackgroundReload(page.source, reload, () => time);

    page.setHidden(true);
    time += BACKGROUND_RELOAD_DELAY_MS - 1;
    page.setHidden(false);

    expect(reload).not.toHaveBeenCalled();
  });

  it('tracks a page that is already hidden and removes its listener', () => {
    let time = 1_000;
    const page = visibilitySource(true);
    const reload = vi.fn();
    const removeListener = installBackgroundReload(page.source, reload, () => time);

    time += BACKGROUND_RELOAD_DELAY_MS;
    page.setHidden(false);
    removeListener();

    expect(reload).toHaveBeenCalledOnce();
    expect(page.source.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
