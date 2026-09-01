export class ApiHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

function retryAfterSeconds(response: Response) {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

/** Combines caller cancellation with a bounded provider request. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error('Service request timed out. Please try again.');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

export function apiHttpError(response: Response, provider: string) {
  const retryAfter = retryAfterSeconds(response);
  const suffix = response.status === 429 && retryAfter !== undefined ? `; retry after ${retryAfter} seconds` : '';
  return new ApiHttpError(`${provider} returned HTTP ${response.status}${suffix}`, response.status, retryAfter);
}
