import { describe, expect, it } from 'vitest';
import { configuredInterval } from './ServiceConfig';

describe('configuredInterval', () => {
  it('uses the fallback for invalid values', () => {
    expect(configuredInterval(undefined, 15_000, 15_000)).toBe(15_000);
    expect(configuredInterval('invalid', 15_000, 15_000)).toBe(15_000);
  });

  it('enforces the provider-friendly minimum', () => {
    expect(configuredInterval('5000', 15_000, 15_000)).toBe(15_000);
    expect(configuredInterval('30000', 15_000, 15_000)).toBe(30_000);
  });
});
