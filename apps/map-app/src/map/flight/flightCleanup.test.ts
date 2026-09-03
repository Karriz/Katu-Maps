import { describe, expect, it, vi } from 'vitest';
import { runIndependentRestoreSteps } from './flightCleanup';

describe('flight cleanup', () => {
  it('continues remaining restore steps after one fails', () => {
    const later = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    runIndependentRestoreSteps([
      { label: 'clip', run: () => { throw new Error('clip failed'); } },
      { label: 'camera', run: later },
    ]);

    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
