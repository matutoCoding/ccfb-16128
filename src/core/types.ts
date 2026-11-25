/** 领域模型类型定义（IndexedDB 持久化对象与推演数据结构） */

export type Handedness = 'L' | 'R';
export type LaneSurface = 'wood' | 'synthetic';
export type BallPhase = 'slide' | 'hook' | 'roll';

/** 油型：按 39 板 × 每英尺一个油量单位(load)录入，去程/回程分开 */
export interface OilPattern {
  id: string;
  name: string;
  /** 油型长度（英尺） */
  lengthFt: number;
  /** 总油量（mL，录入/导入时计算并缓存） */
  totalOilMl: number;
  /** 去程过油圈数/油量 load：[英尺行 0..lengthFt-1][板 0..38] */
  forward: number[][];
  /** 回程过油圈数/油量 load，结构同 forward */
  reverse: number[][];
  createdAt: number;
  updatedAt: number;
  source?: string;
  note?: string;
}

/** 球道档案 */
export interface LaneProfile {
  id: string;
  name: string;
  venue: string;
  surface: LaneSurface;
  /** 39 块板各自的高度（千分之一英寸 mil），板间高低差 → 横向坡度带球 */
  boardHeightMil: number[];
  /** 39 块板表面磨损系数 0..1（越大越磨、摩擦越大） */
  wear: number[];
  /** 干区基础摩擦系数 */
  dryFriction: number;
  note?: string;
}

/** 保龄球 */
export interface BowlingBall {
  id: string;
  name: string;
  brand?: string;
  /** 重量（磅） */
  weightLb: number;
  /** 表面粗糙度 Ra（微英寸 µin），数值越大越粗糙 */
  surfaceRa: number;
  /** 核心类型描述 */
  coreType: string;
  /** RG 回转半径（英寸） */
  rg: number;
  /** 差动 RG（差分，0.000..0.080） */
  differential: number;
  /** 综合勾球强度 0..1（由表面/核心折算，也可手调） */
  hookRating: number;
}

/** 打法/出手参数 */
export interface ShotStyle {
  id: string;
  name: string;
  handedness: Handedness;
  /** 出手球速（mph） */
  ballSpeedMph: number;
  /** 转速（rpm） */
  revRateRpm: number;
  /** 轴倾角（度） */
  axisTiltDeg: number;
  /** 出手板位（犯规线处，1..39） */
  launchBoard: number;
  /** 目标板位（箭头区 ~15ft 处，1..39），与出手板共同决定初速度方向 */
  targetBoard: number;
}

/** 球员 */
export interface Player {
  id: string;
  name: string;
  handedness: Handedness;
  /** 默认打法 */
  styleId: string;
  /** 常用球 */
  ballId: string;
}

/** 一次出手记录（比赛跟踪 + 推演输入） */
export interface MatchShot {
  id: string;
  laneId: string;
  game: number;
  /** 同一局内顺序 */
  order: number;
  playerId: string;
  styleId: string;
  ballId: string;
  /** 左右手冗余（落库便于不对称消耗统计，与 style 保持一致） */
  handedness: Handedness;
  /** 随机扰动种子（试打误差），保证数据可复现 */
  seed: number;
  /** 出手板位扰动（板），由种子生成后落库，便于复盘 */
  boardJitter: number;
  /** 球速扰动（mph） */
  speedJitter: number;
}

/** 比赛/训练日记录 */
export interface MatchRecord {
  id: string;
  name: string;
  date: string;
  patternId: string;
  laneIds: string[];
  shots: MatchShot[];
  note?: string;
}

/** 轨迹采样点 */
export interface TrajectoryPoint {
  z: number;       // 沿道距离（英尺，犯规线=0）
  x: number;       // 横向位置（板，1..39 连续值）
  vx: number;      // 横向速度（in/s）
  vz: number;      // 纵向速度（in/s）
  phase: BallPhase;
}

/** 接触带栅格单元：CPU 确定性枚举，GPU 实例化复用同一份 */
export interface ContactCell {
  row: number;     // 油纹理行
  col: number;     // 油纹理列
  /** 横向权重 0..1（接触带内高斯/线性分布，横向和为 1） */
  lateralWeight: number;
  /** 纵向权重 0..1（沿路径压力分布，纵向和为 1） */
  pressureWeight: number;
  /** 是否处于后段吐油区 */
  deposit: boolean;
}

/** 一次球的完整推演结果 */
export interface TrajectoryResult {
  points: TrajectoryPoint[];
  /** 入袋角（度，相对球道纵向的夹角绝对值） */
  entryAngleDeg: number;
  /** 打到 1 号瓶线(z=60ft)时的板位 */
  hitBoard: number;
  /** 与理想袋位的偏差（板，正=偏左） */
  pocketOffset: number;
  /** 滑行→转弯 的转折点（英尺） */
  hookStartFt: number;
  /** 转弯→滚动 的转折点（英尺） */
  rollStartFt: number;
  contact: ContactCell[];
  /** 本次球吸走的总油量（uL，由 CPU 公式计算） */
  absorbedUl: number;
  /** 本次球在后段吐出的总油量（uL） */
  depositedUl: number;
}

/** 油面快照（一整局/一球后），grid 为 ROWS*COLS 的 uL 数组 */
export interface OilSnapshot {
  /** 0 = 全新过油 */
  game: number;
  /** 截止该快照累计出手数 */
  shotCount: number;
  grid: Float32Array;
  /** 整张油面总油量（mL） */
  totalMl: number;
  /** 每块板纵向累计油量（uL，长度 39）——核心校验指标 */
  boardTotalsUl: Float32Array;
}

/** 推演可调参数（设置页可改，存 IndexedDB） */
export interface SimSettings {
  /** 吸油率：接触带内每球吸走的油比例（基准） */
  absorptionRate: number;
  /** 吸走的油中在后段吐出的比例 */
  depositFraction: number;
  /** 油面摩擦系数（满油时） */
  oilyFriction: number;
  /** 干区摩擦系数 */
  dryFriction: number;
  /** 摩擦对油量的半饱和厚度（uL/格） */
  frictionHalfOilUl: number;
  /** 勾球强度全局增益 */
  hookGain: number;
  /** 地形横向坡度增益 */
  topographyGain: number;
  /** 重新过油提示阈值（中段剩余油比例） */
  reoilThreshold: number;
  /** 渲染质量 0.5 / 1 / 1.5（DPR 倍数上限） */
  renderScale: number;
}
