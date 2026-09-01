import { describe, expect, it } from 'vitest';
import { ApiHttpError, apiHttpError } from './ApiRequest';

describe('apiHttpError', () => {
  it('preserves rate-limit retry guidance', () => {
    const error = apiHttpError(new Response(null, {
      status: 429,
      headers: { 'retry-after': '12' },
    }), 'Photon');

    expect(error).toBeInstanceOf(ApiHttpError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
    expect(error.message).toContain('retry after 12 seconds');
  });

  it('handles ordinary provider failures without retry metadata', () => {
    const error = apiHttpError(new Response(null, { status: 503 }), 'Transitous');
    expect(error.status).toBe(503);
    expect(error.retryAfterSeconds).toBeUndefined();
  });
});
