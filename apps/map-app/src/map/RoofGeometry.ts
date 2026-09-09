/**
 * Footprint → procedural roof geometry generation.
 *
 * Operates in local metre coordinates (x = east, z = south, y = up) so
 * the caller can place the resulting mesh at the correct world position.
 *
 * Only simple, small, rectangular footprints get a procedural roof.
 * Complex shapes, L-shapes, non-rectangular polygons, large buildings, and
 * anything with `hide_3d` fall back to the existing flat fill-extrusion top
 * (the caller decides eligibility).
 */

import * as THREE from 'three';
import type { RoofType } from './RoofClimate';

export type RoofCandidate = {
  /** Outer ring of the footprint in local metres, [x, z] pairs. */
  ring: Array<[number, number]>;
  /** Building wall height in metres (top of walls = base of roof). */
  wallHeight: number;
  /** Roof type from the climate profile. */
  type: RoofType;
  /** Roof pitch in degrees (0 for flat). */
  pitchDegrees: number;
  /** Feature ID for deterministic per-building variation. */
  featureId: number | string;
};

export type RoofMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Translation to apply so the roof sits at the footprint centroid. */
  offset: [number, number];
  /** Total roof height above wall top (for z-fighting avoidance). */
  roofHeight: number;
};

// --- Eligibility -----------------------------------------------------------

const MAX_FOOTPRINT_AREA_SQ_M = 600;
const MAX_RING_VERTICES = 16;
/** Reject elongated footprints where a gable/hip roof looks unnatural. */
const MAX_ASPECT_RATIO = 3;
/** Small enough to reject building parts, sheds, and garages. */
const MIN_FOOTPRINT_AREA_SQ_M = 15;
/** Minimum wall length — narrower than this is likely a building part. */
const MIN_FOOTPRINT_WIDTH_M = 3;
/** Reject any concave vertex — only convex (near-rectangular) footprints qualify. */
const MAX_CONCAVE_VERTICES = 0;
/**
 * Minimum ratio of polygon area to oriented bounding box area. A perfect
 * rectangle fills its OBB completely. At 0.93, trapezoids, chamfered corners,
 * and other near-rectangular shapes whose roof would overhang the walls are
 * rejected, while tile coordinate quantization is tolerated.
 */
const MIN_RECTANGULARITY_RATIO = 0.93;

export function isEligibleFootprint(
  ring: Array<[number, number]>,
): boolean {
  if (ring.length < 4 || ring.length > MAX_RING_VERTICES + 1) return false;

  // Drop a potentially repeated closing vertex.
  const verts = ring.length > 0 && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;

  if (verts.length < 3 || verts.length > MAX_RING_VERTICES) return false;

  const area = Math.abs(signedArea(verts));
  if (area < MIN_FOOTPRINT_AREA_SQ_M || area > MAX_FOOTPRINT_AREA_SQ_M) return false;

  // Only convex footprints are eligible — no L-shapes or notched outlines.
  if (countConcaveVertices(verts) > MAX_CONCAVE_VERTICES) return false;

  // Require the footprint to fill most of its oriented bounding box so the
  // procedural gable/hip roof (built from the OBB) closely matches the walls.
  const { halfWidth, halfDepth } = orientedBoundingBox(verts);
  const obbArea = (halfWidth * 2) * (halfDepth * 2);
  if (obbArea > 0 && area / obbArea < MIN_RECTANGULARITY_RATIO) return false;

  // Reject very elongated slivers.
  const bb = boundingBox(verts);
  const w = bb.maxX - bb.minX;
  const h = bb.maxZ - bb.minZ;
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);
  if (shorter < MIN_FOOTPRINT_WIDTH_M) return false;
  if (longer / shorter > MAX_ASPECT_RATIO) return false;

  return true;
}

// --- Geometry generation ----------------------------------------------------

