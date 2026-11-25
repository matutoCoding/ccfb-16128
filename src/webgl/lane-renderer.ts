/**
 * 球道 3D 渲染器（WebGL2）。
 * 视觉目标（需求 7）：
 *  - 油厚处反光亮而锐（高 specular、低 roughness、清晰顶灯倒影）
 *  - 干区发乌（低反照率、粗糙、倒影糊）
 *  - 顶灯与置瓶区灯光的镜面反射随油量变糊，眼高机位最明显
 *  - 板级高低起伏通过顶点位移体现，把球往一侧带的地形可被看见
 */
import {
  BOARD_WIDTH_IN,
  BOARDS,
  CELL_COLS,
  CELL_ROWS,
  FOUL_TO_PIN_FT,
  LANE_WIDTH_IN,
  PIN_DECK_FT,
} from '../core/constants';
import type { LaneProfile, TrajectoryResult } from '../core/types';
import { OrbitCamera, mat4Perspective, mat4Multiply, type Mat4 } from './mat4';

const LANE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;       // x(英寸,横向) y(高度) z(英寸,纵向)
layout(location=1) in vec2 aGridUv;   // 油纹理 uv
layout(location=2) in float aWear;
uniform mat4 uViewProj;
uniform float uXScale;   // 横向展示展宽（仅视觉，不影响纹理/物理）
out vec2 vGridUv;
out vec3 vWorld;
out float vWear;
void main() {
  vGridUv = aGridUv;
  vec3 pos = vec3(aPos.x * uXScale, aPos.y, aPos.z);
  vWorld = pos;
  vWear = aWear;
  gl_Position = uViewProj * vec4(pos, 1.0);
}
`;

const LANE_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uOil;       // R32F 油量(uL)
uniform vec2 uGridSize;
uniform float uOilMax;        // 满油参考值(uL/格)
uniform vec3 uCamPos;
in vec2 vGridUv;
in vec3 vWorld;
in float vWear;
out vec4 frag;

// 顶灯（沿球道上方的两排）与置瓶区灯（远端强光源）
const vec3 CEILING_LIGHT_A = vec3(-12.0, 96.0, 180.0);
const vec3 CEILING_LIGHT_B = vec3(12.0, 96.0, 420.0);
const vec3 PIN_LIGHT = vec3(0.0, 110.0, 760.0);

vec3 lightDirTo(vec3 lightPos, vec3 p) { return normalize(lightPos - p); }

// Blinn-Phong 高光，粗糙度控制锐度：油多 → shininess 大 → 亮而锐
vec3 specular(vec3 n, vec3 v, vec3 l, vec3 lc, float shininess) {
  vec3 h = normalize(l + v);
  float ndh = max(dot(n, h), 0.0);
  return lc * pow(ndh, shininess);
}

void main() {
  float oil = texture(uOil, vGridUv).r;
  float oilN = clamp(oil / max(uOilMax, 1e-4), 0.0, 1.0);

  // 木/合成基底色：干区发乌，油区加深且偏暖
  vec3 woodDark = vec3(0.055, 0.038, 0.026);
  vec3 woodOily = vec3(0.16, 0.11, 0.07);
  vec3 albedo = mix(woodDark, woodOily, oilN);
  albedo *= 1.0 - 0.35 * vWear; // 磨损处更暗更哑

  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 v = normalize(uCamPos - vWorld);

  // 粗糙度：干区 0.92 → 满油 0.08；shininess 随之 8 → 220
  float roughness = mix(0.92, 0.08, oilN);
  float shininess = mix(8.0, 220.0, 1.0 - roughness);

  vec3 color = albedo * 0.35; // 环境底光
  vec3 warmLamp = vec3(1.0, 0.93, 0.82);
  vec3 coolLamp = vec3(0.85, 0.9, 1.0);

  vec3 l1 = lightDirTo(CEILING_LIGHT_A, vWorld);
  vec3 l2 = lightDirTo(CEILING_LIGHT_B, vWorld);
  vec3 l3 = lightDirTo(PIN_LIGHT, vWorld);

  // 漫反射
  color += albedo * warmLamp * max(dot(n, l1), 0.0) * 0.5;
  color += albedo * warmLamp * max(dot(n, l2), 0.0) * 0.4;
  color += albedo * coolLamp * max(dot(n, l3), 0.0) * 0.5;

  // 镜面反射：油多亮而锐；干区几乎无高光（发乌）
  vec3 spec = vec3(0.0);
  spec += specular(n, v, l1, warmLamp, shininess) * (0.15 + 0.85 * oilN);
  spec += specular(n, v, l2, warmLamp, shininess) * (0.15 + 0.85 * oilN);
  spec += specular(n, v, l3, coolLamp, shininess * 0.8) * (0.1 + 0.9 * oilN);
  color += spec;

  // 板缝暗线（每块板边缘）增强 39 板可读性
  float boardF = vGridUv.x * uGridSize.x;
  float seam = min(fract(boardF), 1.0 - fract(boardF));
  color *= 0.82 + 0.18 * smoothstep(0.0, 0.08, seam);

  // 油面轻微暖色辉光（极油处）
  color += vec3(0.05, 0.04, 0.02) * oilN * oilN;

  frag = vec4(color, 1.0);
}
`;

