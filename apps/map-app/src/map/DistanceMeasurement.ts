import type { GeoJSONSource, Map, MapMouseEvent } from 'maplibre-gl';

export type Coordinate = [number, number];

export type Measurement = {
  points: Coordinate[];
  metres: number;
};

const EARTH_RADIUS_METRES = 6_371_008.8;
export const MEASUREMENT_SOURCE_ID = 'distance-measurement';
export const MEASUREMENT_LAYER_IDS = ['distance-measurement-line', 'distance-measurement-points'] as const;

export function geodesicDistance(start: Coordinate, end: Coordinate) {
  const radians = Math.PI / 180;
  const latitudeDelta = (end[1] - start[1]) * radians;
  const longitudeDelta = (end[0] - start[0]) * radians;
  const startLatitude = start[1] * radians;
  const endLatitude = end[1] * radians;
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function pathDistance(points: Coordinate[]) {
  return points.slice(1).reduce((total, point, index) => (
    total + geodesicDistance(points[index], point)
  ), 0);
}

export function formatDistance(metres: number) {
  if (metres < 1_000) return `${Math.round(metres)} m`;
  const kilometres = metres / 1_000;
  return `${kilometres.toFixed(kilometres < 10 ? 2 : kilometres < 100 ? 1 : 0)} km`;
}

function measurementData(points: Coordinate[]) {
  const features: Array<{
    type: 'Feature';
    properties: { kind: 'line' | 'point'; pointIndex?: number };
    geometry: { type: 'LineString'; coordinates: Coordinate[] } | { type: 'Point'; coordinates: Coordinate };
  }> = points.map((point, pointIndex) => ({
    type: 'Feature',
    properties: { kind: 'point', pointIndex },
    geometry: { type: 'Point', coordinates: point },
  }));
  if (points.length > 1) {
    features.unshift({
      type: 'Feature',
      properties: { kind: 'line' },
      geometry: { type: 'LineString', coordinates: points },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

export class DistanceMeasurementController {
  private points: Coordinate[];
  private readonly handleClick = (event: MapMouseEvent) => {
    const pointFeature = this.map.queryRenderedFeatures(event.point, { layers: [MEASUREMENT_LAYER_IDS[1]] })[0];
    const pointIndex = Number(pointFeature?.properties?.pointIndex);
    if (Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < this.points.length) {
      this.removePoint(pointIndex);
      return;
    }
    this.points = [...this.points, [event.lngLat.lng, event.lngLat.lat]];
    this.update();
  };
  private readonly handlePointEnter = () => { this.map.getCanvas().style.cursor = 'pointer'; };
  private readonly handlePointLeave = () => { this.map.getCanvas().style.cursor = ''; };

  constructor(
    private readonly map: Map,
    start: Coordinate,
    private readonly onChange: (measurement: Measurement) => void,
  ) {
    this.points = [[...start]];
    this.map.addSource(MEASUREMENT_SOURCE_ID, { type: 'geojson', data: measurementData(this.points) });
    this.map.addLayer({
      id: MEASUREMENT_LAYER_IDS[0], type: 'line', source: MEASUREMENT_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'line'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#b45309', 'line-width': 4, 'line-opacity': 0.9 },
    });
    this.map.addLayer({
      id: MEASUREMENT_LAYER_IDS[1], type: 'circle', source: MEASUREMENT_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'point'],
      paint: {
        'circle-radius': 8,
        'circle-color': ['case', ['==', ['get', 'pointIndex'], 0], '#f59e0b', '#b45309'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    this.map.on('click', this.handleClick);
    this.map.on('mouseenter', MEASUREMENT_LAYER_IDS[1], this.handlePointEnter);
    this.map.on('mouseleave', MEASUREMENT_LAYER_IDS[1], this.handlePointLeave);
    this.emit();
  }

  private emit() {
    this.onChange({ points: this.points, metres: pathDistance(this.points) });
  }

  private update() {
    (this.map.getSource(MEASUREMENT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(measurementData(this.points));
    this.emit();
  }

  private removePoint(pointIndex: number) {
    if (this.points.length <= 1) return;
    this.points = this.points.filter((_, index) => index !== pointIndex);
    this.update();
  }

  undo() {
    if (this.points.length <= 1) return;
    this.points = this.points.slice(0, -1);
    this.update();
  }

  dispose() {
    this.map.off('click', this.handleClick);
    this.map.off('mouseenter', MEASUREMENT_LAYER_IDS[1], this.handlePointEnter);
    this.map.off('mouseleave', MEASUREMENT_LAYER_IDS[1], this.handlePointLeave);
    this.map.getCanvas().style.cursor = '';
    [...MEASUREMENT_LAYER_IDS].reverse().forEach((id) => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    if (this.map.getSource(MEASUREMENT_SOURCE_ID)) this.map.removeSource(MEASUREMENT_SOURCE_ID);
  }
}
