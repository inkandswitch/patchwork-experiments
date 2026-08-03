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
}

function boot() {
  const harness: Harness = { listeners: new Map(), rafQueue: [] };
  installBrowserStubs(harness);
  const docHandle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(docHandle);
  const g = globalThis as any;
  g.handle = docHandle;
  g.runtime = rt;
  const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
  rt.eval(src.replace(/\binit\(\)\s*$/, ''));
  rt.eval(`
initUI();
initLively();
Lively.parentBox = Lively.addMorph(new Morph(rect(200, 200, 160, 120)));
Lively.childBox = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
`);

  const makeNativeEvt = (type: string, x: number, y: number, mods: any = {}) => ({
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
    ...mods,
  });

  const dispatch = (type: string, x: number, y: number, mods: any = {}) => {
    const fns = harness.listeners.get(type) ?? [];
    expect(fns.length).toBeGreaterThan(0);
    for (const fn of fns) fn(makeNativeEvt(type, x, y, mods));
  };

  let frameError: unknown = null;
  const origConsoleError = console.error;
  const runFrame = () => {
    const cb = harness.rafQueue.shift();
    if (!cb) throw new Error('no rAF scheduled');
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

  return { rt, docHandle, dispatch, runFrame, getFrameError: () => frameError };
}

/** Count occurrences of `childId` refs in each doc-level submorph list, by walking the raw doc. */
function docListCounts(docHandle: any, rt: any) {
  const childId = rt.eval(`Lively.childBox.$id`) as string;
  const parentId = rt.eval(`Lively.parentBox.$id`) as string;
  const worldId = rt.eval(`Lively.childBox.world().$id`) as string;
  const doc = docHandle.doc();
  const table = doc.objectTable;
  const listFor = (ownerId: string) => {
    const entry = table[ownerId];
    if (!entry) return null;
    const subsRef = (entry as any)['@submorphs'];
    if (!subsRef || subsRef.$type !== 'ref') return null;
    const arr = table[subsRef.$id];
    return arr ? (arr as any).$values : null;
  };
  const countIn = (vals: any[] | null) =>
    vals ? vals.filter((v) => v && v.$type === 'ref' && v.$id === childId).length : 0;
  return {
    docWorldCount: countIn(listFor(worldId)),
    docParentCount: countIn(listFor(parentId)),
  };
}

function snapshot(rt: any) {
  rt.eval(`
Lively.snapWorld = Lively.childBox.world();
Lively.snapCount = function (list, m) {
  let n = 0;
  if (list) list.forEach((x) => { if (x === m) n++; });
  return n;
};
`);
  return {
    childOwnerIsParent: rt.eval(`Lively.childBox.owner === Lively.parentBox`),
    childOwnerIsWorld: rt.eval(`Lively.childBox.owner === Lively.snapWorld`),
    inWorldSub: rt.eval(`Lively.snapCount(Lively.snapWorld.submorphs, Lively.childBox)`),
    inWorldEph: rt.eval(`Lively.snapCount(Lively.snapWorld.$submorphs, Lively.childBox)`),
    inParentSub: rt.eval(`Lively.snapCount(Lively.parentBox.submorphs, Lively.childBox)`),
    inParentEph: rt.eval(`Lively.snapCount(Lively.parentBox.$submorphs, Lively.childBox)`),
    childTopLeftX: rt.eval(`Lively.childBox.getBounds().topLeft.x`),
    childTopLeftY: rt.eval(`Lively.childBox.getBounds().topLeft.y`),
    ownerClass: rt.eval(`Lively.childBox.owner ? Lively.childBox.owner.className : null`),
  };
}

describe('reparent duplication repro', () => {
  it('plain drag of child onto parent leaves exactly one copy, inside the parent', () => {
    const { rt, docHandle, dispatch, runFrame, getFrameError } = boot();

    // Grab the child (bounds 30..90 x 20..50) and drag it onto the parent (200..360 x 200..320).
    dispatch('pointerdown', 50, 30);
    runFrame();
    dispatch('pointermove', 150, 130);
    runFrame();
    dispatch('pointermove', 250, 240);
    runFrame();
    dispatch('pointerup', 250, 240);
    runFrame();

    const snap = snapshot(rt);
    const docCounts = docListCounts(docHandle, rt);
    expect(docCounts.docParentCount).toBe(1);
    expect(docCounts.docWorldCount).toBe(0);
    expect(getFrameError()).toBeNull();
    expect(snap.childOwnerIsParent).toBe(true);
    expect(snap.inParentSub).toBe(1);
    expect(snap.inWorldSub).toBe(0);
    expect(snap.inWorldEph).toBe(0);
  }, 60_000);

  it('halo Grab of child dropped onto parent leaves exactly one copy, inside the parent', () => {
    const { rt, docHandle, dispatch, runFrame, getFrameError } = boot();

    // Summon the halo on the child, then find the Grab handle's world position.
    rt.eval(`Lively.childBox.showHalo();`);
    runFrame();
    const gx = rt.eval(`
(() => {
  let world = Lively.childBox.world();
  let halo = world.$submorphs.at(-1);
  Lively.testHalo = halo;
  let h = halo.grabHandle;
  return halo.transform.transformPt(h.transform.transformPt(h.shape.getBounds().center())).x;
})()
`) as number;
    const gy = rt.eval(`
(() => {
  let halo = Lively.testHalo;
  let h = halo.grabHandle;
  return halo.transform.transformPt(h.transform.transformPt(h.shape.getBounds().center())).y;
})()
`) as number;
    // Drag the Grab handle onto the parent.
    dispatch('pointerdown', gx, gy);
    runFrame();
    dispatch('pointermove', gx + 50, gy + 60);
    runFrame();
    dispatch('pointermove', 260, 250);
    runFrame();
    dispatch('pointerup', 260, 250);
    runFrame();

    const snap = snapshot(rt);
    const docCounts = docListCounts(docHandle, rt);
    expect(docCounts.docParentCount).toBe(1);
    expect(docCounts.docWorldCount).toBe(0);
    expect(getFrameError()).toBeNull();
    expect(snap.childOwnerIsParent).toBe(true);
    expect(snap.inParentSub).toBe(1);
    expect(snap.inWorldSub).toBe(0);
    expect(snap.inWorldEph).toBe(0);
  }, 60_000);

  it('concurrent remote z-order promote + local reparent do not duplicate the child', () => {
    const { rt, docHandle, runFrame, getFrameError } = boot();
    // A third morph on top, so the child is NOT frontmost and a remote click
    // on it triggers a real promote (splice out + reinsert).
    rt.eval(`Lively.otherBox = Lively.addMorph(new Morph(rect(500, 400, 40, 40)));`);
    runFrame();

    const childId = rt.eval(`Lively.childBox.$id`) as string;
    const worldId = rt.eval(`Lively.childBox.world().$id`) as string;

    // Fork the doc as a concurrent replica B and simulate what beTopMorph ->
    // promote() writes there when the user clicks the child: remove the child's
    // ref from the world list and reinsert it at the end (frontmost).
    const forked = Automerge.clone(docHandle.doc());
    const forkedB = Automerge.change(forked, (d: any) => {
      const arrId = d.objectTable[worldId]['@submorphs'].$id;
      const vals = d.objectTable[arrId].$values;
      const idx = vals.findIndex((v: any) => v && v.$type === 'ref' && v.$id === childId);
      expect(idx).toBeGreaterThanOrEqual(0);
      vals.splice(idx, 1);
      vals.push({ $type: 'ref', $id: childId });
    });

    // Meanwhile replica A (this runtime) reparents the child into the parent.
    rt.eval(`Lively.parentBox.addMorph(Lively.childBox);`);
    runFrame();

    // Replica B's concurrent change syncs in.
    docHandle.mergeRemote(forkedB);
    rt.noteExternalChanges();
    runFrame();

    const snap = snapshot(rt);
    const docCounts = docListCounts(docHandle, rt);
    expect(getFrameError()).toBeNull();
    expect(snap.childOwnerIsParent).toBe(true);
    expect(snap.inParentSub).toBe(1);
    expect(snap.inWorldSub).toBe(0);
    expect(snap.inWorldEph).toBe(0);
  }, 60_000);

  it('programmatic addMorph across transactions leaves exactly one copy', () => {
    const { rt, docHandle, runFrame, getFrameError } = boot();
    runFrame();
    rt.eval(`Lively.parentBox.addMorph(Lively.childBox);`);
    runFrame();

    const snap = snapshot(rt);
    const docCounts = docListCounts(docHandle, rt);
    expect(docCounts.docParentCount).toBe(1);
    expect(docCounts.docWorldCount).toBe(0);
    expect(getFrameError()).toBeNull();
    expect(snap.childOwnerIsParent).toBe(true);
    expect(snap.inParentSub).toBe(1);
    expect(snap.inWorldSub).toBe(0);
    expect(snap.inWorldEph).toBe(0);
  }, 60_000);
});
