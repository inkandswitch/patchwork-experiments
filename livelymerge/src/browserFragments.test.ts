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

  it('ctrl-S in the method pane installs the fragment via replaceMethod', async () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); Lively.addMorph(new BrowserPanel());`);
    rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Rectangle');
  browser.messagePane.contentPane.actionFn('bottom');
  let tb = browser.methodPane.contentPane.shape;
  $global._saveBefore = tb.string.slice(0, 9);
  tb.string = 'bottom() { return -1; }';
  tb.handleKeyboardShortcuts(${keyEvt('s')});
})()
`);
    await new Promise((r) => setTimeout(r, 30));
    const result = rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  let recent = recentChanges.at(-1);
  return 'before=' + $global._saveBefore +
    ' changed=' + rect(0, 0, 3, 4).bottom() +
    ' show=' + Rectangle.prototype.bottom.toString() +
    ' dirty=' + browser.methodPane.hasUnsavedChanges() +
    ' recentSpec=' + recent[0] +
    ' recentIsCall=' + ('' + recent[2]).startsWith("replaceMethod('Rectangle'");
})()
`) as string;
    expect(result).toContain('before=bottom() ');
    expect(result).toContain('changed=-1');
    expect(result).toContain('show=bottom() { return -1; }');
    expect(result).toContain('dirty=false');
    expect(result).toContain('recentSpec=Rectangle.prototype.bottom');
    expect(result).toContain('recentIsCall=true');
  }, 120_000);

  it('saving a getter fragment through the pane replaces only the getter', async () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively(); Lively.addMorph(new BrowserPanel());`);
    rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Morph');
  browser.messagePane.contentPane.actionFn('get transform');
  let tb = browser.methodPane.contentPane.shape;
  tb.string = 'get transform() { return 12345; }';
  tb.handleKeyboardShortcuts(${keyEvt('s')});
})()
`);
    await new Promise((r) => setTimeout(r, 30));
    const result = rt.eval(`
