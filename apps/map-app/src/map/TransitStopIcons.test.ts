import { TramFront } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import {
  TRANSIT_ICON_PIXEL_RATIO,
  TRANSIT_ICON_RASTER_SIZE,
  transitIconSvg,
} from './TransitStopsLayer';

describe('transit stop icon raster', () => {
  it('provides a high-density mobile texture without changing logical size', () => {
    const svg = transitIconSvg(TramFront, '#8554c7');

    expect(TRANSIT_ICON_RASTER_SIZE / TRANSIT_ICON_PIXEL_RATIO).toBe(11);
    expect(svg).toContain(`width="${TRANSIT_ICON_RASTER_SIZE}"`);
    expect(svg).toContain(`height="${TRANSIT_ICON_RASTER_SIZE}"`);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('<circle cx="12" cy="12" r="11" fill="#8554c7"/>');
  });
});
