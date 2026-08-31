import { describe, expect, it } from 'vitest';
import { routeExecutionErrorMessage } from './useRouteExecution';

describe('route execution errors', () => {
  it('normalizes network failures for users', () => {
    expect(routeExecutionErrorMessage(new TypeError('Failed to fetch'))).toContain('temporarily unavailable');
    expect(routeExecutionErrorMessage(new Error('No transit route options were returned'))).toBe('No transit route options were returned');
    expect(routeExecutionErrorMessage({})).toBe('Could not calculate a route');
  });
});
