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
        // any other property read returns a no-op function (covers fillRect, arc, etc.)
        return (..._args: unknown[]) => undefined;
      },
      set() {
        return true;
      },
    },
  );
}

/** Listeners registered by initUI, keyed by event type, so the test can dispatch like the browser. */
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
        // querySelector/getElementById/etc. -> null; other methods -> no-op
        return (..._args: unknown[]) => null;
      },
      set() {
        return true;
      },
    },
  );
  // Capture the rAF callback instead of running it, so the test drives frames deterministically.
  g.requestAnimationFrame = (cb: () => void) => {
    harness.rafQueue.push(cb);
    return harness.rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
}

describe('newdefs full-stack drag', () => {
  it('dragging a morph updates its position through the real browser event pipeline', () => {
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
    const docHandle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(docHandle);
    const g = globalThis as any;
    g.handle = docHandle;
    g.runtime = rt;
    const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');

    // Load all class/function defs into the heap/global.
    rt.eval(src);

    // Build a minimal world with one draggable box (skip heavy populateLively).
    rt.eval(`
initUI();
initLively();
Lively.testBox = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
`);

    const startX = rt.eval(`Lively.testBox.getBounds().topLeft.x`);
    const startY = rt.eval(`Lively.testBox.getBounds().topLeft.y`);

    // Native (non-heap) DOM-event-like object, exactly as the browser delivers it.
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

    // Dispatch an event through the *real* listener (which pushes to the heap-backed canvasEvents queue).
    const dispatch = (type: string, x: number, y: number) => {
      const fns = harness.listeners.get(type) ?? [];
      expect(fns.length).toBeGreaterThan(0);
      for (const fn of fns) fn(makeNativeEvt(type, x, y));
    };

    // Run one animation frame (onFrame -> runtime.change -> processEvents -> render).
    let frameError: unknown = null;
    const origConsoleError = console.error;
    const runFrame = () => {
      const cb = harness.rafQueue.shift();
      if (!cb) throw new Error('no rAF scheduled');
      // onFrame swallows errors via handleRuntimeError; capture them so the test can assert.
      console.error = (...args: unknown[]) => {
        frameError = frameError ?? args.find((a) => a instanceof Error) ?? args[0];
        origConsoleError(...args);
      };
      try {
        cb();
      } finally {
        console.error = origConsoleError;
      }
    };

    // Drag: pointer down inside the box (bounds x:30..90 y:20..50), then move by (+20,+20), then up.
    dispatch('pointerdown', 50, 30);
    runFrame();
    dispatch('pointermove', 70, 50);
    runFrame();
    dispatch('pointerup', 70, 50);
    runFrame();

    const endX = rt.eval(`Lively.testBox.getBounds().topLeft.x`);
    const endY = rt.eval(`Lively.testBox.getBounds().topLeft.y`);

    expect(frameError, `frame loop threw: ${String((frameError as any)?.stack ?? frameError)}`).toBeNull();
    expect(endX).toBeCloseTo(startX + 20, 6);
    expect(endY).toBeCloseTo(startY + 20, 6);
  }, 60_000);
});
