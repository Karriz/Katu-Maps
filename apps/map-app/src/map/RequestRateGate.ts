function aborted() {
  return new DOMException('Aborted', 'AbortError');
}

function delay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = () => {
      globalThis.clearTimeout(timer);
      reject(aborted());
    };
    const timer = globalThis.setTimeout(finish, milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** Serializes request starts while allowing cancelled waiters to leave no empty reservation. */
export class RequestRateGate {
  private queue: Promise<void> = Promise.resolve();
  private lastStartedAt: number | undefined;

  constructor(private readonly intervalMs: number) {}

  wait(signal: AbortSignal) {
    const turn = this.queue.catch(() => undefined).then(async () => {
      if (signal.aborted) throw aborted();
      if (this.lastStartedAt !== undefined) {
        const remaining = Math.max(0, this.intervalMs - (Date.now() - this.lastStartedAt));
        if (remaining) await delay(remaining, signal);
      }
      if (signal.aborted) throw aborted();
      this.lastStartedAt = Date.now();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }
}
