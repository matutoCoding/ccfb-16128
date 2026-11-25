/**
 * 油面推演页面（系统核心）。
 * 选择油型/球道/比赛 → 跑满 40 局 → 滑条回放任意局油面，
 * 同球第 1/30 局路径叠加，CPU 公式 / GPU 纹理双路校验，5 秒性能计时。
 */
import { BOARDS, CELL_COLS, FOUL_TO_PIN_FT, LANE_WIDTH_IN, MAX_GAMES, PIN_DECK_FT, SHOTS_PER_GAME } from '../../core/constants';
import { computeBoardTotals } from '../../core/coords';
import { crossValidate, leftRightRetention, midlaneRetention } from '../../core/oil-depletion';
import { buildInitialGrid } from '../../core/pattern';
import { OilSimulator, type SimRunReport } from '../../core/sim-engine';
import type { MatchShot, SimSettings, TrajectoryResult } from '../../core/types';
import { GpuSimBridge } from '../../webgl/gpu-bridge';
import { LaneRenderer } from '../../webgl/lane-renderer';
import { appStore } from '../app-state';
import { badge, button, card, field, h, labeledSlider, select, table, toast } from '../dom';
import {
  drawDecayCurve,
  drawErrorBars,
  drawLeftRight,
  drawOilHeatmap,
} from '../charts';

interface RunHandles {
  sim: OilSimulator;
  bridge: GpuSimBridge | null;
  renderer: LaneRenderer;
  gl: WebGL2RenderingContext;
  report: import('../../core/sim-engine').SimRunReport;
  gpuReport: import('../../webgl/gpu-bridge').GpuValidation | null;
  shots: MatchShot[];
  settings: SimSettings;
  oilMax: number;
}

