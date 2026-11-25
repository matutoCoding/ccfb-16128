/**
 * 种子比赛：打满一天 40 局、12 条道、16 名球员轮转。
 * 逐球带确定性扰动（板位/球速），左右手混合上场制造不对称消耗。
 */
import { MAX_GAMES, SHOTS_PER_GAME } from '../core/constants';
import { gaussian, hashSeed, uid } from '../core/rng';
import type {
  BowlingBall,
  LaneProfile,
  MatchRecord,
  MatchShot,
  Player,
  ShotStyle,
} from '../core/types';

export interface SeedMatchOptions {
  games?: number;
  laneCount?: number;
  shotsPerGame?: number;
}

export function seedMatch(
  patternId: string,
  lanes: LaneProfile[],
  players: Player[],
  styles: ShotStyle[],
  _balls: BowlingBall[],
  now: number,
  opts: SeedMatchOptions = {},
): MatchRecord {
  const games = opts.games ?? MAX_GAMES;
  const laneCount = Math.min(opts.laneCount ?? 12, lanes.length);
  const shotsPerGame = opts.shotsPerGame ?? SHOTS_PER_GAME;
  const usedLanes = lanes.slice(0, laneCount);
  const shots: MatchShot[] = [];
  const styleById = new Map(styles.map((s) => [s.id, s]));

  let order = 0;
  for (let game = 1; game <= games; game++) {
    usedLanes.forEach((lane, laneIdx) => {
      // 每局每道从球员池轮转抽 shotsPerGame 人，保证左右手混合
      for (let k = 0; k < shotsPerGame; k++) {
        const playerIdx =
          (game * 3 + laneIdx * 5 + k * 7) % players.length;
        const player = players[playerIdx];
        const style = styleById.get(player.styleId)!;
        const seed = hashSeed('shot', game, lane.id, k, player.id);
        const rng = mulberryLocal(seed);
        const boardJitter = round2(gaussian(rng) * 1.2);
        const speedJitter = round2(gaussian(rng) * 0.5);
        shots.push({
          id: uid('shot'),
          laneId: lane.id,
          game,
          order: order++,
          playerId: player.id,
          styleId: player.styleId,
          ballId: player.ballId,
          handedness: style.handedness,
          seed,
          boardJitter,
          speedJitter,
        });
      }
    });
  }

  return {
    id: 'match-seed-day1',
    name: '馆际联赛 · 首日 40 局全量',
    date: new Date(now).toISOString().slice(0, 10),
    patternId,
    laneIds: usedLanes.map((l) => l.id),
    shots,
    note: `16 球员 / ${laneCount} 道 / ${games} 局，左右手混合，含试打扰动`,
  };
}

/** 局部确定性 RNG（与 core/rng 同算法，避免循环导入语义混淆） */
function mulberryLocal(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
