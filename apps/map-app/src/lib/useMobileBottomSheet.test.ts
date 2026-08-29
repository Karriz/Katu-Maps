import { describe, expect, it } from 'vitest';
import { destinationSheetSnap, mobileSheetSnapHeights } from './useMobileBottomSheet';

describe('mobile bottom sheet snapping', () => {
  it('produces stable ordered snap heights', () => {
    expect(mobileSheetSnapHeights(800)).toEqual({ collapsed: 104, half: 416, expanded: 788 });
  });

  it('uses position and release velocity to choose a destination', () => {
    expect(destinationSheetSnap(400, 0, 800)).toBe('half');
    expect(destinationSheetSnap(400, -2, 800)).toBe('expanded');
    expect(destinationSheetSnap(400, 2, 800)).toBe('collapsed');
  });
});