export function renderSim(): HTMLElement {
  const state = appStore.getState();
  let handles: RunHandles | null = null;
  let viewGame = 0;
  let compareGame = 30;
  let raf = 0;

  const canvas3d = h('canvas.lane-canvas', { style: { width: '100%', height: '420px' } }) as HTMLCanvasElement;
  const heatCanvas = h('canvas.chart', { style: { width: '100%', height: '300px' } }) as HTMLCanvasElement;
  const decayCanvas = h('canvas.chart', { style: { width: '100%', height: '200px' } }) as HTMLCanvasElement;
  const errorCanvas = h('canvas.chart', { style: { width: '100%', height: '200px' } }) as HTMLCanvasElement;
  const lrCanvas = h('canvas.chart', { style: { width: '100%', height: '140px' } }) as HTMLCanvasElement;

  const patternSel = select(
    state.patterns.map((p) => ({ value: p.id, label: `${p.name} (${p.lengthFt}ft)` })),
    state.currentPatternId,
    (v) => appStore.setState({ currentPatternId: v }),
  );
  const laneSel = select(
    state.lanes.map((l) => ({ value: l.id, label: l.name })),
    state.currentLaneId,
    (v) => appStore.setState({ currentLaneId: v }),
  );
  const matchSel = select(
    state.matches.map((m) => ({ value: m.id, label: `${m.name} (${m.shots.length}球)` })),
    state.currentMatchId,
    (v) => appStore.setState({ currentMatchId: v }),
  );

  const statusLine = h('div.status-line', [badge('未运行', 'info')]);
  const runMs = h('span', ['—']);
  const gameSlider = labeledSlider('查看局数', 0, MAX_GAMES, 0, 1, (v) => {
    viewGame = v;
    refreshView();
  }, (v) => `第 ${v} 局`);
  const compareSlider = labeledSlider('对比局数', 0, MAX_GAMES, 30, 1, (v) => {
    compareGame = v;
    refreshView();
  }, (v) => `第 ${v} 局`);

  const runBtn = button('▶ 跑满 40 局推演', () => void run(), 'primary');
  const gpuBtn = button('GPU 开', toggleGpu, 'primary');
  let gpuEnabled = true;
  function toggleGpu(): void {
    gpuEnabled = !gpuEnabled;
    gpuBtn.textContent = gpuEnabled ? 'GPU 开' : 'GPU 关(纯CPU)';
    gpuBtn.classList.toggle('ghost', gpuEnabled);
  }

  const scaleBtn = button('展宽:开', toggleScale);
  let widened = true;
  function toggleScale(): void {
    widened = !widened;
    scaleBtn.textContent = widened ? '展宽:开' : '展宽:关(真实比例)';
    if (handles) {
      handles.renderer.xScale = widened ? 2.6 : 1;
      handles.renderer.camera.frameBounds(LANE_WIDTH_IN * handles.renderer.xScale, (FOUL_TO_PIN_FT + PIN_DECK_FT) * 12);
    }
  }

  async function run(): Promise<void> {
    const s = appStore.getState();
    const pattern = s.patterns.find((p) => p.id === patternSel.value);
    const lane = s.lanes.find((l) => l.id === laneSel.value);
    const match = s.matches.find((m) => m.id === matchSel.value);
    if (!pattern || !lane || !match) {
      toast('请先在油型库/球道/比赛页准备数据', 'err');
      return;
    }
    runBtn.setAttribute('disabled', 'true');
    statusLine.replaceChildren(badge('推演中…', 'info'));
    await new Promise((r) => setTimeout(r, 30)); // 让 UI 先刷新

    try {
      const ctx = {
        players: new Map(s.players.map((p) => [p.id, p])),
        styles: new Map(s.styles.map((x) => [x.id, x])),
        balls: new Map(s.balls.map((b) => [b.id, b])),
        lanes: new Map(s.lanes.map((l) => [l.id, l])),
      };
      const settings = s.settings;
      const sim = new OilSimulator(pattern, lane, settings, ctx);
      const shots = match.shots
        .filter((sh) => sh.laneId === lane.id)
        .sort((a, b) => a.order - b.order);
      if (shots.length === 0) {
        toast('该球道在所选比赛中没有出手记录', 'err');
        runBtn.removeAttribute('disabled');
        return;
      }

      const gl = canvas3d.getContext('webgl2', { antialias: true, alpha: false })!;
      if (!gl) throw new Error('WebGL2 不可用');
      const renderer = new LaneRenderer(canvas3d, lane);
      let bridge: GpuSimBridge | null = null;
      if (gpuEnabled) {
        bridge = new GpuSimBridge(gl, sim, settings, SHOTS_PER_GAME);
      }

      // 单次逐球推进：CPU 网格/公式 与 GPU 纹理严格同步，按局落快照
      const t0 = performance.now();
      const perGame = Math.max(1, Math.ceil(shots.length / MAX_GAMES));
      let last: TrajectoryResult | null = null;
      let gameNo = 0;
      shots.forEach((shot, idx) => {
        last = sim.runShot(shot);
        bridge?.afterShot(last);
        if ((idx + 1) % perGame === 0 || idx === shots.length - 1) {
          gameNo++;
          sim.recordSnapshot(gameNo, last);
        }
      });
      // 不足 40 局时用终局状态补齐，保证滑条全程可回放
      while (sim.snapshots.length <= MAX_GAMES) {
        gameNo++;
        sim.recordSnapshot(gameNo, last);
      }
      const elapsedMs = performance.now() - t0;

      // CPU 三路一致性校验（网格 vs 独立公式累加器）
      const validation = crossValidate(
        computeBoardTotals(sim.initialGrid),
        sim.grid,
        sim.snapshots[sim.snapshots.length - 1].formulaBoardLoss,
      );
      const retentionNow = midlaneRetention(sim.grid, sim.initialGrid);
      let worstVal = Infinity;
      let worstBoard = 1;
      retentionNow.forEach((v, b) => {
        if (v < worstVal) {
          worstVal = v;
          worstBoard = b + 1;
        }
      });
      const report: SimRunReport = {
        totalShots: shots.length,
        elapsedMs,
        validation: {
          maxRelErrorPct: validation.maxRelErrorPct,
          passed: validation.passed,
          perBoardErrorPct: validation.perBoardErrorPct,
        },
        reoilRecommended: worstVal < settings.reoilThreshold,
        reoilWorstBoard: worstBoard,
      };
      const gpuReport = bridge?.finalValidate() ?? null;

      const oilMax = Math.max(...sim.initialGrid);
      renderer.xScale = widened ? 2.6 : 1;
      renderer.camera.frameBounds(LANE_WIDTH_IN * renderer.xScale, (FOUL_TO_PIN_FT + PIN_DECK_FT) * 12);
      if (bridge) renderer.setOilTexture(bridge.texture, oilMax);
      else renderer.uploadSnapshotTexture(sim.snapshotAt(0).snapshot.grid, oilMax);

      handles = { sim, bridge, renderer, gl, report, gpuReport, shots, settings, oilMax };
      runMs.textContent = `${elapsedMs.toFixed(0)} ms`;
      statusLine.replaceChildren(
        badge(`CPU 最大误差 ${report.validation.maxRelErrorPct.toFixed(4)}%`, report.validation.passed ? 'ok' : 'warn'),
        gpuReport
          ? badge(`GPU 最大误差 ${gpuReport.maxRelErrorPct.toFixed(4)}%`, gpuReport.passed ? 'ok' : 'warn')
          : badge('GPU 已关闭', 'info'),
        report.reoilRecommended ? badge('建议重新过油', 'warn') : badge('油面可继续使用', 'ok'),
        badge(`耗时 ${elapsedMs.toFixed(0)}ms / 目标 5000ms`, elapsedMs < 5000 ? 'ok' : 'warn'),
      );
      viewGame = 0;
      (gameSlider.querySelector('input') as HTMLInputElement).value = '0';
      refreshView();
      startRenderLoop();
      toast(
        report.validation.passed ? `推演完成，误差 <1%（${report.validation.maxRelErrorPct.toFixed(4)}%）` : '误差超 1%，请检查设置',
        report.validation.passed ? 'ok' : 'err',
      );
    } catch (err) {
      toast(`推演失败：${(err as Error).message}`, 'err');
    } finally {
      runBtn.removeAttribute('disabled');
    }
  }

  function refreshView(): void {
    if (!handles) return;
    const { sim, renderer, bridge } = handles;
    const snap = sim.snapshotAt(viewGame);
    const grid = snap.snapshot.grid;

    // 2D 热力图：标出打干轨道（中段剩余 <25% 的板列）
    const dryCols: number[] = [];
    const retention = snap.retention;
    for (let b = 0; b < CELL_COLS; b++) if (retention[b] < 0.25) dryCols.push(b);
    drawOilHeatmap(heatCanvas, grid, handles.oilMax, { showTrack: true, trackCols: dryCols });
    drawDecayCurve(decayCanvas, sim.totalOilCurve, sim.totalOilCurve[0], viewGame);
    drawErrorBars(errorCanvas, handles.report.validation.perBoardErrorPct);
    const lr = leftRightRetention(grid, sim.initialGrid);
    drawLeftRight(lrCanvas, lr.left, lr.right);

    // 3D：回放历史局用 CPU 快照纹理（每局都有、权威）；
    // 仅在查看终局且 GPU 开启时直接采样实时 GPU 纹理，体现零拷贝迭代结果。
    if (bridge && viewGame >= MAX_GAMES) {
      renderer.setOilTexture(bridge.texture, handles.oilMax);
    } else {
      renderer.uploadSnapshotTexture(grid, handles.oilMax);
    }

    // 轨迹叠加：当前局 vs 对比局（同一球员/打法优先）
    const styleId = sim.allTrajectories.find((r) => r.shot.game === Math.max(1, viewGame))?.shot.styleId;
    const tNow = sim.trajectoryAtGame(Math.max(1, viewGame), styleId);
    const tCmp = sim.trajectoryAtGame(Math.max(1, compareGame), styleId);
    renderer.setOverlays([
      ...(tNow ? [{ trajectory: tNow, color: [1, 0.8, 0.2, 1] as [number, number, number, number] }] : []),
      ...(tCmp ? [{ trajectory: tCmp, color: [0.4, 0.8, 1, 1] as [number, number, number, number] }] : []),
    ]);

    renderStats(snap, tNow, tCmp);
  }

  function renderStats(
    snap: import('../../core/sim-engine').GameSnapshot,
    tNow: TrajectoryResult | null,
    tCmp: TrajectoryResult | null,
  ): void {
    const initTotals = computeBoardTotals(handles!.sim.initialGrid);
    const rows: (string | Node)[][] = [];
    for (let b = 0; b < BOARDS; b += 3) {
      const remainPct = initTotals[b] > 0 ? (snap.snapshot.boardTotalsUl[b] / initTotals[b]) * 100 : 100;
      rows.push([
        `${b + 1}板`,
        `${snap.snapshot.boardTotalsUl[b].toFixed(0)} uL`,
        `${remainPct.toFixed(1)}%`,
        `${(snap.formulaBoardLoss[b]).toFixed(0)} uL`,
      ]);
    }
    statsHost.replaceChildren(
      table(['板位', '当前总油量', '剩余比例', '公式累计净损失'], rows),
    );

    trajHost.replaceChildren(
      table(
        ['指标', `第 ${viewGame} 局(金)`, `第 ${compareGame} 局(蓝)`],
        [
          ['入袋角(°)', fmt(tNow?.entryAngleDeg), fmt(tCmp?.entryAngleDeg)],
          ['命中板位', fmt(tNow?.hitBoard, 2), fmt(tCmp?.hitBoard, 2)],
          ['袋位偏差(板)', fmt(tNow?.pocketOffset, 2), fmt(tCmp?.pocketOffset, 2)],
          ['转弯起点(ft)', fmt(tNow?.hookStartFt, 1), fmt(tCmp?.hookStartFt, 1)],
          ['滚动起点(ft)', fmt(tNow?.rollStartFt, 1), fmt(tCmp?.rollStartFt, 1)],
          ['单球吸油(uL)', fmt(tNow?.absorbedUl, 2), fmt(tCmp?.absorbedUl, 2)],
          ['后段吐油(uL)', fmt(tNow?.depositedUl, 2), fmt(tCmp?.depositedUl, 2)],
        ],
      ),
    );
  }

  const statsHost = h('div');
  const trajHost = h('div');

  function startRenderLoop(): void {
    cancelAnimationFrame(raf);
    const loop = () => {
      handles?.renderer.render();
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // 相机拖拽
  attachCameraControls(canvas3d, () => handles?.renderer.camera);

  const root = h('div.page.sim-page', [
    h('div.page-head', [
      h('h1', '油面推演'),
      h('p.page-desc', 'GPU 浮点纹理逐球迭代；滑条回放 0~40 局，打干轨道与后段带油可视化，双路数值校验'),
    ]),
    card(
      '推演配置',
      h('div.editor-toolbar', [
        field('油型', patternSel),
        field('球道', laneSel),
        field('比赛记录', matchSel),
        runBtn,
        gpuBtn,
      ]),
      h('div.card-actions', [
        h('span', ['40 局耗时：']), runMs, statusLine,
      ]),
    ),
    h('div.sim-grid', [
      card('3D 球道油面（眼高机位反光最明显）', h('div.canvas-wrap', [canvas3d]),
        h('div.card-actions', [
          button('俯视机位', () => handles?.renderer.camera.preset('top')),
          button('选手眼高', () => handles?.renderer.camera.preset('eye'), 'primary'),
          button('展宽:开', toggleScale),
        ])),
      card('油面热力图（红柱=打干轨道）', heatCanvas),
    ]),
    card('局数回放', h('div.stack-col', [gameSlider, compareSlider]),
      h('div.card-actions', [
        button('🖨 导出 40 局预测报告(可打印)', () => exportPrediction(), 'primary'),
      ])),
    h('div.sim-grid', [
      card('总油量衰减曲线', decayCanvas),
      card('左右半道不对称消耗', lrCanvas),
    ]),
    card('CPU 公式 vs 网格 每板误差（红线=1% 阈值）', errorCanvas),
    h('div.sim-grid', [
      card('每板油量与公式累计', statsHost),
      card('同球路径叠加对比', trajHost),
    ]),
  ]);

  function fmt(v: number | undefined, digits = 1): string {
    return v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
  }

  async function exportPrediction(): Promise<void> {
    if (!handles) {
      toast('请先运行 40 局推演', 'err');
      return;
    }
    const { openPredictionWindow } = await import('../export/print');
    const { sim } = handles;
    const styleId = sim.allTrajectories[0]?.shot.styleId;
    const t1 = sim.trajectoryAtGame(1, styleId);
    const t30 = sim.trajectoryAtGame(30, styleId);
    const pattern = appStore.getState().patterns.find((p) => p.id === patternSel.value);
    openPredictionWindow({
      patternName: pattern?.name ?? '当前油型',
      finalGrid: sim.snapshotAt(MAX_GAMES).snapshot.grid,
      initialGrid: sim.initialGrid,
      trajectories: [
        ...(t1 ? [{ label: '第 1 局', trajectory: t1, color: '#f5c542' }] : []),
        ...(t30 ? [{ label: '第 30 局', trajectory: t30, color: '#5aa9ff' }] : []),
      ],
      elapsedMs: handles.report.elapsedMs,
    });
  }

  // 初始展示全新油面热力图
  requestAnimationFrame(() => {
    const p = appStore.getState().patterns.find((x) => x.id === patternSel.value);
    if (p) drawOilHeatmap(heatCanvas, buildInitialGrid(p), Math.max(...buildInitialGrid(p)));
  });

  return root;
}

function attachCameraControls(canvas: HTMLCanvasElement, getCam: () => import('../../webgl/mat4').OrbitCamera | undefined): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const cam = getCam();
    if (!cam) return;
    cam.azimuth -= (e.clientX - lastX) * 0.005;
    cam.elevation = Math.max(0.03, Math.min(1.3, cam.elevation + (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('wheel', (e) => {
    const cam = getCam();
    if (!cam) return;
    e.preventDefault();
    cam.distance = Math.max(200, Math.min(2000, cam.distance + e.deltaY));
  }, { passive: false });
}