export function generateRoofGeometry(
  candidate: RoofCandidate,
): RoofMeshData | null {
  switch (candidate.type) {
    case 'flat':
      return null; // Flat roofs use the existing fill-extrusion top.
    case 'pitched':
      return generateGableRoof(candidate);
    case 'hipped':
      return generateHippedRoof(candidate);
    default:
      return null;
  }
}

/**
 * Gable (pitched) roof: two sloped rectangles + two triangular gable ends.
 * The ridge runs along the longer axis of the footprint's oriented
 * bounding box.
 */
function generateGableRoof(candidate: RoofCandidate): RoofMeshData | null {
  const verts = stripClosingVertex(candidate.ring);
  if (verts.length < 4) return null;

  const centroid = polygonCentroid(verts);
  const local = verts.map(([x, z]) => [x - centroid[0], z - centroid[1]] as [number, number]);

  // Orient along the longest edge direction for a natural-looking ridge.
  const { angle, halfWidth, halfDepth, center: boxCenter } = orientedBoundingBox(local);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  // In the local OBB frame: u = along width (ridge direction),
  // v = along depth (gable direction).
  // Eaves height = wall top (y = 0 in roof-local space).
  // Ridge height = halfDepth * tan(pitch).
  const pitchRad = (candidate.pitchDegrees * Math.PI) / 180;
  const roofRise = halfDepth * Math.tan(pitchRad);
  if (roofRise < 0.3) return null;

  const positions: number[] = [];
  const indices: number[] = [];

  // Build a simple gable prism: two gable triangles at the short ends,
  // two rectangular roof slopes on top.
  //
  // OBB extents: u from -halfWidth to +halfWidth, v from -halfDepth to +halfDepth.
  // Ridge is at (u: any, v: 0, y: roofRise).
  // Eaves are at y = 0 on the footprint boundary at v = +/- halfDepth.

  // Gable end vertices (at u = -halfWidth and u = +halfWidth):
  //   left eave (v = -halfDepth, y = 0)
  //   right eave (v = +halfDepth, y = 0)
  //   ridge (v = 0, y = roofRise)
  const leftEaveBottom: [number, number, number] = [-halfWidth, 0, -halfDepth];
  const leftRidge: [number, number, number] = [-halfWidth, roofRise, 0];
  const rightEaveBottom: [number, number, number] = [halfWidth, 0, halfDepth];
  const rightRidge: [number, number, number] = [halfWidth, roofRise, 0];
  const leftEaveTop: [number, number, number] = [-halfWidth, 0, halfDepth];
  const rightEaveBottom2: [number, number, number] = [halfWidth, 0, -halfDepth];

  // Vertices in OBB space (before rotating back):
  // 0: left eave -halfDepth
  // 1: left eave +halfDepth
  // 2: left ridge
  // 3: right eave -halfDepth
  // 4: right eave +halfDepth
  // 5: right ridge
  const obbPositions: Array<[number, number, number]> = [
    leftEaveBottom,   // 0
    leftEaveTop,      // 1
    leftRidge,        // 2
    rightEaveBottom2, // 3
    rightEaveBottom,  // 4
    rightRidge,       // 5
  ];

  // Rotate back from OBB to local frame and add y (up).
  for (const [u, y, v] of obbPositions) {
    const x = u * cosA - v * sinA;
    const z = u * sinA + v * cosA;
    positions.push(x, y, z);
  }

  // Gable triangle at u = -halfWidth (vertices 0, 1, 2)
  indices.push(0, 1, 2);
  // Gable triangle at u = +halfWidth (vertices 3, 4, 5)
  indices.push(5, 4, 3);

  // Left roof slope (vertices 0, 2, 5, 3) — the side at v = -halfDepth
  // This is the face from eave(-halfDepth) to ridge.
  // Quad: 0 (leftEaveBottom), 2 (leftRidge), 5 (rightRidge), 3 (rightEaveBottom2)
  indices.push(0, 2, 5, 0, 5, 3);

  // Right roof slope (vertices 1, 2, 5, 4) — the side at v = +halfDepth
  // Quad: 1 (leftEaveTop), 5 (rightRidge), 2 (leftRidge) → actually:
  // The +halfDepth side: 1 (leftEaveTop), 2 (leftRidge), 5 (rightRidge), 4 (rightEaveBottom)
  indices.push(2, 1, 4, 2, 4, 5);

  const normals = computeFlatNormals(positions, indices);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: indices.length > 65535
      ? new Uint32Array(indices)
      : new Uint16Array(indices),
    offset: [centroid[0] + boxCenter[0], centroid[1] + boxCenter[1]],
    roofHeight: roofRise,
  };
}

