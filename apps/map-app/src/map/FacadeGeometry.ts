/**
 * Footprint → procedural facade (window) geometry generation.
 *
 * Operates in local metre coordinates (x = east, z = south, y = up) so
 * the caller can place the resulting mesh at the correct world position.
 *
 * Only simple, convex, near-rectangular footprints get window overlays.
 * Complex multi-part structures, L-shapes, and highly irregular polygons
 * fall back to the plain fill-extrusion walls.
 */

import * as THREE from 'three';

export type FacadeCandidate = {
  /** Outer ring of the footprint in local metres, [x, z] pairs. */
  ring: Array<[number, number]>;
  /** Building wall height in metres (top of walls = base of roof). */
  wallHeight: number;
  /** Feature ID for deterministic per-building variation. */
  featureId: number | string;
  /** Optional detail budget, distributed across all walls and stories. */
  maxWindows?: number;
};

export type FacadeMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Translation to apply so the facade sits at the footprint centroid. */
  offset: [number, number];
};

// --- Eligibility -----------------------------------------------------------

const MAX_FACADE_RING_VERTICES = 24;
const MAX_FACADE_AREA_SQ_M = 2500;
const MIN_FACADE_AREA_SQ_M = 25;
/** Reject any concave vertex — only convex (near-rectangular) footprints qualify. */
const MAX_FACADE_CONCAVE_VERTICES = 0;
/**
 * Minimum ratio of polygon area to oriented bounding box area. More
 * permissive than the roof threshold (0.93) so pentagons, chamfered
 * corners, and other simple convex shapes still receive facades.
 */
const MIN_FACADE_RECTANGULARITY = 0.80;
const MIN_FACADE_WIDTH_M = 4;
const MAX_FACADE_ASPECT_RATIO = 6;

/**
 * Check whether a footprint ring is simple enough for facade details.
 * Only the ring geometry is checked; wall-height limits are enforced
 * by the caller.
 */
export function isEligibleFacadeFootprint(
  ring: Array<[number, number]>,
): boolean {
  if (ring.length < 4 || ring.length > MAX_FACADE_RING_VERTICES + 1) return false;

  const verts = stripClosingVertex(ring);
  if (verts.length < 3 || verts.length > MAX_FACADE_RING_VERTICES) return false;

  const area = Math.abs(signedArea(verts));
  if (area < MIN_FACADE_AREA_SQ_M || area > MAX_FACADE_AREA_SQ_M) return false;

  if (countConcaveVertices(verts) > MAX_FACADE_CONCAVE_VERTICES) return false;

  const { halfWidth, halfDepth } = orientedBoundingBox(verts);
  const obbArea = (halfWidth * 2) * (halfDepth * 2);
  if (obbArea > 0 && area / obbArea < MIN_FACADE_RECTANGULARITY) return false;

  const bb = boundingBox(verts);
  const w = bb.maxX - bb.minX;
  const h = bb.maxZ - bb.minZ;
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);
  if (shorter < MIN_FACADE_WIDTH_M) return false;
  if (longer / shorter > MAX_FACADE_ASPECT_RATIO) return false;

  return true;
}

// --- Window styles ----------------------------------------------------------

type WindowStyle = {
  windowWidth: number;
  windowHeight: number;
  horizontalSpacing: number;
  /** Multiplier applied to ground-floor window height (1.0 = same). */
  groundFloorMultiplier: number;
  /** Skip windows on the ground floor entirely. */
  groundFloorSkip: boolean;
  /** Offset alternate rows by half the spacing. */
  stagger: boolean;
};

const WINDOW_STYLES: WindowStyle[] = [
  { windowWidth: 1.3, windowHeight: 1.3, horizontalSpacing: 3.0, groundFloorMultiplier: 1.0, groundFloorSkip: false, stagger: false },
  { windowWidth: 1.6, windowHeight: 1.2, horizontalSpacing: 3.3, groundFloorMultiplier: 1.4, groundFloorSkip: false, stagger: false },
  { windowWidth: 0.9, windowHeight: 1.5, horizontalSpacing: 2.2, groundFloorMultiplier: 1.0, groundFloorSkip: false, stagger: true },
  { windowWidth: 1.8, windowHeight: 0.9, horizontalSpacing: 3.0, groundFloorMultiplier: 1.0, groundFloorSkip: true, stagger: false },
];

const MIN_EDGE_LENGTH_M = 2;
const CORNER_MARGIN_M = 0.3;
const OUTWARD_OFFSET_M = 0.12;
const MAX_STORIES = 15;
const STORY_HEIGHT_M = 3.5;
const MAX_WINDOWS_PER_WALL = 15;

// --- Geometry generation ----------------------------------------------------

