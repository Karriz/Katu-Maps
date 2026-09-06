import * as maplibregl from 'maplibre-gl';
import { globeCloudOpacity, type GlobeCloudTexture } from './GlobeClouds';
import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
} from 'maplibre-gl';

export const DAY_NIGHT_SHADE_LAYER_ID = 'day-night-shade';

const LAT_SEGMENTS = 72;
const LNG_SEGMENTS = 144;
const SHELL_ALTITUDE_METERS = 80_000;
const MERCATOR_ATTRIB = 0;
const LNGLAT_ATTRIB = 1;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_lnglat;
in vec3 v_normal;
uniform vec4 u_horizon;
uniform float u_globe;
uniform float u_day_night;
uniform float u_decorative;
uniform float u_cloud_opacity;
uniform vec3 u_sun;
uniform float u_opacity;
uniform float u_lights;
uniform sampler2D u_city_lights;
out vec4 fragColor;

uniform sampler2D u_cloud_cover;

void main() {
  vec3 normal = normalize(v_normal);
  // MapLibre's globe axes are (east at Greenwich, north pole, Greenwich).
  float horizon = dot(normal.yzx, u_horizon.xyz) + u_horizon.w;
  if (u_globe > 0.999 && horizon < 0.0) discard;
  float mu = dot(normal, u_sun);
  // Decorative mode uses a wider, softer limb falloff locked to the screen sun.
  float nightLo = mix(-0.22, 0.02, u_decorative);
  float nightHi = mix(0.12, 0.72, u_decorative);
  float night = (1.0 - smoothstep(nightLo, nightHi, mu)) * u_day_night;
  // Keep the colored twilight close to the horizon instead of washing the night hemisphere.
  float twilight = (1.0 - smoothstep(0.0, 0.10, mu)) * smoothstep(-0.12, -0.01, mu) * u_day_night * (1.0 - u_decorative);
  float dusk = smoothstep(-0.06, 0.06, mu);
  vec3 twilightRgb = mix(vec3(0.06, 0.09, 0.18), vec3(1.0, 0.48, 0.16), dusk);
  vec3 nightRgb = vec3(0.015, 0.04, 0.09);
  vec2 uv = vec2(fract(v_lnglat.x / 360.0 + 0.5), 0.5 - v_lnglat.y / 180.0);
  vec3 lights = texture(u_city_lights, uv).rgb * night * u_lights * u_opacity;
  float nightAlpha = night * mix(0.78, 0.5, u_decorative) * u_opacity;
  float twilightAlpha = twilight * 0.32 * u_opacity;
  vec3 color = nightRgb * nightAlpha + twilightRgb * twilightAlpha + lights;
  float alpha = clamp(nightAlpha + twilightAlpha, 0.0, 1.0);
  if (u_cloud_opacity > 0.001 && u_globe > 0.001) {
    vec2 cloudSize = vec2(textureSize(u_cloud_cover, 0));
    vec2 cloudUv = (uv * (cloudSize - 1.0) + 0.5) / cloudSize;
    // Tap neighboring texels for soft structure without inventing clear-sky clouds.
    vec2 texel = 1.0 / cloudSize;
    float cover = texture(u_cloud_cover, cloudUv).r;
    float coverE = texture(u_cloud_cover, cloudUv + vec2(texel.x, 0.0)).r;
    float coverN = texture(u_cloud_cover, cloudUv + vec2(0.0, -texel.y)).r;
    float coverW = texture(u_cloud_cover, cloudUv - vec2(texel.x, 0.0)).r;
    float coverS = texture(u_cloud_cover, cloudUv + vec2(0.0, texel.y)).r;
    float coverSoft = (cover * 2.0 + coverE + coverN + coverW + coverS) / 6.0;
    float edge = clamp(abs(coverE - coverW) + abs(coverN - coverS), 0.0, 1.0);
    float body = smoothstep(0.06, 0.72, coverSoft);
    float wisps = smoothstep(0.18, 0.92, cover) * (0.72 + edge * 0.45);
    float cloudAlpha = mix(body * 0.55, wisps, 0.62) * u_cloud_opacity * u_globe;
    float cloudDaylight = mix(1.0, smoothstep(-0.12, 0.25, mu), u_day_night);
    vec3 sunlit = vec3(0.97, 0.98, 0.96);
    vec3 shaded = vec3(0.78, 0.82, 0.88);
    vec3 dayCloud = mix(shaded, sunlit, mix(0.45, 1.0, cloudDaylight) * (1.0 - coverSoft * 0.18));
    vec3 nightCloud = vec3(0.10, 0.15, 0.23);
    vec3 cloudRgb = mix(nightCloud, dayCloud, cloudDaylight);
    cloudRgb = mix(cloudRgb, vec3(0.87, 0.73, 0.61), twilight * 0.22);
    color = color * (1.0 - cloudAlpha) + cloudRgb * cloudAlpha;
    alpha = alpha + cloudAlpha * (1.0 - alpha);
  }
  // A thin atmospheric rim shares the exact solar direction of the terminator.
  float rim = (1.0 - smoothstep(0.0, 0.22, max(horizon, 0.0)));
  float sunlight = mix(1.0, smoothstep(-0.18, 0.25, mu), u_day_night);
  float glowAlpha = rim * rim * sunlight * 0.38 * u_globe * u_opacity;
  vec3 glowRgb = mix(vec3(0.35, 0.65, 1.0), vec3(1.0, 0.66, 0.38), twilight * 0.65);
  color = color * (1.0 - glowAlpha) + glowRgb * glowAlpha;
  alpha = alpha + glowAlpha * (1.0 - alpha);
  fragColor = vec4(color, alpha);
}
`;

type ShadeProgram = {
  program: WebGLProgram;
  variant: string;
  projectionMatrix: WebGLUniformLocation | null;
  tileMercator: WebGLUniformLocation | null;
  clippingPlane: WebGLUniformLocation | null;
  projectionTransition: WebGLUniformLocation | null;
  fallbackMatrix: WebGLUniformLocation | null;
  clipAntimeridian: WebGLUniformLocation | null;
  elevation: WebGLUniformLocation | null;
  sun: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  lights: WebGLUniformLocation | null;
  cityLights: WebGLUniformLocation | null;
  horizon: WebGLUniformLocation | null;
  globe: WebGLUniformLocation | null;
    dayNight: WebGLUniformLocation | null;
    decorative: WebGLUniformLocation | null;
    cloudOpacity: WebGLUniformLocation | null;
  cloudCover: WebGLUniformLocation | null;
};

const URBAN_REGIONS: Array<[number, number, number, number]> = [
  [-74.0, 40.7, 1, 4.2],
  [-118.2, 34.0, 0.85, 3.4],
  [-87.6, 41.9, 0.7, 2.6],
  [-80.2, 25.8, 0.55, 1.8],
  [-97.7, 30.3, 0.45, 1.6],
  [-123.1, 49.3, 0.45, 1.5],
  [-79.4, 43.7, 0.55, 2.0],
  [-99.1, 19.4, 0.8, 2.8],
  [-46.6, -23.6, 0.85, 3.0],
  [-43.2, -22.9, 0.7, 2.2],
  [-70.6, -33.4, 0.55, 1.8],
  [-58.4, -34.6, 0.7, 2.4],
  [-3.7, 40.4, 0.55, 1.8],
  [-0.1, 51.5, 0.9, 3.2],
  [2.3, 48.9, 0.75, 2.6],
  [4.9, 52.4, 0.55, 1.8],
  [13.4, 52.5, 0.7, 2.4],
  [12.5, 41.9, 0.55, 1.8],
  [9.2, 45.5, 0.5, 1.6],
  [18.1, 59.3, 0.4, 1.4],
  [24.9, 60.2, 0.35, 1.2],
  [23.8, 61.5, 0.28, 0.9],
  [37.6, 55.8, 0.85, 3.0],
  [28.9, 41.0, 0.7, 2.2],
  [31.2, 30.0, 0.7, 2.4],
  [3.1, 36.7, 0.4, 1.4],
  [18.4, -33.9, 0.45, 1.5],
  [28.0, -26.2, 0.5, 1.8],
  [36.8, -1.3, 0.4, 1.4],
  [77.2, 28.6, 0.9, 3.4],
  [72.9, 19.1, 0.85, 2.8],
  [88.4, 22.6, 0.75, 2.4],
  [90.4, 23.8, 0.7, 2.2],
  [67.0, 24.9, 0.7, 2.2],
  [74.3, 31.5, 0.55, 1.8],
  [69.2, 41.3, 0.35, 1.2],
  [51.4, 35.7, 0.55, 1.8],
  [44.4, 33.3, 0.4, 1.4],
  [46.7, 24.7, 0.55, 1.8],
  [55.3, 25.2, 0.5, 1.5],
  [100.5, 13.8, 0.7, 2.4],
  [106.8, 10.8, 0.55, 1.8],
  [106.8, -6.2, 0.9, 3.0],
  [103.8, 1.35, 0.55, 1.4],
  [101.7, 3.15, 0.5, 1.6],
  [120.98, 14.6, 0.7, 2.2],
  [121.5, 31.2, 0.95, 3.4],
  [116.4, 39.9, 0.9, 3.2],
  [113.3, 23.1, 0.9, 3.0],
  [114.2, 22.3, 0.7, 1.8],
  [104.1, 30.7, 0.7, 2.2],
  [108.9, 34.3, 0.55, 1.8],
  [126.98, 37.6, 0.75, 2.4],
  [139.7, 35.7, 1, 3.6],
  [135.5, 34.7, 0.7, 2.2],
  [136.9, 35.2, 0.5, 1.6],
  [151.2, -33.9, 0.7, 2.4],
  [144.96, -37.8, 0.65, 2.2],
  [174.76, -36.85, 0.35, 1.2],
];

export function createCityLightsTexture() {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const image = context.createImageData(width, height);
  const { data } = image;
  for (let y = 0; y < height; y += 1) {
    const lat = 90 - (y + 0.5) / height * 180;
    for (let x = 0; x < width; x += 1) {
      const lng = (x + 0.5) / width * 360 - 180;
      let glow = 0;
      for (const [cityLng, cityLat, brightness, radius] of URBAN_REGIONS) {
        const dLng = Math.abs(lng - cityLng);
        const wrapped = Math.min(dLng, 360 - dLng);
        const distance = Math.hypot(wrapped * Math.cos(cityLat * Math.PI / 180), lat - cityLat);
        // Compact, smooth city glows replace the unmasked global noise field.
        const extent = radius * 0.16;
        if (distance >= extent) continue;
        const falloff = 1 - distance / extent;
        glow += brightness * falloff * falloff;
      }
      const intensity = Math.min(0.65, glow * 0.8);
      if (intensity <= 0.02) continue;
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(255 * Math.min(1, intensity * 1.15));
      data[offset + 1] = Math.round(220 * intensity);
      data[offset + 2] = Math.round(140 * intensity);
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Day/night shade shader failed to compile.', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function asMat4f32(matrix: ArrayLike<number>) {
  return matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
}

function vertexShaderSource(shaderData: CustomRenderMethodInput['shaderData']) {
  return `#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}
