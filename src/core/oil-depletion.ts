/**
 * 油面消耗推演（CPU 权威实现 + 独立公式累加器）。
 *
 * 每个接触单元一次出手的油量变化：
 *   吸走  absorb_c = oil_c * rate * lateralWeight_c
 *   吐出  deposit_c = 后段(>=38ft)单元按 lateralWeight 分配总吐出量
 *   净变  Δ_c = deposit_c - absorb_c
 * 总吐出量 = Σ absorb * depositFraction（只在吐油区分摊）。
 *
 * 三条实现路径必须数值一致（误差 <1%）：
 *   1) applyShotGrid      —— 网格逐格更新（本文件，权威参考）
 *   2) accumulateBoardLoss —— 独立公式累加器（按接触带宽/吸油率逐球累加，不读回整张表）
 *   3) GPU 着色器          —— webgl/oil-sim.ts，逐格复用同一公式
 */
import { BOARDS, CELL_COLS, CELL_ROWS, DEPOSIT_START_FT } from './constants';
import { cellIndex, computeBoardTotals } from './coords';
import type { ContactCell, SimSettings } from './types';

export interface DepletionOutcome {
  absorbedUl: number;
  depositedUl: number;
  totalBeforeMl: number;
  totalAfterMl: number;
}

/**
 * 路径 1：在油网格上直接应用一次出手的吸油/吐油（原地修改 grid）。
 * 接触单元已按 (row,col) 去重，deposit 先按格聚合再统一更新，顺序确定。
 */
export function applyShotGrid(
  grid: Float32Array,
  contact: ContactCell[],
  s: SimSettings,
): DepletionOutcome {
  let totalBefore = 0;
  for (let i = 0; i < grid.length; i++) totalBefore += grid[i];

  // 1) 逐格吸油
  let totalAbsorb = 0;
  const absorbByCell = new Float32Array(contact.length);
  for (let i = 0; i < contact.length; i++) {
    const c = contact[i];
    const idx = cellIndex(c.row, c.col);
    const absorb = grid[idx] * s.absorptionRate * c.lateralWeight;
    absorbByCell[i] = absorb;
    totalAbsorb += absorb;
    grid[idx] = Math.max(0, grid[idx] - absorb);
  }

  // 2) 后段吐油：先按格聚合分配量
  const totalDeposit = totalAbsorb * s.depositFraction;
  const depositWeightSum = contact.reduce(
    (sum, c) => sum + (c.deposit ? c.lateralWeight : 0),
    0,
  );
  let totalDepositApplied = 0;
  if (depositWeightSum > 0 && totalDeposit > 0) {
    const depositByCell = new Map<number, number>();
    for (const c of contact) {
      if (!c.deposit) continue;
      const share = (c.lateralWeight / depositWeightSum) * totalDeposit;
      const idx = cellIndex(c.row, c.col);
      depositByCell.set(idx, (depositByCell.get(idx) ?? 0) + share);
    }
    for (const [idx, amount] of depositByCell) {
      grid[idx] += amount;
      totalDepositApplied += amount;
    }
  }

  let totalAfter = 0;
  for (let i = 0; i < grid.length; i++) totalAfter += grid[i];

  return {
    absorbedUl: totalAbsorb,
    depositedUl: totalDepositApplied,
    totalBeforeMl: totalBefore / 1000,
    totalAfterMl: totalAfter / 1000,
  };
}

/**
 * 路径 2：独立公式累加器（用户口径）。
 * 逐球、逐板按"接触带覆盖 × 吸油率"累加每板的净损失，
 * 不依赖整张油网格的回读，只接收每次出手接触带上的油量。
 *
 * @param boardLoss 长度 39 的累加数组（原地累加，单位 uL）
 * @param grid      当前油网格（仅用于读取接触格油量，不写回）
 */
