/** 坐标映射：板号(1..39) ↔ 油网格列(0..38) ↔ 英寸；英尺 ↔ 油网格行 */
import {
  BOARD_WIDTH_IN,
  BOARDS,
  CELL_COLS,
  CELL_DEPTH_IN,
  CELL_ROWS,
  CELL_ROWS_PER_FT,
  FOUL_TO_PIN_FT,
} from './constants';

/** 板号(1..39 连续) → 网格列(0..38 连续) */
export function boardToCol(board: number): number {
  return board - 1;
}

/** 网格列(0..38 连续) → 板号(1..39) */
export function colToBoard(col: number): number {
  return col + 1;
}

/** 板号 → 距球道左边缘(面向瓶区)的英寸坐标 */
export function boardToInX(board: number): number {
  return (board - 0.5) * BOARD_WIDTH_IN;
}

/** 英寸 x → 板号 */
export function inXToBoard(x: number): number {
  return x / BOARD_WIDTH_IN + 0.5;
}

/** 英尺 z(犯规线=0) → 网格行(0..479 连续) */
export function ftToRow(zFt: number): number {
  return zFt * CELL_ROWS_PER_FT;
}

/** 网格行 → 英尺 */
export function rowToFt(row: number): number {
  return row / CELL_ROWS_PER_FT;
}

/** 英尺 → 英寸 */
export function ftToIn(zFt: number): number {
  return zFt * 12;
}

/** 双线性/最近邻采样油网格：grid 为 ROWS*COLS 行主序，输入连续行列，越界返回 0 */
export function sampleGrid(grid: Float32Array, row: number, col: number): number {
  if (row < 0 || col < 0 || row >= CELL_ROWS - 1 || col >= CELL_COLS - 1) return 0;
  const r0 = Math.floor(row);
  const c0 = Math.floor(col);
  const fr = row - r0;
  const fc = col - c0;
  const i00 = r0 * CELL_COLS + c0;
  const v00 = grid[i00];
  const v10 = grid[i00 + 1];
  const v01 = grid[i00 + CELL_COLS];
  const v11 = grid[i00 + CELL_COLS + 1];
  return (
    v00 * (1 - fr) * (1 - fc) +
    v10 * (1 - fr) * fc +
    v01 * fr * (1 - fc) +
    v11 * fr * fc
  );
}

/** 计算每块板的纵向累计油量（uL），返回长度 39 的数组 —— 核心校验指标 */
export function computeBoardTotals(grid: Float32Array): Float32Array {
  const totals = new Float32Array(BOARDS);
  for (let r = 0; r < CELL_ROWS; r++) {
    const base = r * CELL_COLS;
    for (let c = 0; c < CELL_COLS; c++) {
      totals[c] += grid[base + c];
    }
  }
  return totals;
}

/** 整张油面总油量（mL） */
export function computeTotalMl(grid: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < grid.length; i++) sum += grid[i];
  return sum / 1000;
}

/** 网格索引工具 */
export function cellIndex(row: number, col: number): number {
  return row * CELL_COLS + col;
}

export function inGrid(row: number, col: number): boolean {
  return row >= 0 && row < CELL_ROWS && col >= 0 && col < CELL_COLS;
}

/** 英尺 z 是否仍在球道范围内 */
export function zInLane(zFt: number): boolean {
  return zFt >= 0 && zFt <= FOUL_TO_PIN_FT;
}

export { CELL_DEPTH_IN };
