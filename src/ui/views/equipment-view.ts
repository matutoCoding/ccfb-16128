/** 球与打法页面：保龄球、打法、球员三个分区 */
import { repo, STORES } from '../../db/indexeddb';
import { appStore, refreshCollection } from '../app-state';
import { badge, button, card, field, h, numberInput, select, table, toast } from '../dom';
import type { BowlingBall, Handedness, Player, ShotStyle } from '../../core/types';
import { uid } from '../../core/rng';

export function renderEquipment(): HTMLElement {
  const root = h('div.page.equipment-page', [
    h('div.page-head', [
      h('h1', '球与打法'),
      h('p.page-desc', '球按表面粗糙度/核心/重量建模；打法录球速、转速、轴倾角、出手板位，支持左右手'),
    ]),
    h('div.stack-col', [renderBalls(), renderStyles(), renderPlayers()]),
  ]);
  return root;
}

function renderBalls(): HTMLElement {
  const host = h('div');
  function redraw(): void {
    const balls = appStore.getState().balls;
    host.replaceChildren(
      card(
        `保龄球 (${balls.length})`,
        table(
          ['名称', '品牌', '重量(lb)', '粗糙度 Ra(µin)', '核心', 'RG', '差动RG', '勾球强度', '操作'],
          balls.map((b) => [
            b.name,
            b.brand ?? '',
            String(b.weightLb),
            String(b.surfaceRa),
            b.coreType,
            b.rg.toFixed(2),
            b.differential.toFixed(3),
            `${Math.round(b.hookRating * 100)}%`,
            button('删除', () => removeBall(b.id), 'danger'),
          ]),
        ),
        button('＋ 新增球', addBall, 'primary'),
      ),
    );
  }
  async function addBall(): Promise<void> {
    const ball: BowlingBall = {
      id: uid('ball'),
      name: `新球 ${appStore.getState().balls.length + 1}`,
      brand: 'Generic',
      weightLb: 15,
      surfaceRa: 50,
      coreType: '对称实心',
      rg: 2.5,
      differential: 0.045,
      hookRating: 0.75,
    };
    await repo.put(STORES.balls, ball);
    refreshCollection('balls', [...appStore.getState().balls, ball]);
    redraw();
    toast('已新增球', 'ok');
  }
  async function removeBall(id: string): Promise<void> {
    await repo.remove(STORES.balls, id);
    refreshCollection('balls', appStore.getState().balls.filter((b) => b.id !== id));
    redraw();
  }
  redraw();
  return host;
}

function renderStyles(): HTMLElement {
  const host = h('div');
  function redraw(): void {
    const styles = appStore.getState().styles;
    host.replaceChildren(
      card(
        `打法/出手 (${styles.length})`,
        h('div.style-grid',
          styles.map((s) => {
            const handBadge = badge(s.handedness === 'R' ? '右手' : '左手', s.handedness === 'R' ? 'info' : 'warn');
            return h('div.style-card', [
              h('div.style-card-head', [h('strong', [s.name]), handBadge]),
              h('div.style-fields', [
                field('球速(mph)', bindNum(s, 'ballSpeedMph', 0.1)),
                field('转速(rpm)', bindNum(s, 'revRateRpm', 10)),
                field('轴倾角(°)', bindNum(s, 'axisTiltDeg', 1)),
                field('出手板位', bindNum(s, 'launchBoard', 1)),
                field('目标板位(15ft)', bindNum(s, 'targetBoard', 1)),
              ]),
              button('删除该打法', () => removeStyle(s.id), 'danger'),
            ]);
          }),
        ),
        button('＋ 新增打法', addStyle, 'primary'),
      ),
    );
  }

  function bindNum(s: ShotStyle, key: keyof ShotStyle, step: number): HTMLElement {
    const input = numberInput(Number(s[key]), (v) => {
      (s[key] as number) = v;
      void repo.put(STORES.styles, s).then(() =>
        refreshCollection('styles', appStore.getState().styles.map((x) => (x.id === s.id ? s : x))),
      );
    });
    input.step = String(step);
    return input;
  }

  async function addStyle(): Promise<void> {
    const style: ShotStyle = {
      id: uid('style'),
      name: `新打法 ${appStore.getState().styles.length + 1}`,
      handedness: 'R',
      ballSpeedMph: 18,
      revRateRpm: 350,
      axisTiltDeg: 15,
      launchBoard: 20,
      targetBoard: 12,
    };
    await repo.put(STORES.styles, style);
    refreshCollection('styles', [...appStore.getState().styles, style]);
    redraw();
  }
  async function removeStyle(id: string): Promise<void> {
    await repo.remove(STORES.styles, id);
    refreshCollection('styles', appStore.getState().styles.filter((s) => s.id !== id));
    redraw();
  }
  redraw();
  return host;
}

function renderPlayers(): HTMLElement {
  const host = h('div');
  function redraw(): void {
    const { players, styles, balls } = appStore.getState();
    host.replaceChildren(
      card(
        `球员 (${players.length})`,
        table(
          ['姓名', '惯用手', '默认打法', '常用球', '操作'],
          players.map((p) => [
            p.name,
            p.handedness === 'R' ? '右手' : '左手',
            select(
              styles.map((s) => ({ value: s.id, label: s.name })),
              p.styleId,
              (v) => {
                p.styleId = v;
                p.handedness = styles.find((s) => s.id === v)?.handedness ?? p.handedness;
                void save(p);
              },
            ),
            select(
              balls.map((b) => ({ value: b.id, label: b.name })),
              p.ballId,
              (v) => {
                p.ballId = v;
                void save(p);
              },
            ),
            button('删除', () => removePlayer(p.id), 'danger'),
          ]),
        ),
        button('＋ 新增球员', addPlayer, 'primary'),
      ),
    );
  }
  async function save(p: Player): Promise<void> {
    await repo.put(STORES.players, p);
    refreshCollection('players', appStore.getState().players.map((x) => (x.id === p.id ? p : x)));
    redraw();
  }
  async function addPlayer(): Promise<void> {
    const { styles, balls } = appStore.getState();
    const p: Player = {
      id: uid('player'),
      name: `球员 ${appStore.getState().players.length + 1}`,
      handedness: 'R' as Handedness,
      styleId: styles[0]?.id ?? '',
      ballId: balls[0]?.id ?? '',
    };
    await repo.put(STORES.players, p);
    refreshCollection('players', [...appStore.getState().players, p]);
    redraw();
  }
  async function removePlayer(id: string): Promise<void> {
    await repo.remove(STORES.players, id);
    refreshCollection('players', appStore.getState().players.filter((p) => p.id !== id));
    redraw();
  }
  redraw();
  return host;
}
