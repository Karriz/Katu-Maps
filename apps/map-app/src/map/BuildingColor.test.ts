import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { buildingColorExpression } from './BuildingColor';

function evaluateBuildingColor(themeColor: string, properties: Record<string, unknown>, id: number) {
  const compiled = createExpression(buildingColorExpression(themeColor), 'fill-color');
  if (compiled.result !== 'success') throw new Error('Invalid building color expression');
  const color = compiled.value.evaluate(
    { zoom: 16 },
    { type: 'Polygon', properties, id },
  );
  return [color.r, color.g, color.b, color.a];
}

function saturation([r, g, b]: number[]) {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  return maximum === 0 ? 0 : (maximum - minimum) / maximum;
}

describe('building colors', () => {
  it('desaturates vivid OpenMapTiles colours into calmer material tones', () => {
    const color = evaluateBuildingColor('#ffffff', { colour: '#ff0000' }, 4);

    expect(saturation(color)).toBeLessThan(0.5);
    expect(color[0]).toBeGreaterThan(color[1]);
    expect(Math.abs(color[1] - color[2])).toBeLessThan(0.05);
    expect(color[3]).toBe(1);
  });

  it('lifts black OSM colours to a neutral gray', () => {
    const [r, g, b] = evaluateBuildingColor('#ffffff', { colour: '#000000' }, 4);

    expect(Math.min(r, g, b)).toBeGreaterThan(0.4);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.04);
  });

  it('uses stable, varied colors when OSM has no building colour', () => {
    const first = evaluateBuildingColor('#ffffff', {}, 25);

    expect(evaluateBuildingColor('#ffffff', {}, 25)).toEqual(first);
    expect(evaluateBuildingColor('#ffffff', {}, 26)).not.toEqual(first);
  });

  it('falls back safely when an OSM colour cannot be parsed', () => {
    expect(evaluateBuildingColor('#293f53', { colour: 'not-a-color' }, 8))
      .toEqual(evaluateBuildingColor('#293f53', { colour: '#293f53' }, 8));
  });
});
