/**
 * 油型构建：打油机油量单位(load) → 油纹理每格微升(uL)。
 * 去程/回程为两次独立过油，油量直接相加。
 */
import {
  BOARDS,
  CELL_COLS,
  CELL_ROWS,
  CELL_ROWS_PER_FT,
  LOAD_UL,
} from './constants';
import { cellIndex } from './coords';
import type { OilPattern } from './types';

/**
 * 把油型铺成初始油网格（ROWS*COLS，单位 uL/格）。
 * 每英尺的 load 值在该英尺的 8 个网格行内均分。
 */
export function buildInitialGrid(pattern: OilPattern): Float32Array {
  const grid = new Float32Array(CELL_ROWS * CELL_COLS);
  const ftRows = Math.min(pattern.lengthFt, pattern.forward.length);
  for (let ft = 0; ft < ftRows; ft++) {
    const fwd = pattern.forward[ft] ?? [];
    const rev = pattern.reverse[ft] ?? [];
    for (let b = 0; b < BOARDS; b++) {
      const loads = (fwd[b] ?? 0) + (rev[b] ?? 0);
      if (loads <= 0) continue;
      // 1 load = LOAD_UL uL，均匀摊到该英尺的 CELL_ROWS_PER_FT 行
      const ulPerCell = (loads * LOAD_UL) / CELL_ROWS_PER_FT;
      for (let k = 0; k < CELL_ROWS_PER_FT; k++) {
        const row = ft * CELL_ROWS_PER_FT + k;
        grid[cellIndex(row, b)] = ulPerCell;
      }
    }
  }
  return grid;
}

/** 由去程/回程矩阵重算总油量（mL）与有效油型长度（英尺） */
export function recomputePatternMeta(forward: number[][], reverse: number[][]): {
  totalOilMl: number;
  lengthFt: number;
} {
  let totalUl = 0;
  let lengthFt = 0;
  const ftRows = Math.max(forward.length, reverse.length);
  for (let ft = 0; ft < ftRows; ft++) {
    let ftSum = 0;
    const fwd = forward[ft] ?? [];
    const rev = reverse[ft] ?? [];
    for (let b = 0; b < BOARDS; b++) {
      ftSum += (fwd[b] ?? 0) + (rev[b] ?? 0);
    }
    if (ftSum > 0) lengthFt = ft + 1;
    totalUl += ftSum * LOAD_UL;
  }
  return { totalOilMl: totalUl / 1000, lengthFt };
}

/** 创建一张全零矩阵（lengthFt × 39） */
export function emptyMatrix(lengthFt: number): number[][] {
  return Array.from({ length: lengthFt }, () => new Array<number>(BOARDS).fill(0));
}

/** 深拷贝矩阵并可改变长度 */
export function resizeMatrix(mat: number[][], lengthFt: number): number[][] {
  const out = emptyMatrix(lengthFt);
  for (let ft = 0; ft < Math.min(lengthFt, mat.length); ft++) {
    for (let b = 0; b < BOARDS; b++) out[ft][b] = mat[ft]?.[b] ?? 0;
  }
  return out;
}
