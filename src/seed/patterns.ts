/** 种子油型：长油型(42ft 联赛墙式) 与 短油型(32ft) */
import { BOARDS } from '../core/constants';
import { recomputePatternMeta } from '../core/pattern';
import { uid } from '../core/rng';
import type { OilPattern } from '../core/types';

/** 板距中心(20板)的横向负载系数：典型墙式，中段板油厚、外侧板油薄 */
function wallProfile(board: number, peak: number, edge: number, centerBoard = 20): number {
  const dist = Math.abs(board - centerBoard);
  const t = Math.min(1, dist / 14);
  // 平滑的墙：中心 peak，边缘 edge
  return peak + (edge - peak) * Math.pow(t, 1.7);
}

function buildLongPattern(now: number): OilPattern {
  const lengthFt = 42;
  const forward: number[][] = [];
  const reverse: number[][] = [];
  for (let ft = 0; ft < lengthFt; ft++) {
    const fRow = new Array<number>(BOARDS).fill(0);
    const rRow = new Array<number>(BOARDS).fill(0);
    for (let b = 0; b < BOARDS; b++) {
      const board = b + 1;
      if (ft < 40) {
        // 去程：远端负载略减，外侧板更早收油
        const far = ft >= 36 ? 0.7 : 1;
        fRow[b] = round2(wallProfile(board, 2.6, 0.5) * far);
      }
      if (ft < 32) {
        // 回程：前段更厚，形成前/中段油墙
        const front = ft < 16 ? 1.25 : 1;
        rRow[b] = round2(wallProfile(board, 2.2, 0.3) * front);
      }
    }
    forward.push(fRow);
    reverse.push(rRow);
  }
  const meta = recomputePatternMeta(forward, reverse);
  return {
    id: 'pat-long-42',
    name: '长油型 42ft 联赛墙式',
    lengthFt: meta.lengthFt,
    totalOilMl: meta.totalOilMl,
    forward,
    reverse,
    createdAt: now,
    updatedAt: now,
    source: '内置种子',
    note: 'PBA 风格长油，油墙居中，后段 36ft 外去程减载',
  };
}

function buildShortPattern(now: number): OilPattern {
  const lengthFt = 32;
  const forward: number[][] = [];
  const reverse: number[][] = [];
  for (let ft = 0; ft < lengthFt; ft++) {
    const fRow = new Array<number>(BOARDS).fill(0);
    const rRow = new Array<number>(BOARDS).fill(0);
    for (let b = 0; b < BOARDS; b++) {
      const board = b + 1;
      if (ft < 31) {
        // 短油去程更集中、外侧更干，迫使球更早转弯
        const far = ft >= 27 ? 0.65 : 1;
        fRow[b] = round2(wallProfile(board, 2.3, 0.25, 20) * far);
      }
      if (ft < 24) {
        const front = ft < 12 ? 1.3 : 1;
        rRow[b] = round2(wallProfile(board, 2.0, 0.2) * front);
      }
    }
    forward.push(fRow);
    reverse.push(rRow);
  }
  const meta = recomputePatternMeta(forward, reverse);
  return {
    id: uid('pat'),
    name: '短油型 32ft 竞技',
    lengthFt: meta.lengthFt,
    totalOilMl: meta.totalOilMl,
    forward,
    reverse,
    createdAt: now,
    updatedAt: now,
    source: '内置种子',
    note: '短油型，前段集中、外侧干燥，后端勾球反应强',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function seedPatterns(now: number): OilPattern[] {
  return [buildLongPattern(now), buildShortPattern(now)];
}
