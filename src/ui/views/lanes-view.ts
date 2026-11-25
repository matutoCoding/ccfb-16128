/** 球道档案页面：木质/合成、39 板高低差(mil)与磨损、干区摩擦 */
import { BOARDS } from '../../core/constants';
import { repo, STORES } from '../../db/indexeddb';
import { appStore, refreshCollection } from '../app-state';
import { badge, button, card, field, h, numberInput, select, table, toast } from '../dom';
import type { LaneProfile, LaneSurface } from '../../core/types';
import { uid } from '../../core/rng';

export function renderLanes(): HTMLElement {
  const state = appStore.getState();
  const list = h('div.pattern-list');
  const detail = h('div.pattern-detail');
  let selectedId = state.lanes[0]?.id ?? '';

  const getLane = (id: string): LaneProfile =>
    appStore.getState().lanes.find((x) => x.id === id)!;

  async function persist(lane: LaneProfile): Promise<void> {
    await repo.put(STORES.lanes, lane);
    refreshCollection(
      'lanes',
      appStore.getState().lanes.map((x) => (x.id === lane.id ? lane : x)),
    );
  }

  function renderList(): void {
    list.replaceChildren();
    list.append(
      h('div.list-head', [
        h('h3', `球道档案 (${appStore.getState().lanes.length})`),
        button('＋ 新增球道', createLane, 'primary'),
      ]),
    );
    const venues = new Map<string, LaneProfile[]>();
    for (const lane of appStore.getState().lanes) {
      const arr = venues.get(lane.venue) ?? [];
      arr.push(lane);
      venues.set(lane.venue, arr);
    }
    for (const [venue, lanes] of venues) {
      list.append(h('div.list-group', [venue]));
      for (const lane of lanes) {
        list.append(
          h(
            `div.list-item${lane.id === selectedId ? '.active' : ''}`,
            { on: { click: () => { selectedId = lane.id; renderList(); renderDetail(lane.id); } } },
            [
              h('div.list-item-title', [lane.name]),
              h('div.list-item-sub', [lane.surface === 'wood' ? '木质' : '合成']),
              badge(lane.surface === 'wood' ? '木' : '合', lane.surface === 'wood' ? 'warn' : 'info'),
            ],
          ),
        );
      }
    }
  }

  function createLane(): void {
    const lane: LaneProfile = {
      id: uid('lane'),
      name: `新球道 ${appStore.getState().lanes.length + 1}`,
      venue: '自家馆',
      surface: 'synthetic',
      boardHeightMil: new Array<number>(BOARDS).fill(0),
      wear: new Array<number>(BOARDS).fill(0.2),
      dryFriction: 0.22,
    };
    repo.put(STORES.lanes, lane).then(() => {
      refreshCollection('lanes', [...appStore.getState().lanes, lane]);
      selectedId = lane.id;
      renderList();
      renderDetail(lane.id);
      toast('已新增球道', 'ok');
    });
  }

  function renderDetail(id: string): void {
    const lane = getLane(id);
    if (!lane) {
      detail.replaceChildren(h('div.empty-hint', '请选择球道'));
      return;
    }
    detail.replaceChildren();

    const nameInput = h('input', { value: lane.name }) as HTMLInputElement;
    nameInput.addEventListener('change', () => {
      lane.name = nameInput.value;
      void persist(lane);
    });
    const venueInput = h('input', { value: lane.venue }) as HTMLInputElement;
    venueInput.addEventListener('change', () => {
      lane.venue = venueInput.value;
      void persist(lane);
    });
    const surfaceSel = select<LaneSurface>(
      [
        { value: 'synthetic', label: '合成面' },
        { value: 'wood', label: '木质面' },
      ],
      lane.surface,
      (v) => {
        lane.surface = v;
        void persist(lane);
      },
    );
    const frictionInput = numberInput(lane.dryFriction, (v) => {
      lane.dryFriction = Math.max(0.01, v);
      void persist(lane);
    });
    frictionInput.step = '0.01';

    const heightGrid = h('div.board-readout');
    const wearGrid = h('div.board-readout');
    renderBoardEditors();

    function renderBoardEditors(): void {
      heightGrid.replaceChildren();
      wearGrid.replaceChildren();
      lane.boardHeightMil.forEach((mil, b) => {
        const hInp = numberInput(mil, (v) => {
          lane.boardHeightMil[b] = v;
          void persist(lane);
        });
        hInp.step = '0.1';
        heightGrid.append(h('div.board-cell', [h('span.board-no', [String(b + 1)]), hInp]));
        const wInp = numberInput(lane.wear[b], (v) => {
          lane.wear[b] = Math.max(0, Math.min(1, v));
          void persist(lane);
        });
        wInp.step = '0.05';
        wearGrid.append(h('div.board-cell', [h('span.board-no', [String(b + 1)]), wInp]));
      });
    }

    const heights = lane.boardHeightMil;
    const maxDiff = Math.max(...heights) - Math.min(...heights);
    const lowBoard = heights.indexOf(Math.min(...heights)) + 1;
    const summary = table(
      ['指标', '数值', '说明'],
      [
        ['板间最大高低差', `${maxDiff.toFixed(1)} mil`, '超过 40mil(≈1mm) 侧坡带球明显'],
        ['最低板位', `${lowBoard} 板`, '球在重力下被带向该侧'],
        ['平均磨损', `${(lane.wear.reduce((a, b) => a + b, 0) / BOARDS).toFixed(2)}`, '0 全新 ~ 1 严重磨损'],
        ['干区摩擦系数', lane.dryFriction.toFixed(3), '木质通常高于合成'],
      ],
    );

    detail.append(
      card(
        lane.name,
        h('div', [
          h('div.editor-toolbar', [
            field('名称', nameInput),
            field('所属馆', venueInput),
            field('表面类型', surfaceSel),
            field('干区摩擦', frictionInput),
          ]),
          summary,
          h('h4.block-title', '39 板高低差（mil，千分之一英寸）'),
          heightGrid,
          h('h4.block-title', '39 板表面磨损（0~1）'),
          wearGrid,
        ]),
        h('div.card-actions', [
          button('随机化地形(模拟复测)', () => randomizeTopo(lane, renderBoardEditors)),
          button('删除球道', () => removeLane(lane.id), 'danger'),
        ]),
      ),
    );
  }

  function randomizeTopo(lane: LaneProfile, redraw: () => void): void {
    const bias = (Math.random() - 0.5) * 6;
    for (let b = 0; b < BOARDS; b++) {
      const t = b / (BOARDS - 1);
      lane.boardHeightMil[b] =
        Math.round((bias * (t - 0.5) + (Math.random() - 0.5) * 2.4) * 10) / 10;
    }
    redraw();
    void persist(lane);
    toast('已生成新的板级地形', 'ok');
  }

  async function removeLane(id: string): Promise<void> {
    if (!confirm('确认删除该球道？')) return;
    await repo.remove(STORES.lanes, id);
    refreshCollection('lanes', appStore.getState().lanes.filter((x) => x.id !== id));
    selectedId = appStore.getState().lanes[0]?.id ?? '';
    renderList();
    renderDetail(selectedId);
  }

  const root = h('div.page.lanes-page', [
    h('div.page-head', [h('h1', '球道档案'), h('p.page-desc', '自家馆 24 道 + 外包 3 馆各 8 道；板级高低差产生横向坡度，把球带向低侧')]),
    h('div.two-col', [list, detail]),
  ]);
  renderList();
  if (selectedId) renderDetail(selectedId);
  return root;
}