export function accumulateBoardLoss(
  boardLoss: Float32Array,
  grid: Float32Array,
  contact: ContactCell[],
  s: SimSettings,
): { absorbed: number; deposited: number } {
  // 先算本次总吸油与吐油
  let totalAbsorb = 0;
  const perCell: { col: number; absorb: number; deposit: boolean; w: number }[] = [];
  for (const c of contact) {
    const oil = grid[cellIndex(c.row, c.col)];
    const absorb = oil * s.absorptionRate * c.lateralWeight;
    totalAbsorb += absorb;
    perCell.push({ col: c.col, absorb, deposit: c.deposit, w: c.lateralWeight });
  }
  const totalDeposit = totalAbsorb * s.depositFraction;
  let depositWeightSum = 0;
  for (const c of contact) if (c.deposit) depositWeightSum += c.lateralWeight;

  // 逐板累加：损失 = 该板吸走 - 该板分到的吐油
  const boardAbsorb = new Float32Array(BOARDS);
  const boardDeposit = new Float32Array(BOARDS);
  for (const pc of perCell) boardAbsorb[pc.col] += pc.absorb;
  if (depositWeightSum > 0) {
    for (const c of contact) {
      if (!c.deposit) continue;
      boardDeposit[c.col] += (c.lateralWeight / depositWeightSum) * totalDeposit;
    }
  }
  for (let b = 0; b < BOARDS; b++) boardLoss[b] += boardAbsorb[b] - boardDeposit[b];

  return { absorbed: totalAbsorb, deposited: totalDeposit };
}

/**
 * 三路一致性校验：
 * 对同一串接触带，比较
 *   A) 网格更新后的每板总油量（GPU 实际渲染/推演所用数据）
 *   B) 初始每板总油量 - 公式累加器的逐球净损失
 * 返回每板相对误差（%）与最大误差。
 */
export function crossValidate(
  initialBoardTotalsUl: Float32Array,
  finalGrid: Float32Array,
  formulaBoardLossUl: Float32Array,
): { maxRelErrorPct: number; perBoardErrorPct: Float32Array; passed: boolean } {
  const finalBoardTotals = computeBoardTotals(finalGrid);
  const perBoardErrorPct = new Float32Array(BOARDS);
  let maxRelErrorPct = 0;

  for (let b = 0; b < BOARDS; b++) {
    const formulaFinal = initialBoardTotalsUl[b] - formulaBoardLossUl[b];
    const actual = finalBoardTotals[b];
    // 用初始油量做归一化分母，避免干板小分母放大
    const denom = Math.max(initialBoardTotalsUl[b], 1e-6);
    const errPct = (Math.abs(actual - formulaFinal) / denom) * 100;
    perBoardErrorPct[b] = errPct;
    if (errPct > maxRelErrorPct) maxRelErrorPct = errPct;
  }
  return { maxRelErrorPct, perBoardErrorPct, passed: maxRelErrorPct < 1 };
}

/** 中段（20~40ft）每板平均剩余油比例，用于重新过油提示 */
export function midlaneRetention(grid: Float32Array, initial: Float32Array): Float32Array {
  const retention = new Float32Array(BOARDS);
  const startRow = 20 * 8;
  const endRow = 40 * 8;
  for (let b = 0; b < BOARDS; b++) {
    let cur = 0;
    let ini = 0;
    for (let r = startRow; r < endRow; r++) {
      cur += grid[r * CELL_COLS + b];
      ini += initial[r * CELL_COLS + b];
    }
    retention[b] = ini > 0 ? cur / ini : 1;
  }
  return retention;
}

/** 左右半道剩余油比例（不对称消耗监控） */
export function leftRightRetention(
  grid: Float32Array,
  initial: Float32Array,
): { left: number; right: number; asymmetry: number } {
  let curL = 0;
  let curR = 0;
  let iniL = 0;
  let iniR = 0;
  for (let r = 0; r < CELL_ROWS; r++) {
    for (let c = 0; c < CELL_COLS; c++) {
      const v = grid[r * CELL_COLS + c];
      const i = initial[r * CELL_COLS + c];
      // 面向瓶区：高板(列 20..38) = 选手左侧
      if (c >= 20) {
        curL += v;
        iniL += i;
      } else {
        curR += v;
        iniR += i;
      }
    }
  }
  const left = iniL > 0 ? curL / iniL : 1;
  const right = iniR > 0 ? curR / iniR : 1;
  return { left, right, asymmetry: Math.abs(left - right) };
}

export { DEPOSIT_START_FT };
