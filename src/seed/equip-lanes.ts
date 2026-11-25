/** 种子球道：自家馆 24 道 + 周边 3 馆各 8 道 = 48 条，板级高低差/磨损各异 */
import { BOARDS } from '../core/constants';
import { gaussian, hashSeed, mulberry32, uid } from '../core/rng';
import type { BowlingBall, LaneProfile, Player, ShotStyle } from '../core/types';

export function seedLanes(now: number): LaneProfile[] {
  const venues = [
    { name: '自家馆', count: 24, surface: 'synthetic' as const },
    { name: '东城馆', count: 8, surface: 'wood' as const },
    { name: '河西馆', count: 8, surface: 'synthetic' as const },
    { name: '南桥馆', count: 8, surface: 'wood' as const },
  ];
  const lanes: LaneProfile[] = [];
  let laneNo = 1;
  for (const venue of venues) {
    for (let i = 0; i < venue.count; i++) {
      const rng = mulberry32(hashSeed('lane', venue.name, i));
      const boardHeightMil: number[] = [];
      const wear: number[] = [];
      // 整体倾斜倾向（某一侧低 → 把球带向该侧），每道不同
      const slopeBias = (rng() - 0.5) * 6; // mil
      for (let b = 0; b < BOARDS; b++) {
        const t = b / (BOARDS - 1);
        const height =
          slopeBias * (t - 0.5) + // 线性侧坡
          gaussian(rng) * 1.2 + // 单板随机起伏
          Math.sin(b * 0.7 + i) * 0.8;
        boardHeightMil.push(Math.round(height * 10) / 10);
        // 磨损集中在常用板区（10~25 板），老木道更严重
        const used = Math.exp(-Math.pow((b - 17) / 7, 2));
        const ageFactor = venue.surface === 'wood' ? 0.9 : 0.55;
        wear.push(Math.min(1, round2(used * ageFactor * (0.6 + rng() * 0.6))));
      }
      lanes.push({
        id: `lane-${laneNo}`,
        name: `${venue.name} ${i + 1}号道`,
        venue: venue.name,
        surface: venue.surface,
        boardHeightMil,
        wear,
        dryFriction: venue.surface === 'wood' ? 0.26 : 0.22,
        note: `${venue.surface === 'wood' ? '木质' : '合成'}面，侧坡 ${slopeBias >= 0 ? '左低' : '右低'}`,
      });
      laneNo++;
    }
  }
  void now;
  return lanes;
}

const BALL_DEFS: Array<Omit<BowlingBall, 'id'>> = [
  { name: 'Storm Phaze III', brand: 'Storm', weightLb: 15, surfaceRa: 55, coreType: '不对称实心', rg: 2.49, differential: 0.056, hookRating: 0.92 },
  { name: 'Roto Grip Halo', brand: 'Roto Grip', weightLb: 15, surfaceRa: 80, coreType: '不对称', rg: 2.5, differential: 0.052, hookRating: 0.88 },
  { name: 'Brunswick Zenith', brand: 'Brunswick', weightLb: 14, surfaceRa: 40, coreType: '对称实心', rg: 2.53, differential: 0.04, hookRating: 0.7 },
  { name: 'Ebonite Envision', brand: 'Ebonite', weightLb: 16, surfaceRa: 65, coreType: '不对称', rg: 2.48, differential: 0.058, hookRating: 0.95 },
  { name: '900 Global Eternity', brand: '900 Global', weightLb: 15, surfaceRa: 30, coreType: '对称珍珠', rg: 2.55, differential: 0.035, hookRating: 0.6 },
  { name: 'Hammer Black Widow', brand: 'Hammer', weightLb: 15, surfaceRa: 70, coreType: '气体核', rg: 2.5, differential: 0.05, hookRating: 0.85 },
];

export function seedBalls(): BowlingBall[] {
  return BALL_DEFS.map((b, i) => ({ ...b, id: `ball-${i + 1}` }));
}

interface StyleDef {
  name: string;
  handedness: 'L' | 'R';
  speed: number;
  revs: number;
  tilt: number;
  launch: number;
  target: number;
}

const STYLE_DEFS: StyleDef[] = [
  { name: '右手强力弧线', handedness: 'R', speed: 17, revs: 450, tilt: 12, launch: 23, target: 12 },
  { name: '右手控速弧线', handedness: 'R', speed: 18.5, revs: 350, tilt: 15, launch: 21, target: 11 },
  { name: '右手低轨速球', handedness: 'R', speed: 20, revs: 280, tilt: 20, launch: 19, target: 10 },
  { name: '右手深线强转', handedness: 'R', speed: 16.5, revs: 500, tilt: 10, launch: 26, target: 14 },
  { name: '左手强力弧线', handedness: 'L', speed: 17, revs: 430, tilt: 13, launch: 17, target: 28 },
  { name: '左手控速弧线', handedness: 'L', speed: 18.5, revs: 340, tilt: 16, launch: 19, target: 29 },
  { name: '左手高轴速球', handedness: 'L', speed: 20, revs: 300, tilt: 22, launch: 21, target: 30 },
  { name: '右手新手直线', handedness: 'R', speed: 15, revs: 180, tilt: 25, launch: 18, target: 18 },
];

export function seedStyles(): ShotStyle[] {
  return STYLE_DEFS.map((d, i) => ({
    id: `style-${i + 1}`,
    name: d.name,
    handedness: d.handedness,
    ballSpeedMph: d.speed,
    revRateRpm: d.revs,
    axisTiltDeg: d.tilt,
    launchBoard: d.launch,
    targetBoard: d.target,
  }));
}

const PLAYER_DEFS: Array<[string, number, number]> = [
  ['陈立恒', 0, 0], ['王启铭', 1, 1], ['李墨', 2, 2], ['赵远', 3, 3],
  ['孙皓', 4, 4], ['周航', 5, 5], ['吴峥', 6, 2], ['郑海', 7, 1],
  ['冯磊', 0, 5], ['许晋', 1, 0], ['何川', 4, 3], ['高霖', 5, 4],
  ['林越', 6, 2], ['马腾', 2, 1], ['罗一', 3, 5], ['梁旭', 0, 0],
];

export function seedPlayers(styles: ShotStyle[], balls: BowlingBall[]): Player[] {
  return PLAYER_DEFS.map(([name, styleIdx, ballIdx], i) => ({
    id: `player-${i + 1}`,
    name,
    handedness: styles[styleIdx].handedness,
    styleId: styles[styleIdx].id,
    ballId: balls[ballIdx].id,
  }));
}

export function makeId(prefix: string): string {
  return uid(prefix);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
