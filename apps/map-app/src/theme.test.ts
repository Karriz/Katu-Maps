import { describe, expect, it } from 'vitest';
import { resolveThemePreference } from './theme';

describe('theme preference resolution', () => {
  it('uses the explicit preference when selected', () => {
    expect(resolveThemePreference('light', 'dark')).toBe('light');
    expect(resolveThemePreference('dark', 'light')).toBe('dark');
  });

  it('follows the operating system only in System mode', () => {
    expect(resolveThemePreference('system', 'dark')).toBe('dark');
    expect(resolveThemePreference('system', 'light')).toBe('light');
  });
});
