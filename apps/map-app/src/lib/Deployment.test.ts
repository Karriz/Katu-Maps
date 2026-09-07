import { describe, expect, it } from 'vitest';
import { deploymentStorageKey } from './Deployment';

describe('deployment storage isolation', () => {
  it('retains production keys and separates preview writes', () => {
    expect(deploymentStorageKey('maps-favorites-v1', false)).toBe('maps-favorites-v1');
    expect(deploymentStorageKey('maps-favorites-v1', true)).toBe('katu-preview:maps-favorites-v1');
  });
});
