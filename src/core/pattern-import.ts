/**
 * 打油机油型表导入解析。
 * 兼容：
 *  A) 本系统导出的原生 JSON（OilPattern）
 *  B) Kegel 风格分节文本/CSV：含 "Forward Oil" / "Reverse Oil" 段，每行: 距离, 油量, 板数
 *  C) 宽表 CSV：每行 = 距离 + 39 个板的 load，去程/回程由表头关键字区分
 */
import { BOARDS } from './constants';
import { emptyMatrix, recomputePatternMeta } from './pattern';
import type { OilPattern } from './types';
import { uid } from './rng';

export interface ParsedPattern {
  name: string;
  lengthFt: number;
  totalOilMl: number;
  forward: number[][];
  reverse: number[][];
  source: string;
  warnings: string[];
}

/** 解析原生 JSON 油型 */
export function parsePatternJson(text: string, fileName: string): ParsedPattern {
  const obj = JSON.parse(text) as Partial<OilPattern>;
  if (!Array.isArray(obj.forward) || !Array.isArray(obj.reverse)) {
    throw new Error('JSON 缺少 forward / reverse 油型矩阵');
  }
  const forward = normalizeMatrix(obj.forward);
  const reverse = normalizeMatrix(obj.reverse);
  const meta = recomputePatternMeta(forward, reverse);
  return {
    name: obj.name ?? fileName.replace(/\.[^.]+$/, ''),
    lengthFt: meta.lengthFt,
    totalOilMl: meta.totalOilMl,
    forward,
    reverse,
    source: fileName,
    warnings: [],
  };
}

function normalizeMatrix(mat: unknown): number[][] {
  if (!Array.isArray(mat)) throw new Error('油型矩阵不是数组');
  return mat.map((row) => {
    if (!Array.isArray(row)) throw new Error('油型行不是数组');
    const out = new Array<number>(BOARDS).fill(0);
    for (let b = 0; b < BOARDS; b++) out[b] = Number(row[b]) || 0;
    return out;
  });
}

/** 解析文本型油型表（自动识别 B / C 两种布局） */
export function parsePatternText(text: string, fileName: string): ParsedPattern {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  // 宽表检测：存在一行拆分后 >= 40 个"纯数字"单元。
  // 数据行首列可能是 Forward/Reverse 标签，故跳过首列，要求其余 >=40 格全数字。
  const wideLine = lines.find((l) => {
    const cells = splitNums(l);
    const numeric = cells.slice(1);
    return numeric.length >= BOARDS + 1 && numeric.every((c) => !Number.isNaN(Number(c)));
  });
  if (wideLine) return parseWideTable(lines, fileName);
  return parseSectioned(lines, fileName);
}

function splitNums(line: string): string[] {
  return line.split(/[,\t;]+/).map((s) => s.trim()).filter((s) => s !== '');
}

/** B) Kegel 风格分节：Forward Oil / Reverse Oil，每行 距离, 油量, 板数(可选) */
function parseSectioned(lines: string[], fileName: string): ParsedPattern {
  const warnings: string[] = [];
  const forward = emptyMatrix(60);
  const reverse = emptyMatrix(60);
  let mode: 'none' | 'forward' | 'reverse' = 'none';
  let name = fileName.replace(/\.[^.]+$/, '');

  for (const raw of lines) {
    const lower = raw.toLowerCase();
    // 名称行必须以 Name/油型 开头，且取值不含说明性符号（= 或多个冒号）
    if (/^(name|油型|pattern)/.test(lower)) {
      const m = raw.split(/[,:：]/).slice(1).join(':').trim();
      if (m && !m.includes('=') && m.length <= 40) name = m;
    }
    if (lower.includes('forward') || lower.includes('去程')) {
      mode = 'forward';
      continue;
    }
    if (lower.includes('reverse') || lower.includes('回程') || lower.includes('reverse oil')) {
      mode = 'reverse';
      continue;
    }
    const cells = splitNums(raw);
    const nums = cells.map(Number);
    if (nums.some((n) => Number.isNaN(n))) continue;
    if (nums.length < 2 || mode === 'none') continue;

    const distanceFt = Math.round(nums[0]); // 该段终点距离(英尺)
    const load = nums[1];
    const boardCount = nums.length >= 3 ? Math.round(nums[2]) : BOARDS;
    if (distanceFt < 1 || distanceFt > 60) {
      warnings.push(`忽略越界距离行: ${raw}`);
      continue;
    }
    // 板数 → 居中的板区间（机器按板数居中喷油）
    const startB = Math.floor((BOARDS - boardCount) / 2);
    const mat = mode === 'forward' ? forward : reverse;
    for (let ft = 0; ft < distanceFt; ft++) {
      for (let b = startB; b < startB + boardCount && b < BOARDS; b++) {
        mat[ft][b] += load;
      }
    }
  }

  const meta = recomputePatternMeta(forward, reverse);
  if (meta.lengthFt === 0) {
    throw new Error('未能从分节文本中识别出任何油量数据（需要 Forward Oil / Reverse Oil 段）');
  }
  return {
    name,
    lengthFt: meta.lengthFt,
    totalOilMl: meta.totalOilMl,
    forward: forward.slice(0, Math.max(meta.lengthFt, 1)),
    reverse: reverse.slice(0, Math.max(meta.lengthFt, 1)),
    source: fileName,
    warnings,
  };
}

