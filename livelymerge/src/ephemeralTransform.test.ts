/**
 * Full-stack tests for ephemeral morph transforms: during a direct-manipulation
 * interaction (drag, halo manipulation) the morph's `transform` getter answers
 * $transform — a per-replica ephemeral copy — so per-frame mutations never touch the
 * Automerge document; the copy's values are written back into the persistent
 * _transform once, on pointer-up.
 *
 * Uses the same browser stubs as newdefsDrag.test.ts (real transpiled newdefs.js,
 * real Automerge document), except cancelAnimationFrame really cancels, so the
 * second initUI never leaves a stale onFrame closure behind.
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

type Harness = {
  listeners: Map<string, Array<(e: any) => void>>;
  rafCallbacks: Map<number, () => void>;
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
          return (sel: string) => (sel === 'canvas' ? canvas : null);
        return (..._args: unknown[]) => null;
      },
      set() {
        return true;
      },
    },
  );
  // Real cancellation semantics (unlike the shared stub's no-op): initUI cancels its
  // predecessor's rAF, so a canceled onFrame closure must never fire.
  let nextRafId = 0;
  g.requestAnimationFrame = (cb: () => void) => {
    harness.rafCallbacks.set(++nextRafId, cb);
    return nextRafId;
  };
  g.cancelAnimationFrame = (id: number) => {
    harness.rafCallbacks.delete(id);
  };
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
}

function makeWorld() {
  const harness: Harness = { listeners: new Map(), rafCallbacks: new Map() };
  installBrowserStubs(harness);
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
  rt.eval(src);
  // Fresh minimal world (populateLively's steppers would move things underneath us).
  // The second initUI is safe here: this harness's cancelAnimationFrame really
  // cancels, so the first onFrame closure never fires.
  rt.eval(`
initUI();
initLively();
Lively.testBox = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
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
    expect(fns.length).toBeGreaterThan(0);
    for (const fn of fns) fn(makeNativeEvt(type, x, y));
  };
  let frameError: unknown = null;
  const runFrame = () => {
    const first = harness.rafCallbacks.entries().next();
    if (first.done) throw new Error('no rAF scheduled');
    const [id, cb] = first.value;
    harness.rafCallbacks.delete(id);
    const origConsoleError = console.error;
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
  return { handle, rt, dispatch, runFrame, getFrameError: () => frameError };
}

/** The stored @x/@y of a Point's document entry, or undefined when not yet promoted. */
function docPointCoords(handle: any, rt: any, expr: string): { x: number; y: number } | undefined {
  const id = rt.eval(`(${expr}).$id`) as string;
  const entry = handle.doc().objectTable[id] as Record<string, any> | undefined;
  return entry ? { x: entry['@x'], y: entry['@y'] } : undefined;
}

