/**
 * Part names (Morph.setName / getName / get / getSubmorphNamed / getOwnerNamed /
 * getAllNamed / partNames), after Lively Kernel. Real transpiled newdefs.js on a
 * real Automerge document, with the same browser stubs as morphCopyOwnership.test.ts.
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
        if (prop === 'querySelector') return (sel: string) => (sel === 'canvas' ? canvas : null);
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
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8'));
  rt.eval(`
initUI();
initLively();
// clock ── face ── hourHand
//       │      └── label (named 'hand' too, deeper than clock's own 'hand')
//       └── hand
// other ── hourHand (a second, more distant 'hourHand')
Lively.clock = Lively.addMorph(new Morph(rect(10, 10, 200, 200)).setName('clock'));
Lively.face = Lively.clock.addMorph(new Morph(rect(0, 0, 150, 150)).setName('face'));
Lively.hour = Lively.face.addMorph(new Morph(rect(0, 0, 10, 60)).setName('hourHand'));
Lively.deepHand = Lively.face.addMorph(new Morph(rect(0, 0, 5, 5)).setName('hand'));
Lively.hand = Lively.clock.addMorph(new Morph(rect(0, 0, 8, 8)).setName('hand'));
Lively.other = Lively.addMorph(new Morph(rect(300, 10, 100, 100)).setName('other'));
Lively.otherHour = Lively.other.addMorph(new Morph(rect(0, 0, 10, 40)).setName('hourHand'));
`);
  return { handle, rt };
}

describe('part names', () => {
  it('setName chains, getName reads, empty clears', () => {
    const { rt } = makeWorld();
    expect(rt.eval(`Lively.hour.getName()`)).toBe('hourHand');
    expect(rt.eval(`new Morph(rect(0, 0, 1, 1)).getName()`)).toBe(null);
    rt.eval(`Lively.tmp = new Morph(rect(0, 0, 1, 1)).setName('x'); Lively.tmp.setName('');`);
    expect(rt.eval(`Lively.tmp.getName()`)).toBe(null);
    expect(rt.eval(`String(Lively.hour)`)).toContain("named 'hourHand'");
  }, 60_000);

  it('get: self, then nearest descendant (breadth-first), then up through owners', () => {
    const { rt } = makeWorld();
    expect(rt.eval(`Lively.clock.get('clock') === Lively.clock`)).toBe(true);
    // breadth-first: clock's direct 'hand' beats the deeper one under face
    expect(rt.eval(`Lively.clock.get('hand') === Lively.hand`)).toBe(true);
    expect(rt.eval(`Lively.face.get('hand') === Lively.deepHand`)).toBe(true);
    // a part reaches a sibling, and the nearest 'hourHand' wins over the other clock's
    expect(rt.eval(`Lively.hand.get('face') === Lively.face`)).toBe(true);
    expect(rt.eval(`Lively.hand.get('hourHand') === Lively.hour`)).toBe(true);
    expect(rt.eval(`Lively.otherHour.get('hourHand') === Lively.otherHour`)).toBe(true);
    // a cousin across top-level morphs, via the world
    expect(rt.eval(`Lively.hour.get('other') === Lively.other`)).toBe(true);
    expect(rt.eval(`morphNamed('face') === Lively.face`)).toBe(true);
    expect(rt.eval(`Lively.hour.get('nobody')`)).toBe(null);
  }, 60_000);

  it('getSubmorphNamed / getOwnerNamed / getAllNamed / partNames', () => {
    const { rt } = makeWorld();
    expect(rt.eval(`Lively.clock.getSubmorphNamed('clock')`)).toBe(null);
    expect(rt.eval(`Lively.face.getSubmorphNamed('other')`)).toBe(null);
    expect(rt.eval(`Lively.hour.getOwnerNamed('clock') === Lively.clock`)).toBe(true);
    expect(rt.eval(`Lively.hour.getOwnerNamed('other')`)).toBe(null);
    expect(rt.eval(`Lively.getAllNamed('hourHand').length`)).toBe(2);
    // breadth-first, frontmost first, duplicates dropped
    expect(rt.eval(`Lively.clock.partNames().join(',')`)).toBe('hand,face,hourHand');
  }, 60_000);

  it('copies keep part names, so a copied assembly finds its own parts', () => {
    const { rt } = makeWorld();
    rt.eval(`Lively.clock2 = Lively.addMorph(Lively.clock.morphCopy());`);
    expect(rt.eval(`Lively.clock2.getName()`)).toBe('clock');
    expect(rt.eval(`Lively.clock2.get('hourHand') !== Lively.hour`)).toBe(true);
    expect(rt.eval(`Lively.clock2.get('hourHand').getOwnerNamed('clock') === Lively.clock2`)).toBe(true);
  }, 60_000);
});
