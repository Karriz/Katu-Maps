import { shapeGlobeCloudCover, type GlobeCloudTexture } from './GlobeClouds';

/** Near-realtime equirectangular cloud maps from https://clouds.matteason.co.uk/ */
const LIVE_CLOUD_IMAGE_URL = 'https://clouds.matteason.co.uk/images/1024x512/clouds-alpha.png';

export function liveCloudImageUrl() {
  return LIVE_CLOUD_IMAGE_URL;
}

/**
 * Convert a clouds-alpha style image (white clouds, alpha = density) into the
 * R-channel cover texture sampled by the globe shade layer.
 */
export function globeCloudPixelsFromAlphaImage(
  image: { data: ArrayLike<number>; width: number; height: number },
): GlobeCloudTexture {
  const { width, height, data } = image;
  if (width < 2 || height < 2) throw new Error('Cloud imagery was empty.');
  const pixels = new Uint8Array(width * height * 4);
  let opaque = 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const alpha = data[o + 3] ?? 0;
    // Alpha carries cloud density; RGB is near-white where clouds exist.
    const cover = (alpha / 255) * 100;
    if (alpha > 16) opaque += 1;
    const shaped = shapeGlobeCloudCover(cover);
    pixels[o] = Math.round(shaped * 2.55);
    pixels[o + 3] = 255;
  }
  if (opaque < width * height * 0.02) throw new Error('Cloud imagery coverage was too sparse.');
  return { data: pixels, width, height };
}

async function fetchImageRgba(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Cloud image request failed (${response.status}).`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : (() => {
        const element = document.createElement('canvas');
        element.width = bitmap.width;
        element.height = bitmap.height;
        return element;
      })();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cloud imagery could not be decoded.');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { data: image.data, width: image.width, height: image.height };
  } finally {
    bitmap.close();
  }
}

/** Latest hosted cloud texture (updated about every three hours). */
export async function fetchLiveCloudCover(signal?: AbortSignal): Promise<GlobeCloudTexture> {
  const image = await fetchImageRgba(liveCloudImageUrl(), signal);
  return globeCloudPixelsFromAlphaImage(image);
}
