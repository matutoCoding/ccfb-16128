/** 性能基准：模拟页面 12 条道各跑 40 局，验证 5 秒预算 */
import { MAX_GAMES, SHOTS_PER_GAME } from '../src/core/constants';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { OilSimulator } from '../src/core/sim-engine';
import { seedBalls, seedLanes, seedPlayers, seedStyles } from '../src/seed/equip-lanes';
import { seedMatch } from '../src/seed/match';
import { seedPatterns } from '../src/seed/patterns';

function main(): void {
  const now = 1_700_000_000_000;
  const patterns = seedPatterns(now);
  const lanes = seedLanes(now).slice(0, 12);
  const balls = seedBalls();
  const styles = seedStyles();
  const players = seedPlayers(styles, balls);
  const settings = { ...DEFAULT_SETTINGS };
  const match = seedMatch(patterns[0].id, lanes, players, styles, balls, now, {
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

  console.log('\n========== 40 局推演性能基准（12 条道全量） ==========');
  const t0 = performance.now();
  let totalShots = 0;
  let maxErr = 0;
  for (const lane of lanes) {
    const sim = new OilSimulator(patterns[0], lane, settings, ctx);
    const shots = match.shots.filter((s) => s.laneId === lane.id).sort((a, b) => a.order - b.order);
    const report = sim.runSequence(shots, MAX_GAMES);
    totalShots += shots.length;
    maxErr = Math.max(maxErr, report.validation.maxRelErrorPct);
  }
  const elapsed = performance.now() - t0;
  console.log(`总球数：${totalShots}`);
  console.log(`12 道 × 40 局总耗时：${elapsed.toFixed(1)} ms`);
  console.log(`单道平均：${(elapsed / 12).toFixed(1)} ms（页面预算 5000ms/道）`);
  console.log(`全局最大板级校验误差：${maxErr.toFixed(6)}%（阈值 1%）`);
  console.log(elapsed / 12 < 5000 && maxErr < 1 ? '✅ 性能与精度达标' : '❌ 未达标');
}

main();
