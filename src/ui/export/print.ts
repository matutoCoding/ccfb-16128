/**
 * 导出给裁判/球员的可打印材料：
 * 油型说明 + 油型图 + 40 局预测油面图 + 推荐出手线。
 * 通过独立打印窗口承载，避免污染主应用样式。
 */
import { BOARDS, CELL_COLS, CELL_ROWS } from '../../core/constants';
import { computeBoardTotals } from '../../core/coords';
import { midlaneRetention } from '../../core/oil-depletion';
import { buildInitialGrid } from '../../core/pattern';
import type { OilPattern, TrajectoryResult } from '../../core/types';

/** 油型说明打印窗口（油型库入口） */
export function openPrintWindow(pattern: OilPattern): void {
  const initial = buildInitialGrid(pattern);
  const heat = renderHeatDataUrl(initial, Math.max(...initial));
  const profile = renderProfileDataUrl(pattern);
  const totals = computeBoardTotals(initial);
  const boardRows = Array.from(totals)
    .map((ul, b) => `<tr><td>${b + 1}</td><td>${(ul / 1000).toFixed(2)}</td></tr>`)
    .join('');

  const html = baseHtml(
    pattern.name,
    `
    <section class="sheet">
      <h1>${escapeHtml(pattern.name)}</h1>
      <p class="meta">油型长度 <b>${pattern.lengthFt} ft</b> ｜ 总油量 <b>${pattern.totalOilMl.toFixed(2)} mL</b> ｜ 39 板 ｜ 单位 load(≈50µL)</p>
      ${pattern.note ? `<p class="note">${escapeHtml(pattern.note)}</p>` : ''}
      <h2>油型横截面（去程 + 回程）</h2>
      <img class="chart-img" src="${profile}" alt="油型横截面"/>
      <h2>初始油面图</h2>
      <img class="chart-img" src="${heat}" alt="初始油面"/>
      <h2>每板总油量（mL）</h2>
      <div class="board-table"><table><thead><tr><th>板</th><th>mL</th></tr></thead><tbody>${boardRows}</tbody></table></div>
    </section>`,
  );
  launchPrintWindow(html, `油型说明-${pattern.name}`);
}

/** 40 局预测油面 + 推荐出手线打印（推演页入口） */
export function openPredictionWindow(args: {
  patternName: string;
  finalGrid: Float32Array;
  initialGrid: Float32Array;
  trajectories: { label: string; trajectory: TrajectoryResult; color: string }[];
  elapsedMs: number;
}): void {
  const { patternName, finalGrid, initialGrid, trajectories, elapsedMs } = args;
  const oilMax = Math.max(...initialGrid);
  const finalHeat = renderHeatDataUrl(finalGrid, oilMax);
  const initHeat = renderHeatDataUrl(initialGrid, oilMax);
  const retention = midlaneRetention(finalGrid, initialGrid);
  const dryBoards = Array.from(retention)
    .map((v, b) => ({ b: b + 1, v }))
    .filter((x) => x.v < 0.35)
    .map((x) => x.b)
    .join(', ');

  const pathImg = renderTrajectoryDataUrl(trajectories);
  const recLines = trajectories
    .map((t) => {
      const tr = t.trajectory;
      return `<tr><td>${escapeHtml(t.label)}</td><td>${tr.hitBoard.toFixed(1)}</td><td>${tr.entryAngleDeg.toFixed(1)}°</td><td>${tr.hookStartFt.toFixed(1)} ft</td></tr>`;
    })
    .join('');

  const html = baseHtml(
    `${patternName} · 40局预测`,
    `
    <section class="sheet">
      <h1>${escapeHtml(patternName)} — 40 局后预测油面与推荐出手线</h1>
      <p class="meta">推演耗时 <b>${elapsedMs.toFixed(0)} ms</b>（目标 &lt; 5000ms）｜ 红柱区域为打干轨道</p>
      <h2>初始油面</h2>
      <img class="chart-img" src="${initHeat}"/>
      <h2>40 局后预测油面</h2>
      <img class="chart-img" src="${finalHeat}"/>
      <h2>推荐出手线（第 1 / 30 局叠加）</h2>
      <img class="chart-img" src="${pathImg}"/>
      <table><thead><tr><th>打法</th><th>命中板位</th><th>入袋角</th><th>转弯起点</th></tr></thead><tbody>${recLines}</tbody></table>
      <p class="note">中段剩余油低于 35% 的板位：${dryBoards || '无'}。这些区域摩擦显著上升，建议向油区调整出手线或重新过油。</p>
    </section>`,
  );
  launchPrintWindow(html, `40局预测-${patternName}`);
}

