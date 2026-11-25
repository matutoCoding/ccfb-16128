/**
 * 球轨迹推演（滑行/转弯/滚动三段）+ 接触带确定性栅格化。
 *
 * 坐标：z 沿球道向瓶区（英寸），x 横向（英寸，板号增大方向 = 选手左侧）。
 * 右手勾球向 +x（高板方向回收），左手向 -x。
 * 积分：半隐式欧拉，空间步长 = 一个油纹理行(1.5in)，保证每一行恰好一个采样，
 * 从而接触带单元枚举对 CPU / GPU 完全确定、可逐格对齐。
 */
import {
  BOARD_WIDTH_IN,
  BOARDS,
  CELL_COLS,
  CELL_ROWS,
  CONTACT_HALF_BOARDS,
  DEPOSIT_START_FT,
  FOUL_TO_PIN_FT,
  GRAVITY_IN_S2,
  MPH_TO_IN_S,
  POCKET_BOARD_L,
  POCKET_BOARD_R,
} from './constants';
import {
  boardToCol,
  boardToInX,
  ftToRow,
  inXToBoard,
  sampleGrid,
} from './coords';
import type {
  BallPhase,
  BowlingBall,
  ContactCell,
  LaneProfile,
  ShotStyle,
  SimSettings,
  TrajectoryPoint,
  TrajectoryResult,
} from './types';

export interface ShotInput {
  style: ShotStyle;
  ball: BowlingBall;
  lane: LaneProfile;
  /** 出手板位扰动（板，可正可负） */
  boardJitter: number;
  /** 球速扰动（mph） */
  speedJitter: number;
}

/** 局部摩擦系数：油越多摩擦越小（双曲线平滑混合） */
export function localFriction(oilUl: number, s: SimSettings): number {
  const oilResponse = oilUl / (oilUl + s.frictionHalfOilUl); // 0(干)..1(满油)
  return s.dryFriction + (s.oilyFriction - s.dryFriction) * oilResponse;
}

/** 勾球势能系数（无量纲）：转速/轴倾角/球速/球种共同决定 */
function hookPotential(style: ShotStyle, ball: BowlingBall, s: SimSettings): number {
  const revFactor = Math.min(1.6, style.revRateRpm / 350);
  const tiltFactor = Math.max(0.15, 1 - style.axisTiltDeg / 45);
  const speedMph = style.ballSpeedMph;
  const speedFactor = Math.max(0.7, Math.min(1.3, 17 / speedMph));
  const ballFactor = 0.6 + 0.8 * ball.hookRating;
  return 0.55 * revFactor * tiltFactor * speedFactor * ballFactor * s.hookGain;
}

/** 地形横向坡度带来的加速度（in/s²），球向低处滚 */
function topoAccelX(xIn: number, lane: LaneProfile, s: SimSettings): number {
  const col = boardToCol(inXToBoard(xIn));
  const c0 = Math.max(0, Math.min(CELL_COLS - 2, Math.floor(col)));
  // mil → inch
  const hL = lane.boardHeightMil[c0] * 0.001;
  const hR = lane.boardHeightMil[c0 + 1] * 0.001;
  const slope = (hR - hL) / BOARD_WIDTH_IN; // 沿 +x 方向的坡度
  return -GRAVITY_IN_S2 * slope * s.topographyGain;
}

/** 横向接触权重：中心列 0.7，两侧各 0.15，行内和恒为 1 */
function lateralWeights(): number[] {
  return [0.15, 0.7, 0.15];
}

