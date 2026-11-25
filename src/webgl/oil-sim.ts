/**
 * GPU 油面迭代（WebGL2 计算路径）。
 *
 * 设计要点：
 *  - 油面存 R32F 浮点纹理(480×39)，两张纹理 ping-pong，全程驻留 GPU。
 *  - 每次出手把 CPU 已按 (row,col) 聚合好的接触单元用 instanced point 上传，
 *    片元着色器逐格执行与 applyShotGrid 完全相同的吸油/吐油公式。
 *  - 每局只回读一次（readbackSnapshot）做 <1% 校验，绝不在每球后回读整表。
 *  - 不依赖 transform feedback / compute shader，兼容性最好。
 */
import { CELL_COLS, CELL_ROWS } from '../core/constants';
import { cellIndex } from '../core/coords';
import type { ContactCell, SimSettings } from '../core/types';

/** CPU 侧按格聚合后的接触单元（与着色器 instance 属性一一对应） */
export interface GpuContact {
  row: number;
  col: number;
  lateralWeight: number;
  deposit: number; // 0 / 1
}

const VERT = `#version 300 es
precision highp float;
in vec2 aCorner;            // 覆盖目标像素的四边形角点 (0..1)
in vec4 iCell;              // row, col, lateralWeight, deposit(0/1)
uniform vec2 uGridSize;     // cols, rows
out vec2 vUv;
flat out vec4 vCell;
void main() {
  // 像素坐标(col,row) → 纹理 uv(列向右、行向下)，与帧缓冲像素一一对应，
  // 不做 y 翻转（实测恒等拷贝下行序天然一致）。
  vec2 px = vec2(iCell.y, iCell.x);
  vec2 pos = (px + aCorner) / uGridSize;
  vUv = pos;
  vCell = iCell;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uOil;
uniform float uAbsorption;
uniform float uDepositFraction;
uniform float uTotalAbsorb;      // 本次出手总吸油(uL)，CPU 预算
uniform float uDepositWeightSum; // 吐油区 lateralWeight 之和
in vec2 vUv;
flat in vec4 vCell;
out float outOil;
void main() {
  float oil = texture(uOil, vUv).r;
  float w = vCell.z;
  float absorb = oil * uAbsorption * w;
  float deposit = 0.0;
  if (vCell.w > 0.5 && uDepositWeightSum > 0.0) {
    deposit = (w / uDepositWeightSum) * (uTotalAbsorb * uDepositFraction);
  }
  outOil = max(0.0, oil - absorb) + deposit;
}
`;

