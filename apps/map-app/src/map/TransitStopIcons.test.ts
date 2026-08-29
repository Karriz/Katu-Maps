import { TramFront } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  TRANSIT_ICON_PIXEL_RATIO,
  TRANSIT_ICON_RASTER_SIZE,
  TRANSIT_ICON_CONTENT_INSET,
  transitIconSvg,
} from './TransitStopsLayer';

describe('transit stop icon raster', () => {
  it('uses a deterministic padded @2x bitmap', () => {
    const svg = transitIconSvg(TramFront, '#8554c7');

    expect(TRANSIT_ICON_RASTER_SIZE).toBe(64);
    expect(TRANSIT_ICON_PIXEL_RATIO).toBe(2);
    expect(TRANSIT_ICON_CONTENT_INSET).toBe(8);
    expect(svg).toContain('width="48"');
    expect(svg).toContain('height="48"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('<circle cx="12" cy="12" r="12" fill="#8554c7"/>');
  });
});