const LINE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform float uXScale;
void main() { gl_Position = uViewProj * vec4(aPos.x * uXScale, aPos.y, aPos.z, 1.0); }
`;
const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main() { frag = uColor; }
`;

export interface OverlayPath {
  trajectory: TrajectoryResult;
  color: [number, number, number, number];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`着色器失败: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}
function makeProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`链接失败: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

/**
 * 浮点纹理参数：NEAREST 是 R32F 的硬性要求（不可线性过滤）。
 * 部分 ANGLE 驱动对 CLAMP_TO_EDGE 枚举报 INVALID_ENUM（无害），用 try/catch 隔离。
 */
export function safeFloatTexParams(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  try {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  } catch {
    /* 个别驱动不接受该枚举，忽略即可 */
  }
}

export class LaneRenderer {
  private gl: WebGL2RenderingContext;
  private laneProg: WebGLProgram;
  private lineProg: WebGLProgram;
  private laneVao: WebGLVertexArrayObject;
  private indexCount = 0;
  private lineVao: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineCap = 0;
  readonly camera = new OrbitCamera();
  private oilTexture: WebGLTexture | null = null;
  private oilMax = 1;
  private canvas: HTMLCanvasElement;
  private lane: LaneProfile;
  /** 横向展示展宽倍数（真实球道宽长比 1:18，放大以看清 39 板油面差异） */
  xScale = 2.6;

  constructor(canvas: HTMLCanvasElement, lane: LaneProfile) {
    this.canvas = canvas;
    this.lane = lane;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    this.laneProg = makeProgram(gl, LANE_VERT, LANE_FRAG);
    this.lineProg = makeProgram(gl, LINE_VERT, LINE_FRAG);

    const built = this.buildLaneGeometry();
    this.laneVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.laneVao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, built.vertices, gl.STATIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 5 * 4);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, built.indices, gl.STATIC_DRAW);
    this.indexCount = built.indices.length;

    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    this.lineBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bindVertexArray(null);

