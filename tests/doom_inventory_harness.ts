/**
 * MINI-DOM PARA TESTES DE INTERFACE DO JOGO (arquivo de apoio, não é suíte)
 * ============================================================================
 * `DoomInventory` monta a interface inteira no construtor: cria elementos,
 * escreve templates com `innerHTML`, consulta com `querySelector` e desenha
 * com um contexto 2D de canvas. Para testar o comportamento do cinto sem um
 * navegador, este arquivo fornece o mínimo de DOM que isso exige.
 *
 * O contexto 2D é um Proxy: qualquer método chamado existe e não faz nada, e
 * qualquer propriedade pode ser lida ou escrita. Assim a placa anatômica e a
 * teiadesenhada no canvas não derrubam o teste.
 */

export interface HarnessEl {
  tagName: string;
  className: string;
  id: string;
  textContent: string;
  title: string;
  value: string;
  style: Record<string, string>;
  attrs: Map<string, string>;
  children: HarnessEl[];
  parent: HarnessEl | null;
  listeners: Map<string, Array<(ev: Record<string, unknown>) => void>>;
  classList: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    toggle: (token: string, force?: boolean) => boolean;
    contains: (token: string) => boolean;
  };
  dataset: Record<string, string>;
  appendChild: (child: HarnessEl) => HarnessEl;
  append: (...nodes: HarnessEl[]) => void;
  remove: () => void;
  querySelector: (selector: string) => HarnessEl | null;
  querySelectorAll: (selector: string) => HarnessEl[];
  addEventListener: (
    type: string,
    cb: (ev: Record<string, unknown>) => void
  ) => void;
  removeEventListener: () => void;
  dispatch: (type: string, extra?: Record<string, unknown>) => void;
  getContext: (kind: string) => unknown;
  innerHTML: string;
  focus: () => void;
  blur: () => void;
  contains: (node: HarnessEl | null) => boolean;
  width: number;
  height: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect: () => {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    right: number;
    bottom: number;
  };
}

const noopCtx = (): unknown =>
  new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, prop: string) => {
        if (prop in target) return target[prop];
        // Buffer de imagem: a teia desenhada no canvas lê os bytes de volta.
        if (prop === 'createImageData' || prop === 'getImageData') {
          return (w: number, h: number) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
          });
        }
        // Toda chamada de desenho vira uma função vazia (fillRect, arc, etc.).
        return () => undefined;
      },
      set: (target: Record<string, unknown>, prop: string, value: unknown) => {
        target[prop] = value;
        return true;
      },
    }
  );

/** `dataset.hubQuick` precisa virar o atributo `data-hub-quick` consultável. */
const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function matches(el: HarnessEl, selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  if (s.startsWith('.')) {
    return el.classList.contains(s.slice(1));
  }
  if (s.startsWith('#')) {
    return el.id === s.slice(1);
  }
  const attrValue = /^\[([a-z0-9-]+)="([^"]*)"\]$/i.exec(s);
  if (attrValue) {
    return el.attrs.get(attrValue[1]) === attrValue[2];
  }
  const attrOnly = /^\[([a-z0-9-]+)\]$/i.exec(s);
  if (attrOnly) {
    return el.attrs.has(attrOnly[1]);
  }
  return el.tagName === s.toUpperCase();
}

/** Extrai do template as tags com classe ou atributo data-*, na ordem. */
function parseTemplate(el: HarnessEl, html: string): void {
  el.children.length = 0;
  const tagRe = /<([a-z0-9]+)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const attrsRaw = match[2] ?? '';
    const attrRe = /([a-z0-9-]+)(?:="([^"]*)")?/gi;
    let hasIdentity = false;
    const dataAttrs: Array<[string, string]> = [];
    let cls = '';
    let id = '';
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrsRaw)) !== null) {
      const name = am[1];
      const value = am[2] ?? '';
      if (name === 'class') {
        cls = value;
        hasIdentity = true;
      } else if (name === 'id') {
        id = value;
        hasIdentity = true;
      } else if (name.startsWith('data-')) {
        dataAttrs.push([name, value]);
        hasIdentity = true;
      }
    }
    if (!hasIdentity) continue;
    const child = makeEl(match[1]);
    if (cls) child.className = cls;
    if (id) child.id = id;
    for (const [name, value] of dataAttrs) {
      child.attrs.set(name, value);
      child.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] =
        value;
    }
    el.appendChild(child);
  }
}

