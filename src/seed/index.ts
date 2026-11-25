/** 种子数据装配：首次启动时把全部基础数据与比赛写入 IndexedDB */
import { repo, STORES } from '../db/indexeddb';
import { seedBalls, seedLanes, seedPlayers, seedStyles } from './equip-lanes';
import { seedMatch } from './match';
import { seedPatterns } from './patterns';

export interface SeedResult {
  patterns: number;
  lanes: number;
  balls: number;
  styles: number;
  players: number;
  matches: number;
}

export async function isSeeded(): Promise<boolean> {
  const existing = await repo.getAll(STORES.patterns);
  return existing.length > 0;
}

export async function seedAll(force = false): Promise<SeedResult> {
  if (!force && (await isSeeded())) {
    const [patterns, lanes, balls, styles, players, matches] = await Promise.all(
      Object.values(STORES)
        .filter((s) => s !== 'kv')
        .map((s) => repo.getAll(s as never)),
    );
    return {
      patterns: patterns.length,
      lanes: lanes.length,
      balls: balls.length,
      styles: styles.length,
      players: players.length,
      matches: matches.length,
    };
  }

  const now = Date.now();
  const patterns = seedPatterns(now);
  const lanes = seedLanes(now);
  const balls = seedBalls();
  const styles = seedStyles();
  const players = seedPlayers(styles, balls);
  const match = seedMatch(patterns[0].id, lanes, players, styles, balls, now);

  await repo.bulkPut(STORES.patterns, patterns);
  await repo.bulkPut(STORES.lanes, lanes);
  await repo.bulkPut(STORES.balls, balls);
  await repo.bulkPut(STORES.styles, styles);
  await repo.bulkPut(STORES.players, players);
  await repo.bulkPut(STORES.matches, [match]);

  return {
    patterns: patterns.length,
    lanes: lanes.length,
    balls: balls.length,
    styles: styles.length,
    players: players.length,
    matches: 1,
  };
}
