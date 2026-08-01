/**
 * Full-stack tests for ephemeral interaction streaming: while a drag is in flight,
 * the sender broadcasts its $transform/$bounds overlays once per frame via
 * automerge-repo ephemeral messages; receivers apply them to the same $-overlays
 * (whitelisted, validated, receiver-side leases) so remote users watch the drag
 * live without any document traffic.
 *
 * Same browser stubs as ephemeralTransform.test.ts, plus a real frame clock
 * (runFrame advances rAF `now`), which the receiver's overlay leases depend on.
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
  rafCallbacks: Map<number, (now: number) => void>;
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
  let nextRafId = 0;
  g.requestAnimationFrame = (cb: (now: number) => void) => {
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
  // A real frame clock: overlay leases are measured against the rAF timestamp.
  let frameNow = 0;
  const runFrame = () => {
    const first = harness.rafCallbacks.entries().next();
    if (first.done) throw new Error('no rAF scheduled');
    const [id, cb] = first.value;
    harness.rafCallbacks.delete(id);
    frameNow += 34; // just past the 33.3ms frame interval, so no frame is skipped
    cb(frameNow);
  };
  return { handle, rt, dispatch, runFrame };
}

const boxOverlayMessage = (id: string, x: number, y: number, opts: { end?: boolean } = {}) => ({
  type: 'lm-eph',
  v: 1,
  actor: 'actor-remote',
  ...(opts.end ? { end: true } : {}),
  objects: [
    {
      id,
      props: {
        transform: {
          c: 'SimpleTransform',
          translation: { c: 'Point', x, y },
          rotation: 0,
          scale: { c: 'Point', x: 1, y: 1 },
        },
        bounds: {
          c: 'Rectangle',
          topLeft: { c: 'Point', x, y },
          extent: { c: 'Point', x: 60, y: 30 },
        },
      },
    },
  ],
});

describe('ephemeral interaction streaming: sender', () => {
  it('broadcasts overlays per frame while dragging, then a final end message with the committed values', () => {
    const { handle, rt, dispatch, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;

    dispatch('pointerdown', 50, 30);
    runFrame();
    expect(handle.sentEphemeral.length).toBe(0); // no motion yet — clicks don't stream

    dispatch('pointermove', 60, 40);
    runFrame();
    dispatch('pointermove', 70, 50);
    runFrame();
    const midCount = handle.sentEphemeral.length;
    expect(midCount).toBeGreaterThanOrEqual(2); // one batched message per move frame

    const mid: any = handle.sentEphemeral[handle.sentEphemeral.length - 1];
    expect(mid.type).toBe('lm-eph');
    expect(mid.v).toBe(1);
    expect(mid.actor).toBe('actor-test');
    expect(mid.end).toBeUndefined();
    expect(mid.objects.length).toBe(1);
    expect(mid.objects[0].id).toBe(boxId);
    expect(mid.objects[0].props.transform.c).toBe('SimpleTransform');
    expect(mid.objects[0].props.transform.translation.x).toBeCloseTo(50, 4); // 30 + 20
    expect(mid.objects[0].props.bounds.c).toBe('Rectangle');
    expect(mid.objects[0].props.bounds.topLeft.x).toBeCloseTo(50, 4);

    dispatch('pointerup', 70, 50);
    runFrame();
    const last: any = handle.sentEphemeral[handle.sentEphemeral.length - 1];
    expect(last.end).toBe(true);
    // The end message is sent after the commit, so it carries the document's values.
    const tlId = rt.eval(`Lively.testBox._transform.translation.$id`) as string;
    const docTl = handle.doc().objectTable[tlId] as any;
    expect(last.objects[0].props.transform.translation.x).toBeCloseTo(docTl['@x'], 6);
    expect(last.objects[0].props.transform.translation.y).toBeCloseTo(docTl['@y'], 6);

    // Idle frames after the interaction broadcast nothing.
    const afterEndCount = handle.sentEphemeral.length;
    runFrame();
    runFrame();
    expect(handle.sentEphemeral.length).toBe(afterEndCount);
  }, 60_000);
});

describe('ephemeral interaction streaming: receiver', () => {
  it('applies a valid remote overlay ephemerally and sweeps it after the silence deadline', () => {
    const { handle, rt, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;
    const tlId = rt.eval(`Lively.testBox._transform.translation.$id`) as string;
    const docTlBefore = JSON.stringify(handle.doc().objectTable[tlId]);

    handle.deliverEphemeral(boxOverlayMessage(boxId, 200, 150));
    runFrame();

    // Overlay applied: renders at the remote position, document untouched.
    expect(rt.eval(`Lively.testBox.$transform != null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBe(200);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.y`)).toBe(150);
    expect(JSON.stringify(handle.doc().objectTable[tlId])).toBe(docTlBefore);

    // ~1000ms of silence (34ms frames): the sender is presumed gone; overlay lapses.
    for (let i = 0; i < 35; i++) runFrame();
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBe(30); // back to committed
  }, 60_000);

  it('an end:true message gets the short deadline', () => {
    const { rt, handle, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;

    handle.deliverEphemeral(boxOverlayMessage(boxId, 120, 90, { end: true }));
    runFrame();
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBe(120);
    for (let i = 0; i < 10; i++) runFrame(); // ~340ms > 250ms end deadline
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
  }, 60_000);

  it('rejects malformed values and never touches persistent props', () => {
    const { rt, handle, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;

    const bad = boxOverlayMessage(boxId, 200, 150) as any;
    bad.objects[0].props.transform.translation.x = Number.NaN;
    handle.deliverEphemeral(bad);
    runFrame();
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBe(30);
  }, 60_000);

  it('a local drag wins over remote overlays for the same morph', () => {
    const { rt, handle, dispatch, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;

    dispatch('pointerdown', 50, 30);
    runFrame();
    dispatch('pointermove', 70, 50);
    runFrame();
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBeCloseTo(50, 4);

    handle.deliverEphemeral(boxOverlayMessage(boxId, 400, 400));
    runFrame();
    // Remote update ignored: this replica's own interaction owns the overlay.
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBeCloseTo(50, 4);
  }, 60_000);
});
