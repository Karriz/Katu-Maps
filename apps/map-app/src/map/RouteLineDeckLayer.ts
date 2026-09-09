import * as maplibregl from 'maplibre-gl';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';
import * as THREE from 'three';
import type { BridgeDeckSource } from './TransitVehicleModelLayer';

const MIN_ZOOM = 13;
// Lift the ribbon above the bridge deck mesh surface.
const DECK_LIFT_METERS = 1.5;
// If consecutive ribbon vertices differ in elevation by more than this, the
// transition from terrain to deck is too abrupt (e.g. a sudden step onto the
// bridge). Discard vertices that would cause such a jump so the native 2D line
// handles the approach instead.
const MAX_VERTEX_ELEVATION_JUMP = 2;
const EARTH_RADIUS_METERS = 6_378_137;

export type RouteLineFeature = {
  coordinates: Array<[number, number]>;
  color: string;
  /** Line width in pixels (matches native MapLibre line-width). */
  widthPixels: number;
  /** Casing width in pixels (drawn under the line). */
  casingWidthPixels: number;
};

/**
 * Custom 3D layer that draws transit/route lines at the elevation of the
 * surface they travel on. Segments that follow a sampled bridge roadway are
 * lifted to deck height; crossings that only pass under the deck stay draped.
 */
