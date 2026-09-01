import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestRateGate } from './RequestRateGate';

describe('RequestRateGate', () => {
  afterEach(() => vi.useRealTimers());

  it('spaces successful request starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const gate = new RequestRateGate(1_100);

    await gate.wait(new AbortController().signal);
    let started = false;
    const second = gate.wait(new AbortController().signal).then(() => { started = true; });
    await vi.advanceTimersByTimeAsync(1_099);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(started).toBe(true);
  });

  it('does not reserve an interval for an aborted waiter', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const gate = new RequestRateGate(1_100);
    await gate.wait(new AbortController().signal);

    const cancelled = new AbortController();
    const abandoned = gate.wait(cancelled.signal);
    cancelled.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });

    let startedAt = 0;
    const latest = gate.wait(new AbortController().signal).then(() => { startedAt = Date.now(); });
    await vi.advanceTimersByTimeAsync(1_100);
    await latest;
    expect(startedAt).toBe(11_100);
  });
});
