import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_DISMISSAL_MS,
  INSTALL_DISMISSED_AT_KEY,
  PwaInstallOffer,
  type InstallPromptEvent,
} from './PwaInstallOffer';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

function setup(options: { standalone?: boolean; now?: number; storage?: MemoryStorage } = {}) {
  const events = new EventTarget();
  const storage = options.storage ?? new MemoryStorage();
  const listener = vi.fn();
  const offer = new PwaInstallOffer({
    events,
    storage,
    now: () => options.now ?? 1_000_000,
    isStandalone: () => options.standalone ?? false,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer),
  }, listener, 7_000);
  offer.start();
  return { events, listener, offer, storage };
}

describe('PwaInstallOffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows an offer after the delay when the browser supplies a prompt', () => {
    const { events, listener } = setup();
    events.dispatchEvent(promptEvent());
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(7_000);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('opens the captured prompt and handles an accepted choice', async () => {
    const { events, listener, offer } = setup();
    const event = promptEvent('accepted');
    events.dispatchEvent(event);
    vi.advanceTimersByTime(7_000);
    await offer.install();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it('persists Not now for fourteen days and permits an offer afterwards', () => {
    const storage = new MemoryStorage();
    const first = setup({ storage, now: 10_000 });
    first.offer.dismiss();
    expect(storage.getItem(INSTALL_DISMISSED_AT_KEY)).toBe('10000');

    const suppressed = setup({ storage, now: 10_000 + INSTALL_DISMISSAL_MS - 1 });
    suppressed.events.dispatchEvent(promptEvent());
    vi.advanceTimersByTime(7_000);
    expect(suppressed.listener).not.toHaveBeenCalled();

    const eligible = setup({ storage, now: 10_000 + INSTALL_DISMISSAL_MS });
    eligible.events.dispatchEvent(promptEvent());
    vi.advanceTimersByTime(7_000);
    expect(eligible.listener).toHaveBeenCalledWith(true);
  });

  it('suppresses the offer in standalone mode', () => {
    const { events, listener } = setup({ standalone: true });
    events.dispatchEvent(promptEvent());
    vi.advanceTimersByTime(7_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stays quiet when beforeinstallprompt is unsupported', () => {
    const { listener } = setup();
    vi.advanceTimersByTime(30_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('closes and invalidates an offer when installation completes', async () => {
    const { events, listener, offer } = setup();
    const event = promptEvent();
    events.dispatchEvent(event);
    vi.advanceTimersByTime(7_000);
    events.dispatchEvent(new Event('appinstalled'));
    expect(listener).toHaveBeenLastCalledWith(false);
    await offer.install();
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('removes listeners and pending timers when stopped', () => {
    const { events, listener, offer } = setup();
    events.dispatchEvent(promptEvent());
    offer.stop();
    vi.advanceTimersByTime(7_000);
    events.dispatchEvent(promptEvent());
    vi.advanceTimersByTime(7_000);
    expect(listener).not.toHaveBeenCalled();
  });
});
