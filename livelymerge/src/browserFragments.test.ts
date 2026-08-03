/**
 * System browser × class fragments: the method pane shows class fragments
 * (`moveBy(delta) {...}`, `get transform() {...}`, `constructor(...) {...}`) with
 * super-sends intact, and ctrl-S installs them via replaceMethod. Accessors get
 * their own 'get foo' / 'set foo' rows, backed by $Object.getOwnPropertyDescriptor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'canvas') return (globalThis as any).canvas;
        return (..._args: unknown[]) => undefined;
      },
      set() {
        return true;
      },
    },
  );
}

type Harness = { listeners: Map<string, Array<(e: any) => void>>; rafQueue: Array<() => void> };

function installBrowserStubs(harness: Harness) {
  const ctx = makeCtxStub();
  const canvas: any = {
    width: 800,
    height: 600,
    style: {},
    tabIndex: 0,
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    addEventListener: (type: string, fn: (e: any) => void) => {
      const arr = harness.listeners.get(type) ?? [];
      arr.push(fn);
      harness.listeners.set(type, arr);
    },
    removeEventListener: () => {},
  };
  const g = globalThis as any;
  g.window = globalThis;
  g.canvas = canvas;
  g.ctx = ctx;
  const elementStub = () => ({
    getContext: () => ctx,
    style: {},
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  });
  g.document = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'createElement') return () => elementStub();
        if (prop === 'body' || prop === 'documentElement') return elementStub();
        if (prop === 'querySelector') return (sel: string) => (sel === 'canvas' ? canvas : null);
        return (..._args: unknown[]) => null;
      },
      set() {
        return true;
      },
    },
  );
  g.requestAnimationFrame = (cb: () => void) => {
    harness.rafQueue.push(cb);
    return harness.rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
  g.HTMLImageElement = class HTMLImageElement {};
  g.HTMLCanvasElement = class HTMLCanvasElement {};
  g.Image = class Image {
    width = 0;
    height = 0;
    set src(_v: string) {}
  };
  g.OffscreenCanvas = class OffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return makeCtxStub();
    }
  };
}

function setup() {
  const harness: Harness = { listeners: new Map(), rafQueue: [] };
  installBrowserStubs(harness);
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
  rt.eval(src.replace(/\binit\(\)\s*$/, ''));
  return { harness, handle, rt };
}

const keyEvt = (key: string) => `{ key: '${key}', preventDefault() {}, stopPropagation() {} }`;

describe('system browser class fragments', () => {
  it('lists accessor halves as "get foo" / "set foo" rows next to the member name', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); Lively.addMorph(new BrowserPanel());`);
    const info = rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Morph');
  let list = browser.messagePane.contentPane.itemList;
  return 'first=' + list[0] +
    ' hasGet=' + list.includes('get transform') +
    ' hasSet=' + list.includes('set transform') +
    ' noPlainRow=' + !list.includes('transform');
})()
`) as string;
    expect(info).toContain('first=constructor');
    expect(info).toContain('hasGet=true');
    expect(info).toContain('hasSet=true');
    expect(info).toContain('noPlainRow=true');
  }, 120_000);

  it('shows getter, constructor, and method fragments in the method pane', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); Lively.addMorph(new BrowserPanel());`);
    const info = rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Morph');
  let out = [];
  browser.messagePane.contentPane.actionFn('get transform');
  out.push(browser.methodPane.contentPane.shape.string.slice(0, 20));
  browser.messagePane.contentPane.actionFn('constructor');
  out.push(browser.methodPane.contentPane.shape.string.slice(0, 20));
  return out.join('|');
})()
`) as string;
    const [getterText, ctorText] = info.split('|');
    expect(getterText).toMatch(/^get transform\(\)/);
    expect(ctorText).toMatch(/^constructor\(/);
  }, 120_000);

  it('ctrl-S in the method pane installs the fragment via replaceMethod', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); Lively.addMorph(new BrowserPanel());`);
    const result = rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Rectangle');
  browser.messagePane.contentPane.actionFn('bottom');
  let tb = browser.methodPane.contentPane.shape;
  let before = tb.string;
  tb.string = 'bottom() { return -1; }';
  tb.handleKeyboardShortcuts(${keyEvt('s')});
  let changed = rect(0, 0, 3, 4).bottom();
  let show = Rectangle.prototype.bottom.toString();
  let recent = recentChanges.at(-1);
  return 'before=' + before.slice(0, 9) + ' changed=' + changed + ' show=' + show +
    ' recentSpec=' + recent[0] +
    ' recentIsCall=' + ('' + recent[2]).startsWith("replaceMethod('Rectangle'");
})()
`) as string;
    expect(result).toContain('before=bottom() ');
    expect(result).toContain('changed=-1');
    expect(result).toContain('show=bottom() { return -1; }');
    expect(result).toContain('recentSpec=Rectangle.prototype.bottom');
    expect(result).toContain('recentIsCall=true');
  }, 120_000);

  it('saving a getter fragment through the pane replaces only the getter', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); Lively.addMorph(new BrowserPanel());`);
    const result = rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Morph');
  browser.messagePane.contentPane.actionFn('get transform');
  let tb = browser.methodPane.contentPane.shape;
  let original = tb.string;
  tb.string = 'get transform() { return 12345; }';
  tb.handleKeyboardShortcuts(${keyEvt('s')});
  let m = new Morph(rect(0, 0, 10, 10));
  let got = m.transform;
  let setterStillThere =
    Object.getOwnPropertyDescriptor(Morph.prototype, 'transform').set != null;
  return 'got=' + got + ' setterStillThere=' + setterStillThere;
})()
`) as string;
    expect(result).toContain('got=12345');
    expect(result).toContain('setterStillThere=true');
  }, 120_000);

  it('a saved method fragment with a super-send displays and works', () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively();`);
    const result = rt.eval(`
(() => {
  replaceMethod('PanelMorph', 'moveBy(delta) { this.$superMoved = true; super.moveBy(delta); }');
  let p = Lively.addMorph(new PanelMorph(rect(10, 10, 100, 100)));
  let before = p.bounds.topLeft.copy();
  p.moveBy(pt(5, 5));
  let show = PanelMorph.prototype.moveBy.toString();
  return 'superMoved=' + p.$superMoved +
    ' moved=' + (p.bounds.topLeft.x - before.x) +
    ' showHasSuper=' + show.includes('super.moveBy(delta)');
})()
`) as string;
    expect(result).toContain('superMoved=true');
    expect(result).toContain('moved=5');
    expect(result).toContain('showHasSuper=true');
  }, 120_000);

  it('deleting one accessor half keeps the other', () => {
    const { rt } = setup();
    const result = rt.eval(`
(() => {
  let ok = deleteMethodWithSpec('Morph.prototype.get transform');
  let desc = Object.getOwnPropertyDescriptor(Morph.prototype, 'transform');
  return 'ok=' + ok + ' getGone=' + (desc.get == null) + ' setKept=' + (desc.set != null);
})()
`) as string;
    expect(result).toContain('ok=true');
    expect(result).toContain('getGone=true');
    expect(result).toContain('setKept=true');
  }, 120_000);

  it('exports fragment members as self-contained replaceMethod calls', () => {
    const { rt } = setup();
    const out = rt.eval(
      `exportStringForSelection('Rectangle', { includeHeader: false, includeClassDef: false })`,
    ) as string;
    expect(out).toContain("replaceMethod('Rectangle', `bottom() {");
    expect(out).not.toContain('Rectangle.prototype.bottom = function');
  }, 120_000);
});