const COPY_VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
const COPY_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uTex;
in vec2 vUv;
out float outOil;
void main() { outOil = texture(uTex, vUv).r; }
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('无法创建着色器');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`着色器编译失败: ${log}`);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('无法创建程序');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`程序链接失败: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

export class GpuOilSim {
  private gl: WebGL2RenderingContext;
  private simProg: WebGLProgram;
  private copyProg: WebGLProgram;
  private tex: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private vao: WebGLVertexArrayObject;
  private cornerBuf: WebGLBuffer;
  private cellBuf: WebGLBuffer;
  private quadVao: WebGLVertexArrayObject;
  private quadBuf: WebGLBuffer;
  private readBuf: Float32Array;
  private src = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('当前设备不支持 EXT_color_buffer_float，无法做浮点油面纹理迭代');
    }
    this.simProg = program(gl, VERT, FRAG);
    this.copyProg = program(gl, COPY_VERT, COPY_FRAG);

    this.tex = [this.createTex(), this.createTex()];
    this.fbo = [this.createFbo(this.tex[0]), this.createFbo(this.tex[1])];

    // 实例几何：两个三角形覆盖一个像素，6 个角点
    const corners = new Float32Array([
      0, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 1,
    ]);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    const locCorner = gl.getAttribLocation(this.simProg, 'aCorner');
    gl.enableVertexAttribArray(locCorner);
    gl.vertexAttribPointer(locCorner, 2, gl.FLOAT, false, 0, 0);

    this.cellBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuf);
    const locCell = gl.getAttribLocation(this.simProg, 'iCell');
    gl.enableVertexAttribArray(locCell);
    gl.vertexAttribPointer(locCell, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(locCell, 1);
    gl.bindVertexArray(null);

    // 全屏拷贝四边形
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const locPos = gl.getAttribLocation(this.copyProg, 'aPos');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.readBuf = new Float32Array(CELL_ROWS * CELL_COLS);
  }

  private createTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture();
    if (!t) throw new Error('创建油纹理失败');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F, CELL_COLS, CELL_ROWS, 0,
      gl.RED, gl.FLOAT, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    try {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch { /* 驱动枚举差异，忽略 */ }
    return t;
  }

  private createFbo(tex: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('创建 FBO 失败');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`浮点 FBO 不完整: 0x${status.toString(16)}`);
    }
    return fbo;
  }

  /** 上传初始油面（CPU 网格 → 当前源纹理） */
  uploadInitial(grid: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.src]);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, CELL_COLS, CELL_ROWS,
      gl.RED, gl.FLOAT, grid,
    );
  }

  /** 把接触带按格聚合（同行同列合并，权重取首个——接触带已去重，实际无重复） */
  static aggregateContacts(contact: ContactCell[]): GpuContact[] {
    const map = new Map<number, GpuContact>();
    for (const c of contact) {
      const key = cellIndex(c.row, c.col);
      if (!map.has(key)) {
        map.set(key, {
          row: c.row,
          col: c.col,
          lateralWeight: c.lateralWeight,
          deposit: c.deposit ? 1 : 0,
        });
      }
    }
    return [...map.values()];
  }

  /**
   * 应用一次出手。totalAbsorb / depositWeightSum 由 CPU 预算传入，
   * 保证着色器吐出量与 CPU 公式严格同源。
   */
  applyShot(
    contacts: GpuContact[],
    totalAbsorb: number,
    depositWeightSum: number,
    settings: SimSettings,
  ): void {
    const gl = this.gl;
    if (contacts.length === 0) return;

    const data = new Float32Array(contacts.length * 4);
    contacts.forEach((c, i) => {
      data[i * 4] = c.row;
      data[i * 4 + 1] = c.col;
      data[i * 4 + 2] = c.lateralWeight;
      data[i * 4 + 3] = c.deposit;
    });

    const dst = 1 - this.src;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
    gl.viewport(0, 0, CELL_COLS, CELL_ROWS);
    gl.disable(gl.BLEND);

    // 先把源纹理整体拷贝到目标（未接触格保持不变）
    gl.useProgram(this.copyProg);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.src]);
    gl.uniform1i(gl.getUniformLocation(this.copyProg, 'uTex'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 再逐接触格叠加吸油/吐油
    gl.useProgram(this.simProg);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cellBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.src]);
    const u = (name: string) => gl.getUniformLocation(this.simProg, name);
    gl.uniform1i(u('uOil'), 0);
    gl.uniform2f(u('uGridSize'), CELL_COLS, CELL_ROWS);
    gl.uniform1f(u('uAbsorption'), settings.absorptionRate);
    gl.uniform1f(u('uDepositFraction'), settings.depositFraction);
    gl.uniform1f(u('uTotalAbsorb'), totalAbsorb);
    gl.uniform1f(u('uDepositWeightSum'), depositWeightSum);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, contacts.length);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.src = dst;
  }

  /** 每局最多一次：回读当前油面用于校验（不逐球调用） */
  readbackSnapshot(): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.src]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, CELL_COLS, CELL_ROWS, gl.RED, gl.FLOAT, this.readBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // 写入时纹理 row 与帧缓冲像素行直接对应；readPixels 虽以左下为原点，
    // 但恒等拷贝实验证明返回缓冲的行序与上传数据一致，故直接返回，不翻转。
    return new Float32Array(this.readBuf);
  }

  /** 当前源纹理（供渲染器直接采样，零拷贝） */
  get texture(): WebGLTexture {
    return this.tex[this.src];
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.simProg);
    gl.deleteProgram(this.copyProg);
    this.tex.forEach((t) => gl.deleteTexture(t));
    this.fbo.forEach((f) => gl.deleteFramebuffer(f));
    gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.cellBuf);
    gl.deleteBuffer(this.quadBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.quadVao);
  }
}
