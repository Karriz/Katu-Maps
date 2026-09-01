import { describe, expect, it } from 'vitest';
import { nextAutocompleteIndex } from './useAutocompleteNavigation';

describe('nextAutocompleteIndex', () => {
  it('cycles down through results and back to no selection', () => {
    expect(nextAutocompleteIndex(-1, 3, 1)).toBe(0);
    expect(nextAutocompleteIndex(2, 3, 1)).toBe(-1);
  });

  it('cycles up through results and back to no selection', () => {
    expect(nextAutocompleteIndex(-1, 3, -1)).toBe(2);
    expect(nextAutocompleteIndex(0, 3, -1)).toBe(-1);
  });

  it('never highlights an empty result set', () => {
    expect(nextAutocompleteIndex(-1, 0, 1)).toBe(-1);
  });
});
