/** 全局应用状态：所有领域实体的内存缓存 + 设置 + 当前选中项 */
import { repo, STORES } from '../db/indexeddb';
import { DEFAULT_SETTINGS, loadSettings } from '../core/settings';
import { createStore, type Store } from './store';
import type {
  BowlingBall,
  LaneProfile,
  MatchRecord,
  OilPattern,
  Player,
  ShotStyle,
  SimSettings,
} from '../core/types';

export interface AppState {
  ready: boolean;
  patterns: OilPattern[];
  lanes: LaneProfile[];
  balls: BowlingBall[];
  styles: ShotStyle[];
  players: Player[];
  matches: MatchRecord[];
  settings: SimSettings;
  currentPatternId: string;
  currentLaneId: string;
  currentMatchId: string;
}

export const appStore: Store<AppState> = createStore<AppState>({
  ready: false,
  patterns: [],
  lanes: [],
  balls: [],
  styles: [],
  players: [],
  matches: [],
  settings: { ...DEFAULT_SETTINGS },
  currentPatternId: '',
  currentLaneId: '',
  currentMatchId: '',
});

export async function loadAppState(): Promise<void> {
  const [patterns, lanes, balls, styles, players, matches] = await Promise.all([
    repo.getAll<OilPattern>(STORES.patterns),
    repo.getAll<LaneProfile>(STORES.lanes),
    repo.getAll<BowlingBall>(STORES.balls),
    repo.getAll<ShotStyle>(STORES.styles),
    repo.getAll<Player>(STORES.players),
    repo.getAll<MatchRecord>(STORES.matches),
  ]);
  const settings = await loadSettings();
  appStore.setState({
    ready: true,
    patterns,
    lanes,
    balls,
    styles,
    players,
    matches,
    settings,
    currentPatternId: patterns[0]?.id ?? '',
    currentLaneId: lanes[0]?.id ?? '',
    currentMatchId: matches[0]?.id ?? '',
  });
}

export function refreshCollection<K extends 'patterns' | 'lanes' | 'balls' | 'styles' | 'players' | 'matches'>(
  key: K,
  items: AppState[K],
): void {
  appStore.setState({ [key]: items } as Partial<AppState>);
}

export function findById<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((x) => x.id === id);
}
