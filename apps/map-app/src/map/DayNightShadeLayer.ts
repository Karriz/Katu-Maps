import * as maplibregl from 'maplibre-gl';
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
uniform vec3 u_sun;
uniform float u_opacity;
uniform float u_lights;
uniform sampler2D u_city_lights;
out vec4 fragColor;

void main() {
  float lat = clamp(v_lnglat.y, -89.5, 89.5) * 0.017453292519943295;
  float lng = v_lnglat.x * 0.017453292519943295;
  vec3 normal = vec3(cos(lat) * cos(lng), cos(lat) * sin(lng), sin(lat));
  float mu = dot(normal, u_sun);
  float night = smoothstep(0.12, -0.22, mu);
  float twilight = smoothstep(0.28, 0.02, mu) * smoothstep(-0.38, -0.02, mu);
  float dusk = clamp((mu + 0.04) / 0.22, 0.0, 1.0);
  vec3 twilightRgb = mix(vec3(0.22, 0.08, 0.42), vec3(1.0, 0.48, 0.16), dusk);
  vec3 nightRgb = vec3(0.015, 0.04, 0.09);
  vec2 uv = vec2(fract(v_lnglat.x / 360.0 + 0.5), 0.5 - v_lnglat.y / 180.0);
  vec3 lights = texture(u_city_lights, uv).rgb * night * u_lights;
  float nightAlpha = night * 0.78 * u_opacity;
  float twilightAlpha = twilight * 0.55 * u_opacity;
  vec3 color = nightRgb * nightAlpha + twilightRgb * twilightAlpha + lights;
  float alpha = clamp(nightAlpha + twilightAlpha, 0.0, 1.0);
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

function hash2(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

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
    const latitudeFalloff = Math.max(0, 1 - Math.abs(lat) / 68);
    const equatorialCut = lat > -38 && lat < 62 ? 1 : 0.18;
    for (let x = 0; x < width; x += 1) {
      const lng = (x + 0.5) / width * 360 - 180;
      const n1 = hash2(lng * 0.18, lat * 0.22);
      const n2 = hash2(lng * 0.7, lat * 0.7);
      const n3 = hash2(lng * 2.3, lat * 2.1);
      let glow = 0;
      for (const [cityLng, cityLat, brightness, radius] of URBAN_REGIONS) {
        const dLng = Math.abs(lng - cityLng);
        const wrapped = Math.min(dLng, 360 - dLng);
        const distance = Math.hypot(wrapped, lat - cityLat);
        glow += brightness * Math.exp(-((distance * distance) / (radius * radius * 0.55)));
      }
      const speck = n2 > 0.82 && n3 > 0.6 ? (n3 - 0.6) * 1.4 : 0;
      const field = Math.max(0, n1 * 1.15 - 0.55) ** 1.8;
      const intensity = Math.min(1, (glow * 1.15 + field * 0.55 + speck * 0.35) * latitudeFalloff * equatorialCut);
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
uniform float u_elevation;
void main() {
  v_lnglat = a_lnglat;
  gl_Position = projectTileFor3D(a_mercator, u_elevation);
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
  };
}

function createGlobeMesh() {
  const mercators: number[] = [];
  const lnglats: number[] = [];
  const indices: number[] = [];
  for (let latIndex = 0; latIndex <= LAT_SEGMENTS; latIndex += 1) {
    const lat = 85 - latIndex * (170 / LAT_SEGMENTS);
    for (let lngIndex = 0; lngIndex <= LNG_SEGMENTS; lngIndex += 1) {
      const lng = -180 + lngIndex * (360 / LNG_SEGMENTS);
      const mercator = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat });
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
  private indexCount = 0;
  private opacity = 0;
  private lights = 0;
  private sun: [number, number, number] = [1, 0, 0];

  setAppearance(sun: [number, number, number], opacity: number, lights: number) {
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
    const previousTexture = gl2.getParameter(gl2.TEXTURE_BINDING_2D);

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
    gl2.uniform1f(program.elevation, SHELL_ALTITUDE_METERS);
    gl2.uniform3f(program.sun, this.sun[0], this.sun[1], this.sun[2]);
    gl2.uniform1f(program.opacity, this.opacity);
    gl2.uniform1f(program.lights, this.lights);
    gl2.activeTexture(gl2.TEXTURE0);
    gl2.bindTexture(gl2.TEXTURE_2D, this.lightsTexture);
    gl2.uniform1i(program.cityLights, 0);
    gl2.drawElements(gl2.TRIANGLES, this.indexCount, gl2.UNSIGNED_INT, 0);

    gl2.bindTexture(gl2.TEXTURE_2D, previousTexture);
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
    this.vao = null;
    this.map = undefined;
  }
}
