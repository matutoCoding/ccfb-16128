/** 简易 4x4 矩阵与轨道相机（无第三方依赖） */
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = norm3(sub3(eye, center));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  const m = mat4Identity();
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot3(x, eye);
  m[13] = -dot3(y, eye);
  m[14] = -dot3(z, eye);
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** 轨道相机：绕目标点旋转，支持压到选手眼高（低机位） */
export class OrbitCamera {
  target: Vec3 = [0, 0, 32 * 12];
  azimuth = 0.5;       // 斜侧三分之四视角，让狭长球道长度斜向展开
  elevation = 0.42;   // 弧度，小角度=眼高
  distance = 1000;    // 由 frameBounds 按球道尺寸重算
  fovy = (60 * Math.PI) / 180;
  eyeHeightIn = 60;  // 选手眼高约 5ft(60in)
  eye: Vec3 = [0, 60, -120];

  update(): void {
    const horiz = Math.cos(this.elevation) * this.distance;
    const ex = this.target[0] + Math.sin(this.azimuth) * horiz;
    const ez = this.target[2] - Math.cos(this.azimuth) * horiz;
    const ey = this.target[1] + Math.sin(this.elevation) * this.distance + this.eyeHeightIn * 0.4;
    this.eye = [ex, Math.max(8, ey), ez];
  }

  view(): Mat4 {
    this.update();
    return mat4LookAt(this.eye, this.target, [0, 1, 0]);
  }

  /** 快速机位：俯视 / 选手眼高 */
  preset(name: 'top' | 'eye'): void {
    if (name === 'top') {
      this.azimuth = 0.5;
      this.elevation = 0.85;
      this.fovy = (60 * Math.PI) / 180;
      this.target = [0, 0, 32 * 12];
    } else {
      this.azimuth = 0.14;
      this.elevation = 0.1;
      this.fovy = (76 * Math.PI) / 180;
      this.target = [0, 0, 40 * 12];
    }
    this.frameBounds(42, 754);
  }

  /**
   * 取景：让狭长球道尽量填满视场。
   * 球道极狭长（宽 42in / 长 754in），包围球会过度保守，改为按
   * 当前方位角下"球道长度在相机视平面上的投影跨度"反推距离，
   * 再与宽度约束取较大者，保证两个方向都不出框。
   */
  frameBounds(widthIn: number, lengthIn: number, margin = 1.08): void {
    // 长度方向相对视线的有效投影系数（azimuth 越大，长度在画面里越"横"）
    const lenFactor = Math.abs(Math.cos(this.azimuth)) * Math.cos(this.elevation) + 0.25;
    const projectedLen = lengthIn * lenFactor;
    const tanV = Math.tan(this.fovy / 2);
    // 纵向取景距离
    const distByLength = (projectedLen * margin) / (2 * tanV);
    // 横向取景距离（宽度在画面横向，受 aspect 影响由 fovy 近似）
    const distByWidth = (widthIn * margin) / (2 * tanV);
    this.distance = Math.max(distByLength, distByWidth);
  }
}
