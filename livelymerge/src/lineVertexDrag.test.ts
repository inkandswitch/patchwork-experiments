/**
 * Vertex-handle drags on a LineMorph use the same ephemeral drag/drop scheme as
 * plain morph drags: per-frame reshapes land on $vertices (a per-user ephemeral
 * copy of the PolyLine's vertex list), peers watch live via lm-eph messages that
 * now carry a flat vertex array, and the document sees exactly one commit on
 * pointer-up. Before this, every pointer move wrote a fresh vertex Point plus
 * recomputed bounds Points into the Automerge document — hundreds of ops per
 * drag, all synced.
 *
 * Browser stubs and frame clock as in ephemeralStreaming.test.ts; op counting as
 * in opEconomy.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Automerge from '@automerge/automerge';
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
        if (prop === 'querySelector') return (sel: string) => (sel === 'canvas' ? canvas : null);
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
  // Fresh page load, shared globalThis: clear the window side-tables production
  // initUI preserves across same-session re-inits (see ephemeralStreaming.test.ts).
  const g0 = globalThis as any;
  delete g0._ephOverlays;
  delete g0._ephemeralMessages;
  delete g0._ephLastSyncNudge;
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
  // Strip the trailing top-level init(): it boots a demo world (including its own
  // demo line) that would fight this test's world.
  rt.eval(src.replace(/\binit\(\)\s*$/, ''));
  // World-coord vertices (30,330) → (90,330): line origin lands at (30,330), so
  // line-local coords are world − (30,330) and vertex 0 sits at local (0,0).
  rt.eval(`
initUI();
initLively();
let plmVerts = [pt(30, 330), pt(90, 330)];
Lively.demoLine = Lively.addMorph(
  new LineMorph(plmVerts, { borderWidth: 2, borderColor: Color.black, arrowheads: 'end' }),
);
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
  let frameNow = 0;
  const runFrame = () => {
    const first = harness.rafCallbacks.entries().next();
    if (first.done) throw new Error('no rAF scheduled');
    const [id, cb] = first.value;
    harness.rafCallbacks.delete(id);
    frameNow += 34; // just past the 33.3ms frame interval, so no frame is skipped
    cb(frameNow);
  };
  /** Ops generated across `act()`, with a readable dump for failures. */
  const opsDuring = (act: () => void): { count: number; keys: string[] } => {
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
  };
  /** Hover over the line: the world's pointer-move hover pass materializes the handles. */
  const materializeHandles = () => {
    dispatch('pointermove', 60, 330);
    runFrame();
    expect(rt.eval(`(Lively.demoLine.$vertexHandles || []).length`)).toBe(2);
    expect(rt.eval(`(Lively.demoLine.$midpointHandles || []).length`)).toBe(1);
  };
  return { handle, rt, dispatch, runFrame, opsDuring, materializeHandles };
}

const lineOverlayMessage = (
  id: string,
  vertsFlat: number[] | null,
  opts: { end?: boolean; sid?: string } = {},
) => ({
  type: 'lm-eph',
  v: 1,
  actor: 'actor-remote',
  sid: opts.sid ?? 'eph-remote-session',
  ...(opts.end ? { end: true } : {}),
  objects: [
    {
      id,
      props: {
        // The line's resting transform/bounds (translation 30,330; 60×2): vertex
        // reshapes don't move the transform, so end-overlay landing is decided by
        // the vertex comparison.
        transform: {
          c: 'SimpleTransform',
          translation: { c: 'Point', x: 30, y: 330 },
          rotation: 0,
          scale: { c: 'Point', x: 1, y: 1 },
        },
        bounds: {
          c: 'Rectangle',
          topLeft: { c: 'Point', x: 30, y: 330 },
          extent: { c: 'Point', x: 60, y: 2 },
        },
        ...(vertsFlat ? { vertices: vertsFlat } : {}),
      },
    },
  ],
});