function baseHtml(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,'Segoe UI',sans-serif;margin:24px;color:#1a2030;background:#fff}
  .sheet{max-width:900px;margin:0 auto}
  h1{font-size:22px;margin:0 0 6px} h2{font-size:15px;margin:18px 0 6px;color:#33415c}
  .meta{color:#55607a;font-size:13px}.note{background:#f4f6fb;padding:8px 12px;border-left:3px solid #f59e0b;font-size:12px}
  .chart-img{width:100%;border:1px solid #d6dce8;border-radius:6px}
  table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px}
  th,td{border:1px solid #cdd5e3;padding:4px 8px;text-align:center}
  th{background:#eef2f9}.board-table{max-height:300px;overflow:auto}
  .toolbar{position:sticky;top:0;background:#fff;padding:8px 0;margin-bottom:8px}
  @media print{.toolbar{display:none}body{margin:8mm}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()" style="padding:8px 18px;font-size:14px;cursor:pointer">🖨 打印 / 另存为 PDF</button></div>
${body}</body></html>`;
}

function launchPrintWindow(html: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    alert('浏览器拦截了弹出窗口，请允许弹窗后重试');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** 把油网格渲染成 PNG data URL（独立 2D canvas，打印窗口可直接 <img>） */
export function renderHeatDataUrl(grid: Float32Array, maxUl: number): string {
  const cw = 14;
  const ch = 4;
  const padL = 50;
  const padT = 10;
  const canvas = document.createElement('canvas');
  canvas.width = padL + CELL_COLS * cw + 10;
  canvas.height = padT + CELL_ROWS * ch + 30;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < CELL_ROWS; r++) {
    for (let c = 0; c < CELL_COLS; c++) {
      const t = Math.min(1, grid[r * CELL_COLS + c] / Math.max(maxUl, 1e-4));
      const rr = Math.round(12 + 220 * t);
      const gg = Math.round(18 + 150 * Math.pow(t, 0.8));
      const bb = Math.round(30 + 40 * t);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(padL + c * cw, padT + r * ch, cw, ch);
    }
  }
  ctx.fillStyle = '#9aa6bb';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  for (let b = 1; b <= BOARDS; b += 4) {
    ctx.fillText(String(b), padL + ((b - 0.5) / BOARDS) * CELL_COLS * cw, canvas.height - 8);
  }
  ctx.textAlign = 'right';
  for (let ft = 0; ft <= 60; ft += 10) {
    ctx.fillText(`${ft}ft`, padL - 4, padT + (ft / 60) * CELL_ROWS * ch + 4);
  }
  return canvas.toDataURL('image/png');
}

function renderProfileDataUrl(pattern: OilPattern): string {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 260;
  const ctx = canvas.getContext('2d')!;
  const padL = 44;
  const padT = 14;
  const plotW = canvas.width - padL - 16;
  const plotH = canvas.height - 44;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const total = new Array<number>(BOARDS).fill(0);
  for (let ft = 0; ft < pattern.forward.length; ft++) {
    for (let b = 0; b < BOARDS; b++) {
      total[b] += (pattern.forward[ft][b] ?? 0) + (pattern.reverse[ft][b] ?? 0);
    }
  }
  const max = Math.max(1, ...total);
  const x = (b: number) => padL + ((b + 0.5) / BOARDS) * plotW;
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  ctx.beginPath();
  ctx.moveTo(x(0), y(0));
  total.forEach((v, b) => ctx.lineTo(x(b), y(v)));
  ctx.lineTo(x(BOARDS - 1), y(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(245,158,11,0.35)';
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#2a3345';
  ctx.strokeRect(padL, padT, plotW, plotH);
  ctx.fillStyle = '#9aa6bb';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  for (let b = 1; b <= BOARDS; b += 4) ctx.fillText(String(b), x(b - 1), canvas.height - 12);
  return canvas.toDataURL('image/png');
}

function renderTrajectoryDataUrl(
  paths: { label: string; trajectory: TrajectoryResult; color: string }[],
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  const padL = 44;
  const padT = 14;
  const plotW = canvas.width - padL - 16;
  const plotH = canvas.height - 40;
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#2a3345';
  ctx.strokeRect(padL, padT, plotW, plotH);
  const x = (board: number) => padL + ((board - 1) / (BOARDS - 1)) * plotW;
  const z = (zFt: number) => padT + (zFt / 60) * plotH;
  for (const p of paths) {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    p.trajectory.points.forEach((pt, i) => {
      const px = x(pt.x);
      const py = z(pt.z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.fillStyle = '#9aa6bb';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  for (let b = 1; b <= BOARDS; b += 4) ctx.fillText(String(b), x(b), canvas.height - 12);
  ctx.textAlign = 'right';
  for (let ft = 0; ft <= 60; ft += 10) ctx.fillText(`${ft}ft`, padL - 4, z(ft) + 4);
  return canvas.toDataURL('image/png');
}
