/** 设置页面：物理参数、重新过油阈值、渲染、数据管理与 GPU 能力检测 */
import { saveSettings } from '../../core/settings';
import { repo, STORES } from '../../db/indexeddb';
import { seedAll } from '../../seed';
import { appStore } from '../app-state';
import { badge, button, card, field, h, labeledSlider, table, toast } from '../dom';
import type { SimSettings } from '../../core/types';

export function renderSettings(): HTMLElement {
  let settings: SimSettings = { ...appStore.getState().settings };

  const gpuInfo = detectGpu();
  const statusHost = h('div', [
    badge(gpuInfo.webgl2 ? 'WebGL2 可用' : 'WebGL2 不可用', gpuInfo.webgl2 ? 'ok' : 'warn'),
    badge(gpuInfo.floatFbo ? '浮点纹理可渲染' : '浮点 FBO 不支持', gpuInfo.floatFbo ? 'ok' : 'warn'),
    h('span.gpu-vendor', [gpuInfo.renderer]),
  ]);

  async function commit(): Promise<void> {
    await saveSettings(settings);
    appStore.setState({ settings: { ...settings } });
    toast('设置已保存并应用于后续推演', 'ok');
  }

  function sliderRow(
    label: string,
    key: keyof SimSettings,
    min: number,
    max: number,
    step: number,
  ): HTMLElement {
    return labeledSlider(
      label, min, max, Number(settings[key]), step,
      (v) => {
        (settings[key] as number) = v;
        void commit();
      },
      (v) => v.toFixed(step < 0.01 ? 3 : 2),
    );
  }

  const physicsCard = card(
    '推演物理参数',
    h('div.stack-col', [
      sliderRow('吸油率（接触带每球吸走比例）', 'absorptionRate', 0.01, 0.2, 0.005),
      sliderRow('后段吐油比例（带油）', 'depositFraction', 0, 0.9, 0.01),
      sliderRow('满油摩擦系数', 'oilyFriction', 0.01, 0.15, 0.005),
      sliderRow('干区摩擦系数', 'dryFriction', 0.08, 0.4, 0.01),
      sliderRow('摩擦半饱和油厚(uL/格)', 'frictionHalfOilUl', 2, 40, 1),
      sliderRow('勾球强度增益', 'hookGain', 0.4, 1.8, 0.05),
      sliderRow('地形侧坡增益', 'topographyGain', 0, 3, 0.1),
      sliderRow('重新过油阈值（中段剩余油）', 'reoilThreshold', 0.1, 0.6, 0.01),
    ]),
  );

  // 数据统计
  const s = appStore.getState();
  const dataCard = card(
    '数据管理（IndexedDB）',
    table(
      ['数据表', '记录数'],
      [
        ['油型', String(s.patterns.length)],
        ['球道', String(s.lanes.length)],
        ['保龄球', String(s.balls.length)],
        ['打法', String(s.styles.length)],
        ['球员', String(s.players.length)],
        ['比赛', String(s.matches.length)],
        ['比赛出手总数', String(s.matches.reduce((n, m) => n + m.shots.length, 0))],
      ],
    ),
    h('div.card-actions', [
      button('♻️ 重置为内置种子数据', () => void reseed(), 'danger'),
      button('🗑 清空全部数据', () => void wipe(), 'danger'),
    ]),
  );

  async function reseed(): Promise<void> {
    if (!confirm('将覆盖现有数据为内置种子（长/短油型、48 道、16 球员、40 局比赛），继续？')) return;
    const result = await seedAll(true);
    toast(`已重置：${result.lanes} 道 / ${result.players} 球员 / ${result.matches} 比赛`, 'ok');
    setTimeout(() => location.reload(), 800);
  }
  async function wipe(): Promise<void> {
    if (!confirm('确认清空 IndexedDB 全部数据？此操作不可恢复。')) return;
    await Promise.all(Object.values(STORES).map((st) => repo.clear(st as never)));
    toast('已清空，刷新后可重新播种', 'info');
    setTimeout(() => location.reload(), 800);
  }

  return h('div.page.settings-page', [
    h('div.page-head', [h('h1', '设置'), h('p.page-desc', '物理参数实时影响 CPU/GPU 推演；数据持久化在浏览器 IndexedDB')]),
    card('GPU 能力检测', statusHost),
    physicsCard,
    dataCard,
    field('', h('span', ['提示：调整吸油率/吐油比例后，回到油面推演页重新运行即可看到误差与油面变化。'])),
  ]);
}

function detectGpu(): { webgl2: boolean; floatFbo: boolean; renderer: string } {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false, floatFbo: false, renderer: '当前浏览器/设备不支持 WebGL2' };
    const ext = gl.getExtension('EXT_color_buffer_float');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER) || 'Unknown GPU');
    return { webgl2: true, floatFbo: !!ext, renderer };
  } catch (err) {
    return { webgl2: false, floatFbo: false, renderer: (err as Error).message };
  }
}
