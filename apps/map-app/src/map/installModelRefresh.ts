import type { Map, MapSourceDataEvent } from 'maplibre-gl';
import { scheduleSceneJobs } from './flight/FlightSceneScheduler';
import { OPENFREEMAP_SOURCE_ID } from './GlobalMapStyle';
import type { MapLayerRuntime } from './MapLayerRuntime';
import { treeViewportSignature } from './TreeModelLayer';

type ModelRefreshOptions = {
  map: Map;
  layers: MapLayerRuntime;
  terrainSource: () => string;
  terrainEnabled: () => boolean;
  immersiveActive: () => boolean;
};

export function installModelRefresh({
  map,
  layers,
  terrainSource,
  terrainEnabled,
  immersiveActive,
}: ModelRefreshOptions) {
  let updateTimer: number | undefined;
  let cancelIdleJobs: (() => void) | undefined;
  let dataRevision = 0;
  let lastUpdateSignature: string | undefined;

  const modelUpdateSignature = () => {
    const bounds = map.getBounds();
    return treeViewportSignature(
      {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      map.getZoom(),
      map.getPitch(),
      terrainSource(),
      terrainEnabled(),
      Math.floor(map.getZoom() + 1e-6),
    );
  };

  const update = () => {
    updateTimer = undefined;
    if (immersiveActive()) return;
    if (map.isMoving()) {
      schedule();
      return;
    }
    layers.bridge.updateBridges();
    map.once('idle', () => {
      layers.selectedRouteDeck.rebuildFromCurrentFeatures();
      layers.transitStopRouteDeck.rebuildFromCurrentFeatures();
    });
    const nextSignature = `${modelUpdateSignature()}:${dataRevision}`;
    if (nextSignature === lastUpdateSignature) return;
    layers.tree.updateTrees(() => { lastUpdateSignature = nextSignature; });
  };

  function schedule() {
    if (updateTimer !== undefined) window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 120);
  }

  const invalidate = () => {
    layers.bridge.invalidateTerrain();
    layers.tree.invalidateTerrain();
    layers.roof.invalidateSource();
    layers.facade.invalidateSource();
    dataRevision += 1;
    schedule();
  };

  const handleSourceData = (event: MapSourceDataEvent) => {
    if (event.sourceId === terrainSource() && event.sourceDataType === 'content') {
      invalidate();
      map.once('idle', () => {
        layers.selectedRouteDeck.rebuildFromCurrentFeatures();
        layers.transitStopRouteDeck.rebuildFromCurrentFeatures();
      });
      return;
    }
    if (event.sourceId !== OPENFREEMAP_SOURCE_ID || event.sourceDataType !== 'content') return;
    if (immersiveActive()) layers.bridge.markSourceDirty();
    else layers.bridge.invalidateSource();
    layers.tree.cancelTreeJobs();
    layers.roof.invalidateSource();
    layers.facade.invalidateSource();
    dataRevision += 1;
    schedule();
  };

  const handleIdle = () => {
    if (immersiveActive() || cancelIdleJobs) return;
    cancelIdleJobs = scheduleSceneJobs([
      () => { if (layers.roof.updateRoofs()) map.triggerRepaint(); },
      () => { if (layers.facade.updateFacades()) map.triggerRepaint(); },
      schedule,
    ], () => { cancelIdleJobs = undefined; });
  };

  map.on('sourcedata', handleSourceData);
  map.on('idle', handleIdle);

  return {
    schedule,
    invalidate,
    dispose() {
      if (updateTimer !== undefined) window.clearTimeout(updateTimer);
      cancelIdleJobs?.();
      map.off('sourcedata', handleSourceData);
      map.off('idle', handleIdle);
    },
  };
}