/**
 * Hipped roof: four sloped faces from eaves to a central ridge.
 * The ridge is shorter than the footprint, running along the long axis.
 */
function generateHippedRoof(candidate: RoofCandidate): RoofMeshData | null {
  const verts = stripClosingVertex(candidate.ring);
  if (verts.length < 4) return null;

  const centroid = polygonCentroid(verts);
  const local = verts.map(([x, z]) => [x - centroid[0], z - centroid[1]] as [number, number]);

  const { angle, halfWidth, halfDepth, center: boxCenter } = orientedBoundingBox(local);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  // Convert to OBB-aligned coordinates.
  const pitchRad = (candidate.pitchDegrees * Math.PI) / 180;
  const roofRise = halfDepth * Math.tan(pitchRad);
  if (roofRise < 0.3) return null;

  // Ridge runs along the u axis, centered at v=0.
  // Ridge half-length = halfWidth - halfDepth (hip inset).
  const ridgeHalfLength = Math.max(0, halfWidth - halfDepth);
  const ridgeY = roofRise;

  // Corner positions in OBB space:
  // Eaves at the four corners of the OBB (y = 0).
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfDepth], // 0: front-left
    [halfWidth, -halfDepth],  // 1: front-right
    [halfWidth, halfDepth],   // 2: back-right
    [-halfWidth, halfDepth],  // 3: back-left
  ];

  // Ridge endpoints:
  // 4: front ridge (u = -ridgeHalfLength, v = 0)
  // 5: back ridge (u = ridgeHalfLength, v = 0)
  const ridgeFront: [number, number, number] = [-ridgeHalfLength, ridgeY, 0];
  const ridgeBack: [number, number, number] = [ridgeHalfLength, ridgeY, 0];

  const positions: number[] = [];
  const indices: number[] = [];

  // Add eave corners (y = 0), rotated back from OBB to local frame.
  const eaveIndices: number[] = [];
  for (const [u, v] of corners) {
    const x = u * cosA - v * sinA;
    const z = u * sinA + v * cosA;
    positions.push(x, 0, z);
    eaveIndices.push(eaveIndices.length);
  }

  // Add ridge endpoints, rotated back from OBB to local frame.
  const ridgeFrontIdx = positions.length / 3;
  {
    const [u, y, v] = ridgeFront;
    const x = u * cosA - v * sinA;
    const z = u * sinA + v * cosA;
    positions.push(x, y, z);
  }
  const ridgeBackIdx = positions.length / 3;
  {
    const [u, y, v] = ridgeBack;
    const x = u * cosA - v * sinA;
    const z = u * sinA + v * cosA;
    positions.push(x, y, z);
  }

  // The two long slopes share the whole ridge. Each short end is one hip
  // triangle. Keeping these four regions disjoint prevents diagonal faces
  // from crossing over the roof on long rectangular buildings.
  indices.push(
    eaveIndices[0], ridgeFrontIdx, ridgeBackIdx,
    eaveIndices[0], ridgeBackIdx, eaveIndices[1],
  );
  indices.push(
    eaveIndices[3], eaveIndices[2], ridgeBackIdx,
    eaveIndices[3], ridgeBackIdx, ridgeFrontIdx,
  );
  indices.push(eaveIndices[0], eaveIndices[3], ridgeFrontIdx);
  indices.push(eaveIndices[1], ridgeBackIdx, eaveIndices[2]);

  const normals = computeFlatNormals(positions, indices);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: indices.length > 65535
      ? new Uint32Array(indices)
      : new Uint16Array(indices),
    offset: [centroid[0] + boxCenter[0], centroid[1] + boxCenter[1]],
    roofHeight: roofRise,
  };
}

