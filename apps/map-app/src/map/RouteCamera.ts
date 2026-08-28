export type ViewportRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>;

export type CameraPadding = { top: number; right: number; bottom: number; left: number };

export function panelPaddingForRects(
  mapRect: ViewportRect,
  panelRects: ViewportRect[],
  base = 0,
  gap = 0,
): CameraPadding {
  const padding = { top: base, right: base, bottom: base, left: base };
  for (const panelRect of panelRects) {
    const overlaps = panelRect.right > mapRect.left
      && panelRect.left < mapRect.right
      && panelRect.bottom > mapRect.top
      && panelRect.top < mapRect.bottom;
    if (!overlaps) continue;
    if (panelRect.width >= mapRect.width * 0.75) {
      if (panelRect.bottom >= mapRect.bottom - 2) {
        padding.bottom = Math.max(padding.bottom, mapRect.bottom - panelRect.top + gap);
      } else {
        padding.top = Math.max(padding.top, panelRect.bottom - mapRect.top + gap);
      }
    } else if (panelRect.left <= mapRect.left + mapRect.width / 2) {
      padding.left = Math.max(padding.left, panelRect.right - mapRect.left + gap);
    } else {
      padding.right = Math.max(padding.right, mapRect.right - panelRect.left + gap);
    }
  }
  return padding;
}

export function coordinateBounds(coordinates: [number, number][]) {
  if (coordinates.length < 2) return null;
  return coordinates.reduce(
    (bounds, [lng, lat]) => ({
      minLng: Math.min(bounds.minLng, lng),
      minLat: Math.min(bounds.minLat, lat),
      maxLng: Math.max(bounds.maxLng, lng),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity },
  );
}

export function removeIsolatedCoordinateOutliers(coordinates: [number, number][], maximumJump = 5) {
  if (coordinates.length < 3) return coordinates;
  const distance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return coordinates.filter((coordinate, index) => {
    if (index === 0 || index === coordinates.length - 1) return true;
    const previous = coordinates[index - 1];
    const next = coordinates[index + 1];
    return !(distance(previous, coordinate) > maximumJump
      && distance(coordinate, next) > maximumJump
      && distance(previous, next) <= maximumJump);
  });
}
