import { closestHourIndex, type ForecastGrid } from './Weather';

/** Upsample factor so a sparse model grid still samples smoothly on the globe shell. */
const TEXTURE_SCALE = 4;

export type GlobeCloudTexture = {
  data: Uint8Array;
  width: number;
  height: number;
};

/** Clouds are strongest at globe scale and fade before regional detail takes over. */
export function globeCloudOpacity(zoom: number) {
  const t = Math.min(1, Math.max(0, (zoom - 2.5) / 3));
  return 0.95 * (1 - t * t * (3 - 2 * t));
}

/** Mild contrast so broken cloud fields read more clearly at globe scale. */
export function shapeGlobeCloudCover(cover: number) {
  const clamped = Math.max(0, Math.min(100, cover));
  return clamped < 8 ? 0 : Math.min(100, (clamped - 8) * (100 / 92));
}

function sampleCover(covers: Float32Array, columns: number, rows: number, x: number, y: number) {
  const x0 = Math.max(0, Math.min(columns - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(y)));
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const at = (row: number, column: number) => covers[row * columns + column] ?? 0;
  const top = at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx;
  const bottom = at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function globeCloudPixels(grid: ForecastGrid): GlobeCloudTexture {
  const timeIndex = closestHourIndex(grid.times);
  const { columns, rows } = grid;
  const covers = new Float32Array(columns * rows);
  const value = (row: number, column: number) => {
    const cover = grid.cloudCover[row * columns + column]?.[timeIndex];
    return Number.isFinite(cover) ? Math.max(0, Math.min(100, cover)) : 0;
  };
  for (let row = 0; row < rows; row += 1) {
    const pole = row === 0 || row === rows - 1;
    const poleCover = pole ? Array.from({ length: columns - 1 }, (_, col) => value(row, col))
      .reduce((sum, cover) => sum + cover, 0) / (columns - 1) : 0;
    const seamCover = (value(row, 0) + value(row, columns - 1)) / 2;
    for (let col = 0; col < columns; col += 1) {
      covers[row * columns + col] = pole
        ? poleCover
        : col === 0 || col === columns - 1 ? seamCover : value(row, col);
    }
  }

  const width = Math.max(2, (columns - 1) * TEXTURE_SCALE + 1);
  const height = Math.max(2, (rows - 1) * TEXTURE_SCALE + 1);
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const y = (row / (height - 1)) * (rows - 1);
    for (let col = 0; col < width; col += 1) {
      const x = (col / (width - 1)) * (columns - 1);
      const cover = sampleCover(covers, columns, rows, x, y);
      const shaped = shapeGlobeCloudCover(cover);
      const offset = (row * width + col) * 4;
      data[offset] = Math.round(shaped * 2.55);
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}