export function generateFacadeGeometry(
  candidate: FacadeCandidate,
): FacadeMeshData | null {
  const verts = stripClosingVertex(candidate.ring);
  if (verts.length < 3) return null;

  const centroid = polygonCentroid(verts);
  const local = verts.map(([x, z]) => [x - centroid[0], z - centroid[1]] as [number, number]);

  const numericId = typeof candidate.featureId === 'number'
    ? candidate.featureId
    : hashString(candidate.featureId);
  const style = WINDOW_STYLES[Math.abs(numericId) % WINDOW_STYLES.length];

  let numStories = Math.min(MAX_STORIES, Math.max(1, Math.round(candidate.wallHeight / STORY_HEIGHT_M)));
  const windowsForEdge = (edgeLength: number) => Math.min(MAX_WINDOWS_PER_WALL,
    Math.max(1, Math.floor(edgeLength / style.horizontalSpacing)));
  const estimatedWindows = local.reduce((sum, a, index) => {
    const b = local[(index + 1) % local.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return sum + (length >= MIN_EDGE_LENGTH_M ? windowsForEdge(length) : 0);
  }, 0) * numStories;
  const maxWindows = Math.max(0, Math.floor(candidate.maxWindows ?? Infinity));
  const density = Math.min(1, Math.sqrt(maxWindows / Math.max(1, estimatedWindows)));
  numStories = Math.max(1, Math.floor(numStories * density));
  const storyHeight = candidate.wallHeight / numStories;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let edgeIdx = 0; edgeIdx < local.length; edgeIdx++) {
    const a = local[edgeIdx];
    const b = local[(edgeIdx + 1) % local.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const edgeLength = Math.hypot(dx, dz);
    if (edgeLength < MIN_EDGE_LENGTH_M) continue;

    const dirX = dx / edgeLength;
    const dirZ = dz / edgeLength;

    // Outward normal: perpendicular to edge, pointing away from centroid.
    const midX = (a[0] + b[0]) / 2;
    const midZ = (a[1] + b[1]) / 2;
    let nx = dirZ;
    let nz = -dirX;
    if (nx * midX + nz * midZ < 0) {
      nx = -nx;
      nz = -nz;
    }

    const numWindows = Math.max(1, Math.floor(windowsForEdge(edgeLength) * density));
    const spacing = style.horizontalSpacing / Math.max(density, 0.01);
    const totalSpan = (numWindows - 1) * spacing;
    const startOffset = (edgeLength - totalSpan) / 2;

    for (let story = 0; story < numStories; story++) {
      if (story === 0 && style.groundFloorSkip) continue;

      const storyBase = story * storyHeight;
      const storyCenter = storyBase + storyHeight / 2;

      const heightMultiplier = story === 0 ? style.groundFloorMultiplier : 1.0;
      const windowHeight = Math.min(style.windowHeight * heightMultiplier, storyHeight * 0.7);
      if (windowHeight < 0.4) continue;

      const yBottom = storyCenter - windowHeight / 2;
      const yTop = storyCenter + windowHeight / 2;

      const rowOffset = style.stagger && story % 2 === 1
        ? spacing / 2
        : 0;

      for (let win = 0; win < numWindows; win++) {
        if (positions.length / 12 >= maxWindows) break;
        let center = startOffset + win * spacing + rowOffset;

        const halfW = style.windowWidth / 2;
        const minCenter = halfW + CORNER_MARGIN_M;
        const maxCenter = edgeLength - halfW - CORNER_MARGIN_M;
        if (maxCenter < minCenter) continue;
        center = Math.max(minCenter, Math.min(maxCenter, center));
        if (center < minCenter - 0.01 || center > maxCenter + 0.01) continue;

        const left = center - halfW;
        const right = center + halfW;

        // Quad vertices (BL, BR, TR, TL) offset outward from the wall.
        const baseX = a[0];
        const baseZ = a[1];
        const ox = nx * OUTWARD_OFFSET_M;
        const oz = nz * OUTWARD_OFFSET_M;

        const p0 = positions.length / 3;
        positions.push(
          baseX + left * dirX + ox, yBottom, baseZ + left * dirZ + oz,
          baseX + right * dirX + ox, yBottom, baseZ + right * dirZ + oz,
          baseX + right * dirX + ox, yTop, baseZ + right * dirZ + oz,
          baseX + left * dirX + ox, yTop, baseZ + left * dirZ + oz,
        );

        for (let v = 0; v < 4; v++) {
          normals.push(nx, 0, nz);
        }

        indices.push(p0, p0 + 1, p0 + 2, p0, p0 + 2, p0 + 3);
      }
    }
  }

  if (indices.length === 0) return null;

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: indices.length > 65535
      ? new Uint32Array(indices)
      : new Uint16Array(indices),
    offset: [centroid[0], centroid[1]],
  };
}

export function facadeMeshDataToBufferGeometry(data: FacadeMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

// --- Geometry utilities (shared logic, kept local to this module) -----------

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

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}
