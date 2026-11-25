import { REOIL_THRESHOLD } from './constants';
import { kvGet, kvSet } from '../db/indexeddb';
import type { SimSettings } from './types';

export const DEFAULT_SETTINGS: SimSettings = {
  // 每球接触带吸走比例（基准吸油率，典型 6~8%）
  absorptionRate: 0.07,
  // 吸走油量中在后段吐出的比例（带油）
  depositFraction: 0.35,
  // 满油摩擦低、干区摩擦高
  oilyFriction: 0.045,
  dryFriction: 0.22,
  // 半饱和油厚（uL/格），决定油→摩擦曲线斜率
  frictionHalfOilUl: 12,
  hookGain: 1.0,
  topographyGain: 1.0,
  reoilThreshold: REOIL_THRESHOLD,
  renderScale: 1,
};

const SETTINGS_KEY = 'sim-settings';

export async function loadSettings(): Promise<SimSettings> {
  const saved = await kvGet<SimSettings>(SETTINGS_KEY);
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(s: SimSettings): Promise<void> {
  await kvSet(SETTINGS_KEY, s);
}