describe('ephemeral transform during drag', () => {
  it('mid-drag mutations stay in $transform; pointer-up commits into _transform in place', () => {
    const { handle, rt, dispatch, runFrame, getFrameError } = makeWorld();

    // Lively.testBox: bounds (30, 20, 60, 30).
    const startX = rt.eval(`Lively.testBox.getBounds().topLeft.x`) as number;
    const startY = rt.eval(`Lively.testBox.getBounds().topLeft.y`) as number;
    const tfmId = rt.eval(`Lively.testBox._transform.$id`);
    const docStart = docPointCoords(handle, rt, `Lively.testBox._transform.translation`);
    expect(docStart).toBeDefined();

    // Down inside the box; measure after this frame so beTopMorph promotion etc.
    // don't muddy the mid-drag no-op assertions below.
    dispatch('pointerdown', 50, 30);
    runFrame();
    const tlId = rt.eval(`Lively.testBox._bounds.topLeft.$id`) as string;
    const docBoundsTlStart = docPointCoords(handle, rt, `Lively.testBox._bounds.topLeft`);
    const tableSizeAfterDown = Object.keys(handle.doc().objectTable).length;

    // Two move frames: the interaction is now mid-flight.
    dispatch('pointermove', 60, 40);
    runFrame();
    dispatch('pointermove', 70, 50);
    runFrame();

    // The morph renders at the dragged position (through the getter)…
    expect(rt.eval(`Lively.testBox.$transform != null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBeCloseTo(
      (rt.eval(`Lively.testBox._transform.translation.x`) as number) + 20,
      6,
    );
    // …while the persistent transform/bounds and their document entries are
    // untouched, and the move frames allocated nothing in the document (the old
    // bounds path promoted one fresh topLeft Point per frame).
    expect(docPointCoords(handle, rt, `Lively.testBox._transform.translation`)).toEqual(docStart);
    expect(rt.eval(`Lively.testBox.$bounds != null`)).toBe(true);
    expect(docPointCoords(handle, rt, `Lively.testBox._bounds.topLeft`)).toEqual(docBoundsTlStart);
    expect(Object.keys(handle.doc().objectTable).length).toBe(tableSizeAfterDown);

    // Pointer-up: the ephemeral values are committed into the same document objects.
    dispatch('pointerup', 70, 50);
    runFrame();

    expect(getFrameError(), `frame loop threw: ${String((getFrameError() as any)?.stack ?? getFrameError())}`).toBeNull();
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.$bounds == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox._transform.$id`)).toBe(tfmId); // same object, mutated in place
    expect(rt.eval(`Lively.testBox._bounds.topLeft.$id`)).toBe(tlId); // ditto: no orphaned Points
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBeCloseTo(startX + 20, 6);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.y`)).toBeCloseTo(startY + 20, 6);
    const docEnd = docPointCoords(handle, rt, `Lively.testBox._transform.translation`);
    expect(docEnd!.x).toBeCloseTo(docStart!.x + 20, 6);
    expect(docEnd!.y).toBeCloseTo(docStart!.y + 20, 6);
    const docBoundsTlEnd = docPointCoords(handle, rt, `Lively.testBox._bounds.topLeft`);
    expect(docBoundsTlEnd!.x).toBeCloseTo(docBoundsTlStart!.x + 20, 6);
    expect(docBoundsTlEnd!.y).toBeCloseTo(docBoundsTlStart!.y + 20, 6);
  }, 60_000);

  it('dragging a panel by its title bar goes through $transform too', () => {
    const { handle, rt, dispatch, runFrame, getFrameError } = makeWorld();

    // A titled panel like the welcome window; its title-bar drag uses
    // beginTitleBarPress/clearTitleBarPress, not the generic Morph drag path.
    rt.eval(
      `Lively.testPanel = Lively.addMorph(new MethodPanel(rect(100, 300, 200, 120), 'hello panel', 'Test Panel'));`,
    );

    // Title bar spans y 300..324; x 128..272 is the title label (no chrome buttons).
    dispatch('pointerdown', 200, 312);
    runFrame();
    expect(rt.eval(`Lively.testPanel.$titleBarDrag`)).toBe(true);
    const docStart = docPointCoords(handle, rt, `Lively.testPanel._transform.translation`);
    const tableSizeAfterDown = Object.keys(handle.doc().objectTable).length;

    dispatch('pointermove', 220, 332);
    runFrame();
    dispatch('pointermove', 240, 352);
    runFrame();

    // Mid-drag: renders at the dragged position, but not one document write.
    expect(rt.eval(`Lively.testPanel.$transform != null`)).toBe(true);
    expect(rt.eval(`Lively.testPanel.transform.translation.x`)).toBeCloseTo(
      (rt.eval(`Lively.testPanel._transform.translation.x`) as number) + 40,
      6,
    );
    expect(docPointCoords(handle, rt, `Lively.testPanel._transform.translation`)).toEqual(docStart);
    expect(Object.keys(handle.doc().objectTable).length).toBe(tableSizeAfterDown);

    dispatch('pointerup', 240, 352);
    runFrame();

    expect(getFrameError(), `frame loop threw: ${String((getFrameError() as any)?.stack ?? getFrameError())}`).toBeNull();
    expect(rt.eval(`Lively.testPanel.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.testPanel.$titleBarDrag`)).toBe(false);
    const docEnd = docPointCoords(handle, rt, `Lively.testPanel._transform.translation`);
    expect(docEnd!.x).toBeCloseTo(docStart!.x + 40, 6);
    expect(docEnd!.y).toBeCloseTo(docStart!.y + 40, 6);
  }, 60_000);

  it('dragging via the halo Drag handle goes through $transform on the target', () => {
    const { handle, rt, dispatch, runFrame, getFrameError } = makeWorld();

    // Show the halo on the box and locate its Drag handle in world coordinates.
    rt.eval(`Lively.cycleHaloAt(pt(60, 35));`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(1);
    const hx = rt.eval(
      `Lively.ephemeralSubmorphs().at(0).globalize(Lively.ephemeralSubmorphs().at(0).dragHandle.getBounds().center()).x`,
    ) as number;
    const hy = rt.eval(
      `Lively.ephemeralSubmorphs().at(0).globalize(Lively.ephemeralSubmorphs().at(0).dragHandle.getBounds().center()).y`,
    ) as number;

    const startX = rt.eval(`Lively.testBox.getBounds().topLeft.x`) as number;
    const docStart = docPointCoords(handle, rt, `Lively.testBox._transform.translation`);

    dispatch('pointerdown', hx, hy);
    runFrame();
    const tableSizeAfterDown = Object.keys(handle.doc().objectTable).length;
    dispatch('pointermove', hx + 10, hy + 5);
    runFrame();
    dispatch('pointermove', hx + 30, hy + 15);
    runFrame();

    // Mid-drag: the target follows visually, the document does not.
    expect(rt.eval(`Lively.testBox.$transform != null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBeCloseTo(startX + 30, 4);
    expect(docPointCoords(handle, rt, `Lively.testBox._transform.translation`)).toEqual(docStart);
    expect(Object.keys(handle.doc().objectTable).length).toBe(tableSizeAfterDown);

    dispatch('pointerup', hx + 30, hy + 15);
    runFrame();

    expect(getFrameError(), `frame loop threw: ${String((getFrameError() as any)?.stack ?? getFrameError())}`).toBeNull();
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBeCloseTo(startX + 30, 4);
    const docEnd = docPointCoords(handle, rt, `Lively.testBox._transform.translation`);
    expect(docEnd!.x).toBeCloseTo(docStart!.x + 30, 4);
    expect(docEnd!.y).toBeCloseTo(docStart!.y + 15, 4);
  }, 60_000);

  it('a click without a drag leaves the document transform untouched', () => {
    const { handle, rt, dispatch, runFrame, getFrameError } = makeWorld();

    const before = handle.doc().objectTable[rt.eval(`Lively.testBox._transform.translation.$id`) as string];
    dispatch('pointerdown', 50, 30);
    runFrame();
    dispatch('pointerup', 50, 30);
    runFrame();

    expect(getFrameError(), `frame loop threw: ${String((getFrameError() as any)?.stack ?? getFrameError())}`).toBeNull();
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
    const after = handle.doc().objectTable[rt.eval(`Lively.testBox._transform.translation.$id`) as string];
    expect((after as any)['@x']).toBe((before as any)['@x']);
    expect((after as any)['@y']).toBe((before as any)['@y']);
  }, 60_000);
});
