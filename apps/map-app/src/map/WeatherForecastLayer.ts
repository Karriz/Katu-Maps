import type { ImageSource, Map, RasterLayerSpecification } from 'maplibre-gl';
import {
  closestHourIndex,
  renderForecastImage,
  type ForecastGrid,
  type WeatherOverlayVariable,
} from './Weather';

const SOURCE_ID = 'weather-forecast';
const LAYER_ID = 'weather-forecast-overlay';

export const WEATHER_FORECAST_LAYER_IDS = [LAYER_ID] as const;

function overlayCoordinates(grid: ForecastGrid): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [grid.west, grid.north],
    [grid.east, grid.north],
    [grid.east, grid.south],
    [grid.west, grid.south],
  ];
}

function firstSymbolLayerId(map: Map) {
  return (map.getStyle().layers ?? []).find((layer) => layer.type === 'symbol')?.id;
}

export class WeatherForecastLayer {
  private map: Map | null = null;
  private grid: ForecastGrid | null = null;
  private timeIndex = 0;
  private variable: WeatherOverlayVariable = 'cloud';

  install(map: Map) {
    this.map = map;
    this.sync();
  }

  setForecast(grid: ForecastGrid | null, time: string | undefined, variable: WeatherOverlayVariable) {
    this.grid = grid;
    this.variable = variable;
    this.timeIndex = grid && time ? Math.max(0, grid.times.indexOf(time)) : grid ? closestHourIndex(grid.times) : 0;
    if (this.timeIndex < 0) this.timeIndex = closestHourIndex(grid?.times ?? []);
    this.sync();
  }

  clear() {
    this.grid = null;
    this.remove();
  }

  dispose() {
    this.clear();
    this.map = null;
  }

  private sync() {
    const map = this.map;
    const grid = this.grid;
    if (!map || !grid || !grid.times.length) {
      this.remove();
      return;
    }
    const url = renderForecastImage(grid, this.variable, this.timeIndex);
    const coordinates = overlayCoordinates(grid);
    const source = map.getSource(SOURCE_ID) as ImageSource | undefined;
    if (source) {
      source.updateImage({ url, coordinates });
    } else {
      map.addSource(SOURCE_ID, { type: 'image', url, coordinates });
    }
    if (!map.getLayer(LAYER_ID)) {
      const layer: RasterLayerSpecification = {
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: {
          'raster-opacity': 0.78,
          'raster-fade-duration': 0,
        },
      };
      const beforeId = firstSymbolLayerId(map);
      if (beforeId) map.addLayer(layer, beforeId);
      else map.addLayer(layer);
    }
  }

  private remove() {
    const map = this.map;
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }
}
