import type { Map as MaplibreMap } from 'maplibre-gl';
import * as THREE from 'three';

export type BuildingView = {
  west: number; south: number; east: number; north: number;
  zoom: number; latitude: number;
};

export function buildingView(map: MaplibreMap, padding = 0): BuildingView {
  const bounds = map.getBounds();
  const dx = (bounds.getEast() - bounds.getWest()) * padding;
  const dy = (bounds.getNorth() - bounds.getSouth()) * padding;
  return {
    west: bounds.getWest() - dx, east: bounds.getEast() + dx,
    south: bounds.getSouth() - dy, north: bounds.getNorth() + dy,
    // Integer zoom also tracks terrain tile resolution and facade detail.
    zoom: Math.floor(map.getZoom()), latitude: Math.round(map.getCenter().lat * 10) / 10,
  };
}

/** A bounded flight footprint remains usable when screen corners cross the horizon. */
export function flightBuildingView(map: MaplibreMap): BuildingView {
  const center = map.getCenter();
  const heading = map.getBearing() * Math.PI / 180;
  const metersPerDegree = Math.PI / 180 * 6_378_137;
  const longitudeScale = Math.max(0.01, Math.cos(center.lat * Math.PI / 180));
  const longitude = center.lng + Math.sin(heading) * 600 / (metersPerDegree * longitudeScale);
  const latitude = center.lat + Math.cos(heading) * 600 / metersPerDegree;
  const radius = 1200;
  return {
    west: longitude - radius / (metersPerDegree * longitudeScale),
    east: longitude + radius / (metersPerDegree * longitudeScale),
    south: latitude - radius / metersPerDegree,
    north: latitude + radius / metersPerDegree,
    zoom: Math.floor(map.getZoom()), latitude: center.lat,
  };
}

export function containsBuildingView(cached: BuildingView, current: BuildingView): boolean {
  return cached.zoom === current.zoom && cached.latitude === current.latitude
    && current.west >= cached.west && current.east <= cached.east
    && current.south >= cached.south && current.north <= cached.north;
}

// Stable, incremental sort: preserve largest-first duplicate selection without
// blocking on a native sort of every loaded building footprint.
export function* sortBuildingCandidates<T>(items: T[], compare: (a: T, b: T) => number): Generator<void, T[]> {
  let source = items;
  let target = new Array<T>(items.length);
  for (let width = 1; width < items.length; width *= 2) {
    for (let start = 0; start < items.length; start += width * 2) {
      const middle = Math.min(start + width, items.length);
      const end = Math.min(start + width * 2, items.length);
      let left = start;
      let right = middle;
      for (let index = start; index < end; index++) {
        if (index % 64 === 0) yield;
        target[index] = left < middle && (right >= end || compare(source[left], source[right]) <= 0)
          ? source[left++] : source[right++];
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

export function* mergeBuildingGeometries(geometries: THREE.BufferGeometry[]): Generator<void, THREE.BufferGeometry> {
  let totalVertices = 0;
  let totalIndices = 0;
  for (const geometry of geometries) {
    totalVertices += geometry.getAttribute('position').count;
    totalIndices += geometry.getIndex()!.count;
    yield;
  }
  // Callers cap total vertices; allocations and the eventual GPU upload are
  // bounded by that cap. Copy attributes and remap indices in small chunks.
  const positions = new Float32Array(totalVertices * 3);
  yield;
  const normals = new Float32Array(totalVertices * 3);
  yield;
  const colors = new Float32Array(totalVertices * 3);
  yield;
  const indices = totalVertices > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of geometries) {
    const count = geometry.getAttribute('position').count;
    for (const [name, target] of [['position', positions], ['normal', normals], ['color', colors]] as const) {
      const source = geometry.getAttribute(name).array as Float32Array;
      for (let offset = 0; offset < source.length; offset += 3072) {
        target.set(source.subarray(offset, offset + 3072), vertexOffset * 3 + offset);
        yield;
      }
    }
    const source = geometry.getIndex()!.array;
    for (let offset = 0; offset < source.length; offset += 1024) {
      const end = Math.min(offset + 1024, source.length);
      for (let i = offset; i < end; i++) indices[indexOffset + i] = source[i] + vertexOffset;
      yield;
    }
    vertexOffset += count;
    indexOffset += source.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}
