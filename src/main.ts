import './styles.css';
import { loadAppState, appStore } from './ui/app-state';
import { startRouter } from './ui/router';
import { seedAll } from './seed';
import { h } from './ui/dom';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app')!;
  root.append(h('div.boot-splash', [h('div.spinner'), h('p', '正在初始化球道油面推演系统…')]));

  try {
    const seed = await seedAll(false);
    await loadAppState();
    root.replaceChildren();
    // 首次播种提示
    if (seed.patterns > 0) {
      console.info('[seed] 数据就绪', seed);
    }
    if (!appStore.getState().ready) throw new Error('状态装载失败');
    if (location.hash === '') location.hash = '#/sim';
    startRouter(root);
  } catch (err) {
    root.replaceChildren();
    root.append(
      h('div.boot-error', [
        h('h2', '启动失败'),
        h('pre', [(err as Error).message]),
        h('p', '请确认浏览器支持 WebGL2 与 IndexedDB（推荐最新版 Chrome/Edge）。'),
      ]),
    );
  }
}

void bootstrap();