export function simulateTrajectory(
  grid: Float32Array,
  input: ShotInput,
  s: SimSettings,
): TrajectoryResult {
  const { style, ball, lane } = input;
  const handSign = style.handedness === 'R' ? 1 : -1;
  const hp = hookPotential(style, ball, s);

  const launchBoard = style.launchBoard + input.boardJitter;
  const x0 = boardToInX(launchBoard);
  const xTarget = boardToInX(style.targetBoard);
  const speedMph = style.ballSpeedMph + input.speedJitter;
  const vz0 = speedMph * MPH_TO_IN_S;
  // 由出手板 → 15ft 目标板确定初始方向
  const vx0 = vz0 * ((xTarget - x0) / (15 * 12));

  let x = x0;
  let z = 0;
  let vx = vx0;
  let vz = vz0;

  const points: TrajectoryPoint[] = [];
  const stepIn = 12 / 8; // 1.5in = 一个油网格行
  const maxSteps = CELL_ROWS; // 480 步到 60ft
  let gutter = false;

  let hookStartFt = NaN;
  let rollStartFt = NaN;
  let maxAbsVx = 0;

  for (let step = 0; step <= maxSteps; step++) {
    const zFt = z / 12;
    const board = inXToBoard(x);
    const phase: BallPhase = classifyPhase(step, zFt, vx, vz, hookStartFt, rollStartFt);
    points.push({ z: zFt, x: board, vx, vz, phase });

    if (zFt >= FOUL_TO_PIN_FT) break;
    if (board < 0.5 || board > BOARDS + 0.5) {
      gutter = true;
      break;
    }

    const row = ftToRow(zFt);
    const col = boardToCol(board);
    const oil = sampleGrid(grid, row, col);
    const f = localFriction(oil, s);

    const speed = Math.hypot(vx, vz) || 1;
    // 摩擦沿速度反方向（同时衰减纵向与横向速度）
    const aFric = f * GRAVITY_IN_S2;
    let ax = (-aFric * vx) / speed;
    let az = (-aFric * vz) / speed;

    // 勾球：需要摩擦力提供牵引力，油区自然变小 → 滑行
    ax += handSign * hp * aFric;
    // 地形侧坡
    ax += topoAccelX(x, lane, s);
    // 磨损额外增加干区牵引（叠加到勾球与摩擦）
    const wearCol = Math.max(0, Math.min(BOARDS - 1, Math.round(col)));
    ax *= 1 + 0.25 * lane.wear[wearCol];

    const dt = stepIn / Math.max(vz, 30);
    vx += ax * dt;
    vz += az * dt;
    x += vx * dt;
    z += stepIn;

    // 转折点判定
    const absVx = Math.abs(vx);
    if (Number.isNaN(hookStartFt) && absVx > 12 && zFt > 8) hookStartFt = zFt;
    if (absVx > maxAbsVx) {
      maxAbsVx = absVx;
    } else if (!Number.isNaN(hookStartFt) && Number.isNaN(rollStartFt) && zFt > hookStartFt + 6) {
      rollStartFt = zFt;
    }
  }

  if (Number.isNaN(hookStartFt)) hookStartFt = FOUL_TO_PIN_FT;
  if (Number.isNaN(rollStartFt)) rollStartFt = FOUL_TO_PIN_FT;

  // ---- 接触带栅格化（确定性：每个油纹理行至多一组枚举列） ----
  const contact = buildContact(points);
  const last = points[points.length - 1];
  const entryAngleDeg = (Math.atan2(Math.abs(last.vx), Math.max(last.vz, 1)) * 180) / Math.PI;
  const pocket = style.handedness === 'R' ? POCKET_BOARD_R : POCKET_BOARD_L;

  return {
    points,
    entryAngleDeg,
    hitBoard: gutter ? last.x : last.x,
    pocketOffset: last.x - pocket,
    hookStartFt,
    rollStartFt,
    contact,
    absorbedUl: 0, // 由 oil-depletion 填充
    depositedUl: 0,
  };
}

function classifyPhase(
  step: number,
  zFt: number,
  vx: number,
  vz: number,
  hookStartFt: number,
  rollStartFt: number,
): BallPhase {
  if (step === 0) return 'slide';
  if (!Number.isNaN(rollStartFt) && zFt >= rollStartFt) return 'roll';
  if (!Number.isNaN(hookStartFt) && zFt >= hookStartFt) return 'hook';
  // 在线判定（转折点尚未确定时）用横向速度占比
  const ratio = Math.abs(vx) / Math.max(Math.hypot(vx, vz), 1);
  return ratio > 0.04 ? 'hook' : 'slide';
}

/**
 * 由轨迹点生成接触带单元。
 * 每个网格行枚举中心列 ±1 共 3 列，横向权重 0.15/0.7/0.15（行内和=1），
 * 纵向压力权重当前为均匀（每行 1.0），后段(>=38ft)标记为吐油区。
 */
export function buildContact(points: TrajectoryPoint[]): ContactCell[] {
  const cells: ContactCell[] = [];
  const seen = new Set<number>();
  const w = lateralWeights();

  for (const p of points) {
    if (p.z < 0 || p.z > FOUL_TO_PIN_FT) continue;
    const row = Math.round(ftToRow(p.z));
    const centerCol = Math.round(boardToCol(p.x));
    for (let k = -CONTACT_HALF_BOARDS; k <= CONTACT_HALF_BOARDS; k++) {
      const col = centerCol + k;
      if (col < 0 || col >= CELL_COLS || row < 0 || row >= CELL_ROWS) continue;
      const key = row * CELL_COLS + col;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({
        row,
        col,
        lateralWeight: w[k + CONTACT_HALF_BOARDS],
        pressureWeight: 1,
        deposit: p.z >= DEPOSIT_START_FT,
      });
    }
  }
  return cells;
}
