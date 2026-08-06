/**
 * Regression test: morphCopy() must point each copied child's owner at the
 * copy, not at the original's owner. repairSubmorphOwnership() (run on boot
 * and after every batch of remote changes) treats the owner back-pointer as
 * truth and strips foreign-owned entries, so a wrong back-pointer silently
 * dropped the copy's whole subtree on the next merge or reload.
 *
 * Uses the same browser stubs as zOrder.test.ts / ephemeralSubmorphs.test.ts:
 * real transpiled newdefs.js, real Automerge document.
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
`);
  return { handle, rt };
}

describe('morphCopy submorph ownership', () => {
  it('copied children point at the copy, and survive repairSubmorphOwnership', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.box = Lively.addMorph(new Morph(rect(10, 10, 200, 200)));
Lively.k1 = Lively.box.addMorph(new Morph(rect(0, 0, 50, 50)));
Lively.k2 = Lively.box.addMorph(new Morph(rect(0, 0, 60, 60)));
Lively.grandkid = Lively.k1.addMorph(new Morph(rect(0, 0, 20, 20)));
Lively.copy = Lively.addMorph(Lively.box.morphCopy());
`);
    // owner back-pointers land on the copy, recursively
    expect(rt.eval(`Lively.copy.submorphs.length`)).toBe(2);
    expect(rt.eval(`Lively.copy.submorphs.at(0).owner === Lively.copy`)).toBe(true);
    expect(rt.eval(`Lively.copy.submorphs.at(1).owner === Lively.copy`)).toBe(true);
    expect(
      rt.eval(
        `Lively.copy.submorphs.at(0).submorphs.at(0).owner === Lively.copy.submorphs.at(0)`,
      ),
    ).toBe(true);
    // the merge repair (boot + after every remote batch) keeps the subtree
    rt.eval(`Lively.repairSubmorphOwnership();`);
    expect(rt.eval(`Lively.copy.submorphs.length`)).toBe(2);
    expect(rt.eval(`Lively.copy.submorphs.at(0).submorphs.length`)).toBe(1);
    // the original's children were not stolen
    expect(rt.eval(`Lively.box.submorphs.length`)).toBe(2);
    expect(rt.eval(`Lively.k1.owner === Lively.box`)).toBe(true);
    expect(rt.eval(`Lively.grandkid.owner === Lively.k1`)).toBe(true);
  }, 60_000);
});
