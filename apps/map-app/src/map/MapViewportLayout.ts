import type { Map } from 'maplibre-gl';
import { panelPaddingForRects } from './RouteCamera';

export const CONTENT_PANEL_SELECTOR = '.route-panel, .transit-departures-panel, .location-info-panel, .position-information, .nearby-panel, .weather-time-slider, .day-night-time-slider';

export function closeRangeCameraOffset(): [number, number] {
  if (window.innerWidth > 760) return [0, 0];
  return [0, -Math.min(140, window.innerHeight * 0.18)];
}

export function visibleMapTargetPoint(map: Map): [number, number] {
  const mapRect = map.getContainer().getBoundingClientRect();
  let left = 0;
  let right = mapRect.width;
  let top = 0;
  let bottom = mapRect.height;
  document.querySelectorAll<HTMLElement>(CONTENT_PANEL_SELECTOR).forEach((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const overlaps = panelRect.right > mapRect.left
      && panelRect.left < mapRect.right
      && panelRect.bottom > mapRect.top
      && panelRect.top < mapRect.bottom;
    if (!overlaps) return;
    const relative = {
      left: panelRect.left - mapRect.left,
      right: panelRect.right - mapRect.left,
      top: panelRect.top - mapRect.top,
      bottom: panelRect.bottom - mapRect.top,
    };
    if (relative.bottom >= mapRect.height - 2) bottom = Math.min(bottom, relative.top);
    else if (relative.top <= 2) top = Math.max(top, relative.bottom);
    else if (relative.left <= mapRect.width / 2) left = Math.max(left, relative.right);
    else right = Math.min(right, relative.left);
  });
  if (right <= left || bottom <= top) return [mapRect.width / 2, mapRect.height / 2];
  return [(left + right) / 2, (top + bottom) / 2];
}

export function followCameraCenter(map: Map, coordinates: [number, number]): [number, number] {
  const [targetX, targetY] = visibleMapTargetPoint(map);
  const currentCenter = map.getCenter();
  const vehicleCoordinateAtTarget = map.unproject([targetX, targetY]);
  return [
    currentCenter.lng + coordinates[0] - vehicleCoordinateAtTarget.lng,
    currentCenter.lat + coordinates[1] - vehicleCoordinateAtTarget.lat,
  ];
}

export function selectionCameraOffset(map: Map): [number, number] {
  const mapRect = map.getContainer().getBoundingClientRect();
  const [targetX, targetY] = visibleMapTargetPoint(map);
  return [targetX - mapRect.width / 2, targetY - mapRect.height / 2];
}

export function panelViewportPadding(map: Map, base = 0, gap = 0) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const panelRects = [...document.querySelectorAll<HTMLElement>(CONTENT_PANEL_SELECTOR)]
    .map((panel) => panel.getBoundingClientRect());
  return panelPaddingForRects(mapRect, panelRects, base, gap);
}

export function searchViewportPadding(map: Map) {
  const mapRect = map.getContainer().getBoundingClientRect();
  const obscuringRects = [...document.querySelectorAll<HTMLElement>(
    '.location-search-form, .route-panel, .transit-departures-panel, .location-info-panel',
  )].map((element) => element.getBoundingClientRect());
  return panelPaddingForRects(mapRect, obscuringRects, window.innerWidth <= 760 ? 28 : 44, 16);
}
