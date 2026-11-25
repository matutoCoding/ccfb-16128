/**
 * 比赛跟踪页面：
 * 按每条道每局实际出手球员展示，标注左右手混合，
 * 基于实时推演给出下一轮前哪些道需要重新过油。
 */
import { MAX_GAMES, SHOTS_PER_GAME } from '../../core/constants';
import { midlaneRetention } from '../../core/oil-depletion';
import { OilSimulator } from '../../core/sim-engine';
import { repo, STORES } from '../../db/indexeddb';
import { appStore } from '../app-state';
import { badge, button, card, field, h, select, table, toast } from '../dom';
import type { MatchRecord, MatchShot } from '../../core/types';
import { uid } from '../../core/rng';
import { seedMatch } from '../../seed/match';

interface LaneHealth {
  laneId: string;
  laneName: string;
  gamesUsed: number;
  leftShots: number;
  rightShots: number;
  worstRetention: number;
  worstBoard: number;
  reoil: boolean;
}

export function renderMatches(): HTMLElement {
  const state = appStore.getState();
  let matchId = state.matches[0]?.id ?? '';
  const listHost = h('div');
  const healthHost = h('div');
  const editHost = h('div');

  const matchSel = select(
    appStore.getState().matches.map((m) => ({ value: m.id, label: `${m.name} (${m.shots.length}球)` })),
    matchId,
    (v) => {
      matchId = v;
      redraw();
    },
  );

  function currentMatch(): MatchRecord | undefined {
    return appStore.getState().matches.find((m) => m.id === matchId);
  }

  async function evaluateHealth(): Promise<void> {
    const s = appStore.getState();
    const match = currentMatch();
    const pattern = s.patterns.find((p) => p.id === match?.patternId);
    if (!match || !pattern) {
      toast('缺少比赛或油型数据', 'err');
      return;
    }
    const ctx = {
      players: new Map(s.players.map((p) => [p.id, p])),
      styles: new Map(s.styles.map((x) => [x.id, x])),
      balls: new Map(s.balls.map((b) => [b.id, b])),
      lanes: new Map(s.lanes.map((l) => [l.id, l])),
    };

    const health: LaneHealth[] = [];
    for (const laneId of match.laneIds) {
      const lane = s.lanes.find((l) => l.id === laneId);
      if (!lane) continue;
      const sim = new OilSimulator(pattern, lane, s.settings, ctx);
      const laneShots = match.shots
        .filter((sh) => sh.laneId === laneId)
        .sort((a, b) => a.order - b.order);
      if (laneShots.length === 0) continue;
      sim.runSequence(laneShots, MAX_GAMES);
      const retention = midlaneRetention(sim.grid, sim.initialGrid);
      let worst = Infinity;
      let worstBoard = 1;
      retention.forEach((v, b) => {
        if (v < worst) {
          worst = v;
          worstBoard = b + 1;
        }
      });
      const gamesUsed = new Set(laneShots.map((sh) => sh.game)).size;
      const leftShots = laneShots.filter((sh) => sh.handedness === 'L').length;
      health.push({
        laneId,
        laneName: lane.name,
        gamesUsed,
        leftShots,
        rightShots: laneShots.length - leftShots,
        worstRetention: worst,
        worstBoard,
        reoil: worst < s.settings.reoilThreshold,
      });
    }
    health.sort((a, b) => a.worstRetention - b.worstRetention);
    renderHealth(health);
  }

  function renderHealth(health: LaneHealth[]): void {
    healthHost.replaceChildren(
      card(
        '下一轮重新过油建议',
        table(
          ['球道', '已用局数', '左/右手球数', '最差板剩余油', '最差板位', '建议'],
          health.map((x) => [
            x.laneName,
            `${x.gamesUsed} 局`,
            `${x.leftShots} / ${x.rightShots}`,
            `${(x.worstRetention * 100).toFixed(1)}%`,
            `${x.worstBoard} 板`,
            x.reoil ? badge('重新过油', 'warn') : badge('可继续', 'ok'),
          ]),
        ),
      ),
    );
    const reoilCount = health.filter((x) => x.reoil).length;
    toast(`评估完成：${reoilCount} 条道建议重新过油`, reoilCount > 0 ? 'info' : 'ok');
  }

  function redraw(): void {
    const match = currentMatch();
    if (!match) {
      listHost.replaceChildren(h('div.empty-hint', '暂无比赛记录'));
      return;
    }
    // 按道分组，再按局列出
    const byLane = new Map<string, MatchShot[]>();
    for (const sh of match.shots) {
      const arr = byLane.get(sh.laneId) ?? [];
      arr.push(sh);
      byLane.set(sh.laneId, arr);
    }
    const s = appStore.getState();
    listHost.replaceChildren();
    for (const [laneId, shots] of byLane) {
      const lane = s.lanes.find((l) => l.id === laneId);
      const games = new Map<number, MatchShot[]>();
      shots.forEach((sh) => {
        const arr = games.get(sh.game) ?? [];
        arr.push(sh);
        games.set(sh.game, arr);
      });
      const gameBlocks = [...games.entries()].sort((a, b) => a[0] - b[0]).map(([g, ss]) =>
        h('div.game-chip', [
          h('span.game-no', [`G${g}`]),
          ...ss
            .sort((a, b) => a.order - b.order)
            .map((sh) => {
              const player = s.players.find((p) => p.id === sh.playerId);
              return h(
                `span.shot-pill.${sh.handedness === 'L' ? 'left' : 'right'}`,
                { title: `${player?.name ?? sh.playerId} · ${sh.handedness === 'L' ? '左手' : '右手'}` },
                [player?.name ?? '?'],
              );
            }),
        ]),
      );
      listHost.append(
        card(
          lane?.name ?? laneId,
          h('div.game-list', gameBlocks),
          h('div.card-actions', [
            button('＋ 该局补录球员', () => appendShot(laneId, Math.max(...games.keys()) + 1)),
          ]),
        ),
      );
    }
  }

  async function appendShot(laneId: string, game: number): Promise<void> {
    const s = appStore.getState();
    const match = currentMatch();
    if (!match) return;
    const player = s.players[0];
    if (!player) {
      toast('请先在球与打法页建立球员', 'err');
      return;
    }
    const order = match.shots.length;
    const style = s.styles.find((x) => x.id === player.styleId);
    const shot: MatchShot = {
      id: uid('shot'),
      laneId,
      game,
      order,
      playerId: player.id,
      styleId: player.styleId,
      ballId: player.ballId,
      handedness: style?.handedness ?? 'R',
      seed: order * 2654435761,
      boardJitter: 0,
      speedJitter: 0,
    };
    match.shots.push(shot);
    await repo.put(STORES.matches, match);
    appStore.setState({ matches: [...s.matches] });
    redraw();
    toast(`已在 ${game} 局补录 ${player.name}`, 'ok');
  }

  async function regenerateDay(): Promise<void> {
    const s = appStore.getState();
    const match = currentMatch();
    if (!match) return;
    const fresh = seedMatch(
      match.patternId,
      s.lanes.filter((l) => match.laneIds.includes(l.id)),
      s.players,
      s.styles,
      s.balls,
      Date.now(),
      { games: MAX_GAMES, laneCount: match.laneIds.length, shotsPerGame: SHOTS_PER_GAME },
    );
    fresh.id = match.id;
    fresh.name = match.name;
    await repo.put(STORES.matches, fresh);
    appStore.setState({ matches: s.matches.map((m) => (m.id === fresh.id ? fresh : m)) });
    redraw();
    toast('已重新生成打满一天的比赛记录', 'ok');
  }

  editHost.replaceChildren(
    card(
      '比赛管理',
      h('div.editor-toolbar', [
        field('选择比赛', matchSel),
        button('🔄 重新生成 40 局全天记录', regenerateDay, 'primary'),
        button('📊 评估各道油面/过油建议', () => void evaluateHealth(), 'primary'),
      ]),
    ),
  );

  redraw();

  return h('div.page.matches-page', [
    h('div.page-head', [
      h('h1', '比赛跟踪'),
      h('p.page-desc', '按道按局记录实际出手球员；左右手混打导致不对称消耗，系统给出下一轮重新过油建议'),
    ]),
    editHost,
    healthHost,
    listHost,
  ]);
}
