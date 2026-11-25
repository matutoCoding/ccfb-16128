/**
 * 推演服务：在 CPU 权威模拟器之外，并行驱动 GPU 油面纹理迭代。
 * 同一份 ContactCell 同时喂给两条路径：
 *   - CPU：OilSimulator 网格 + 公式累加器（权威、可校验）
 *   - GPU：GpuOilSim 浮点纹理 ping-pong（渲染采样 + 独立校验）
 * GPU 每局回读一次与 CPU 对照，不逐球回读。
 */
import { CELL_COLS } from '../core/constants';
import { computeBoardTotals } from '../core/coords';
import type { OilSimulator, SimContext } from '../core/sim-engine';
import type {
  BowlingBall,
  LaneProfile,
  Player,
  ShotStyle,
  SimSettings,
  TrajectoryResult,
} from '../core/types';
import { GpuOilSim } from './oil-sim';

export interface GpuValidation {
  game: number;
  maxAbsDiffUl: number;
  maxRelErrorPct: number;
  passed: boolean;
}

export class GpuSimBridge {
  private gpu: GpuOilSim;
  readonly validations: GpuValidation[] = [];
  private shotsInGame = 0;

  constructor(
    gl: WebGL2RenderingContext,
    private sim: OilSimulator,
    private settings: SimSettings,
    private shotsPerGame: number,
  ) {
    this.gpu = new GpuOilSim(gl);
    this.gpu.uploadInitial(sim.initialGrid);
  }

  /** 每次出手后调用：用 CPU 已算好的接触带与吸油量驱动 GPU */
  afterShot(trajectory: TrajectoryResult): void {
    const contacts = GpuOilSim.aggregateContacts(trajectory.contact);
    const depositWeightSum = trajectory.contact.reduce(
      (sum, c) => sum + (c.deposit ? c.lateralWeight : 0),
      0,
    );
    this.gpu.applyShot(
      contacts,
      trajectory.absorbedUl,
      depositWeightSum,
      this.settings,
    );

    this.shotsInGame++;
    if (this.shotsInGame >= this.shotsPerGame) {
      this.shotsInGame = 0;
      this.validate();
    }
  }

  /** GPU vs CPU 逐格/逐板校验（每局一次回读） */
  private validate(): void {
    const gpuGrid = this.gpu.readbackSnapshot();
    const cpuGrid = this.sim.grid;
    let maxAbs = 0;
    for (let i = 0; i < gpuGrid.length; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(gpuGrid[i] - cpuGrid[i]));
    }
    const gpuBoard = computeBoardTotals(gpuGrid);
    const cpuBoard = computeBoardTotals(cpuGrid);
    const initBoard = computeBoardTotals(this.sim.initialGrid);
    let maxRel = 0;
    for (let b = 0; b < CELL_COLS; b++) {
      const denom = Math.max(initBoard[b], 1e-6);
      maxRel = Math.max(maxRel, (Math.abs(gpuBoard[b] - cpuBoard[b]) / denom) * 100);
    }
    this.validations.push({
      game: this.validations.length + 1,
      maxAbsDiffUl: maxAbs,
      maxRelErrorPct: maxRel,
      passed: maxRel < 1,
    });
  }

  get texture(): WebGLTexture {
    return this.gpu.texture;
  }

  /** 强制做一次终局校验 */
  finalValidate(): GpuValidation | null {
    if (this.shotsInGame > 0 || this.validations.length === 0) this.validate();
    return this.validations[this.validations.length - 1] ?? null;
  }

  dispose(): void {
    this.gpu.dispose();
  }
}

export function buildSimContext(state: {
  players: Player[];
  styles: ShotStyle[];
  balls: BowlingBall[];
  lanes: LaneProfile[];
}): SimContext {
  return {
    players: new Map(state.players.map((p) => [p.id, p])),
    styles: new Map(state.styles.map((s) => [s.id, s])),
    balls: new Map(state.balls.map((b) => [b.id, b])),
    lanes: new Map(state.lanes.map((l) => [l.id, l])),
  };
}