/** C) 宽表：表头含 forward/reverse(去/回) 关键字，数据行 = 距离 + 39 板 load */
function parseWideTable(lines: string[], fileName: string): ParsedPattern {
  const warnings: string[] = [];
  const fwd = emptyMatrix(60);
  const rev = emptyMatrix(60);
  let name = fileName.replace(/\.[^.]+$/, '');
  let mode: 'unknown' | 'forward' | 'reverse' = 'unknown';

  for (const raw of lines) {
    const lower = raw.toLowerCase();
    if (/forward|去程/.test(lower)) mode = 'forward';
    else if (/reverse|回程/.test(lower)) mode = 'reverse';
    else if (/^(name|油型|pattern)/.test(lower)) {
      const m = raw.split(/[,:：]/).slice(1).join(':').trim();
      if (m && !m.includes('=') && m.length <= 40) name = m;
    }

    const cells = splitNums(raw);
    // 首列可能是 Forward/Reverse 标签：有标签时数值整体右移一格
    const firstIsLabel = cells.length > 0 && Number.isNaN(Number(cells[0]));
    const nums = (firstIsLabel ? cells.slice(1) : cells).map(Number);
    if (nums.length < BOARDS + 1 || nums.some((n) => Number.isNaN(n))) continue;
    const distanceFt = Math.round(nums[0]);
    if (distanceFt < 1 || distanceFt > 60) continue;
    const ft = distanceFt - 1;
    const boards = nums.slice(1, 1 + BOARDS);
    const target = mode === 'reverse' ? rev : fwd;
    for (let b = 0; b < BOARDS; b++) target[ft][b] = boards[b];
    if (mode === 'unknown') warnings.push(`第 ${distanceFt}ft 行未标明去/回程，按去程处理`);
  }

  const meta = recomputePatternMeta(fwd, rev);
  if (meta.lengthFt === 0) throw new Error('宽表中未识别到有效数据行');
  return {
    name,
    lengthFt: meta.lengthFt,
    totalOilMl: meta.totalOilMl,
    forward: fwd.slice(0, Math.max(meta.lengthFt, 1)),
    reverse: rev.slice(0, Math.max(meta.lengthFt, 1)),
    source: fileName,
    warnings,
  };
}

/** 入口：按扩展名/内容自动选择解析器 */
export function parsePatternFile(text: string, fileName: string): ParsedPattern {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const p = parsePatternJson(text, fileName);
    return { ...p, warnings: [] };
  }
  return parsePatternText(text, fileName);
}

/** 把解析结果落成可持久化对象 */
export function toOilPattern(p: ParsedPattern, now: number): OilPattern {
  return {
    id: uid('pat'),
    name: p.name,
    lengthFt: p.lengthFt,
    totalOilMl: p.totalOilMl,
    forward: p.forward,
    reverse: p.reverse,
    createdAt: now,
    updatedAt: now,
    source: p.source,
    note: p.warnings.length ? p.warnings.join('；') : undefined,
  };
}
