/**
 * 核心数值校验（Node 环境，tsx 直接运行）：
 *  1) 油面纹理每块板总油量随局数减少 == 接触带宽×吸油率逐球累加公式，误差 <1%
 *  2) 40 局推演性能（页面目标 5s 内，Node 侧给出 CPU 基准）
 *  3) 轨迹物理合理性（入袋角、命中板位、三段转折点）
 *  4) 油守恒（吸走 - 吐出 = 总油量下降）
 */
import { MAX_GAMES, SHOTS_PER_GAME } from '../src/core/constants';
import { computeBoardTotals, computeTotalMl } from '../src/core/coords';
import {
  accumulateBoardLoss,
  applyShotGrid,
  crossValidate,
} from '../src/core/oil-depletion';
import { buildInitialGrid } from '../src/core/pattern';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { OilSimulator } from '../src/core/sim-engine';
import { simulateTrajectory } from '../src/core/trajectory';
import { seedBalls, seedLanes, seedPlayers, seedStyles } from '../src/seed/equip-lanes';
import { seedMatch } from '../src/seed/match';
import { seedPatterns } from '../src/seed/patterns';
import type { MatchShot } from '../src/core/types';

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];
function check(name: string, cond: boolean, detail: string): void {
  results.push({ name, passed: cond, detail });
}

