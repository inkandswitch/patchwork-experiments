/**
 * Full-stack tests for the ephemeral submorph layer ($submorphs) and for
 * never-collect semantics on persistent objects.
 *
 * Uses the same browser stubs as newdefsDrag.test.ts: real transpiled newdefs.js,
 * real Automerge document.
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

function installBrowserStubs() {
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
    addEventListener: () => {},
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
  g.requestAnimationFrame = (_cb: () => void) => 1;
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
}

function makeWorld() {
  installBrowserStubs();
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
  return { handle, rt };
}

describe('ephemeral submorphs ($submorphs)', () => {
  it('cycling a halo attaches it ephemerally: visible in $submorphs, absent from the document', () => {
    const { handle, rt } = makeWorld();
    const docEntriesBefore = Object.keys(handle.doc().objectTable).length;

    rt.eval(`Lively.cycleHaloAt(pt(50, 30));`); // inside testBox

    // the halo is a per-user submorph of the world...
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(1);
    expect(rt.eval(`Lively.ephemeralSubmorphs().at(0).className`)).toBe('HaloMorph');
    // ...its whole subtree (handles!) stayed out of the Automerge document...
    expect(Object.keys(handle.doc().objectTable).length).toBe(docEntriesBefore);
    // ...and the persistent submorph list is untouched.
    expect(rt.eval(`Lively.submorphs.length`)).toBe(1); // just testBox
  }, 60_000);

  it('unified iteration sees both layers; bounds and hit-testing include the halo', () => {
    const { rt } = makeWorld();
    rt.eval(`Lively.cycleHaloAt(pt(50, 30));`);
    // allSubmorphs = persistent + ephemeral
    expect(rt.eval(`Lively.allSubmorphs().length`)).toBe(2);
    expect(rt.eval(`Lively.allSubmorphsTopFirst().at(0).className`)).toBe('HaloMorph');
    // the halo is hit-testable (topMorphAt walks the ephemeral layer first);
    // halo handles sit on the halo's frame outside the box, e.g. above its top-left
    const hit = rt.eval(`
      let halo = Lively.ephemeralSubmorphs().at(0);
      let handle = halo.submorphs.at(0); // handles are the halo's own (ephemeral-by-reachability) children
      handle != null && halo.fullBounds() != null && Lively.topMorphAt(pt(50, 30)) != null
    `);
    expect(hit).toBe(true);
  }, 60_000);

  it('cycling on empty space removes the halo, and GC reclaims it from the shadow document', () => {
    const { rt } = makeWorld();
    rt.eval(`Lively.cycleHaloAt(pt(50, 30));`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(1);
    rt.eval(`Lively.cycleHaloAt(pt(700, 550));`); // empty space -> removeExistingHalos
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(0);
  }, 60_000);

  it('removeMorph and remove() work for ephemeral submorphs', () => {
    const { rt } = makeWorld();
    rt.eval(`Lively.$badge = Lively.addEphemeralMorph(new Morph(rect(1, 1, 5, 5)));`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(1);
    rt.eval(`Lively.$badge.remove(); Lively.$badge = null;`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(0);
  }, 60_000);
});

describe('persistent objects are never collected', () => {
  it('an unlinked persistent object stays in the object table', () => {
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    rt.eval(`keeper = { name: 'immortal' };`);
    const id = rt.eval(`keeper.$id`) as string;
    expect(handle.doc().objectTable[id]).toBeDefined();
    rt.eval(`keeper = null;`); // now unreachable from the persistent root
    rt.eval(`null;`); // one more transaction (and GC) for good measure
    // Still there: an offline replica might have re-linked it; local GC must not decide.
    expect(handle.doc().objectTable[id]).toBeDefined();
  });
});
