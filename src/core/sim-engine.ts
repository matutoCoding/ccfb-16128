/**
 * 油面推演编排引擎（单条球道）。
 * 串联：轨迹推演 → 接触带 → CPU 权威网格更新 + 独立公式累加，
 * 按局保存快照与代表轨迹，供滑条回放与第 1/30 局路径叠加对比。
 */
import {
  CELL_COLS,
  CELL_ROWS,
  MAX_GAMES,
  REOIL_THRESHOLD,
  SHOTS_PER_GAME,
} from './constants';
import {
  computeBoardTotals,
  computeTotalMl,
  cellIndex,
} from './coords';
import {
  accumulateBoardLoss,
  applyShotGrid,
  crossValidate,
  midlaneRetention,
} from './oil-depletion';
import { buildInitialGrid } from './pattern';
import { simulateTrajectory, type ShotInput } from './trajectory';
import type {
  BowlingBall,
  LaneProfile,
  MatchShot,
  OilPattern,
  OilSnapshot,
  Player,
  ShotStyle,
  SimSettings,
  TrajectoryResult,
} from './types';

export interface ShotRecord {
  shot: MatchShot;
  trajectory: TrajectoryResult;
}

export interface GameSnapshot {
  snapshot: OilSnapshot;
  /** 该局最后一球的轨迹（代表轨迹，用于叠加对比） */
  representative: TrajectoryResult | null;
  /** 每板累计净损失（公式累加器口径，uL） */
  formulaBoardLoss: Float32Array;
  /** 中段剩余油比例（39 板） */
  retention: Float32Array;
}

export interface SimRunReport {
  totalShots: number;
  elapsedMs: number;
  validation: {
    maxRelErrorPct: number;
    passed: boolean;
    perBoardErrorPct: Float32Array;
  };
  reoilRecommended: boolean;
  reoilWorstBoard: number;
}

export interface SimContext {
  players: Map<string, Player>;
  styles: Map<string, ShotStyle>;
  balls: Map<string, BowlingBall>;
  lanes: Map<string, LaneProfile>;
}

export class OilSimulator {
  readonly initialGrid: Float32Array;
  grid: Float32Array;
  readonly settings: SimSettings;
  private readonly lane: LaneProfile;
  private readonly ctx: SimContext;

  private boardLoss = new Float32Array(CELL_COLS);
  private shotCount = 0;
  readonly snapshots: GameSnapshot[] = [];
  readonly allTrajectories: ShotRecord[] = [];
  /** 每球后的总油量（mL），用于衰减曲线 */
  readonly totalOilCurve: number[] = [];

  constructor(pattern: OilPattern, lane: LaneProfile, settings: SimSettings, ctx: SimContext) {
    this.lane = lane;
    this.settings = settings;
    this.ctx = ctx;
    this.initialGrid = buildInitialGrid(pattern);
    this.grid = new Float32Array(this.initialGrid);
    this.pushSnapshot(0, null);
    this.totalOilCurve.push(computeTotalMl(this.grid));
  }

  /** 推演一次出手，更新油面并返回轨迹 */
  runShot(shot: MatchShot): TrajectoryResult {
    const style = this.ctx.styles.get(shot.styleId);
    const ball = this.ctx.balls.get(shot.ballId);
    if (!style || !ball) throw new Error(`出手 ${shot.id} 缺少打法或球数据`);

    const input: ShotInput = {
      style,
      ball,
      lane: this.lane,
      boardJitter: shot.boardJitter,
      speedJitter: shot.speedJitter,
    };
    const trajectory = simulateTrajectory(this.grid, input, this.settings);
    // 先在"出手前油面"上做独立公式累加，再更新网格，保证两条路径同源
    accumulateBoardLoss(this.boardLoss, this.grid, trajectory.contact, this.settings);
    const outcome = applyShotGrid(this.grid, trajectory.contact, this.settings);
    trajectory.absorbedUl = outcome.absorbedUl;
    trajectory.depositedUl = outcome.depositedUl;

    this.shotCount++;
    this.allTrajectories.push({ shot, trajectory });
    this.totalOilCurve.push(computeTotalMl(this.grid));
    return trajectory;
  }

