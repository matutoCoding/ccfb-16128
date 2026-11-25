/** 哈希路由：#/patterns | #/lanes | #/equipment | #/sim | #/matches | #/settings */
import { h, mount } from './dom';
import { renderPatterns } from './views/patterns-view';
import { renderLanes } from './views/lanes-view';
import { renderEquipment } from './views/equipment-view';
import { renderSim } from './views/sim-view';
import { renderMatches } from './views/matches-view';
import { renderSettings } from './views/settings-view';

export type Route = 'patterns' | 'lanes' | 'equipment' | 'sim' | 'matches' | 'settings';

const NAV: Array<{ route: Route; label: string; icon: string }> = [
  { route: 'patterns', label: '油型库', icon: '🛢' },
  { route: 'lanes', label: '球道档案', icon: '🛣' },
  { route: 'equipment', label: '球与打法', icon: '🎳' },
  { route: 'sim', label: '油面推演', icon: '📈' },
  { route: 'matches', label: '比赛跟踪', icon: '🏁' },
  { route: 'settings', label: '设置', icon: '⚙️' },
];

function parseHash(): Route {
  const r = location.hash.replace(/^#\/?/, '') as Route;
  return NAV.some((n) => n.route === r) ? r : 'sim';
}

export function startRouter(container: HTMLElement): void {
  const render = () => {
    const route = parseHash();
    const nav = h(
      'nav.side-nav',
      NAV.map((n) =>
        h(
          `a.nav-item${n.route === route ? '.active' : ''}`,
          { href: `#/${n.route}` },
          [h('span.nav-icon', [n.icon]), h('span.nav-label', [n.label])],
        ),
      ),
    );
    const view = renderRoute(route);
    mount(container, h('div.app-shell', [nav, h('main.viewport', [view])]));
  };
  window.addEventListener('hashchange', render);
  render();
}

function renderRoute(route: Route): HTMLElement {
  switch (route) {
    case 'patterns':
      return renderPatterns();
    case 'lanes':
      return renderLanes();
    case 'equipment':
      return renderEquipment();
    case 'sim':
      return renderSim();
    case 'matches':
      return renderMatches();
    case 'settings':
      return renderSettings();
  }
}
