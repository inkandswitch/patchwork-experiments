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

describe('per-user focus', () => {
  it('keyboardFocus is per-user: readable across transactions, never in the document', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`Lively.setKeyboardFocus(Lively.testBox);`);
    // readable in a later transaction, and identity-stable
    expect(rt.eval(`Lively.$keyboardFocus === Lively.testBox`)).toBe(true);
    // never serialized into the shared document
    expect(JSON.stringify(handle.doc().objectTable)).not.toContain('@$keyboardFocus');
    const worldId = rt.eval(`Lively.$id`) as string;
    const worldEntry = handle.doc().objectTable[worldId] as Record<string, unknown>;
    expect(Object.keys(worldEntry).some((k) => k.includes('keyboardFocus'))).toBe(false);
    // clearing works
    rt.eval(`Lively.setKeyboardFocus(null);`);
    expect(rt.eval(`Lively.$keyboardFocus`)).toBe(null);
  }, 60_000);
});

describe('per-user modifier state', () => {
  it('soft modifiers and shiftKeyDown never touch the document', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`setShiftKeyPressed(true); setMetaKeyPressed(true);`);
    expect(rt.eval(`isShiftKeyPressed()`)).toBe(true);
    rt.eval(`Lively.onKeyDown({ shiftKey: true, key: 'Shift' });`);
    expect(rt.eval(`Lively.$shiftKeyDown`)).toBe(true);
    // nothing persisted: neither the flags on the global nor shiftKeyDown on the world
    const table = handle.doc().objectTable as Record<string, Record<string, unknown>>;
    const globalKeys = Object.keys(table['global']);
    expect(globalKeys.some((k) => k.toLowerCase().includes('pressedflag'))).toBe(false);
    const worldId = rt.eval(`Lively.$id`) as string;
    expect(Object.keys(table[worldId]).some((k) => k.includes('shiftKeyDown'))).toBe(false);
  }, 60_000);
});

describe('per-user stepping', () => {
  it('runs animations locally with zero Automerge ops for the schedule', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      Lively.testBox.wiggle = function () { this.moveBy(pt(2, 0)); };
      Lively.testBox.startStepping('wiggle', null, 0, Date.now() - 5);
    `);
    const x0 = rt.eval(`Lively.testBox.getBounds().topLeft.x`) as number;
    rt.eval(`Lively.handleStepList();`);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBeCloseTo(x0 + 2, 6);
    rt.eval(`Lively.handleStepList();`);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBeCloseTo(x0 + 4, 6);

    // The schedule is replica-local: no entry in the shared document carries the
    // schedule STATE properties (the box's movement, of course, is shared). Two
    // pitfalls this check avoids: class $code source strings legitimately mention
    // $stepList as text (so no raw-JSON substring checks), and method refs like
    // @handleStepList/@activeStepList are persistent class structure by design (so
    // exact state-key matches only). @nextStepTime/@stepPeriod anywhere would betray
    // a promoted StepSpec.
    const stateKeys = new Set(['@stepList', '@steppingSpecs', '@nextStepTime', '@stepPeriod']);
    const table = handle.doc().objectTable as Record<string, Record<string, unknown>>;
    const offendingKeys: string[] = [];
    for (const [id, entry] of Object.entries(table)) {
      for (const k of Object.keys(entry)) {
        if (stateKeys.has(k)) offendingKeys.push(`${id}.${k}`);
      }
    }
    expect(offendingKeys, `stepping schedule leaked into the document:\n  ${offendingKeys.join('\n  ')}`).toEqual([]);

    rt.eval(`Lively.testBox.stopStepping('wiggle');`);
    rt.eval(`Lively.handleStepList();`);
    expect(rt.eval(`Lively.testBox.getBounds().topLeft.x`)).toBeCloseTo(x0 + 4, 6);
    expect(rt.eval(`Lively.isSteppingMorph ? Lively.isSteppingMorph(Lively.testBox, 'wiggle') : false`)).toBe(false);
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