// --- Geometry utilities ----------------------------------------------------

function signedArea(ring: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    area += x1 * z2 - x2 * z1;
  }
  return area / 2;
}

function polygonCentroid(ring: Array<[number, number]>): [number, number] {
  let cx = 0;
  let cz = 0;
  let totalArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const cross = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
    totalArea += cross;
  }
  if (Math.abs(totalArea) < 1e-9) {
    // Degenerate: fall back to average.
    const avg = ring.reduce(([ax, az], [x, z]) => [ax + x, az + z], [0, 0] as [number, number]);
    return [avg[0] / ring.length, avg[1] / ring.length];
  }
  return [cx / (3 * totalArea), cz / (3 * totalArea)];
}

function countConcaveVertices(ring: Array<[number, number]>): number {
  if (ring.length < 3) return ring.length;
  const verts = stripClosingVertex(ring);
  let sign = 0;
  let concave = 0;
  for (let i = 0; i < verts.length; i++) {
    const [x1, z1] = verts[i];
    const [x2, z2] = verts[(i + 1) % verts.length];
    const [x3, z3] = verts[(i + 2) % verts.length];
    const cross = (x2 - x1) * (z3 - z2) - (z2 - z1) * (x3 - x2);
    if (Math.abs(cross) > 1e-9) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) concave += 1;
    }
  }
  return concave;
}

function boundingBox(ring: Array<[number, number]>): {
  minX: number; maxX: number; minZ: number; maxZ: number;
} {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Minimum-area oriented bounding box. Testing every polygon-edge direction
 * makes the result insensitive to extra collinear vertices in source tiles.
 * The returned width is always the long axis used for the roof ridge.
 */
function orientedBoundingBox(ring: Array<[number, number]>): {
  angle: number;
  halfWidth: number;
  halfDepth: number;
  center: [number, number];
} {
  let bestArea = Infinity;
  let bestAngle = 0;
  let bestMinU = 0;
  let bestMaxU = 0;
  let bestMinV = 0;
  let bestMaxV = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    const dx = x2 - x1;
    const dz = z2 - z1;
    if (Math.hypot(dx, dz) < 1e-6) continue;

    const angle = Math.atan2(dz, dx);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * cosA + z * sinA;
      const v = -x * sinA + z * cosA;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
      bestMinU = minU;
      bestMaxU = maxU;
      bestMinV = minV;
      bestMaxV = maxV;
    }
  }

  let width = bestMaxU - bestMinU;
  let depth = bestMaxV - bestMinV;
  const cosA = Math.cos(bestAngle);
  const sinA = Math.sin(bestAngle);
  const centerU = (bestMinU + bestMaxU) / 2;
  const centerV = (bestMinV + bestMaxV) / 2;
  const center: [number, number] = [
    centerU * cosA - centerV * sinA,
    centerU * sinA + centerV * cosA,
  ];

  if (depth > width) {
    bestAngle += Math.PI / 2;
    [width, depth] = [depth, width];
  }

  return {
    angle: bestAngle,
    halfWidth: width / 2,
    halfDepth: depth / 2,
    center,
  };
}

function stripClosingVertex(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

/**
 * Compute flat (per-face) normals for a non-indexed-then-indexed mesh.
 * `positions` is a flat array [x,y,z, ...] and `indices` references them.
 */
function computeFlatNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const vi of [indices[i], indices[i + 1], indices[i + 2]]) {
      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
    }
  }
  return normals;
}

/**
 * Build a THREE.BufferGeometry from RoofMeshData, translated to the
 * footprint centroid offset.
 */
export function roofMeshDataToBufferGeometry(data: RoofMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positionArray = new Float32Array(data.positions);
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}
