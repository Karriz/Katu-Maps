export const INSTALL_OFFER_DELAY_MS = 7_000;
export const INSTALL_DISMISSAL_MS = 14 * 24 * 60 * 60 * 1_000;
export const INSTALL_DISMISSED_AT_KEY = 'katu-maps.install-dismissed-at';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface InstallOfferPlatform {
  events: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now(): number;
  isStandalone(): boolean;
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

export type InstallOfferListener = (visible: boolean) => void;

export class PwaInstallOffer {
  private promptEvent: InstallPromptEvent | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private visible = false;
  private started = false;

  constructor(
    private readonly platform: InstallOfferPlatform,
    private readonly listener: InstallOfferListener,
    private readonly delay = INSTALL_OFFER_DELAY_MS,
  ) {}

  start() {
    if (this.started || this.platform.isStandalone() || this.isRecentlyDismissed()) return;
    this.started = true;
    this.platform.events.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt as EventListener);
    this.platform.events.addEventListener('appinstalled', this.onAppInstalled);
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.platform.events.removeEventListener('beforeinstallprompt', this.onBeforeInstallPrompt as EventListener);
    this.platform.events.removeEventListener('appinstalled', this.onAppInstalled);
    this.clearOffer();
  }

  dismiss() {
    this.platform.storage.setItem(INSTALL_DISMISSED_AT_KEY, String(this.platform.now()));
    this.clearOffer();
  }

  async install() {
    const event = this.promptEvent;
    if (!event) return;

    this.setVisible(false);
    await event.prompt();
    const choice = await event.userChoice;
    this.promptEvent = null;
    if (choice.outcome === 'dismissed') {
      this.platform.storage.setItem(INSTALL_DISMISSED_AT_KEY, String(this.platform.now()));
    }
  }

  private readonly onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    if (this.promptEvent) return;
    this.promptEvent = event as InstallPromptEvent;
    this.timer = this.platform.setTimer(() => {
      this.timer = null;
      if (this.promptEvent) this.setVisible(true);
    }, this.delay);
  };

  private readonly onAppInstalled = () => this.clearOffer();

  private isRecentlyDismissed() {
    const dismissedAt = Number(this.platform.storage.getItem(INSTALL_DISMISSED_AT_KEY));
    return Number.isFinite(dismissedAt)
      && dismissedAt > 0
      && this.platform.now() - dismissedAt < INSTALL_DISMISSAL_MS;
  }

  private clearOffer() {
    if (this.timer !== null) this.platform.clearTimer(this.timer);
    this.timer = null;
    this.promptEvent = null;
    this.setVisible(false);
  }

  private setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.listener(visible);
  }
}

export function createBrowserInstallOffer(listener: InstallOfferListener) {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return new PwaInstallOffer({
    events: window,
    storage: localStorage,
    now: () => Date.now(),
    isStandalone: () => navigatorWithStandalone.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches,
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (timer) => window.clearTimeout(timer),
  }, listener);
}
