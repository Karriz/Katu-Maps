import type { PatternImage } from './GroundPatterns';

export const WATER_PATTERN_ID = 'water-surface-pattern';

export function* generateWaterPattern(size: number): Generator<void, PatternImage> {
  const data = new Uint8ClampedArray(size * size * 4);
  const shadow = [92, 171, 194];
  const highlight = [157, 216, 227];
  const tau = Math.PI * 2;

  for (let y = 0; y < size; y += 1) {
    yield;
    for (let x = 0; x < size; x += 1) {
      const horizontal = (x / size) * tau;
      const vertical = (y / size) * tau;
      // Integer-frequency waves meet at every edge, making the generated
      // image seamless when MapLibre repeats it across water polygons.
      const broad = Math.sin(horizontal + vertical * 2) * 0.18
        + Math.cos(horizontal * 2 - vertical) * 0.12;
      // Fine elongated ripples cross a broader current. Keep every frequency
      // integral so the static surface stays seamless and deterministic.
      const current = horizontal * 3 + vertical * 11
        + Math.sin(horizontal * 2 - vertical) * 0.7;
      const ripples = Math.sin(current) * 0.11
        + Math.sin(horizontal * 5 + vertical * 19) * 0.04;
      const glint = Math.pow(Math.max(0, Math.cos(current)), 12) * 0.16;
      const shade = Math.max(0, Math.min(1, 0.43 + broad + ripples + glint));
      const offset = (y * size + x) * 4;

      data[offset] = Math.round(shadow[0] + (highlight[0] - shadow[0]) * shade);
      data[offset + 1] = Math.round(shadow[1] + (highlight[1] - shadow[1]) * shade);
      data[offset + 2] = Math.round(shadow[2] + (highlight[2] - shadow[2]) * shade);
      data[offset + 3] = 255;
    }
  }

  return { width: size, height: size, data };
}