  /** 手动模式：落一个当前状态的局快照（供逐球驱动流程使用） */
  recordSnapshot(game: number, representative: TrajectoryResult | null): void {
    this.pushSnapshot(game, representative);
  }

  /** 跑完整序列并按局落快照（shots 已按局/顺序排好） */
  runSequence(shots: MatchShot[], games = MAX_GAMES): SimRunReport {
    const t0 = performance.now();
    const perGame = Math.max(1, Math.ceil(shots.length / games));

    let lastTraj: TrajectoryResult | null = null;
    let gameNo = 0;
    for (const shot of shots) {
      lastTraj = this.runShot(shot);
      if (this.shotCount % perGame === 0 || this.shotCount === shots.length) {
        gameNo++;
        this.pushSnapshot(gameNo, lastTraj);
      }
    }
    // 补足到请求局数（空局快照指向最后状态）
    while (this.snapshots.length <= games) {
      gameNo++;
      this.pushSnapshot(gameNo, lastTraj);
    }

    const validation = crossValidate(
      computeBoardTotals(this.initialGrid),
      this.grid,
      this.boardLoss,
    );
    const retention = midlaneRetention(this.grid, this.initialGrid);
    let worst = 0;
    let worstVal = Infinity;
    for (let b = 0; b < CELL_COLS; b++) {
      if (retention[b] < worstVal) {
        worstVal = retention[b];
        worst = b + 1;
      }
    }
    const elapsedMs = performance.now() - t0;
    return {
      totalShots: shots.length,
      elapsedMs,
      validation: {
        maxRelErrorPct: validation.maxRelErrorPct,
        passed: validation.passed,
        perBoardErrorPct: validation.perBoardErrorPct,
      },
      reoilRecommended: worstVal < REOIL_THRESHOLD,
      reoilWorstBoard: worst,
    };
  }

  private pushSnapshot(game: number, representative: TrajectoryResult | null): void {
    const gridCopy = new Float32Array(this.grid);
    this.snapshots.push({
      snapshot: {
        game,
        shotCount: this.shotCount,
        grid: gridCopy,
        totalMl: computeTotalMl(gridCopy),
        boardTotalsUl: computeBoardTotals(gridCopy),
      },
      representative,
      formulaBoardLoss: new Float32Array(this.boardLoss),
      retention: midlaneRetention(this.grid, this.initialGrid),
    });
  }

  /** 取某一局的快照（越界钳制） */
  snapshotAt(game: number): GameSnapshot {
    const idx = Math.max(0, Math.min(this.snapshots.length - 1, game));
    return this.snapshots[idx];
  }

  /** 某球员/打法在指定局的代表轨迹（用于同球第 1/30 局叠加） */
  trajectoryAtGame(game: number, styleId?: string): TrajectoryResult | null {
    const snap = this.snapshotAt(game);
    if (snap.representative && (!styleId || this.matchStyle(snap.representative, styleId))) {
      return snap.representative;
    }
    // 回退：在全部轨迹里找该局、该打法最近的一条
    const startShot = Math.max(0, (game - 1) * SHOTS_PER_GAME);
    for (let i = this.allTrajectories.length - 1; i >= startShot; i--) {
      const rec = this.allTrajectories[i];
      if (!styleId || rec.shot.styleId === styleId) return rec.trajectory;
    }
    return this.allTrajectories[Math.min(this.allTrajectories.length - 1, startShot)]?.trajectory ?? null;
  }

  private matchStyle(_t: TrajectoryResult, _styleId: string): boolean {
    // 快照代表轨迹未直接带 styleId，由调用方过滤；保留扩展点
    return true;
  }

  /** 重置为全新过油状态 */
  reset(): void {
    this.grid.set(this.initialGrid);
    this.boardLoss.fill(0);
    this.shotCount = 0;
    this.snapshots.length = 0;
    this.allTrajectories.length = 0;
    this.totalOilCurve.length = 0;
    this.pushSnapshot(0, null);
    this.totalOilCurve.push(computeTotalMl(this.grid));
  }

  get gridCellCount(): number {
    return CELL_ROWS * CELL_COLS;
  }

  /** 读取某格当前油量（uL） */
  oilAt(row: number, col: number): number {
    if (row < 0 || row >= CELL_ROWS || col < 0 || col >= CELL_COLS) return 0;
    return this.grid[cellIndex(row, col)];
  }
}