    // 按球道实际尺寸做包围球取景，保证狭长球道完整入框
    const lengthIn = (FOUL_TO_PIN_FT + PIN_DECK_FT) * 12;
    this.camera.frameBounds(LANE_WIDTH_IN, lengthIn);
  }

  /** 球道网格：每板一列、沿道按纹理行细分，顶点 y 取板高（mil→inch） */
  private buildLaneGeometry(): { vertices: Float32Array; indices: Uint32Array } {
    const gl = this.gl;
    const cols = CELL_COLS;
    const rows = CELL_ROWS;
    const verts: number[] = [];
    const idxs: number[] = [];
    const lengthIn = (FOUL_TO_PIN_FT + PIN_DECK_FT) * 12;

    for (let r = 0; r <= rows; r++) {
      const z = (r / rows) * lengthIn;
      for (let c = 0; c <= cols; c++) {
        const boardIdx = Math.min(BOARDS - 1, Math.max(0, c));
        const x = (c / cols) * LANE_WIDTH_IN - LANE_WIDTH_IN / 2;
        const y = this.lane.boardHeightMil[boardIdx] * 0.001;
        const u = c / cols;
        const v = 1 - r / rows; // 纹理行 0 在近端
        const wear = this.lane.wear[boardIdx];
        verts.push(x, y, z, u, v, wear);
      }
    }
    const strideV = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * strideV + c;
        const b = a + 1;
        const d = a + strideV;
        const e = d + 1;
        idxs.push(a, d, b, b, d, e);
      }
    }
    if (gl.getExtension('OES_element_index_uint') === null && idxs.length > 65535) {
      // WebGL2 原生支持 Uint32 索引，无需扩展
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(idxs) };
  }

  /** 绑定当前油面纹理（来自 GpuOilSim.texture，零拷贝）或 CPU 快照 */
  setOilTexture(tex: WebGLTexture, oilMaxUl: number): void {
    this.oilTexture = tex;
    this.oilMax = oilMaxUl;
  }

  /** 从 CPU 快照建一张纹理（回放历史局时用） */
  uploadSnapshotTexture(grid: Float32Array, oilMaxUl: number): WebGLTexture {
    const gl = this.gl;
    if (!this.oilTexture || (this.oilTexture as WebGLTexture & { __cpu?: boolean }).__cpu) {
      if (this.oilTexture) gl.deleteTexture(this.oilTexture);
      this.oilTexture = gl.createTexture();
      (this.oilTexture as WebGLTexture & { __cpu?: boolean }).__cpu = true;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.oilTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F, CELL_COLS, CELL_ROWS, 0,
      gl.RED, gl.FLOAT, grid,
    );
    safeFloatTexParams(gl);
    this.oilMax = oilMaxUl;
    return this.oilTexture;
  }

  /** 板号(1..39) → 世界 x（英寸，中心为 0） */
  private boardToWorldX(board: number): number {
    return (board - (BOARDS + 1) / 2) * BOARD_WIDTH_IN;
  }

  /** 上传轨迹/入袋标记折线 */
  setOverlays(paths: OverlayPath[]): void {
    const gl = this.gl;
    const data: number[] = [];
    for (const { trajectory } of paths) {
      const pts = trajectory.points;
      for (let i = 0; i < pts.length - 1; i++) {
        data.push(
          this.boardToWorldX(pts[i].x), 0.25, pts[i].z * 12,
          this.boardToWorldX(pts[i + 1].x), 0.25, pts[i + 1].z * 12,
        );
      }
      // 入袋点十字
      const last = pts[pts.length - 1];
      const hx = this.boardToWorldX(last.x);
      const hz = last.z * 12;
      data.push(hx - 3, 0.3, hz, hx + 3, 0.3, hz);
      data.push(hx, 0.3, hz - 3, hx, 0.3, hz + 3);
    }
    const arr = new Float32Array(data);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    if (arr.length > this.lineCap) {
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      this.lineCap = arr.length;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
    }
    const loc = 0;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lineVertexCount = arr.length / 3;
  }
  private lineVertexCount = 0;

  render(): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.02, 0.02, 0.025, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective(this.camera.fovy, aspect, 1, 5000);
    const viewProj = mat4Multiply(proj, this.camera.view()) as Mat4;

    // 球道
    gl.useProgram(this.laneProg);
    gl.bindVertexArray(this.laneVao);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.laneProg, 'uViewProj'), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(this.laneProg, 'uCamPos'), this.camera.eye);
    gl.uniform2f(gl.getUniformLocation(this.laneProg, 'uGridSize'), CELL_COLS, CELL_ROWS);
    gl.uniform1f(gl.getUniformLocation(this.laneProg, 'uOilMax'), this.oilMax);
    gl.uniform1f(gl.getUniformLocation(this.laneProg, 'uXScale'), this.xScale);
    if (this.oilTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.oilTexture);
      gl.uniform1i(gl.getUniformLocation(this.laneProg, 'uOil'), 0);
    }
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // 轨迹叠加
    if (this.lineVertexCount > 0) {
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVao);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uViewProj'), false, viewProj);
      gl.uniform1f(gl.getUniformLocation(this.lineProg, 'uXScale'), this.xScale);
      gl.uniform4fv(gl.getUniformLocation(this.lineProg, 'uColor'), [1, 0.75, 0.2, 1]);
      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.laneProg);
    gl.deleteProgram(this.lineProg);
    gl.deleteVertexArray(this.laneVao);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteBuffer(this.lineBuf);
  }
}
