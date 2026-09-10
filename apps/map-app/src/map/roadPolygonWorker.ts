import { buildRoadCellPolygons, type RoadCenterline, type RoadWorkCell } from './RoadPolygonGeometry';

export type RoadPolygonWorkerRequest = {
  requestId: number;
  cell: RoadWorkCell;
  lines: RoadCenterline[];
};

export type RoadPolygonWorkerResponse = {
  requestId: number;
  cellKey: string;
  ok: boolean;
  polygons?: ReturnType<typeof buildRoadCellPolygons>['polygons'];
  vertexCount?: number;
  skipped?: boolean;
  error?: string;
};

self.onmessage = (event: MessageEvent<RoadPolygonWorkerRequest>) => {
  const { requestId, cell, lines } = event.data;
  try {
    const result = buildRoadCellPolygons(cell, lines);
    const response: RoadPolygonWorkerResponse = {
      requestId,
      cellKey: result.cellKey,
      ok: true,
      polygons: result.polygons,
      vertexCount: result.vertexCount,
      skipped: result.skipped,
    };
    self.postMessage(response);
  } catch (error) {
    const response: RoadPolygonWorkerResponse = {
      requestId,
      cellKey: cell.key,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