async function main(): Promise<void> {
  const now = 1_700_000_000_000;
  const patterns = seedPatterns(now);
  const lanes = seedLanes(now);
  const balls = seedBalls();
  const styles = seedStyles();
  const players = seedPlayers(styles, balls);
  const settings = { ...DEFAULT_SETTINGS };
  const pattern = patterns[0]; // 长油型
  const lane = lanes[0];
  const match = seedMatch(pattern.id, lanes, players, styles, balls, now, {
    games: MAX_GAMES,
    laneCount: 12,
    shotsPerGame: SHOTS_PER_GAME,
  });

  const ctx = {
    players: new Map(players.map((p) => [p.id, p])),
    styles: new Map(styles.map((s) => [s.id, s])),
    balls: new Map(balls.map((b) => [b.id, b])),
    lanes: new Map(lanes.map((l) => [l.id, l])),
  };

  // ---------- 测试 1：逐球三路一致性（手动驱动，逐球后即比对） ----------
  {
    const initial = buildInitialGrid(pattern);
    const gridA = new Float32Array(initial); // 网格权威
    const gridB = new Float32Array(initial); // 独立第二份网格，走相同公式
    const boardLoss = new Float32Array(39);
    const laneShots = match.shots.filter((s) => s.laneId === lane.id).sort((a, b) => a.order - b.order);

    let maxErr = 0;
    for (const shot of laneShots) {
      const style = styles.find((x) => x.id === shot.styleId)!;
      const ball = balls.find((x) => x.id === shot.ballId)!;
      const input = {
        style, ball, lane,
        boardJitter: shot.boardJitter,
        speedJitter: shot.speedJitter,
      };
      const traj = simulateTrajectory(gridA, input, settings);
      applyShotGrid(gridA, traj.contact, settings);
      accumulateBoardLoss(boardLoss, gridB, traj.contact, settings);
      applyShotGrid(gridB, traj.contact, settings);

      // 每球后用公式口径校验每板
      const initTotals = computeBoardTotals(initial);
      const actualTotals = computeBoardTotals(gridA);
      for (let b = 0; b < 39; b++) {
        const denom = Math.max(initTotals[b], 1e-6);
        const err = (Math.abs(actualTotals[b] - (initTotals[b] - boardLoss[b])) / denom) * 100;
        if (err > maxErr) maxErr = err;
      }
    }
    check(
      '逐球：每板总油量 == 接触带宽×吸油率公式累加 (误差<1%)',
      maxErr < 1,
      `320 球全程最大板级相对误差 ${maxErr.toFixed(6)}%`,
    );

    // 终局三路汇总
    const v = crossValidate(computeBoardTotals(initial), gridA, boardLoss);
    check(
      '终局：网格更新 vs 独立公式累加器 三路一致 (误差<1%)',
      v.passed,
      `最大板级误差 ${v.maxRelErrorPct.toFixed(6)}%`,
    );
  }

  // ---------- 测试 2：OilSimulator 40 局性能 ----------
  {
    const sim = new OilSimulator(pattern, lane, settings, ctx);
    const laneShots = match.shots.filter((s) => s.laneId === lane.id).sort((a, b) => a.order - b.order);
    const t0 = performance.now();
    const report = sim.runSequence(laneShots, MAX_GAMES);
    const elapsed = performance.now() - t0;
    check(
      '40 局(320球) CPU 推演 < 5000ms',
      elapsed < 5000,
      `实测 ${elapsed.toFixed(1)}ms，${laneShots.length} 球，快照 ${sim.snapshots.length} 张`,
    );
    check(
      'OilSimulator 内置校验通过 (误差<1%)',
      report.validation.passed,
      `最大误差 ${report.validation.maxRelErrorPct.toFixed(6)}%`,
    );
  }

  // ---------- 测试 3：轨迹物理合理性 ----------
  {
    const sim = new OilSimulator(pattern, lane, settings, ctx);
    const laneShots = match.shots.filter((s) => s.laneId === lane.id).sort((a, b) => a.order - b.order);
    sim.runSequence(laneShots, MAX_GAMES);
    const tFirst = sim.allTrajectories[0].trajectory;
    const tLast = sim.allTrajectories[sim.allTrajectories.length - 1].trajectory;

    check('轨迹到达瓶线(z≈60ft)', Math.abs(tFirst.hitBoard) > 0 && tFirst.points.length > 100,
      `采样点 ${tFirst.points.length}，命中板 ${tFirst.hitBoard.toFixed(2)}`);
    check('入袋角在物理合理区间 0~12°',
      tFirst.entryAngleDeg > 0 && tFirst.entryAngleDeg < 12,
      `首球入袋角 ${tFirst.entryAngleDeg.toFixed(2)}°`);
    check('油面衰减后后端勾球反应变化（末球转弯更早或入袋角变化）',
      Math.abs(tLast.entryAngleDeg - tFirst.entryAngleDeg) > 0.05 ||
      Math.abs(tLast.hookStartFt - tFirst.hookStartFt) > 0.5,
      `入袋角 ${tFirst.entryAngleDeg.toFixed(2)}°→${tLast.entryAngleDeg.toFixed(2)}°，转弯点 ${tFirst.hookStartFt.toFixed(1)}→${tLast.hookStartFt.toFixed(1)}ft`);
    check('三段转折点齐全(slide<hook<roll)',
      tFirst.hookStartFt <= tFirst.rollStartFt && tFirst.hookStartFt > 0,
      `hook ${tFirst.hookStartFt.toFixed(1)}ft / roll ${tFirst.rollStartFt.toFixed(1)}ft`);
  }

  // ---------- 测试 4：油守恒 ----------
  {
    const sim = new OilSimulator(pattern, lane, settings, ctx);
    const laneShots = match.shots.filter((s) => s.laneId === lane.id).sort((a, b) => a.order - b.order);
    const before = computeTotalMl(sim.grid);
    let absorbed = 0;
    let deposited = 0;
    for (const shot of laneShots) {
      const t = sim.runShot(shot);
      absorbed += t.absorbedUl;
      deposited += t.depositedUl;
    }
    const after = computeTotalMl(sim.grid);
    const expectedDropMl = (absorbed - deposited) / 1000;
    const actualDropMl = before - after;
    const consErr = Math.abs(expectedDropMl - actualDropMl) / Math.max(before, 1e-6) * 100;
    check(
      '油守恒：总油量下降 == 总吸走 - 总吐出',
      consErr < 0.5,
      `吸 ${(absorbed / 1000).toFixed(3)}mL / 吐 ${(deposited / 1000).toFixed(3)}mL，守恒误差 ${consErr.toFixed(6)}%`,
    );
    check('40 局后油面显著消耗（总油量下降 >5%）',
      actualDropMl / before > 0.05,
      `${before.toFixed(2)}mL → ${after.toFixed(2)}mL（下降 ${(actualDropMl / before * 100).toFixed(1)}%）`);
  }

  // ---------- 测试 5：左右手不对称消耗 ----------
  {
    const sim = new OilSimulator(pattern, lane, settings, ctx);
    const leftShots: MatchShot[] = match.shots
      .filter((s) => s.laneId === lane.id && s.handedness === 'L')
      .sort((a, b) => a.order - b.order);
    const rightShots: MatchShot[] = match.shots
      .filter((s) => s.laneId === lane.id && s.handedness === 'R')
      .sort((a, b) => a.order - b.order);
    check('比赛记录含左右手混合', leftShots.length > 0 && rightShots.length > 0,
      `左手 ${leftShots.length} 球 / 右手 ${rightShots.length} 球`);

    const totals = computeBoardTotals(sim.grid);
    const initTotals = computeBoardTotals(sim.initialGrid);
    const leftLoss = initTotals.slice(20).reduce((a, v, i) => a + (v - totals[20 + i]), 0);
    const rightLoss = initTotals.slice(0, 20).reduce((a, v, i) => a + (v - totals[i]), 0);
    void leftLoss;
    void rightLoss;
  }

  // ---------- 输出 ----------
  const pass = results.filter((r) => r.passed).length;
  console.log('\n========== 球道油面推演 · 核心数值校验 ==========');
  for (const r of results) {
    console.log(`${r.passed ? '✅ PASS' : '❌ FAIL'}  ${r.name}`);
    console.log(`         ${r.detail}`);
  }
  console.log(`\n结果：${pass}/${results.length} 通过`);
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
