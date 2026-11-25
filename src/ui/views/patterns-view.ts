/** 油型库页面：列表、油型图、39 板编辑、打油机文件导入、新增/删除 */
import { BOARDS } from '../../core/constants';
import { recomputePatternMeta, resizeMatrix } from '../../core/pattern';
import { parsePatternFile, toOilPattern } from '../../core/pattern-import';
import { repo, STORES } from '../../db/indexeddb';
import { appStore, refreshCollection } from '../app-state';
import { badge, button, card, field, h, numberInput, select, toast } from '../dom';
import { drawPatternProfile } from '../charts';
import type { OilPattern } from '../../core/types';
import { uid } from '../../core/rng';

export function renderPatterns(): HTMLElement {
  const state = appStore.getState();
  const list = h('div.pattern-list');
  const detail = h('div.pattern-detail');
  let selectedId = state.patterns[0]?.id ?? '';

  function renderList(): void {
    list.replaceChildren();
    list.append(
      h('div.list-head', [
        h('h3', '油型库'),
        button('＋ 新建油型', () => createPattern(), 'primary'),
      ]),
    );
    for (const p of appStore.getState().patterns) {
      list.append(
        h(
          `div.list-item${p.id === selectedId ? '.active' : ''}`,
          {
            on: {
              click: () => {
                selectedId = p.id;
                renderList();
                renderDetail(p.id);
              },
            },
          },
          [
            h('div.list-item-title', [p.name]),
            h('div.list-item-sub', [
              `${p.lengthFt}ft · ${p.totalOilMl.toFixed(1)}mL`,
            ]),
            p.source ? badge(p.source, 'info') : '',
          ],
        ),
      );
    }
  }

  async function createPattern(): Promise<void> {
    const now = Date.now();
    const blank: OilPattern = {
      id: uid('pat'),
      name: `新油型 ${appStore.getState().patterns.length + 1}`,
      lengthFt: 39,
      totalOilMl: 0,
      forward: Array.from({ length: 39 }, () => new Array<number>(BOARDS).fill(1.5)),
      reverse: Array.from({ length: 39 }, () => new Array<number>(BOARDS).fill(1.2)),
      createdAt: now,
      updatedAt: now,
    };
    const meta = recomputePatternMeta(blank.forward, blank.reverse);
    blank.lengthFt = meta.lengthFt;
    blank.totalOilMl = meta.totalOilMl;
    await repo.put(STORES.patterns, blank);
    refreshCollection('patterns', [blank, ...appStore.getState().patterns]);
    selectedId = blank.id;
    renderList();
    renderDetail(blank.id);
    toast('已新建油型', 'ok');
  }

  async function importFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = parsePatternFile(text, file.name);
      const pattern = toOilPattern(parsed, Date.now());
      await repo.put(STORES.patterns, pattern);
      refreshCollection('patterns', [pattern, ...appStore.getState().patterns]);
      selectedId = pattern.id;
      renderList();
      renderDetail(pattern.id);
      toast(`导入成功：${pattern.lengthFt}ft / ${pattern.totalOilMl.toFixed(1)}mL`, 'ok');
      parsed.warnings.forEach((w) => toast(w, 'info'));
    } catch (err) {
      toast(`导入失败：${(err as Error).message}`, 'err');
    }
  }

  function renderDetail(id: string): void {
    const found = appStore.getState().patterns.find((x) => x.id === id);
    detail.replaceChildren();
    if (!found) {
      detail.append(h('div.empty-hint', '请选择或新建一个油型'));
      return;
    }
    const p: OilPattern = found;

    const canvas = h('canvas.chart', { style: { width: '100%', height: '220px' } }) as HTMLCanvasElement;
    const metaLine = h('div.meta-line', [
      badge(`油型长度 ${p.lengthFt} ft`, 'ok'),
      badge(`总油量 ${p.totalOilMl.toFixed(2)} mL`, 'ok'),
      badge(`${p.forward.length} 英尺行 × 39 板`, 'info'),
    ]);

    // 矩阵编辑器：选英尺行，编辑 39 板的去/回程 load
    const ftSel = select(
      p.forward.map((_, i) => ({ value: String(i), label: `${i + 1} ft` })),
      '0',
      (v) => renderEditor(Number(v)),
    );
    const passSel = select(
      [
        { value: 'forward', label: '去程' },
        { value: 'reverse', label: '回程' },
      ],
      'forward',
      () => renderEditor(Number(ftSel.value)),
    );
    const editorHost = h('div.board-editor');

    function renderEditor(ft: number): void {
      const pass = passSel.value as 'forward' | 'reverse';
      const row = p[pass][ft] ?? new Array<number>(BOARDS).fill(0);
      editorHost.replaceChildren();
      editorHost.append(
        h(
          'div.board-grid',
          row.map((load, b) => {
            const inp = numberInput(load, async (v) => {
              p[pass][ft][b] = Math.max(0, v);
              await persist();
            });
            inp.step = '0.1';
            inp.title = `${b + 1}板`;
            return h('div.board-cell', [h('span.board-no', [String(b + 1)]), inp]);
          }),
        ),
      );
    }

    async function persist(): Promise<void> {
      const meta = recomputePatternMeta(p.forward, p.reverse);
      p.lengthFt = meta.lengthFt;
      p.totalOilMl = meta.totalOilMl;
      p.updatedAt = Date.now();
      await repo.put(STORES.patterns, p);
      const all = appStore.getState().patterns.map((x) => (x.id === p.id ? p : x));
      refreshCollection('patterns', all);
      drawPatternProfile(canvas, p.forward, p.reverse);
      metaLine.replaceChildren(
        badge(`油型长度 ${p.lengthFt} ft`, 'ok'),
        badge(`总油量 ${p.totalOilMl.toFixed(2)} mL`, 'ok'),
      );
    }

    const lengthInput = numberInput(p.lengthFt, async (v) => {
      const len = Math.max(1, Math.min(60, Math.round(v)));
      p.forward = resizeMatrix(p.forward, len);
      p.reverse = resizeMatrix(p.reverse, len);
      await persist();
      renderDetail(p.id);
    });

    const fileInput = h('input', {
      type: 'file',
      accept: '.csv,.txt,.json',
      style: { display: 'none' },
      on: { change: (e) => importFile((e.target as HTMLInputElement).files?.[0] as File) },
    }) as HTMLInputElement;

    detail.append(
      card(
        p.name,
        h('div', [
          metaLine,
          canvas,
          h('div.editor-toolbar', [
            field('油型长度(ft)', lengthInput),
            field('编辑英尺行', ftSel),
            field('过油方向', passSel),
            button('保存并重算', () => persist(), 'primary'),
          ]),
          editorHost,
        ]),
        h('div.card-actions', [
          button('📥 导入打油机油型表', () => fileInput.click()),
          fileInput,
          button('🖨 导出/打印油型说明', () => exportPatternSheet(p), 'primary'),
          button('删除油型', () => removePattern(p.id), 'danger'),
        ]),
      ),
    );
    requestAnimationFrame(() => drawPatternProfile(canvas, p.forward, p.reverse));
    renderEditor(0);
  }

  async function removePattern(id: string): Promise<void> {
    if (!confirm('确认删除该油型？')) return;
    await repo.remove(STORES.patterns, id);
    refreshCollection(
      'patterns',
      appStore.getState().patterns.filter((x) => x.id !== id),
    );
    selectedId = appStore.getState().patterns[0]?.id ?? '';
    renderList();
    renderDetail(selectedId);
    toast('已删除', 'info');
  }

  const root = h('div.page.patterns-page', [
    h('div.page-head', [h('h1', '油型库'), h('p.page-desc', '39 板 × 每英尺油量单位(load)，去程/回程分设；支持打油机导出表导入')]),
    h('div.two-col', [list, detail]),
  ]);
  renderList();
  if (selectedId) renderDetail(selectedId);
  return root;
}

/** 导出油型说明（可打印，复用 export 模块） */
async function exportPatternSheet(p: OilPattern): Promise<void> {
  const { openPrintWindow } = await import('../export/print');
  openPrintWindow(p);
}