export function makeEl(tag: string): HarnessEl {
  const classes = new Set<string>();
  let html = '';
  const el = {} as HarnessEl;

  el.tagName = tag.toUpperCase();
  el.id = '';
  el.textContent = '';
  el.title = '';
  el.value = '';
  el.style = {};
  el.attrs = new Map<string, string>();
  el.children = [];
  el.parent = null;
  el.listeners = new Map();
  el.dataset = new Proxy({} as Record<string, string>, {
    get: (target: Record<string, string>, prop: string) => target[prop],
    set: (target: Record<string, string>, prop: string, value: string) => {
      target[prop] = value;
      el.attrs.set(`data-${kebab(prop)}`, value);
      return true;
    },
  });
  el.width = 96;
  el.height = 116;
  el.scrollTop = 0;
  el.clientWidth = 1280;
  el.clientHeight = 720;

  Object.defineProperty(el, 'className', {
    get: () => Array.from(classes).join(' '),
    set: (val: string) => {
      classes.clear();
      for (const t of String(val).split(/\s+/).filter(Boolean)) classes.add(t);
    },
  });

  el.classList = {
    add: (...tokens: string[]) => tokens.forEach((t) => classes.add(t)),
    remove: (...tokens: string[]) => tokens.forEach((t) => classes.delete(t)),
    toggle: (token: string, force?: boolean) => {
      const next = force ?? !classes.has(token);
      if (next) classes.add(token);
      else classes.delete(token);
      return next;
    },
    contains: (token: string) => classes.has(token),
  };

  el.appendChild = (child: HarnessEl) => {
    child.parent = el;
    el.children.push(child);
    return child;
  };
  el.append = (...nodes: HarnessEl[]) => {
    for (const n of nodes) el.appendChild(n);
  };
  el.remove = () => {
    if (!el.parent) return;
    const idx = el.parent.children.indexOf(el);
    if (idx >= 0) el.parent.children.splice(idx, 1);
    el.parent = null;
  };
  el.contains = (node: HarnessEl | null) => {
    let cur: HarnessEl | null = node ?? null;
    while (cur) {
      if (cur === el) return true;
      cur = cur.parent;
    }
    return false;
  };

  const visit = (node: HarnessEl, sel: string): HarnessEl | null => {
    if (matches(node, sel)) return node;
    for (const c of node.children) {
      const hit = visit(c, sel);
      if (hit) return hit;
    }
    return null;
  };
  el.querySelector = (selector: string) => {
    for (const sel of selector.split(',')) {
      const hit = visit(el, sel);
      if (hit) return hit;
    }
    return null;
  };
  el.querySelectorAll = (selector: string) => {
    const out: HarnessEl[] = [];
    const sels = selector.split(',').map((s) => s.trim());
    const walk = (node: HarnessEl) => {
      for (const c of node.children) {
        if (sels.some((s) => matches(c, s))) out.push(c);
        walk(c);
      }
    };
    walk(el);
    return out;
  };

  el.addEventListener = (type: string, cb: (ev: Record<string, unknown>) => void) => {
    const arr = el.listeners.get(type) ?? [];
    arr.push(cb);
    el.listeners.set(type, arr);
  };
  el.removeEventListener = () => {};
  el.dispatch = (type: string, extra: Record<string, unknown> = {}) => {
    const ev = {
      type,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...extra,
    };
    for (const cb of [...(el.listeners.get(type) ?? [])]) cb(ev);
  };
  el.getContext = (kind: string) => (kind === '2d' ? noopCtx() : null);
  el.focus = () => {};
  el.blur = () => {};
  el.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
    top: 0,
    left: 0,
    right: 1280,
    bottom: 720,
  });

  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: (val: string) => {
      html = String(val);
      parseTemplate(el, html);
    },
  });

  return el;
}

export interface InventoryHarness {
  viewport: HarnessEl;
  restore: () => void;
}

/**
 * Instala o mini-DOM em `globalThis` e devolve o viewport onde o inventário
 * deve ser montado (mais `restore()` para desfazer a instalação no fim).
 */
export function installInventoryHarness(): InventoryHarness {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;
  const prevPerf = (globalThis as Record<string, unknown>).performance;

  const viewport = makeEl('div');
  viewport.id = 'viewport';
  const body = makeEl('body');
  const docRoot = makeEl('html');
  body.appendChild(viewport);

  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => makeEl(tag),
    getElementById: () => null,
    activeElement: null,
    pointerLockElement: null,
    exitPointerLock: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
    documentElement: docRoot,
    body,
    fullscreenElement: null,
  };

  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    scrollTo: () => {},
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  globalThis.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as unknown as typeof cancelAnimationFrame;
  if (!prevPerf) {
    (globalThis as Record<string, unknown>).performance = { now: () => Date.now() };
  }

  return {
    viewport,
    restore: () => {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCaf;
      if (!prevPerf) delete (globalThis as Record<string, unknown>).performance;
    },
  };
}
