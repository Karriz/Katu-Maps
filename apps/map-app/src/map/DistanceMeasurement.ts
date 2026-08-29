import type { GeoJSONSource, Map } from 'maplibre-gl';

export type Coordinate = [number, number];

export type Measurement = {
  start: Coordinate;
  end: Coordinate;
  metres: number;
};

const EARTH_RADIUS_METRES = 6_371_008.8;
export const MEASUREMENT_SOURCE_ID = 'distance-measurement';
export const MEASUREMENT_LAYER_IDS = ['distance-measurement-line', 'distance-measurement-start'] as const;

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

export function formatDistance(metres: number) {
  if (metres < 1_000) return `${Math.round(metres)} m`;
  const kilometres = metres / 1_000;
  return `${kilometres.toFixed(kilometres < 10 ? 2 : kilometres < 100 ? 1 : 0)} km`;
}

function measurementData(start: Coordinate, end: Coordinate) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, properties: { kind: 'line' }, geometry: { type: 'LineString' as const, coordinates: [start, end] } },
      { type: 'Feature' as const, properties: { kind: 'start' }, geometry: { type: 'Point' as const, coordinates: start } },
    ],
  };
}

export class DistanceMeasurementController {
  private readonly handleMove = () => this.update();

  constructor(
    private readonly map: Map,
    private readonly start: Coordinate,
    private readonly onChange: (measurement: Measurement) => void,
  ) {
    const end = this.map.getCenter().toArray() as Coordinate;
    this.map.addSource(MEASUREMENT_SOURCE_ID, { type: 'geojson', data: measurementData(start, end) });
    this.map.addLayer({
      id: MEASUREMENT_LAYER_IDS[0], type: 'line', source: MEASUREMENT_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'line'],
      paint: { 'line-color': '#b45309', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [1.5, 1] },
    });
    this.map.addLayer({
      id: MEASUREMENT_LAYER_IDS[1], type: 'circle', source: MEASUREMENT_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'start'],
      paint: { 'circle-radius': 8, 'circle-color': '#f59e0b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
    });
    this.map.on('move', this.handleMove);
    this.emit(end);
  }

  private emit(end: Coordinate) {
    this.onChange({ start: this.start, end, metres: geodesicDistance(this.start, end) });
  }

  private update() {
    const end = this.map.getCenter().toArray() as Coordinate;
    (this.map.getSource(MEASUREMENT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(measurementData(this.start, end));
    this.emit(end);
  }

  dispose() {
    this.map.off('move', this.handleMove);
    [...MEASUREMENT_LAYER_IDS].reverse().forEach((id) => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    if (this.map.getSource(MEASUREMENT_SOURCE_ID)) this.map.removeSource(MEASUREMENT_SOURCE_ID);
  }
}
