import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
            data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
            width: w,
            height: h,
          });
        return (..._args: unknown[]) => undefined;
      },
      set() {
        return true;
      },
    },
  );
}

type Harness = {
  listeners: Map<string, Array<(e: any) => void>>;
  rafQueue: Array<() => void>;
};

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
        if (prop === 'querySelector')
          return (sel: string) => (sel === 'canvas' ? (globalThis as any).canvas : null);
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
  g.HTMLImageElement = class HTMLImageElement {};
  g.HTMLCanvasElement = class HTMLCanvasElement {};
  g.Automerge = { getActorId: () => 'actor-test' };
}

// Regression test for the "Livelymerge gc: missing referent ... '@topLeft'" damage:
// LineMorph.moveBy used to mutate the cached this.bounds rect in place (Morph.moveBy
// writes a fresh topLeft Point into the doc-resident rect) and then replace it via
// syncBoundsFromGeometry — orphaning the just-mutated rect, so end-of-transaction GC
// swept the fresh Point and baked a permanently dangling @topLeft ref into the
// document, one per drag frame. Fixed by making syncBoundsFromGeometry update the
// cached rect in place.
describe('LineMorph drag document integrity', () => {
  it('dragging a line with hover handles bakes no dangling refs and swallows no exceptions', () => {
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
    const docHandle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(docHandle);
    const g = globalThis as any;
    g.handle = docHandle;
    g.runtime = rt;
    const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');

    // Exceptions during submorph event dispatch are swallowed by the debug catch in
    // eachSubmorph ("boom! ..."); capture them so this test can assert none fire.
    const booms: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      const s = args.map(String).join(' ');
      if (s.includes('boom!')) booms.push(s);
      origLog(...args);
    };

    rt.eval(src);
    rt.eval(`
initUI();
initLively();
Lively.box = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
let boxB = Lively.box.getBounds();
let lineY = 330;
let plmVerts = [pt(boxB.topLeft.x, lineY), pt(boxB.topLeft.x + boxB.width(), lineY)];
Lively.demoLine = Lively.addMorph(
  new LineMorph(plmVerts, { borderWidth: 2, borderColor: Color.black, arrowheads: 'end' }),
);
Lively.demoLine.startHandleStepping();
`);

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

    const dispatch = (type: string, x: number, y: number) => {
      const fns = harness.listeners.get(type) ?? [];
      for (const fn of fns) fn(makeNativeEvt(type, x, y));
    };

    const runFrame = () => {
      const cb = harness.rafQueue.shift();
      if (!cb) throw new Error('no rAF scheduled');
      cb();
    };

    const audit = (label: string) => {
      const dangling = (rt as any).findDanglingRefs();
      console.log(`audit[${label}]: ${dangling.length} dangling`);
      if (dangling.length) console.log(dangling.join('\n'));
      return dangling.length;
    };

    runFrame();
    runFrame();
    audit('idle');

    // hover over the line (no button) to trigger hover handles
    dispatch('pointermove', 60, 330);
    runFrame();
    runFrame();
    audit('hover over line');

    // drag the line from its middle
    dispatch('pointerdown', 60, 330);
    runFrame();
    for (let i = 1; i <= 10; i++) {
      dispatch('pointermove', 60 + i * 3, 330 + i * 2);
      runFrame();
    }
    dispatch('pointerup', 90, 350);
    runFrame();
    runFrame();
    const n = audit('after line drag');

    // --- Simulate a reload: fresh runtime on the same (damaged) doc, then drag again
    // and capture live "missing referent" warnings like the user sees in the console.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const s = args.map(String).join(' ');
      if (s.includes('missing referent')) warnings.push(s);
      else origWarn(...args);
    };
    try {
      const harness2: Harness = { listeners: new Map(), rafQueue: [] };
      installBrowserStubs(harness2);
      const handle2 = roundTripDocHandle(docHandle as any);
      const rt2 = createLivelymergeRuntime(handle2 as any);
      g.handle = handle2;
      g.runtime = rt2;
      rt2.eval(`initUI()`);
      const dispatch2 = (type: string, x: number, y: number) => {
        for (const fn of harness2.listeners.get(type) ?? []) fn(makeNativeEvt(type, x, y));
      };
      const runFrame2 = () => {
        const cb = harness2.rafQueue.shift();
        if (!cb) throw new Error('no rAF scheduled');
        cb();
      };
      runFrame2();
      runFrame2();
      console.log(`warnings after reload idle frames: ${warnings.length}`);
      const lineY2 = rt2.eval(`Lively.demoLine.getBounds().center().y`) as number;
      const lineX2 = rt2.eval(`Lively.demoLine.getBounds().center().x`) as number;
      dispatch2('pointerdown', lineX2, lineY2);
      runFrame2();
      for (let i = 1; i <= 10; i++) {
        dispatch2('pointermove', lineX2 + i * 3, lineY2 + i * 2);
        runFrame2();
      }
      dispatch2('pointerup', lineX2 + 30, lineY2 + 20);
      runFrame2();
      console.log(`warnings after reload + drag: ${warnings.length}`);
      for (const w of warnings.slice(0, 8)) console.log(w);
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }

    // No dangling refs baked into the document by the drag...
    expect(n).toBe(0);
    // ...no missing-referent warnings after a reload of the same doc...
    expect(warnings).toEqual([]);
    // ...and no exceptions swallowed during submorph event dispatch (e.g. the
    // pt-shadowing TypeError in insertVertexOnSegment).
    expect(booms).toEqual([]);
  }, 240_000);
});