(() => {
  let m = new Morph(rect(0, 0, 10, 10));
  return 'got=' + m.transform +
    ' setterStillThere=' +
    (Object.getOwnPropertyDescriptor(Morph.prototype, 'transform').set != null);
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

  it('the occurrences panel shows fragments bare and saves them via replaceMethod', async () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively();`);
    rt.eval(`
(() => {
  let hits = methodsContaining('bottom');
  let panel = Lively.addMorph(
    new MethodListPanel(null, hits, null, 'Occurrences of "bottom"', 'bottom'),
  );
  panel.methodsPane.contentPane.actionFn('Rectangle.prototype.bottom');
  let tb = panel.printPane.contentPane.shape;
  $global._occSave = { shown: tb.string, copyText: panel.methodCopyText() };
  tb.string = 'bottom() { return -2; }';
  tb.handleKeyboardShortcuts(${keyEvt('s')});
})()
`);
    await new Promise((r) => setTimeout(r, 30));
    const result = rt.eval(`
(() => {
  let p = $global._occSave;
  let recent = recentChanges.at(-1);
  return 'shown=' + ('' + p.shown).slice(0, 9) +
    ' copyIsCall=' + ('' + p.copyText).startsWith("replaceMethod('Rectangle'") +
    ' changed=' + rect(0, 0, 3, 4).bottom() +
    ' recentSpec=' + recent[0] +
    ' recentIsCall=' + ('' + recent[2]).startsWith("replaceMethod('Rectangle'");
})()
`) as string;
    expect(result).toContain('shown=bottom() ');
    expect(result).toContain('copyIsCall=true');
    expect(result).toContain('changed=-2');
    expect(result).toContain('recentSpec=Rectangle.prototype.bottom');
    expect(result).toContain('recentIsCall=true');
  }, 120_000);

  it('the recent-changes panel shows fragment saves bare and re-saves via replaceMethod', async () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively();`);
    rt.eval(`
(() => {
  replaceMethod('Rectangle', 'bottom() { return -3; }');
  noteMethodChanges(replaceMethodCallString('Rectangle', 'bottom() { return -3; }'));
  let panel = browseRecentChanges();
  let spec = recentChanges.at(-1)[0] + recentChanges.at(-1)[1];
  panel.methodsPane.contentPane.actionFn(spec);
  let tb = panel.printPane.contentPane.shape;
  $global._recentShown = tb.string;
  tb.string = 'bottom() { return -4; }';
  tb.handleKeyboardShortcuts(${keyEvt('s')});
})()
`);
    await new Promise((r) => setTimeout(r, 30));
    const result = rt.eval(`
(() => 'shown=' + $global._recentShown + ' changed=' + rect(0, 0, 3, 4).bottom())()
`) as string;
    expect(result).toContain('shown=bottom() { return -3; }');
    expect(result).toContain('changed=-4');
  }, 120_000);

  it('exports fragment members as self-contained replaceMethod calls', () => {
    const { rt } = setup();
    const out = rt.eval(
      `exportStringForSelection('Rectangle', { includeHeader: false, includeClassDef: false })`,
    ) as string;
    expect(out).toContain("replaceMethod('Rectangle', `bottom() {");
    expect(out).not.toContain('Rectangle.prototype.bottom = function');
  }, 120_000);

  it('highlights method panes when the live method diverges from the loaded baseline', async () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively();`);
    const result = rt.eval(`
(() => {
  replaceMethod('Rectangle', 'bottom() { return 1; }');
  let browser = Lively.addEphemeralMorph(new BrowserPanel());
  browser.classPane.contentPane.actionFn('Rectangle');
  browser.messagePane.contentPane.actionFn('bottom');
  let before = !!browser.methodPane.$methodConflictHighlight;
  replaceMethod('Rectangle', 'bottom() { return 99; }');
  browser.tickMethodConflict();
  let conflict = !!browser.methodPane.$methodConflictHighlight;
  browser.methodPane._savedTextSnapshot = liveMethodPaneTextForSpec('Rectangle.prototype.bottom');
  browser.tickMethodConflict();
  let cleared = !!browser.methodPane.$methodConflictHighlight;

  let hits = methodsContaining('bottom');
  let search = Lively.addEphemeralMorph(
    new MethodListPanel(null, hits, null, 'Occurrences of "bottom"', 'bottom'),
  );
  search.methodsPane.contentPane.actionFn('Rectangle.prototype.bottom');
  replaceMethod('Rectangle', 'bottom() { return 7; }');
  search.tickMethodConflict();
  let searchConflict = !!search.printPane.$methodConflictHighlight;

  noteMethodChanges(replaceMethodCallString('Rectangle', 'bottom() { return 7; }'));
  let recent = browseRecentChanges();
  let spec = recentChanges.at(-1)[0] + recentChanges.at(-1)[1];
  recent.methodsPane.contentPane.actionFn(spec);
  let recentWatching = recent.isStepping('tickMethodConflict');

  let meth = new MethodPanel(
    null,
    replaceMethodCallString('Rectangle', 'bottom() { return 7; }'),
    'Rectangle.prototype.bottom',
  );
  Lively.addEphemeralMorph(meth);
  replaceMethod('Rectangle', 'bottom() { return 8; }');
  meth.tickMethodConflict();
  let methodBrowserConflict = !!meth.textPane.$methodConflictHighlight;

  browser.messagePane.contentPane.actionFn('bottom');
  let tb = browser.methodPane.contentPane.shape;
  tb.string = 'bottom() { return -55; }';
  tb.handleKeyboardShortcuts({ key: 's', preventDefault() {}, stopPropagation() {} });
  $global._conflictSaveBrowser = browser;

  return 'before=' + before +
    ' conflict=' + conflict +
    ' cleared=' + cleared +
    ' searchConflict=' + searchConflict +
    ' recentWatching=' + recentWatching +
    ' methodBrowserConflict=' + methodBrowserConflict;
})()
`) as string;
    await new Promise((r) => setTimeout(r, 30));
    const after = rt.eval(`
(() => {
  let browser = $global._conflictSaveBrowser;
  browser.tickMethodConflict();
  return 'saved=' + rect(0, 0, 3, 4).bottom() +
    ' afterSaveConflict=' + !!browser.methodPane.$methodConflictHighlight +
    ' dirty=' + browser.methodPane.hasUnsavedChanges();
})()
`) as string;
    expect(result).toContain('before=false');
    expect(result).toContain('conflict=true');
    expect(result).toContain('cleared=false');
    expect(result).toContain('searchConflict=true');
    expect(result).toContain('recentWatching=false');
    expect(result).toContain('methodBrowserConflict=true');
    expect(after).toContain('saved=-55');
    expect(after).toContain('afterSaveConflict=false');
    expect(after).toContain('dirty=false');
  }, 120_000);

  it('ephemeral system browser ctrl-S installs replaceMethod (production open path)', async () => {
    const { rt } = setup();
    rt.eval(`initUI(); initLively();`);
    rt.eval(`
(() => {
  replaceMethod('Rectangle', 'bottom() { return 1; }');
  let browser = Lively.addEphemeralMorph(new BrowserPanel());
  browser.classPane.contentPane.actionFn('Rectangle');
  browser.messagePane.contentPane.actionFn('bottom');
  let tb = browser.methodPane.contentPane.shape;
  $global._ephFrag = typeof tb.fragmentSaveClassName == 'function' ? tb.fragmentSaveClassName() : null;
  tb.string = 'bottom() { return -123; }';
  tb.handleKeyboardShortcuts({ key: 's', preventDefault() {}, stopPropagation() {} });
})()
`);
    await new Promise((r) => setTimeout(r, 30));
    const result = rt.eval(`
(() => {
  let browser = (Lively.$submorphs || []).find((m) => m.className === 'BrowserPanel');
  browser.tickMethodConflict();
  return 'fragName=' + $global._ephFrag +
    ' changed=' + rect(0, 0, 3, 4).bottom() +
    ' dirty=' + browser.methodPane.hasUnsavedChanges() +
    ' conflict=' + !!browser.methodPane.$methodConflictHighlight;
})()
`) as string;
    expect(result).toContain('fragName=Rectangle');
    expect(result).toContain('changed=-123');
    expect(result).toContain('dirty=false');
    expect(result).toContain('conflict=false');
  }, 120_000);
});
