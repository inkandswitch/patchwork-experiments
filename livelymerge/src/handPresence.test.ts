/**
 * Full-stack tests for hands as shared-but-never-persisted state: each session's
 * hand lives in the world's per-user $hands list (zero document writes, ever),
 * goes to peers on the lm-eph channel (riding the frame's overlay message, or a
 * message of its own when it moved / its heartbeat is due), and a peer's hand is
 * created on first sight, moved per message, and dropped on `bye` or after
 * $HAND_TTL_MS of silence. Hand-carry (Alt-click) keeps the cargo in the world on
 * its ephemeral transform, streamed live, committed once on drop — and must never
 * promote the hand into the document.
 *
 * Harness: same browser stubs + frame clock as ephemeralStreaming.test.ts, plus
 * opsDuring from lineVertexDrag.test.ts.
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

type EvtOpts = { altKey?: boolean; shiftKey?: boolean };

function makeWorld() {
  const harness: Harness = { listeners: new Map(), rafCallbacks: new Map() };
  installBrowserStubs(harness);
  // Fresh page load, shared globalThis: clear the window side-tables production
  // initUI preserves across same-session re-inits (see ephemeralStreaming.test.ts).
  const g0 = globalThis as any;
  delete g0._ephOverlays;
  delete g0._ephemeralMessages;
  delete g0._ephLastSyncNudge;
  delete g0._ephByeMsg;
  delete g0._lmUserName;
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

  const makeNativeEvt = (type: string, x: number, y: number, opts: EvtOpts) => ({
    type,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
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
  const dispatch = (type: string, x: number, y: number, opts: EvtOpts = {}) => {
    const fns = harness.listeners.get(type) ?? [];
    expect(fns.length).toBeGreaterThan(0);
    // ONE event object for every listener: newdefs.js's trailing init() plus this
    // harness's initUI() register two listener sets, and processEvents dedups by
    // event identity. (A fresh object per listener would be two Alt-clicks: grab, drop.)
    const evt = makeNativeEvt(type, x, y, opts);
    for (const fn of fns) fn(evt);
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
  const runFrames = (n: number) => {
    for (let i = 0; i < n; i++) runFrame();
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
  const docEntryCount = () => Object.keys(handle.doc().objectTable as any).length;
  const inDoc = (id: string) => (handle.doc().objectTable as any)[id] != null;
  return { handle, rt, dispatch, runFrame, runFrames, opsDuring, docEntryCount, inDoc };
}

type HandOpts = {
  actor?: string;
  ci?: number;
  name?: string;
  carrying?: string[];
  bye?: boolean;
  objects?: unknown[];
  hand?: unknown; // raw override (malformed payloads)
};
const handMessage = (sid: string, x: number, y: number, opts: HandOpts = {}) => ({
  type: 'lm-eph',
  v: 1,
  actor: opts.actor ?? 'actor-remote',
  sid,
  objects: opts.objects ?? [],
  hand:
    opts.hand !== undefined
      ? opts.hand
      : opts.bye
        ? { bye: true }
        : {
            x,
            y,
            ci: opts.ci ?? 2,
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.carrying ? { carrying: opts.carrying } : {}),
          },
});
const boxOverlay = (id: string, x: number, y: number) => ({
  id,
  props: {
    transform: {
      c: 'SimpleTransform',
      translation: { c: 'Point', x, y },
      rotation: 0,
      scale: { c: 'Point', x: 1, y: 1 },
    },
    bounds: { c: 'Rectangle', topLeft: { c: 'Point', x, y }, extent: { c: 'Point', x: 60, y: 30 } },
  },
});
const lastSent = (handle: { sentEphemeral: unknown[] }): any =>
  handle.sentEphemeral[handle.sentEphemeral.length - 1];

describe('hands: my own hand', () => {
  it('is created on the first pointer event, per-user, with zero document writes', () => {
    const { rt, dispatch, runFrame, runFrames, opsDuring, docEntryCount, inDoc } = makeWorld();
    expect(rt.eval(`Lively.myHand()`)).toBeNull();
    const entriesBefore = docEntryCount();

    const first = opsDuring(() => {
      dispatch('pointermove', 100, 100);
      runFrame();
    });
    expect(first.count, first.keys.join('\n')).toBe(0);
    expect(rt.eval(`Lively.myHand() != null`)).toBe(true);
    expect(rt.eval(`Lively.myHand().$isLocal`)).toBe(true);
    expect(rt.eval(`Lively.myHand().$sid === $ephSessionID`)).toBe(true);
    expect(rt.eval(`Lively.myHand().actorID`)).toBe('actor-test');
    expect(rt.eval(`Lively.myHand().hotspot().x`)).toBe(100);
    expect(rt.eval(`Lively.myHand().hotspot().y`)).toBe(100);
    expect(rt.eval(`Lively.$hands.length`)).toBe(1);
    // The hand IS the cursor.
    expect((globalThis as any).canvas.style.cursor).toBe('none');

    // Moving it is free too, and it never shows up in the document.
    const moves = opsDuring(() => {
      dispatch('pointermove', 150, 120);
      runFrame();
      dispatch('pointermove', 180, 140);
      runFrame();
      runFrames(5);
    });
    expect(moves.count, moves.keys.join('\n')).toBe(0);
    expect(rt.eval(`Lively.myHand().hotspot().x`)).toBe(180);
    expect(rt.eval(`Lively.myHand().transform.translation.x`)).toBeCloseTo(
      rt.eval(`Lively.myHand()._transform.translation.x`) as number,
      9,
    );
    expect(inDoc(rt.eval(`Lively.myHand().$id`) as string)).toBe(false);
    expect(inDoc(rt.eval(`Lively.myHand().shape.$id`) as string)).toBe(false);
    expect(inDoc(rt.eval(`Lively.myHand()._transform.$id`) as string)).toBe(false);
    expect(docEntryCount()).toBe(entriesBefore);
  }, 60_000);

  it('goes on the wire when it moves, then heartbeats while idle', () => {
    const { handle, rt, dispatch, runFrame, runFrames } = makeWorld();
    dispatch('pointermove', 100, 100);
    runFrame();
    expect(handle.sentEphemeral.length).toBe(1);
    const m = lastSent(handle);
    expect(m.type).toBe('lm-eph');
    expect(m.v).toBe(1);
    expect(m.sid).toBe(rt.eval(`$ephSessionID`));
    expect(m.actor).toBe('actor-test');
    expect(m.objects.length).toBe(0);
    expect(m.hand.x).toBe(100);
    expect(m.hand.y).toBe(100);
    expect(Number.isInteger(m.hand.ci)).toBe(true);
    expect(m.hand.ci).toBe(rt.eval(`Lively.myHand().$colorIndex`));
    expect(m.hand.ci).toBeLessThan(rt.eval(`$HAND_PALETTE.length`) as number);
    expect(m.hand.name).toBeUndefined();
    expect(m.hand.carrying).toBeUndefined();

    // Idle: nothing until the heartbeat interval (1000ms = 30 frames) elapses, then one.
    runFrames(20);
    expect(handle.sentEphemeral.length).toBe(1);
    runFrames(10);
    expect(handle.sentEphemeral.length).toBe(2);
    expect(lastSent(handle).hand.x).toBe(100);
    expect(lastSent(handle).objects.length).toBe(0);
    runFrames(10);
    expect(handle.sentEphemeral.length).toBe(2);

    // Motion sends right away; the display name rides along once resolved.
    (globalThis as any)._lmUserName = 'Alex';
    dispatch('pointermove', 120, 130);
    runFrame();
    expect(handle.sentEphemeral.length).toBe(3);
    expect(lastSent(handle).hand.x).toBe(120);
    expect(lastSent(handle).hand.y).toBe(130);
    expect(lastSent(handle).hand.name).toBe('Alex');
  }, 60_000);

  it('rides on the overlay message while dragging: exactly one message per frame', () => {
    const { handle, rt, dispatch, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;
    dispatch('pointerdown', 50, 30);
    runFrame();
    expect(handle.sentEphemeral.length).toBe(1); // the hand's first appearance; no drag yet
    expect(lastSent(handle).objects.length).toBe(0);
    dispatch('pointermove', 60, 40);
    runFrame();
    expect(handle.sentEphemeral.length).toBe(2);
    expect(lastSent(handle).objects.length).toBe(1);
    expect(lastSent(handle).objects[0].id).toBe(boxId);
    expect(lastSent(handle).hand.x).toBe(60);
    dispatch('pointermove', 70, 50);
    runFrame();
    expect(handle.sentEphemeral.length).toBe(3);
    dispatch('pointerup', 70, 50);
    runFrame();
    // The end message (sent from the commit) carries the hand; no separate hand message.
    expect(handle.sentEphemeral.length).toBe(4);
    expect(lastSent(handle).end).toBe(true);
    expect(lastSent(handle).hand.x).toBe(70);
    expect(lastSent(handle).hand.y).toBe(50);
  }, 60_000);

  it('prebuilds the goodbye message for the pagehide listener', () => {
    const { rt } = makeWorld();
    const bye = (globalThis as any)._ephByeMsg;
    expect(bye.type).toBe('lm-eph');
    expect(bye.v).toBe(1);
    expect(bye.sid).toBe(rt.eval(`$ephSessionID`));
    expect(bye.actor).toBe('actor-test');
    expect(bye.objects.length).toBe(0);
    expect(bye.hand.bye).toBe(true);
  }, 60_000);
});

describe('hands: peers', () => {
  it("a peer's hand appears on first sight, moves per message, and is never persisted", () => {
    const { handle, rt, runFrame, runFrames, opsDuring, docEntryCount } = makeWorld();
    const entriesBefore = docEntryCount();
    const arrival = opsDuring(() => {
      handle.deliverEphemeral(handMessage('sid-dan', 200, 200, { actor: 'actor-dan', ci: 3, name: 'Dan' }));
      runFrame();
    });
    expect(arrival.count, arrival.keys.join('\n')).toBe(0);
    expect(rt.eval(`Lively.$hands.length`)).toBe(1); // no pointer event here yet: no local hand
    expect(rt.eval(`Lively.handForSid('sid-dan') != null`)).toBe(true);
    expect(rt.eval(`Lively.handForSid('sid-dan').$isLocal`)).toBe(false);
    expect(rt.eval(`Lively.handForSid('sid-dan').actorID`)).toBe('actor-dan');
    expect(rt.eval(`Lively.handForSid('sid-dan').$name`)).toBe('Dan');
    expect(rt.eval(`Lively.handForSid('sid-dan').$colorIndex`)).toBe(3);
    expect(rt.eval(`Lively.handForSid('sid-dan').handColor() === $HAND_PALETTE[3]`)).toBe(true);
    expect(rt.eval(`Lively.handForSid('sid-dan').hotspot().x`)).toBe(200);
    expect(rt.eval(`Lively.handForSid('sid-dan').hotspot().y`)).toBe(200);
    // Attribution by actor (drag-shadow tint, unsaved-text borders) finds it.
    expect(rt.eval(`Lively.handForID('actor-dan') === Lively.handForSid('sid-dan')`)).toBe(true);
    expect(rt.eval(`Lively.myHand()`)).toBeNull();
    // Peers' hands do not hide MY cursor.
    expect((globalThis as any).canvas.style.cursor).toBe('default');

    handle.deliverEphemeral(handMessage('sid-dan', 260, 230, { actor: 'actor-dan', ci: 3 }));
    runFrame();
    expect(rt.eval(`Lively.handForSid('sid-dan').hotspot().x`)).toBe(260);
    expect(rt.eval(`Lively.handForSid('sid-dan').hotspot().y`)).toBe(230);
    expect(rt.eval(`Lively.handForSid('sid-dan').$name`)).toBeNull(); // name not resent this time
    expect(rt.eval(`Lively.$hands.length`)).toBe(1); // same sid, same hand

    // A second peer gets a second hand; nothing reaches the document.
    handle.deliverEphemeral(handMessage('sid-eve', 10, 10, { actor: 'actor-eve', ci: 5 }));
    runFrames(3);
    expect(rt.eval(`Lively.$hands.length`)).toBe(2);
    expect(docEntryCount()).toBe(entriesBefore);
    const remoteId = rt.eval(`Lively.handForSid('sid-dan').$id`) as string;
    expect((handle.doc().objectTable as any)[remoteId]).toBeUndefined();
  }, 60_000);

  it("a silent peer's hand lapses after the TTL; a `bye` removes it at once", () => {
    const { handle, rt, runFrame, runFrames } = makeWorld();
    handle.deliverEphemeral(handMessage('sid-dan', 200, 200));
    runFrame();
    expect(rt.eval(`Lively.handForSid('sid-dan') != null`)).toBe(true);
    runFrames(100); // 3.4s of silence: still there
    expect(rt.eval(`Lively.handForSid('sid-dan') != null`)).toBe(true);
    runFrames(25); // past 4s
    expect(rt.eval(`Lively.handForSid('sid-dan')`)).toBeNull();
    expect(rt.eval(`Lively.$hands.length`)).toBe(0);

    // Heartbeats keep it alive indefinitely.
    handle.deliverEphemeral(handMessage('sid-dan', 200, 200));
    runFrame();
    for (let i = 0; i < 10; i++) {
      runFrames(29);
      handle.deliverEphemeral(handMessage('sid-dan', 200, 200));
      runFrame();
    }
    expect(rt.eval(`Lively.handForSid('sid-dan') != null`)).toBe(true);

    // bye: gone this very frame. A bye for an unknown sid is a no-op.
    handle.deliverEphemeral(handMessage('sid-dan', 0, 0, { bye: true }));
    handle.deliverEphemeral(handMessage('sid-nobody', 0, 0, { bye: true }));
    runFrame();
    expect(rt.eval(`Lively.handForSid('sid-dan')`)).toBeNull();
    expect(rt.eval(`Lively.$hands.length`)).toBe(0);
  }, 60_000);

  it('ignores my own echo and malformed hand payloads (but still applies the overlays beside them)', () => {
    const { handle, rt, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;
    const mySid = rt.eval(`$ephSessionID`) as string;
    handle.deliverEphemeral(handMessage(mySid, 5, 5, { actor: 'actor-test' }));
    runFrame();
    expect(rt.eval(`Lively.$hands == null || Lively.$hands.length === 0`)).toBe(true);

    const bad: unknown[] = [
      { x: NaN, y: 1, ci: 0 },
      { x: 1, y: Infinity, ci: 0 },
      { x: 1, y: 1, ci: 1.5 },
      { x: 1, y: 1, ci: -1 },
      { x: 1, y: 1, ci: 0, name: 'x'.repeat(40) },
      { x: 1, y: 1, ci: 0, carrying: [1, 2] },
      'not an object',
      { x: 'a', y: 'b' },
    ];
    bad.forEach((hand, i) => {
      handle.deliverEphemeral(handMessage(`sid-bad-${i}`, 0, 0, { hand, objects: [boxOverlay(boxId, 300, 300)] }));
    });
    runFrame();
    expect(rt.eval(`Lively.$hands == null || Lively.$hands.length === 0`)).toBe(true);
    // The overlay in the same message still applied.
    expect(rt.eval(`Lively.testBox.$transform != null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBe(300);
    // A message must carry a sid to place a hand.
    handle.deliverEphemeral({ type: 'lm-eph', v: 1, actor: 'actor-old', objects: [], hand: { x: 1, y: 1, ci: 0 } });
    runFrame();
    expect(rt.eval(`Lively.$hands == null || Lively.$hands.length === 0`)).toBe(true);
  }, 60_000);

  it("tints what a peer carries and caps the number of peers' hands", () => {
    const { handle, rt, runFrame } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;
    handle.deliverEphemeral(
      handMessage('sid-dan', 50, 30, { actor: 'actor-dan', carrying: [boxId, 'no-such-morph'] }),
    );
    runFrame();
    expect(rt.eval(`Lively.testBox.$carriedBy === Lively.handForSid('sid-dan')`)).toBe(true);
    handle.deliverEphemeral(handMessage('sid-dan', 60, 40, { actor: 'actor-dan' }));
    runFrame();
    expect(rt.eval(`Lively.testBox.$carriedBy == null`)).toBe(true);
    // Removal (TTL or bye) while carrying clears the tint edge too.
    handle.deliverEphemeral(handMessage('sid-dan', 60, 40, { actor: 'actor-dan', carrying: [boxId] }));
    runFrame();
    expect(rt.eval(`Lively.testBox.$carriedBy != null`)).toBe(true);
    handle.deliverEphemeral(handMessage('sid-dan', 0, 0, { bye: true }));
    runFrame();
    expect(rt.eval(`Lively.testBox.$carriedBy == null`)).toBe(true);

    rt.eval(`$HAND_MAX_REMOTE = 3`);
    for (let i = 0; i < 6; i++) handle.deliverEphemeral(handMessage(`sid-${i}`, i, i, { actor: `actor-${i}` }));
    runFrame();
    expect(rt.eval(`Lively.remoteHandCount()`)).toBe(3);
  }, 60_000);
});

describe('hands: carrying morphs', () => {
  it('Alt-click picks a morph up in the world, moves it ephemerally (streamed), commits once on drop, and never promotes the hand', () => {
    const { handle, rt, dispatch, runFrame, runFrames, opsDuring, docEntryCount, inDoc } = makeWorld();
    const boxId = rt.eval(`Lively.testBox.$id`) as string;
    const entriesBefore = docEntryCount();

    // Alt-press on the box picks it up; releasing without moving keeps carrying (sticky).
    const grab = opsDuring(() => {
      dispatch('pointerdown', 50, 30, { altKey: true });
      runFrame();
      dispatch('pointerup', 50, 30, { altKey: true });
      runFrame();
    });
    expect(grab.count, grab.keys.join('\n')).toBeLessThanOrEqual(2);
    expect(rt.eval(`Lively.myHand().isLaden()`)).toBe(true);
    expect(rt.eval(`Lively.myHand().$carrying.includes(Lively.testBox)`)).toBe(true);
    expect(rt.eval(`Lively.testBox.$carriedBy === Lively.myHand()`)).toBe(true);
    expect(rt.eval(`Lively.testBox.$dragActorID`)).toBe('actor-test');
    // Not a submorph of the hand: still a persistent world child, on an ephemeral transform.
    expect(rt.eval(`Lively.testBox.owner === Lively`)).toBe(true);
    expect(rt.eval(`Lively.submorphs.includes(Lively.testBox)`)).toBe(true);
    expect(rt.eval(`Lively.testBox.$transform != null`)).toBe(true);
    expect(rt.eval(`Lively.myHand().submorphs.length`)).toBe(0);

    // Carrying: the box follows the hand, the document does not change, peers watch.
    const carry = opsDuring(() => {
      for (let i = 1; i <= 10; i++) {
        dispatch('pointermove', 50 + i * 10, 30 + i * 5);
        runFrame();
      }
    });
    expect(carry.count, carry.keys.join('\n')).toBe(0);
    expect(rt.eval(`Lively.testBox.transform.translation.x`)).toBeCloseTo(130, 6); // 30 + 100
    expect(rt.eval(`Lively.testBox.transform.translation.y`)).toBeCloseTo(70, 6); // 20 + 50
    expect(rt.eval(`Lively.testBox._transform.translation.x`)).toBe(30);
    expect(rt.eval(`Lively.testBox._transform.translation.y`)).toBe(20);
    const mid = lastSent(handle);
    expect(mid.objects.length).toBe(1);
    expect(mid.objects[0].id).toBe(boxId);
    expect(mid.objects[0].props.transform.translation.x).toBeCloseTo(130, 6);
    expect(mid.hand.x).toBe(150);
    expect(Array.from(mid.hand.carrying)).toEqual([boxId]);

    // Alt-click again drops it: one commit, in place.
    const drop = opsDuring(() => {
      dispatch('pointerdown', 150, 80, { altKey: true });
      runFrame();
      dispatch('pointerup', 150, 80, { altKey: true });
      runFrame();
    });
    expect(drop.count, drop.keys.join('\n')).toBeGreaterThan(0);
    expect(drop.count, drop.keys.join('\n')).toBeLessThanOrEqual(12);
    expect(rt.eval(`Lively.myHand().isLaden()`)).toBe(false);
    expect(rt.eval(`Lively.testBox.$carriedBy == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox.$transform == null`)).toBe(true);
    expect(rt.eval(`Lively.testBox._transform.translation.x`)).toBeCloseTo(130, 6);
    expect(rt.eval(`Lively.testBox._transform.translation.y`)).toBeCloseTo(70, 6);
    expect(rt.eval(`Lively.testBox.owner === Lively`)).toBe(true);
    // The end message (after the commit) carries the committed values and no cargo.
    const endMsgs = handle.sentEphemeral.filter((m: any) => m.end === true) as any[];
    expect(endMsgs.length).toBe(1);
    expect(endMsgs[0].objects[0].id).toBe(boxId);
    expect(endMsgs[0].objects[0].props.transform.translation.x).toBeCloseTo(130, 6);
    expect(endMsgs[0].hand.carrying).toBeUndefined();

    // Promotion regression: after the whole cycle the hand is still nowhere in the document.
    runFrames(3);
    expect(inDoc(rt.eval(`Lively.myHand().$id`) as string)).toBe(false);
    expect(inDoc(rt.eval(`Lively.myHand().shape.$id`) as string)).toBe(false);
    expect(inDoc(rt.eval(`Lively.myHand()._transform.$id`) as string)).toBe(false);
    expect(docEntryCount()).toBe(entriesBefore);
  }, 60_000);

  it('Alt+Shift-click picks up a copy; Alt-drag-release drops', () => {
    const { rt, dispatch, runFrame } = makeWorld();
    dispatch('pointerdown', 50, 30, { altKey: true, shiftKey: true });
    runFrame();
    expect(rt.eval(`Lively.myHand().isLaden()`)).toBe(true);
    expect(rt.eval(`Lively.myHand().$carrying.includes(Lively.testBox)`)).toBe(false);
    expect(rt.eval(`Lively.submorphs.length`)).toBe(2);
    expect(rt.eval(`Lively.myHand().$carrying[0].owner === Lively`)).toBe(true);
    // Dragging farther than 2px before releasing drops the cargo where it is.
    dispatch('pointermove', 250, 230, { altKey: true });
    runFrame();
    dispatch('pointerup', 250, 230, { altKey: true });
    runFrame();
    expect(rt.eval(`Lively.myHand().isLaden()`)).toBe(false);
    expect(rt.eval(`Lively.submorphs.length`)).toBe(2);
    expect(rt.eval(`Lively.submorphs.every((m) => m.$transform == null)`)).toBe(true);
    const xs = rt.eval(`Lively.submorphs.map((m) => m._transform.translation.x).sort((a, b) => a - b)`) as number[];
    expect(xs[0]).toBe(30);
    expect(xs[1]).toBeCloseTo(230, 6); // 30 + 200
  }, 60_000);
});

describe('hands: legacy documents', () => {
  it('drops a persisted world.hands list on the first frame and never renders from it', () => {
    const { rt, runFrame, opsDuring } = makeWorld();
    // What an old session left behind: hands in the document.
    rt.eval(`Lively.hands = [new HandMorph('actor-old', pt(5, 5), Color.red)]`);
    expect(rt.eval(`Lively.hands.length`)).toBe(1);
    const first = opsDuring(() => runFrame());
    expect(rt.eval(`Lively.hands`)).toBeNull();
    expect(first.count, first.keys.join('\n')).toBeLessThanOrEqual(1); // the one register write
    expect(rt.eval(`Lively.$hands == null || Lively.$hands.length === 0`)).toBe(true);
    const later = opsDuring(() => {
      runFrame();
      runFrame();
    });
    expect(later.count, later.keys.join('\n')).toBe(0);
  }, 60_000);
});