export class RouteLineDeckLayer implements CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map?: MaplibreMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly camera = new THREE.Camera();
  private readonly scene = new THREE.Scene();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly sceneTransform = new THREE.Matrix4();
  private readonly sceneScale = new THREE.Vector3();
  private origin = new maplibregl.LngLat(0, 0);
  private originElevation = 0;
  private bridgeDeckSource: BridgeDeckSource | null = null;
  private features: RouteLineFeature[] = [];
  private lineGroup?: THREE.Group;
  private visible = false;

  constructor(id: string) {
    this.id = id;
  }

  setBridgeDeckSource(source: BridgeDeckSource | null) {
    this.bridgeDeckSource = source;
  }

  setFeatures(features: RouteLineFeature[]) {
    this.features = features;
    if (this.map) this.rebuild();
  }

  /** Rebuild geometry from the last features (e.g. after bridge decks load). */
  rebuildFromCurrentFeatures() {
    if (this.map) this.rebuild();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    // Rebuild if transitioning to visible but geometry was never built (features
    // arrived while the layer was hidden). If already built, just toggle.
    if (visible && !this.lineGroup && this.features.length > 0) {
      this.rebuild();
    } else if (this.lineGroup) {
      this.lineGroup.visible = visible;
    }
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (this.features.length > 0) this.rebuild();
  }

  onRemove() {
    this.disposeGeometry();
    this.scene.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.map = undefined;
  }

  private disposeGeometry() {
    if (!this.lineGroup) return;
    this.lineGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    this.scene.remove(this.lineGroup);
    this.lineGroup = undefined;
  }

  /**
   * Deck elevation when this sample is travelling on a sampled bridge roadway.
   * Heading is the local route tangent so a long winding line can still lift
   * on a short bridge, and a parallel street under the same deck stays down.
   */
  private sampleDeckElevation(lng: number, lat: number, heading: number): number | null {
    return this.bridgeDeckSource?.deckPlacementAt(lng, lat, heading) ?? null;
  }

  private segmentHeading(from: [number, number], to: [number, number]): number {
    const midLat = (from[1] + to[1]) / 2;
    const cosLat = Math.cos(midLat * Math.PI / 180);
    const metresPerDegLat = (Math.PI / 180) * EARTH_RADIUS_METERS;
    return Math.atan2(
      (to[0] - from[0]) * cosLat * metresPerDegLat,
      (to[1] - from[1]) * metresPerDegLat,
    );
  }

  private rebuild() {
    const map = this.map;
    if (!map) return;
    this.disposeGeometry();
    if (this.features.length === 0) return;

    // Use the map center as origin for local coordinates.
    const center = map.getCenter();
    this.origin = center;
    this.originElevation = map.queryTerrainElevation(center) ?? 0;

    this.lineGroup = new THREE.Group();
    this.lineGroup.visible = this.visible;
    this.scene.add(this.lineGroup);
    this.lastRebuildZoom = map.getZoom();

    for (const feature of this.features) {
      if (feature.coordinates.length < 2) continue;
      this.buildBridgeSegments(feature);
    }
    map.triggerRepaint();
  }

  /**
   * Build ribbon geometry only for the portions of the line that travel along
   * a sampled bridge roadway. Perpendicular and parallel under-crossings stay
   * on the native 2D drape.
   */
  private buildBridgeSegments(feature: RouteLineFeature) {
    const map = this.map;
    if (!map || !this.lineGroup) return;
    const coords = feature.coordinates;
    const originMercator = maplibregl.MercatorCoordinate.fromLngLat(this.origin);
    const units = originMercator.meterInMercatorCoordinateUnits();

    type Vert = { x: number; y: number; z: number };
    let strip: Vert[] = [];

    const localPoint = (lng: number, lat: number, elevation: number): Vert => {
      const mercator = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
      return {
        x: (mercator.x - originMercator.x) / units,
        y: elevation - this.originElevation + DECK_LIFT_METERS,
        z: (originMercator.y - mercator.y) / units,
      };
    };

    const flushStrip = () => {
      if (strip.length < 2) { strip = []; return; }
      // Split the strip where consecutive vertices jump more than the allowed
      // threshold. This discards abrupt terrain-to-deck transitions at the
      // bridge boundary so the native 2D line handles the approach instead.
      let run: Vert[] = [strip[0]];
      for (let i = 1; i < strip.length; i++) {
        if (Math.abs(strip[i].y - strip[i - 1].y) > MAX_VERTEX_ELEVATION_JUMP) {
          if (run.length >= 2) this.buildRibbon(run, feature);
          run = [strip[i]];
        } else {
          run.push(strip[i]);
        }
      }
      if (run.length >= 2) this.buildRibbon(run, feature);
      strip = [];
    };

    const headingAt = (index: number) => {
      const prev = coords[Math.max(0, index - 1)];
      const next = coords[Math.min(coords.length - 1, index + 1)];
      if (prev[0] === next[0] && prev[1] === next[1]) return 0;
      return this.segmentHeading(prev, next);
    };

    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      const heading = headingAt(i);
      const deckElev = this.sampleDeckElevation(lng, lat, heading);

      if (i > 0) {
        // Densify long segments to catch bridge crossings between coordinates.
        const [prevLng, prevLat] = coords[i - 1];
        const prevMercator = maplibregl.MercatorCoordinate.fromLngLat({ lng: prevLng, lat: prevLat });
        const curMercator = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
        const dist = Math.hypot(
          (curMercator.x - prevMercator.x) / units,
          (originMercator.y - curMercator.y - (originMercator.y - prevMercator.y)) / units,
        );
        if (dist > 12) {
          const steps = Math.ceil(dist / 10);
          const segmentHeading = this.segmentHeading(coords[i - 1], coords[i]);
          for (let s = 1; s < steps; s++) {
            const t = s / steps;
            const midLng = prevLng + (lng - prevLng) * t;
            const midLat = prevLat + (lat - prevLat) * t;
            const midDeck = this.sampleDeckElevation(midLng, midLat, segmentHeading);
            if (midDeck !== null) {
              strip.push(localPoint(midLng, midLat, midDeck));
            } else {
              flushStrip();
            }
          }
        }
      }

      if (deckElev !== null) {
        strip.push(localPoint(lng, lat, deckElev));
      } else {
        flushStrip();
      }
    }
    flushStrip();
  }

  private buildRibbon(verts: Array<{ x: number; y: number; z: number }>, feature: RouteLineFeature) {
    if (!this.lineGroup || verts.length < 2) return;
    const map = this.map;
    // Convert the feature's pixel-based widths to meters at the current zoom
    // so the ribbon matches the native MapLibre line layer's apparent width.
    const zoom = map?.getZoom() ?? 15;
    const centerLat = this.origin.lat;
    const metersPerPixel = (156543.04 * Math.cos(centerLat * Math.PI / 180)) / Math.pow(2, zoom);
    const buildLayer = (widthPixels: number, color: string, renderOrder: number) => {
      const positions: number[] = [];
      const indices: number[] = [];
      const halfWidth = (widthPixels * metersPerPixel) / 2;
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const a = verts[Math.max(0, i - 1)];
        const b = verts[Math.min(verts.length - 1, i + 1)];
        const heading = Math.atan2(b.x - a.x, b.z - a.z);
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        positions.push(
          v.x - cos * halfWidth, v.y, v.z + sin * halfWidth,
          v.x + cos * halfWidth, v.y, v.z - sin * halfWidth,
        );
      }
      for (let i = 0; i < verts.length - 1; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = renderOrder;
      this.lineGroup!.add(mesh);
    };
    buildLayer(feature.casingWidthPixels, '#fffdf8', 0);
    buildLayer(feature.widthPixels, feature.color, 1);
  }

  private lastRebuildZoom = 0;

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.renderer || !this.visible || map.getZoom() < MIN_ZOOM) return;
    const zoom = map.getZoom();
    // Rebuild when zoom changes by more than 1 level so ribbon widths stay
    // proportional to the native line layer's pixel-based widths.
    if (this.lineGroup && this.lineGroup.children.length > 0 && Math.abs(zoom - this.lastRebuildZoom) > 1) {
      this.rebuild();
    }
    // Retry building bridge segments if features exist but no geometry was
    // produced yet (bridges may not have been sampled when features arrived).
    // Only retry when the bridge source has bridges available.
    if (this.features.length > 0 && (!this.lineGroup || this.lineGroup.children.length === 0)) {
      if (this.bridgeDeckSource?.hasBridges()) this.rebuild();
    }
    if (!this.lineGroup || this.lineGroup.children.length === 0) {
      // Keep the repaint loop alive so the retry can fire on the next frame
      // once bridges finish sampling.
      if (this.features.length > 0) map.triggerRepaint();
      return;
    }
    const origin = maplibregl.MercatorCoordinate.fromLngLat(this.origin, this.originElevation);
    const scale = origin.meterInMercatorCoordinateUnits();
    this.sceneScale.set(scale, -scale, scale);
    this.sceneTransform.makeTranslation(origin.x, origin.y, origin.z).scale(this.sceneScale);
    this.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.sceneTransform);
    this.camera.projectionMatrix.copy(this.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    map.triggerRepaint();
  }
}
