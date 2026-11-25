/** Canvas 2D 图表：油型热力图、衰减曲线、误差条形图、半道对比 */
import { BOARDS, CELL_COLS, CELL_ROWS } from '../core/constants';
import { rowToFt } from '../core/coords';

function setup(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 600;
  const h = rect.height || 300;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** 油量热力图（纵向=英尺 0..60，横向=39 板），蓝(干)→琥珀(油) */
export function drawOilHeatmap(
  canvas: HTMLCanvasElement,
  grid: Float32Array,
  maxUl: number,
  opts: { showTrack?: boolean; trackCols?: number[] } = {},
): void {
  const { ctx, w, h } = setup(canvas);
  const padL = 44;
  const padB = 26;
  const padT = 8;
  const plotW = w - padL - 8;
  const plotH = h - padB - padT;
  const cw = plotW / CELL_COLS;
  const ch = plotH / CELL_ROWS;

  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);

  for (let r = 0; r < CELL_ROWS; r++) {
    for (let c = 0; c < CELL_COLS; c++) {
      const v = grid[r * CELL_COLS + c];
      const t = Math.min(1, v / Math.max(maxUl, 1e-4));
      ctx.fillStyle = oilColor(t);
      ctx.fillRect(padL + c * cw, padT + r * ch, Math.ceil(cw), Math.ceil(ch));
    }
  }

  if (opts.showTrack && opts.trackCols) {
    ctx.fillStyle = 'rgba(255,90,90,0.28)';
    for (const c of opts.trackCols) {
      ctx.fillRect(padL + c * cw, padT, Math.ceil(cw), plotH);
    }
  }

  // 坐标轴
  ctx.strokeStyle = '#3a4356';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);
  ctx.fillStyle = '#8b97ab';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  for (let b = 1; b <= BOARDS; b += 4) {
    const x = padL + ((b - 0.5) / BOARDS) * plotW;
    ctx.fillText(String(b), x, h - 8);
  }
  ctx.textAlign = 'right';
  for (let ft = 0; ft <= 60; ft += 10) {
    const y = padT + (ft / 60) * plotH;
    ctx.fillText(`${ft}ft`, padL - 4, y + 3);
  }
  ctx.textAlign = 'left';
  ctx.fillText('板号 →', padL + plotW - 40, h - 8);
}

function oilColor(t: number): string {
  // 干：深蓝黑；油：琥珀金
  const r = Math.round(12 + 220 * t);
  const g = Math.round(18 + 150 * Math.pow(t, 0.8));
  const b = Math.round(30 + 40 * t);
  return `rgb(${r},${g},${b})`;
}