layout(location=${MERCATOR_ATTRIB}) in vec2 a_mercator;
layout(location=${LNGLAT_ATTRIB}) in vec2 a_lnglat;
out vec2 v_lnglat;
out vec3 v_normal;
uniform float u_elevation;
void main() {
  v_lnglat = a_lnglat;
  vec2 angles = radians(a_lnglat);
  v_normal = vec3(cos(angles.y) * cos(angles.x), cos(angles.y) * sin(angles.x), sin(angles.y));
#ifdef GLOBE
  // Direct spherical positions cover the poles without infinite Mercator coordinates.
  gl_Position = interpolateProjectionFor3D(a_mercator, v_normal.yzx, u_elevation);
#else
  gl_Position = projectTileFor3D(a_mercator, u_elevation);
#endif
}
`;
}

function createShadeProgram(
  gl: WebGL2RenderingContext,
  shaderData: CustomRenderMethodInput['shaderData'],
): ShadeProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource(shaderData));
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Day/night shade program failed to link.', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    variant: shaderData.variantName,
    projectionMatrix: gl.getUniformLocation(program, 'u_projection_matrix'),
    tileMercator: gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'),
    clippingPlane: gl.getUniformLocation(program, 'u_projection_clipping_plane'),
    projectionTransition: gl.getUniformLocation(program, 'u_projection_transition'),
    fallbackMatrix: gl.getUniformLocation(program, 'u_projection_fallback_matrix'),
    clipAntimeridian: gl.getUniformLocation(program, 'u_projection_clip_antimeridian'),
    elevation: gl.getUniformLocation(program, 'u_elevation'),
    sun: gl.getUniformLocation(program, 'u_sun'),
    opacity: gl.getUniformLocation(program, 'u_opacity'),
    lights: gl.getUniformLocation(program, 'u_lights'),
    cityLights: gl.getUniformLocation(program, 'u_city_lights'),
    horizon: gl.getUniformLocation(program, 'u_horizon'),
    globe: gl.getUniformLocation(program, 'u_globe'),
    dayNight: gl.getUniformLocation(program, 'u_day_night'),
    decorative: gl.getUniformLocation(program, 'u_decorative'),
    cloudOpacity: gl.getUniformLocation(program, 'u_cloud_opacity'),
    cloudCover: gl.getUniformLocation(program, 'u_cloud_cover'),
  };
}

export function createGlobeMesh() {
  const mercators: number[] = [];
  const lnglats: number[] = [];
  const indices: number[] = [];
  for (let latIndex = 0; latIndex <= LAT_SEGMENTS; latIndex += 1) {
    const lat = 90 - latIndex * (180 / LAT_SEGMENTS);
    for (let lngIndex = 0; lngIndex <= LNG_SEGMENTS; lngIndex += 1) {
      const lng = -180 + lngIndex * (360 / LNG_SEGMENTS);
      const mercator = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat: Math.max(-85.05112878, Math.min(85.05112878, lat)) });
      mercators.push(mercator.x, mercator.y);
      lnglats.push(lng, lat);
    }
  }
  for (let latIndex = 0; latIndex < LAT_SEGMENTS; latIndex += 1) {
    for (let lngIndex = 0; lngIndex < LNG_SEGMENTS; lngIndex += 1) {
      const stride = LNG_SEGMENTS + 1;
      const top = latIndex * stride + lngIndex;
      const bottom = top + stride;
      indices.push(top, bottom, top + 1, top + 1, bottom, bottom + 1);
    }
  }
  return {
    mercators: new Float32Array(mercators),
    lnglats: new Float32Array(lnglats),
    indices: new Uint32Array(indices),
  };
}

export class DayNightShadeLayer implements CustomLayerInterface {
  readonly id = DAY_NIGHT_SHADE_LAYER_ID;
  readonly type = 'custom';
  readonly renderingMode = '3d';
  private map?: MaplibreMap;
  private programs = new Map<string, ShadeProgram>();
  private vao: WebGLVertexArrayObject | null = null;
  private mercatorBuffer: WebGLBuffer | null = null;
  private lnglatBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private lightsTexture: WebGLTexture | null = null;
  private cloudTexture: WebGLTexture | null = null;
  private cloudPixels: GlobeCloudTexture | null = null;
  private cloudDirty = false;

  setCloudCover(texture: GlobeCloudTexture | null) {
    this.cloudPixels = texture;
    this.cloudDirty = true;
    this.map?.triggerRepaint();
  }
  private indexCount = 0;
  private opacity = 0;
  private lights = 0;
  private dayNight = true;
  private decorative = false;
  private sun: [number, number, number] = [1, 0, 0];

  setAppearance(
    sun: [number, number, number],
    opacity: number,
    lights: number,
    dayNight = true,
    decorative = false,
  ) {
    this.dayNight = dayNight;
    this.decorative = decorative;
    this.sun = sun;
    this.opacity = opacity;
    this.lights = lights;
    this.map?.triggerRepaint();
  }

  onAdd(map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    const gl2 = gl as WebGL2RenderingContext;
    const mesh = createGlobeMesh();
    this.indexCount = mesh.indices.length;
    this.vao = gl2.createVertexArray();
    this.mercatorBuffer = gl2.createBuffer();
    this.lnglatBuffer = gl2.createBuffer();
    this.indexBuffer = gl2.createBuffer();
    gl2.bindVertexArray(this.vao);
    gl2.bindBuffer(gl2.ARRAY_BUFFER, this.mercatorBuffer);
    gl2.bufferData(gl2.ARRAY_BUFFER, mesh.mercators, gl2.STATIC_DRAW);
    gl2.enableVertexAttribArray(MERCATOR_ATTRIB);
    gl2.vertexAttribPointer(MERCATOR_ATTRIB, 2, gl2.FLOAT, false, 0, 0);
    gl2.bindBuffer(gl2.ARRAY_BUFFER, this.lnglatBuffer);
    gl2.bufferData(gl2.ARRAY_BUFFER, mesh.lnglats, gl2.STATIC_DRAW);
    gl2.enableVertexAttribArray(LNGLAT_ATTRIB);
    gl2.vertexAttribPointer(LNGLAT_ATTRIB, 2, gl2.FLOAT, false, 0, 0);
    gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl2.bufferData(gl2.ELEMENT_ARRAY_BUFFER, mesh.indices, gl2.STATIC_DRAW);
    gl2.bindVertexArray(null);

    const canvas = createCityLightsTexture();
    this.lightsTexture = gl2.createTexture();
    gl2.bindTexture(gl2.TEXTURE_2D, this.lightsTexture);
    gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 0);
    gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.REPEAT);
    gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
    gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR);
    gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
    gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, canvas);
    gl2.bindTexture(gl2.TEXTURE_2D, null);
  }

  private programFor(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput['shaderData']) {
    const cached = this.programs.get(shaderData.variantName);
    if (cached) return cached;
    const program = createShadeProgram(gl, shaderData);
    if (program) this.programs.set(shaderData.variantName, program);
    return program;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const gl2 = gl as WebGL2RenderingContext;
    if (!this.vao || this.opacity <= 0.002) return;
    const program = this.programFor(gl2, options.shaderData);
    if (!program) return;

    const previousProgram = gl2.getParameter(gl2.CURRENT_PROGRAM);
    const previousVao = gl2.getParameter(gl2.VERTEX_ARRAY_BINDING);
    const previousBlend = gl2.isEnabled(gl2.BLEND);
    const previousDepthTest = gl2.isEnabled(gl2.DEPTH_TEST);
    const previousCull = gl2.isEnabled(gl2.CULL_FACE);
    const previousDepthMask = gl2.getParameter(gl2.DEPTH_WRITEMASK);
    const previousDepthFunc = gl2.getParameter(gl2.DEPTH_FUNC);
    const previousBlendSrcRgb = gl2.getParameter(gl2.BLEND_SRC_RGB);
    const previousBlendDstRgb = gl2.getParameter(gl2.BLEND_DST_RGB);
    const previousBlendSrcAlpha = gl2.getParameter(gl2.BLEND_SRC_ALPHA);
    const previousBlendDstAlpha = gl2.getParameter(gl2.BLEND_DST_ALPHA);
    const previousActiveTexture = gl2.getParameter(gl2.ACTIVE_TEXTURE);
    gl2.activeTexture(gl2.TEXTURE0);
    const previousTexture = gl2.getParameter(gl2.TEXTURE_BINDING_2D);
    gl2.activeTexture(gl2.TEXTURE1);
    const previousCloudTexture = gl2.getParameter(gl2.TEXTURE_BINDING_2D);
    if (this.cloudDirty) {
      if (this.cloudPixels) {
        this.cloudTexture ??= gl2.createTexture();
        gl2.bindTexture(gl2.TEXTURE_2D, this.cloudTexture);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR);
        gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, this.cloudPixels.width, this.cloudPixels.height,
          0, gl2.RGBA, gl2.UNSIGNED_BYTE, this.cloudPixels.data);
      } else if (this.cloudTexture) {
        gl2.deleteTexture(this.cloudTexture);
        this.cloudTexture = null;
      }
      this.cloudDirty = false;
    }
    gl2.bindTexture(gl2.TEXTURE_2D, this.cloudTexture ?? this.lightsTexture);

    const projection = options.defaultProjectionData;
    gl2.useProgram(program.program);
    gl2.bindVertexArray(this.vao);
    gl2.enable(gl2.BLEND);
    gl2.blendFunc(gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
    gl2.enable(gl2.DEPTH_TEST);
    gl2.depthFunc(gl2.LEQUAL);
    gl2.depthMask(false);
    gl2.disable(gl2.CULL_FACE);
    if (program.projectionMatrix) {
      gl2.uniformMatrix4fv(program.projectionMatrix, false, asMat4f32(projection.mainMatrix));
    }
    if (program.tileMercator) {
      gl2.uniform4f(program.tileMercator, ...projection.tileMercatorCoords);
    }
    if (program.clippingPlane) {
      gl2.uniform4f(program.clippingPlane, ...projection.clippingPlane);
    }
    if (program.projectionTransition) {
      gl2.uniform1f(program.projectionTransition, projection.projectionTransition);
    }
    if (program.fallbackMatrix) {
      gl2.uniformMatrix4fv(program.fallbackMatrix, false, asMat4f32(projection.fallbackMatrix));
    }
    if (program.clipAntimeridian) {
      gl2.uniform1i(program.clipAntimeridian, projection.clipAntimeridian ? 1 : 0);
    }
    gl2.uniform4f(program.horizon, ...projection.clippingPlane);
    gl2.uniform1f(program.globe, projection.projectionTransition);
    gl2.uniform1f(program.dayNight, this.dayNight ? 1 : 0);
    gl2.uniform1f(program.decorative, this.decorative ? 1 : 0);
    gl2.uniform1f(program.cloudOpacity, this.cloudTexture ? globeCloudOpacity(this.map?.getZoom() ?? 6) : 0);
    gl2.uniform1f(program.elevation, SHELL_ALTITUDE_METERS);
    gl2.uniform3f(program.sun, this.sun[0], this.sun[1], this.sun[2]);
    gl2.uniform1f(program.opacity, this.opacity);
    gl2.uniform1f(program.lights, this.lights);
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, this.lightsTexture);
    gl2.uniform1i(program.cityLights, 0);
    gl2.uniform1i(program.cloudCover, 1);
    gl2.drawElements(gl2.TRIANGLES, this.indexCount, gl2.UNSIGNED_INT, 0);

    gl2.bindTexture(gl2.TEXTURE_2D, previousTexture);
    gl2.activeTexture(gl2.TEXTURE1);
    gl2.bindTexture(gl2.TEXTURE_2D, previousCloudTexture);
    gl2.activeTexture(previousActiveTexture);
    gl2.depthMask(previousDepthMask);
    gl2.depthFunc(previousDepthFunc);
    if (previousCull) gl2.enable(gl2.CULL_FACE);
    else gl2.disable(gl2.CULL_FACE);
    if (!previousDepthTest) gl2.disable(gl2.DEPTH_TEST);
    if (!previousBlend) gl2.disable(gl2.BLEND);
    else gl2.blendFuncSeparate(previousBlendSrcRgb, previousBlendDstRgb, previousBlendSrcAlpha, previousBlendDstAlpha);
    gl2.bindVertexArray(previousVao);
    gl2.useProgram(previousProgram);
  }

  onRemove(_map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl2 = gl as WebGL2RenderingContext;
    for (const program of this.programs.values()) gl2.deleteProgram(program.program);
    this.programs.clear();
    if (this.vao) gl2.deleteVertexArray(this.vao);
    if (this.mercatorBuffer) gl2.deleteBuffer(this.mercatorBuffer);
    if (this.lnglatBuffer) gl2.deleteBuffer(this.lnglatBuffer);
    if (this.indexBuffer) gl2.deleteBuffer(this.indexBuffer);
    if (this.lightsTexture) gl2.deleteTexture(this.lightsTexture);
    if (this.cloudTexture) gl2.deleteTexture(this.cloudTexture);
    this.cloudTexture = null;
    this.cloudDirty = Boolean(this.cloudPixels);
    this.vao = null;
    this.map = undefined;
  }
}
