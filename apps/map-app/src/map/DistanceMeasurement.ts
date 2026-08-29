export type Coordinate = [number, number];

const EARTH_RADIUS_METRES = 6_371_008.8;

function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

/** Great-circle distance using the haversine formula. */
export function geodesicDistanceMetres(from: Coordinate, to: Coordinate) {
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const fromLatitude = radians(from[1]);
  const toLatitude = radians(to[1]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function formatMeasuredDistance(metres: number) {
  if (metres < 1_000) return `${Math.round(metres)} m`;
  const kilometres = metres / 1_000;
  if (kilometres < 10) return `${kilometres.toFixed(2)} km`;
  if (kilometres < 100) return `${kilometres.toFixed(1)} km`;
  return `${Math.round(kilometres)} km`;
}

type MeasurementSource = { setData(data: unknown): void };

export interface MeasurementMap {
  addSource(id: string, source: unknown): void;
  addLayer(layer: unknown): void;
  getSource(id: string): unknown;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  on(event: 'move', listener: () => void): void;
  off(event: 'move', listener: () => void): void;
  getCanvas(): { clientWidth: number; clientHeight: number };
  unproject(point: [number, number]): { lng: number; lat: number };
}

export type MeasurementUpdate = {
  start: Coordinate;
  end: Coordinate;
  metres: number;
};

const SOURCE_ID = 'distance-measurement';
const LINE_LAYER_ID = 'distance-measurement-line';
const POINT_LAYER_ID = 'distance-measurement-start';

/** Owns every temporary map resource and listener used by one measurement. */
export class DistanceMeasurement {
  private active = false;

  constructor(
    private readonly map: MeasurementMap,
    private readonly start: Coordinate,
    private readonly onUpdate: (measurement: MeasurementUpdate) => void,
  ) {}

  startMode() {
    if (this.active) return;
    this.active = true;
    this.map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#8b5cf6', 'line-width': 4, 'line-dasharray': [2, 1.4] },
    });
    this.map.addLayer({
      id: POINT_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 8,
        'circle-color': '#8b5cf6',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
    this.map.on('move', this.update);
    this.update();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.map.off('move', this.update);
    [POINT_LAYER_ID, LINE_LAYER_ID].forEach((id) => {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    });
    if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
  }

  private readonly update = () => {
    if (!this.active) return;
    const canvas = this.map.getCanvas();
    const centre = this.map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
    const end: Coordinate = [centre.lng, centre.lat];
    const metres = geodesicDistanceMetres(this.start, end);
    (this.map.getSource(SOURCE_ID) as MeasurementSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: [this.start, end] } },
        { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: this.start } },
      ],
    });
    this.onUpdate({ start: this.start, end, metres });
  };
}
