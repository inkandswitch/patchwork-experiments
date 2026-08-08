import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

/**
 * A QBF game running in the real LivelyMerge runtime, with the browser stubbed the same
 * way newdefsDrag.test.ts does it. Shared by qbf.test.ts and the perf probe.
 */

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

export type Harness = {
  listeners: Map<string, Array<(e: any) => void>>;
  rafQueue: Array<() => void>;
};

export function readQBFWordsText() {
  return readFileSync(join(__dirname, '..', 'QBFWords.txt'), 'utf8');
}

function installBrowserStubs(harness: Harness) {
  const ctx = makeCtxStub();
  const canvas: any = {
    width: 1000,
    height: 700,
    style: {},
    tabIndex: 0,
    clientWidth: 1000,
    clientHeight: 700,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
      right: 1000,
      bottom: 700,
    }),
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
    width: 64,
    height: 64,
    getContext: () => ctx,
    style: {},
    setAttribute: () => {},
    appendChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
  });
  g.document = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'createElement') return () => elementStub();
        if (prop === 'body' || prop === 'documentElement') return elementStub();
        // TextBox.getTextContext measures through document.querySelector('canvas').
        if (prop === 'querySelector') return () => canvas;
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
  g.cancelAnimationFrame = (_id?: number) => {
    // initUI cancels the previous loop before starting a new one; without this the
    // stub would leave stale onFrame closures in the queue (their scopes get GC'd).
    harness.rafQueue.length = 0;
  };
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
}

export function makeGame() {
  const harness: Harness = { listeners: new Map(), rafQueue: [] };
  installBrowserStubs(harness);
  const docHandle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(docHandle);
  const g = globalThis as any;
  g.handle = docHandle;
  g.runtime = rt;
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8'));
  rt.eval(readFileSync(join(__dirname, '..', 'QBFWordList.js'), 'utf8'));
  rt.eval(readFileSync(join(__dirname, '..', 'QBF.js'), 'utf8'));
  rt.eval(`
initUI();
initLively();
qbfSetScoresStore(new QBFMemoryScoresStore());
qbfPanel = openQBF(pt(10, 10));
qbfGame = qbfPanel.submorphs.find((m) => m.className == 'QBFMorph');
// openQBF starts idle (empty tray); harness tests need an active local game.
qbfGame.setup();
qbfScoresPanel = openQBFScores();
qbfScores = findQBFScoresViewer();
`);
  // Hold the game morph once: each rt.eval is an Automerge.change (~0.5s), so
  // re-looking-up qbfGame every tick would dominate. Nested evals inside rt.change
  // share one commit (see livelymergeRuntime.change / inChangeCall).
  const game = rt.eval(`qbfGame`) as any;
  const ticks = (n: number) => {
    rt.change(() => {
      for (let i = 0; i < n; i++) game.tick();
    });
  };
  const type = (key: string) => {
    rt.change(() => {
      game.onKeyDown({ key });
    });
  };
  const dispatch = (type: string, x: number, y: number) => {
    const fns = harness.listeners.get(type) ?? [];
    expect(fns.length).toBeGreaterThan(0);
    // Events are only queued here; onFrame processes them inside its own change().
    for (const fn of fns) {
      fn({
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
    }
  };
  const runFrame = () => {
    // Prefer the live loop root: initUI may have cancelled earlier rAF entries, and
    // cancelAnimationFrame is best-effort against a queue of stubs.
    const live = rt.eval(`$uiState && $uiState.onFrame`) as (() => void) | null;
    const cb = live || harness.rafQueue.shift();
    if (!cb) throw new Error('no rAF scheduled');
    cb();
  };
  /** Tick until pred is true (evaluated in the runtime), answering the tick count. */
  const ticksUntil = (pred: string, limit = 4000) => {
    return rt.change(() => {
      for (let i = 0; i < limit; i++) {
        if (rt.eval(pred)) return i;
        game.tick();
      }
      throw new Error('condition never became true: ' + pred);
    }) as number;
  };
  return { rt, harness, handle: docHandle, game, ticks, ticksUntil, type, dispatch, runFrame };
}
