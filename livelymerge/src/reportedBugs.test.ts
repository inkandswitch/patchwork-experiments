/**
 * Regression tests for a batch of user-reported bugs (July 2026):
 *  1. Op count grew every second while idle (LineMorph hover handles were persistent
 *     and re-assigned fresh arrays every 200ms step).
 *  2. Panels could not be dragged and lost their title bar / close button
 *     (contentMorphs() mutated submorphs; beTopMorph referenced dead `w`;
 *     Automerge's mutable list proxy mishandles negative at() indices).
 *  3. The class browser crashed on open (`w` was referenced but never defined) and
 *     on class selection (regex-based this-rewrite corrupted a string literal).
 *  4. ErrorStackPanel crashed with "cannot store a Livelymerge object inside a plain
 *     JS value" (captured `let xs = []` declarations lost their $arr wrap).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Automerge from '@automerge/automerge';
import { createAutomergeTestDocHandle, roundTripDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'canvas') return (globalThis as any).canvas;
        if (prop === 'getImageData')
          return (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(4, w * h * 4)),
          });
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
  // populateLively's EmojiMorph path needs these host classes to exist.
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
  rt.eval(src);
  return { harness, handle, rt };
}

function opsDuring(handle: any, act: () => void): { count: number; keys: string[] } {
  const headsBefore = Automerge.getHeads(handle.doc() as any);
  act();
  const changes = Automerge.getChanges(
    Automerge.view(handle.doc() as any, headsBefore) as any,
    handle.doc() as any,
  );
  let count = 0;
  const keys: string[] = [];
  for (const ch of changes) {
    const dec = Automerge.decodeChange(ch);
    count += dec.ops.length;
    for (const op of dec.ops as any[]) {
      keys.push(
        `${op.action} key=${String(op.key ?? op.elemId ?? '?')} val=${JSON.stringify(op.value ?? '')}`.slice(0, 110),
      );
    }
  }
  return { count, keys };
}

const makeNativeEvt = (type: string, x: number, y: number) => ({
  type,
  button: 0,
  buttons: type === 'pointerup' ? 0 : 1,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  pointerId: 1,
  pointerType: 'mouse',
  offsetX: x,
  offsetY: y,
  clientX: x,
  clientY: y,
  preventDefault() {},
  stopPropagation() {},
});

describe('idle op growth (LineMorph hover-handle stepping)', () => {
  it('repeated stepHoverHandles with no pointer generates no ops', () => {
    const { handle, rt } = setup();
    rt.eval(`
initUI();
initLively();
Lively.demoLine = Lively.addMorph(
  new LineMorph([pt(30, 300), pt(90, 300)], { borderWidth: 2, borderColor: Color.black, arrowheads: 'end' }),
);
`);
    // settle: the first step may create one-time keys
    rt.eval(`Lively.demoLine.stepHoverHandles()`);
    const second = opsDuring(handle, () => rt.eval(`Lively.demoLine.stepHoverHandles()`));
    const third = opsDuring(handle, () => rt.eval(`Lively.demoLine.stepHoverHandles()`));
    expect(second.count, `2nd step ops:\n  ${second.keys.join('\n  ')}`).toBe(0);
    expect(third.count, `3rd step ops:\n  ${third.keys.join('\n  ')}`).toBe(0);
  }, 120_000);
});

describe('panel chrome and dragging', () => {
  it('a panel has a title bar with title text and close button, and contentMorphs() does not destroy it', () => {
    const { rt } = setup();
    rt.eval(`
initUI();
initLively();
Lively.panel = Lively.addMorph(new MethodPanel(rect(100, 100, 300, 200), 'hello world', 'My Title'));
Lively.panel.contentMorphs(); // must not mutate submorphs
`);
    const info = rt.eval(`
'hasTitleBar=' + Lively.panel.submorphs.includes(Lively.panel.titleBar) +
' titleString=' + Lively.panel.titleBar.titleMorph.shape.string +
' hasClose=' + Lively.panel.titleBar.hasVisibleCloseBtn()
`);
    expect(info).toContain('hasTitleBar=true');
    expect(info).toContain('titleString=My Title');
    expect(info).toContain('hasClose=true');
  }, 120_000);

  it('after full init(), the welcome panel can be raised and dragged by its title bar', () => {
    const { harness, rt } = setup();
    rt.eval(`init()`);

    const dispatch = (type: string, x: number, y: number) => {
      for (const fn of harness.listeners.get(type) ?? []) fn(makeNativeEvt(type, x, y));
    };
    const runFrame = () => {
      const cb = harness.rafQueue.shift();
      if (!cb) throw new Error('no rAF scheduled');
      cb();
    };
    runFrame();
    runFrame();

    rt.eval(`Lively.thePanel = Lively.submorphs.find((m) => m.className === 'MethodPanel')`);
    const dragPanelBy = (dx: number, dy: number) => {
      const topLeft = rt.eval(
        `Lively.thePanel.getBounds().topLeft.x + ',' + Lively.thePanel.getBounds().topLeft.y`,
      ) as string;
      const [px, py] = topLeft.split(',').map(Number);
      dispatch('pointerdown', px + 150, py + 12); // middle of the title bar
      runFrame();
      dispatch('pointermove', px + 150 + dx, py + 12 + dy);
      runFrame();
      dispatch('pointerup', px + 150 + dx, py + 12 + dy);
      runFrame();
      return px;
    };
    // First press raises the buried panel; the second press drags it.
    dragPanelBy(0, 0);
    expect(rt.eval(`Lively.submorphs.at(-1) === Lively.thePanel`)).toBe(true);
    const beforeX = dragPanelBy(40, 30);
    const afterX = rt.eval(`Lively.thePanel.getBounds().topLeft.x`);
    expect(afterX).toBeCloseTo(beforeX + 40, 6);
  }, 120_000);
});

describe('class browser', () => {
  it('opens, lists classes/methods, and shows method source', () => {
    const { rt } = setup();
    rt.eval(`
initUI();
initLively();
Lively.addMorph(new BrowserPanel());
`);
    const info = rt.eval(`
(() => {
  let names = allClassNames();
  let statics = classStaticNames(Morph);
  return 'hasMorph=' + names.includes('Morph') +
    ' morphHasMoveBy=' + classInstanceMemberNames(Morph).includes('moveBy') +
    ' staticsHasNew=' + statics.includes('new') +
    ' staticsHasMoveBy=' + statics.includes('moveBy') +
    ' specWorks=' + (methodFromSpec('Morph.prototype.moveBy') === Morph.prototype.moveBy) +
    ' globalSpecWorks=' + (methodFromSpec('rect') === rect);
})()
`) as string;
    expect(info).toContain('hasMorph=true');
    expect(info).toContain('morphHasMoveBy=true');
    expect(info).toContain('staticsHasNew=true');
    expect(info).toContain('staticsHasMoveBy=false');
    expect(info).toContain('specWorks=true');
    expect(info).toContain('globalSpecWorks=true');

    // Drive the actual panes: select a class, then a method, and check the source pane.
    const browse = rt.eval(`
(() => {
  let browser = Lively.submorphs.find((m) => m.className === 'BrowserPanel');
  browser.classPane.contentPane.actionFn('Morph');
  let msgListOk = browser.messagePane.contentPane.itemList.includes('moveBy');
  browser.messagePane.contentPane.actionFn('moveBy');
  let src = browser.methodPane.contentPane.shape.string;
  return 'msgListOk=' + msgListOk + ' srcStartsWith=' + src.slice(0, 40);
})()
`) as string;
    expect(browse).toContain('msgListOk=true');
    expect(browse).toContain('Morph.prototype.moveBy = ');
  }, 120_000);

  it('methods named after reserved words (Map.delete, Class.new) are callable', () => {
    const { rt } = setup();
    expect(
      rt.eval(`
(() => {
  let m = new Map();
  m.set('a', 1);
  m.set('b', 2);
  m.delete('a');
  return m.get('a') === undefined && m.get('b') === 2;
})()
`),
    ).toBe(true);
  }, 120_000);
});

describe('error stack panel', () => {
  it('stackFramesFromError returns an LM array and the panel opens for a browser-shaped stack', () => {
    const { rt } = setup();
    rt.eval(`
initUI();
initLively();
`);
    const fakeErr = `({
  name: 'TypeError',
  message: 'Cannot convert undefined or null to object',
  stack: 'TypeError: Cannot convert undefined or null to object\\n' +
    '    at Object.getOwnPropertyNames (<anonymous>)\\n' +
    '    at $Object.getOwnPropertyNames (/Livelymerge-test.js:27412)\\n' +
    '    at Proxy.eval (/Livelymerge-test.js:27499:17)\\n' +
    '    at Object.apply (/Livelymerge-test.js:27213:21)\\n' +
    '    at Proxy.initClassPane (/Livelymerge-test.js:27499:17)\\n' +
    '    at Proxy.BrowserPanel (/Livelymerge-test.js:27499:17)\\n',
})`;
    expect(rt.eval(`Array.isArray(stackFramesFromError(${fakeErr}))`)).toBe(true);
    expect(() => rt.eval(`openErrorStackPanel(${fakeErr}, 'test context')`)).not.toThrow();
  }, 120_000);

  it('handleRuntimeError presents a real host error and survives promotion', () => {
    const { rt } = setup();
    rt.eval(`
initUI();
initLively();
`);
    // Full path: handleRuntimeError -> presentError -> ErrorStackPanel. Covers the
    // raw-Error-stays-per-replica rule and the disabled ensureAlldefsSourceLines guard.
    expect(() =>
      rt.eval(`
(() => {
  try { null.foo; } catch (e) { handleRuntimeError(e, 'probe context'); }
})()
`),
    ).not.toThrow();
    expect(rt.eval(`!!Lively.submorphs.find((m) => m.className === 'ErrorStackPanel')`)).toBe(true);
  }, 120_000);
});

describe('document integrity', () => {
  it('an object held only by raw JS is resurrected when stored back into the heap', () => {
    const { handle, rt } = setup();
    // The object is reachable only through a raw window side-table, which the GC
    // cannot see — so its heap entry is swept at the end of the transaction.
    rt.eval(`hub = {}`);
    rt.eval(`window._probeStash = { marker: 42 }`);
    rt.eval(`1 + 1`); // idle transaction: the stashed object's entry is collected
    // Storing the stale proxy back into the persistent heap must resurrect the
    // entry, not bake a dangling ref into the document.
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const s = args.map(String).join(' ');
      if (s.includes('missing referent')) warns.push(s);
      else origWarn(...args);
    };
    try {
      rt.eval(`hub.later = window._probeStash`);
      rt.eval(`1 + 1`);
    } finally {
      console.warn = origWarn;
    }
    expect(warns).toEqual([]);
    expect(rt.eval(`hub.later.marker`)).toBe(42);
    expect(rt.findDanglingRefs()).toEqual([]);
    // and it survives a reload
    const rt2 = createLivelymergeRuntime(roundTripDocHandle(handle as any));
    expect(rt2.eval(`hub.later.marker`)).toBe(42);
  }, 120_000);

  it('a fresh session bakes no dangling refs into the document', () => {
    const { harness, handle, rt } = setup();
    rt.eval(`init()`);
    const dispatch = (type: string, x: number, y: number) => {
      for (const fn of harness.listeners.get(type) ?? []) fn(makeNativeEvt(type, x, y));
    };
    const runFrame = () => {
      const cb = harness.rafQueue.shift();
      if (cb) cb();
    };
    for (let i = 0; i < 4; i++) runFrame();
    dispatch('pointerdown', 50, 30);
    runFrame();
    dispatch('pointermove', 120, 90);
    runFrame();
    dispatch('pointerup', 120, 90);
    runFrame();
    rt.eval(`Lively.addMorph(new BrowserPanel())`);
    for (let i = 0; i < 4; i++) runFrame();

    // Every ref stored anywhere in the document must resolve within the document
    // (post-reload, the shadow table is empty, so an unresolved ref would surface
    // as a "Livelymerge gc: missing referent" warning).
    const table = (handle.doc() as any).objectTable;
    const ids = new Set(Object.keys(table));
    const missing: string[] = [];
    const lookAt = (v: any, where: string) => {
      if (v && typeof v === 'object' && v.$type === 'ref' && !ids.has(v.$id)) {
        missing.push(`${v.$id} <- ${where}`);
      }
    };
    for (const [id, entry] of Object.entries<any>(table)) {
      if (entry.$type === 'obj' || entry.$type === 'fun') {
        for (const k of Object.keys(entry)) {
          if (k.startsWith('@')) lookAt(entry[k], `${entry.$type} ${id} prop ${k}`);
        }
      }
      if (entry.$type === 'obj' && entry.$protoId && !ids.has(entry.$protoId)) {
        missing.push(`${entry.$protoId} <- obj ${id} $protoId`);
      }
      if (entry.$type === 'arr') {
        entry.$values.forEach((v: any, i: number) => lookAt(v, `arr ${id}[${i}]`));
      }
      if (entry.$type === 'fun') {
        (entry.$scopes || []).forEach((v: any, i: number) => lookAt(v, `fun ${id} scope[${i}]`));
        if (entry.$prototypeId && !ids.has(entry.$prototypeId)) {
          missing.push(`${entry.$prototypeId} <- fun ${id} $prototypeId`);
        }
      }
    }
    expect(missing, `dangling refs:\n  ${missing.slice(0, 10).join('\n  ')}`).toEqual([]);
  }, 120_000);
});
