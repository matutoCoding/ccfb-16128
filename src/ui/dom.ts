/**  hyperscript DOM 构建助手与通用组件 */

export type Attrs = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  on?: Record<string, EventListenerOrEventListenerObject>;
};

/** h('div.class', {attrs}, children) / h('div', children) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | string,
  attrs?: Attrs | Node | string | Array<Node | string | null | false | undefined>,
  children?: Array<Node | string | null | false | undefined>,
): HTMLElement {
  let tagName = tag as string;
  let cls = '';
  if (tagName.includes('.')) {
    const parts = tagName.split('.');
    tagName = parts[0];
    cls = parts.slice(1).join(' ');
  }
  const el = document.createElement(tagName);
  if (cls) el.className = cls;

  let attrObj: Attrs | undefined;
  let kids: Array<Node | string | null | false | undefined> | undefined;
  if (attrs instanceof Node || typeof attrs === 'string' || Array.isArray(attrs)) {
    kids = attrs as Array<Node | string>;
  } else {
    attrObj = attrs as Attrs | undefined;
    kids = children;
  }

  if (attrObj) {
    for (const [k, v] of Object.entries(attrObj)) {
      if (k === 'class') el.className = [cls, String(v)].filter(Boolean).join(' ');
      else if (k === 'style') applyStyle(el, v as Attrs['style']);
      else if (k === 'on' && v && typeof v === 'object') {
        for (const [evt, fn] of Object.entries(v)) {
          el.addEventListener(evt, fn as EventListener);
        }
      } else if (k.startsWith('data-') || k === 'for' || k === 'role' || k === 'title') {
        el.setAttribute(k, String(v));
      } else if (k in el) {
        try {
          (el as unknown as Record<string, unknown>)[k] = v;
        } catch {
          el.setAttribute(k, String(v));
        }
      } else if (v !== null && v !== undefined) {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendKids(el, kids);
  return el;
}

function applyStyle(el: HTMLElement, style: Attrs['style']): void {
  if (!style) return;
  if (typeof style === 'string') el.style.cssText = style;
  else Object.assign(el.style, style);
}

function appendKids(
  el: HTMLElement,
  kids?: Array<Node | string | null | false | undefined>,
): void {
  if (!kids) return;
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(parent: HTMLElement, ...nodes: Node[]): void {
  clear(parent);
  parent.append(...nodes);
}

/** 卡片容器 */
export function card(title: string, body: Node, extra?: Node): HTMLElement {
  return h('section.card', [
    h('header.card-head', [h('h2', title), extra ?? '']),
    h('div.card-body', [body]),
  ]);
}

/** 标签 + 控件行 */
export function field(label: string, control: Node, hint?: string): HTMLElement {
  return h('label.field', [
    h('span.field-label', label),
    control,
    hint ? h('span.field-hint', hint) : '',
  ]);
}

export function slider(
  min: number,
  max: number,
  value: number,
  step: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
  }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(Number(input.value)));
  return input;
}

export function select<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const sel = h('select') as HTMLSelectElement;
  for (const o of options) {
    const opt = h('option', { value: o.value }, [o.label]) as HTMLOptionElement;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

export function numberInput(value: number, onChange: (v: number) => void): HTMLInputElement {
  const input = h('input', { type: 'number', value }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (!Number.isNaN(n)) onChange(n);
  });
  return input;
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  const btn = h(`button.btn.${kind}`, [label]) as HTMLButtonElement;
  btn.addEventListener('click', onClick);
  return btn;
}

export function badge(text: string, tone: 'ok' | 'warn' | 'info' = 'info'): HTMLElement {
  return h(`span.badge.${tone}`, [text]);
}

/** 轻提示 */
export function toast(message: string, tone: 'ok' | 'err' | 'info' = 'info'): void {
  const el = h(`div.toast.${tone}`, [message]);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

/** 简易表格 */
export function table(headers: string[], rows: (string | Node)[][]): HTMLElement {
  return h('table.data-table', [
    h('thead', [h('tr', headers.map((hd) => h('th', [hd])))]),
    h(
      'tbody',
      rows.map((row) => h('tr', row.map((cell) => h('td', [cell])))),
    ),
  ]);
}

/** 带数值气泡的滑条 */
export function labeledSlider(
  label: string,
  min: number,
  max: number,
  value: number,
  step: number,
  onInput: (v: number) => void,
  fmt: (v: number) => string = String,
): HTMLElement {
  const val = h('span.slider-value', [fmt(value)]);
  const input = slider(min, max, value, step, (v) => {
    val.textContent = fmt(v);
    onInput(v);
  });
  return h('div.slider-row', [h('span.slider-label', [label]), input, val]);
}
