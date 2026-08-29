export type RasterizeMapIconOptions = {
  bitmapSize?: number;
  contentInset?: number;
};

/**
 * Rasterize an SVG into a fixed, transparent bitmap before handing it to
 * MapLibre. Keeping atlas input dimensions and transparent gutters explicit
 * avoids browser-dependent SVG sizing and keeps painted pixels away from
 * neighbouring atlas entries.
 */
export async function rasterizeMapIcon(
  svg: string,
  { bitmapSize = 64, contentInset = 8 }: RasterizeMapIconOptions = {},
): Promise<ImageData> {
  if (contentInset < 0 || contentInset * 2 >= bitmapSize) {
    throw new Error('Map icon content inset must leave a positive drawing area');
  }

  const image = new Image();
  image.decoding = 'sync';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to rasterize map icon SVG'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = bitmapSize;
  canvas.height = bitmapSize;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Unable to create map icon rasterization context');

  context.clearRect(0, 0, bitmapSize, bitmapSize);
  const contentSize = bitmapSize - contentInset * 2;
  context.drawImage(image, contentInset, contentInset, contentSize, contentSize);
  return context.getImageData(0, 0, bitmapSize, bitmapSize);
}
