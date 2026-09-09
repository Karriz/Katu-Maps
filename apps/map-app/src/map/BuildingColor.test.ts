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

describe('building colors', () => {
  it('softens OpenMapTiles colour values toward the theme', () => {
    const color = evaluateBuildingColor('#ffffff', { colour: '#ff0000' }, 4);

    expect(color).toEqual([1, 0.72, 0.72, 1]);
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