describe('line vertex drag: ephemeral until drop', () => {
  it('vertex-handle drag makes no document writes per move, streams vertices, and commits once on drop', () => {
    const { handle, rt, dispatch, runFrame, opsDuring, materializeHandles } = makeWorld();
    runFrame();
    materializeHandles();
    const lineId = rt.eval(`Lively.demoLine.$id`) as string;

    // Grab the vertex-0 handle (world 30,330 = line-local 0,0).
    const down = opsDuring(() => {
      dispatch('pointerdown', 30, 330);
      runFrame();
    });
    expect(down.count, `pointerdown on vertex handle:\n  ${down.keys.join('\n  ')}`).toBe(0);
    expect(rt.eval(`Lively.demoLine.shape.$vertices != null`)).toBe(true);

    // Ten drag moves: every reshape is ephemeral — zero Automerge ops.
    const moves = opsDuring(() => {
      for (let i = 1; i <= 10; i++) {
        dispatch('pointermove', 30 + i * 3, 330 + i * 3);
        runFrame();
      }
    });
    expect(moves.count, `drag moves wrote ops:\n  ${moves.keys.join('\n  ')}`).toBe(0);

    // The rendered (ephemeral) vertex tracks the pointer; the document does not.
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].x`)).toBeCloseTo(30, 4); // local 60−30
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBeCloseTo(30, 4);
    expect(rt.eval(`Lively.demoLine.shape._vertices[0].x`)).toBe(0);
    expect(rt.eval(`Lively.demoLine.shape._vertices[0].y`)).toBe(0);

    // Peers watch live: per-frame messages carry the flat ephemeral vertex list.
    const mid: any = handle.sentEphemeral[handle.sentEphemeral.length - 1];
    expect(mid.type).toBe('lm-eph');
    expect(mid.end).toBeUndefined();
    expect(mid.objects[0].id).toBe(lineId);
    const midVerts = Array.from(mid.objects[0].props.vertices) as number[];
    expect(midVerts.length).toBe(4);
    [30, 30, 60, 0].forEach((v, i) => expect(midVerts[i]).toBeCloseTo(v, 6));

    // Drop: one commit — the moved vertex, the shape rect, and the cached morph
    // bounds, all as in-place value writes (no fresh doc Points).
    const up = opsDuring(() => {
      dispatch('pointerup', 60, 360);
      runFrame();
    });
    expect(up.count, `drop commit:\n  ${up.keys.join('\n  ')}`).toBeGreaterThan(0);
    expect(up.count, `drop commit:\n  ${up.keys.join('\n  ')}`).toBeLessThanOrEqual(24);
    expect(rt.eval(`Lively.demoLine.shape.$vertices == null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape._vertices[0].x`)).toBeCloseTo(30, 4);
    expect(rt.eval(`Lively.demoLine.shape._vertices[0].y`)).toBeCloseTo(30, 4);

    // The end message (sent after the commit) carries exactly the committed list.
    const last: any = handle.sentEphemeral[handle.sentEphemeral.length - 1];
    expect(last.end).toBe(true);
    expect(last.objects[0].id).toBe(lineId);
    const endVerts = Array.from(last.objects[0].props.vertices) as number[];
    expect(endVerts.length).toBe(4);
    [30, 30, 60, 0].forEach((v, i) => expect(endVerts[i]).toBeCloseTo(v, 6));

    // Idle frames after the drop stream nothing and write nothing.
    const afterEndCount = handle.sentEphemeral.length;
    const idle = opsDuring(() => {
      runFrame();
      runFrame();
    });
    expect(idle.count, `idle after drop:\n  ${idle.keys.join('\n  ')}`).toBe(0);
    expect(handle.sentEphemeral.length).toBe(afterEndCount);
  }, 120_000);

  it('midpoint-handle drag inserts the new vertex ephemerally and commits it once on drop', () => {
    const { rt, dispatch, runFrame, opsDuring, materializeHandles } = makeWorld();
    runFrame();
    materializeHandles();

    // Grab the (single) midpoint handle at world (60,330); the insert must land
    // on the ephemeral list, not the document.
    const down = opsDuring(() => {
      dispatch('pointerdown', 60, 330);
      runFrame();
    });
    expect(down.count, `midpoint pointerdown:\n  ${down.keys.join('\n  ')}`).toBe(0);
    expect(rt.eval(`Lively.demoLine.shape.vertices.length`)).toBe(3);
    expect(rt.eval(`Lively.demoLine.shape._vertices.length`)).toBe(2);

    const moves = opsDuring(() => {
      for (let i = 1; i <= 10; i++) {
        dispatch('pointermove', 60, 330 - i * 3);
        runFrame();
      }
    });
    expect(moves.count, `midpoint drag moves wrote ops:\n  ${moves.keys.join('\n  ')}`).toBe(0);

    // Drop: the document gains the vertex in one commit (list insert + values).
    const up = opsDuring(() => {
      dispatch('pointerup', 60, 300);
      runFrame();
    });
    expect(up.count, `midpoint drop commit:\n  ${up.keys.join('\n  ')}`).toBeLessThanOrEqual(40);
    expect(rt.eval(`Lively.demoLine.shape._vertices.length`)).toBe(3);
    expect(rt.eval(`Lively.demoLine.shape._vertices[1].x`)).toBeCloseTo(30, 4); // local 60−30
    expect(rt.eval(`Lively.demoLine.shape._vertices[1].y`)).toBeCloseTo(-30, 4); // local 300−330
  }, 120_000);
});

describe('line vertex drag: receiver', () => {
  it('applies remote vertex overlays ephemerally and sweeps them after the silence deadline', () => {
    const { handle, rt, runFrame } = makeWorld();
    runFrame();
    const lineId = rt.eval(`Lively.demoLine.$id`) as string;

    handle.deliverEphemeral(lineOverlayMessage(lineId, [0, 40, 60, 0]));
    runFrame();
    expect(rt.eval(`Lively.demoLine.shape.$vertices != null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBe(40);
    expect(rt.eval(`Lively.demoLine.shape._vertices[0].y`)).toBe(0); // document untouched

    // ~1000ms of silence: the overlay lapses and the line snaps back.
    for (let i = 0; i < 35; i++) runFrame();
    expect(rt.eval(`Lively.demoLine.shape.$vertices == null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBe(0);
  }, 60_000);

  it('holds an end:true vertex overlay past its deadline until the committed vertices sync in', () => {
    const { handle, rt, runFrame } = makeWorld();
    runFrame();
    const lineId = rt.eval(`Lively.demoLine.$id`) as string;

    handle.deliverEphemeral(lineOverlayMessage(lineId, [0, 40, 60, 0], { end: true }));
    runFrame();
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBe(40);

    // Past the 250ms end deadline the document still shows the pre-drag vertices
    // (transform/bounds in the message already match): held on the vertex check.
    for (let i = 0; i < 10; i++) runFrame();
    expect(rt.eval(`Lively.demoLine.shape.$vertices != null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBe(40);

    // The sender's commit syncs in — the overlay lapses invisibly.
    rt.eval(`Lively.demoLine.shape._vertices[0].setToPt(pt(0, 40))`);
    runFrame();
    expect(rt.eval(`Lively.demoLine.shape.$vertices == null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBe(40);
  }, 60_000);

  it('rejects malformed vertex payloads without touching any overlay state', () => {
    const { handle, rt, runFrame } = makeWorld();
    runFrame();
    const lineId = rt.eval(`Lively.demoLine.$id`) as string;

    handle.deliverEphemeral(lineOverlayMessage(lineId, [0, Number.NaN, 60, 0]));
    handle.deliverEphemeral(lineOverlayMessage(lineId, [0, 40, 60])); // odd length
    runFrame();
    expect(rt.eval(`Lively.demoLine.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape.$vertices == null`)).toBe(true);
    expect(rt.eval(`Lively.demoLine.shape.vertices[0].y`)).toBe(0);
  }, 60_000);
});