/** 油型横截面：每英尺一条 39 板负载曲线（去程+回程） */
export function drawPatternProfile(
  canvas: HTMLCanvasElement,
  forward: number[][],
  reverse: number[][],
): void {
  const { ctx, w, h } = setup(canvas);
  const padL = 40;
  const padB = 26;
  const padT = 10;
  const plotW = w - padL - 10;
  const plotH = h - padB - padT;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);

  const maxLoad = Math.max(
    1,
    ...forward.flat(),
    ...reverse.flat(),
  );
  const totalByBoard = new Array<number>(BOARDS).fill(0);
  const fwdByBoard = new Array<number>(BOARDS).fill(0);
  const revByBoard = new Array<number>(BOARDS).fill(0);
  for (let ft = 0; ft < forward.length; ft++) {
    for (let b = 0; b < BOARDS; b++) {
      fwdByBoard[b] += forward[ft][b] ?? 0;
      revByBoard[b] += reverse[ft][b] ?? 0;
      totalByBoard[b] += (forward[ft][b] ?? 0) + (reverse[ft][b] ?? 0);
    }
  }
  const maxTotal = Math.max(1, ...totalByBoard);
  const x = (b: number) => padL + ((b + 0.5) / BOARDS) * plotW;
  const y = (v: number, max: number) => padT + plotH - (v / max) * plotH;

  drawAxes(ctx, padL, padT, plotW, plotH, h, w, BOARDS, maxLoad);

  // 去程/回程堆叠面积
  ctx.beginPath();
  ctx.moveTo(x(0), y(0, maxLoad));
  fwdByBoard.forEach((v, b) => ctx.lineTo(x(b), y(v, maxTotal)));
  ctx.lineTo(x(BOARDS - 1), y(0, maxLoad));
  ctx.closePath();
  ctx.fillStyle = 'rgba(96,165,250,0.35)';
  ctx.fill();

  ctx.beginPath();
  fwdByBoard.forEach((v, b) => {
    const y0 = y(v, maxTotal);
    const y1 = y(v + revByBoard[b], maxTotal);
    if (b === 0) ctx.moveTo(x(b), y1);
    else ctx.lineTo(x(b), y1);
    void y0;
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();

  // 图例
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#60a5fa';
  ctx.fillRect(padL, h - 18, 10, 10);
  ctx.fillStyle = '#c7d0de';
  ctx.fillText('去程累计', padL + 14, h - 9);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(padL + 96, h - 18, 10, 10);
  ctx.fillStyle = '#c7d0de';
  ctx.fillText('去+回总负载', padL + 110, h - 9);
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  padL: number, padT: number, plotW: number, plotH: number,
  h: number, _w: number, boards: number, _max: number,
): void {
  ctx.strokeStyle = '#2a3345';
  ctx.strokeRect(padL, padT, plotW, plotH);
  ctx.fillStyle = '#8b97ab';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  for (let b = 1; b <= boards; b += 4) {
    const xPos = padL + ((b - 0.5) / boards) * plotW;
    ctx.fillText(String(b), xPos, h - 8);
  }
  ctx.textAlign = 'left';
}

/** 总油量随出手/局数衰减曲线 */
export function drawDecayCurve(
  canvas: HTMLCanvasElement,
  curveMl: number[],
  initialMl: number,
  markerGame?: number,
): void {
  const { ctx, w, h } = setup(canvas);
  const padL = 48;
  const padB = 28;
  const padT = 10;
  const plotW = w - padL - 12;
  const plotH = h - padB - padT;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2a3345';
  ctx.strokeRect(padL, padT, plotW, plotH);

  const n = curveMl.length;
  const maxY = Math.max(initialMl, ...curveMl);
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / maxY) * plotH;

  ctx.beginPath();
  curveMl.forEach((v, i) => {
    if (i === 0) ctx.moveTo(x(i), y(v));
    else ctx.lineTo(x(i), y(v));
  });
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (markerGame !== undefined && n > 1) {
    const mx = x(Math.min(n - 1, markerGame));
    ctx.strokeStyle = 'rgba(245,158,11,0.8)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mx, padT);
    ctx.lineTo(mx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#8b97ab';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = (maxY * i) / 4;
    ctx.fillText(val.toFixed(1), padL - 4, y(val) + 3);
  }
  ctx.textAlign = 'center';
  ctx.fillText('累计出手 →', padL + plotW / 2, h - 8);
  ctx.textAlign = 'left';
  ctx.fillText('mL', padL, padT - 2);
}

/** 每板校验误差条形图（%），1% 红线 */
export function drawErrorBars(canvas: HTMLCanvasElement, perBoardErrorPct: Float32Array): void {
  const { ctx, w, h } = setup(canvas);
  const padL = 40;
  const padB = 28;
  const padT = 10;
  const plotW = w - padL - 12;
  const plotH = h - padB - padT;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);

  const maxErr = Math.max(1, ...perBoardErrorPct) * 1.1;
  const bw = plotW / BOARDS;
  const y = (v: number) => padT + plotH - (v / maxErr) * plotH;

  // 1% 阈值线
  ctx.strokeStyle = '#ef4444';
  ctx.setLineDash([5, 4]);
  const y1 = y(1);
  ctx.beginPath();
  ctx.moveTo(padL, y1);
  ctx.lineTo(padL + plotW, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ef4444';
  ctx.font = '10px system-ui';
  ctx.fillText('1% 阈值', padL + plotW - 46, y1 - 3);

  perBoardErrorPct.forEach((err, b) => {
    ctx.fillStyle = err < 1 ? '#34d399' : '#f87171';
    const bx = padL + b * bw;
    ctx.fillRect(bx + 1, y(err), Math.max(1, bw - 2), padT + plotH - y(err));
  });

  ctx.strokeStyle = '#2a3345';
  ctx.strokeRect(padL, padT, plotW, plotH);
  ctx.fillStyle = '#8b97ab';
  ctx.textAlign = 'center';
  for (let b = 1; b <= BOARDS; b += 4) {
    ctx.fillText(String(b), padL + ((b - 0.5) / BOARDS) * plotW, h - 8);
  }
  ctx.textAlign = 'left';
  ctx.fillText('板号', padL, h - 8);
}

/** 左右半道剩余油对比（不对称消耗） */
export function drawLeftRight(
  canvas: HTMLCanvasElement,
  left: number,
  right: number,
): void {
  const { ctx, w, h } = setup(canvas);
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, w, h);
  const barH = 34;
  const padL = 60;
  const plotW = w - padL - 20;
  const rows: Array<[string, number, string]> = [
    ['左半道', left, '#60a5fa'],
    ['右半道', right, '#f59e0b'],
  ];
  ctx.font = '12px system-ui';
  rows.forEach(([label, val, color], i) => {
    const y0 = 24 + i * (barH + 18);
    ctx.fillStyle = '#c7d0de';
    ctx.textAlign = 'right';
    ctx.fillText(label, padL - 8, y0 + barH / 2 + 4);
    ctx.fillStyle = '#1c2433';
    ctx.fillRect(padL, y0, plotW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(padL, y0, plotW * val, barH);
    ctx.fillStyle = '#e6ebf4';
    ctx.textAlign = 'left';
    ctx.fillText(`${(val * 100).toFixed(1)}% 剩余`, padL + 8, y0 + barH / 2 + 4);
  });
}

export { rowToFt };
