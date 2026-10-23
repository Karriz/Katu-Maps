import type { CustomTerrainRenderInput, TerrainHeightMapTarget } from 'maplibre-gl';

/** The terrain tile callback supplies unwrapped XYZ tiles. */
export function terrainTileMercatorBounds(tile: CustomTerrainRenderInput['tileID']): [number, number, number, number] {
  const size = 2 ** tile.canonical.z;
  const wrap = tile.wrap ?? 0;
  return [
    wrap + tile.canonical.x / size,
    tile.canonical.y / size,
    wrap + (tile.canonical.x + 1) / size,
    (tile.canonical.y + 1) / size,
  ];
}

/** Keep Mercator subtraction in JavaScript's double precision before GL uniforms. */
export function shadowLocalBounds(
  bounds: [number, number, number, number],
  origin: [number, number, number, number],
): [number, number, number, number] {
  const [x, y, metresToMercator] = origin;
  return [
    (bounds[0] - x) / metresToMercator,
    (bounds[1] - y) / metresToMercator,
    (bounds[2] - x) / metresToMercator,
    (bounds[3] - y) / metresToMercator,
  ];
}

const VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 out_color;
uniform vec4 u_tile_bounds;
uniform vec4 u_height_bounds;
uniform float u_origin_elevation;
uniform mat4 u_shadow_matrix;
uniform sampler2D u_height;
uniform sampler2D u_depth;
uniform vec4 u_color;
void main() {
  // Tile bounds are metres relative to the scene origin, with Y increasing south.
  vec2 local = vec2(
    mix(u_tile_bounds.x, u_tile_bounds.z, v_uv.x),
    mix(u_tile_bounds.w, u_tile_bounds.y, v_uv.y)
  );
  vec2 height_uv = vec2(
    (local.x - u_height_bounds.x) / (u_height_bounds.z - u_height_bounds.x),
    (u_height_bounds.w - local.y) / (u_height_bounds.w - u_height_bounds.y)
  );
  if (any(lessThan(height_uv, vec2(0.0))) || any(greaterThan(height_uv, vec2(1.0)))) discard;
  // Float height targets use NEAREST; interpolate loaded samples in the shader.
  ivec2 height_size = textureSize(u_height, 0);
  vec2 height_pos = height_uv * vec2(height_size) - 0.5;
  ivec2 height_base = ivec2(floor(height_pos));
  vec2 height_fraction = fract(height_pos);
  float elevation = 0.0;
  float loaded = 0.0;
  for (int y = 0; y < 2; ++y) {
    for (int x = 0; x < 2; ++x) {
      ivec2 at = clamp(height_base + ivec2(x, y), ivec2(0), height_size - 1);
      vec4 sample_height = texelFetch(u_height, at, 0);
      float weight = (x == 0 ? 1.0 - height_fraction.x : height_fraction.x)
        * (y == 0 ? 1.0 - height_fraction.y : height_fraction.y) * sample_height.a;
      elevation += sample_height.r * weight;
      loaded += weight;
    }
  }
  if (loaded < 0.5) discard;
  elevation /= loaded;
  // The Three scene maps local (east, up, north) into (east, north, up).
  vec3 world = vec3(
    local.x,
    -local.y,
    elevation - u_origin_elevation + 0.6
  );
  vec4 light = u_shadow_matrix * vec4(world, 1.0);
  vec3 shadow = light.xyz / light.w;
  if (any(lessThan(shadow, vec3(0.0))) || any(greaterThan(shadow, vec3(1.0)))) discard;
  // Blend a small tent of depth comparisons to soften texel stair steps.
  ivec2 depth_size = textureSize(u_depth, 0);
  vec2 depth_pos = shadow.xy * vec2(depth_size) - 0.5;
  ivec2 depth_center = ivec2(floor(depth_pos + 0.5));
  vec2 fraction = depth_pos - vec2(depth_center);
  float covered = 0.0;
  float total_weight = 0.0;
  for (int y = -1; y <= 1; ++y) {
    for (int x = -1; x <= 1; ++x) {
      ivec2 at = clamp(depth_center + ivec2(x, y), ivec2(0), depth_size - 1);
      float weight = max(0.0, 1.5 - abs(float(x) - fraction.x))
        * max(0.0, 1.5 - abs(float(y) - fraction.y));
      covered += weight * float(shadow.z - 0.0002 > texelFetch(u_depth, at, 0).r);
      total_weight += weight;
    }
  }
  covered /= total_weight;
  // A broad DEM comparison gives shallow terrain recesses a restrained
  // ambient-occlusion cue without changing MapLibre's styled ground material.
  ivec2 center = clamp(ivec2(height_pos + 0.5), ivec2(0), height_size - 1);
  ivec2 relief_step = ivec2(8);
  float surrounding = 0.0;
  float surrounding_weight = 0.0;
  for (int axis = 0; axis < 4; ++axis) {
    ivec2 direction = axis == 0 ? ivec2(1, 0) : axis == 1 ? ivec2(-1, 0)
      : axis == 2 ? ivec2(0, 1) : ivec2(0, -1);
    vec4 neighbor = texelFetch(u_height,
      clamp(center + direction * relief_step, ivec2(0), height_size - 1), 0);
    surrounding += neighbor.r * neighbor.a;
    surrounding_weight += neighbor.a;
  }
  float relief_occlusion = surrounding_weight > 3.0
    ? clamp((surrounding / surrounding_weight - elevation) * 0.015, 0.0, 0.08)
    : 0.0;
  float alpha = clamp(u_color.a * covered + relief_occlusion, 0.0, 1.0);
  out_color = vec4(u_color.rgb * alpha, alpha);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate terrain shadow shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Terrain shadow shader compilation failed: ${log}`);
  }
  return shader;
}

/** Paints the caster shadow map into MapLibre's terrain tile framebuffer. */
export class TerrainShadowDrape {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly heightTexture: WebGLTexture;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private heightBounds: [number, number, number, number] = [0, 0, 1, 1];
  constructor(private readonly gl: WebGL2RenderingContext, public heightSize: number) {
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('Float terrain height render targets are unavailable');
    }
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate terrain shadow program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Terrain shadow program linking failed: ${log}`);
    }
    this.program = program;
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const heightTexture = gl.createTexture();
    if (!vao || !vertexBuffer || !heightTexture) throw new Error('Unable to allocate terrain shadow buffers');
    this.vao = vao;
    this.vertexBuffer = vertexBuffer;
    this.heightTexture = heightTexture;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, heightTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.heightSize, this.heightSize, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uniforms = Object.fromEntries([
      'u_tile_bounds', 'u_height_bounds', 'u_origin_elevation', 'u_shadow_matrix',
      'u_height', 'u_depth', 'u_color',
    ].map((name) => [name, gl.getUniformLocation(program, name)]));
  }

  resizeHeightMap(size: number) {
    if (size === this.heightSize) return;
    const gl = this.gl;
    this.heightSize = size;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
  }

  updateHeightMap(render: (target: TerrainHeightMapTarget) => void, bounds: [number, number, number, number]) {
    this.heightBounds = bounds;
    render({
      texture: this.heightTexture,
      width: this.heightSize,
      height: this.heightSize,
      bounds,
    });
  }

  draw(
    tile: CustomTerrainRenderInput,
    depthTexture: WebGLTexture,
    shadowMatrix: Float32Array,
    origin: [number, number, number, number],
    color: [number, number, number],
    opacity: number,
  ) {
    const tileBounds = terrainTileMercatorBounds(tile.tileID);
    const [west, north, east, south] = tileBounds;
    const [minX, minY, maxX, maxY] = this.heightBounds;
    const clipWest = Math.max(west, minX);
    const clipEast = Math.min(east, maxX);
    const clipNorth = Math.max(north, minY);
    const clipSouth = Math.min(south, maxY);
    if (clipWest >= clipEast || clipNorth >= clipSouth) return;
    const gl = this.gl;
    const previousScissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    const previousScissor = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
    gl.viewport(0, 0, tile.width, tile.height);
    gl.enable(gl.SCISSOR_TEST);
    const scissorX = Math.max(0, Math.floor((clipWest - west) / (east - west) * tile.width));
    const scissorY = Math.max(0, Math.floor((south - clipSouth) / (south - north) * tile.height));
    const scissorRight = Math.min(tile.width, Math.ceil((clipEast - west) / (east - west) * tile.width));
    const scissorTop = Math.min(tile.height, Math.ceil((south - clipNorth) / (south - north) * tile.height));
    gl.scissor(scissorX, scissorY, scissorRight - scissorX, scissorTop - scissorY);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.uniform1i(this.uniforms.u_height, 0);
    gl.uniform1i(this.uniforms.u_depth, 1);
    gl.uniform4fv(this.uniforms.u_tile_bounds, shadowLocalBounds(tileBounds, origin));
    gl.uniform4fv(this.uniforms.u_height_bounds, shadowLocalBounds(this.heightBounds, origin));
    gl.uniform1f(this.uniforms.u_origin_elevation, origin[3]);
    gl.uniformMatrix4fv(this.uniforms.u_shadow_matrix, false, shadowMatrix);
    gl.uniform4f(this.uniforms.u_color, color[0], color[1], color[2], opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.scissor(previousScissor[0], previousScissor[1], previousScissor[2], previousScissor[3]);
    if (!previousScissorEnabled) gl.disable(gl.SCISSOR_TEST);
  }

  dispose() {
    this.gl.deleteTexture(this.heightTexture);
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
