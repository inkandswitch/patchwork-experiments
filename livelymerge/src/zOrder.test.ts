/**
 * Tests for zIndex-based stacking: persistent and ephemeral submorphs interleave
 * in one z order per owner (drawList), promote is a single register write (no
 * list splice), zBands keep halos/fleeting menus on top, and pre-zIndex
 * documents are migrated by repairSubmorphOwnership.
 *
 * Uses the same browser stubs as ephemeralSubmorphs.test.ts: real transpiled
 * newdefs.js, real Automerge document.
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

/** Tags of the world's children in draw order (backmost first). */
function drawTags(rt: any): string {
  return rt.eval(
    `Lively.drawList().map((m) => (m.testTag != null ? m.testTag : '?')).join(',')`,
  );
}

/** Ref ids in the world's persistent submorph list, straight from the doc. */
function docWorldListIds(handle: any, rt: any): string[] {
  const worldId = rt.eval(`Lively.$id`) as string;
  const doc = handle.doc();
  const arrId = doc.objectTable[worldId]['@submorphs'].$id;
  return doc.objectTable[arrId].$values.map((v: any) => v.$id);
}

describe('zIndex-based stacking', () => {
  it('new morphs stack in creation order; hit-test order is the exact reverse of draw order', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.b = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.b.testTag = 'b';
Lively.c = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.c.testTag = 'c';
`);
    expect(drawTags(rt)).toBe('a,b,c');
    expect(
      rt.eval(`Lively.allSubmorphsTopFirst().map((m) => m.testTag).join(',')`),
    ).toBe('c,b,a');
    // frontmost of the overlapping trio wins the hit test
    expect(rt.eval(`Lively.topMorphAt(pt(50, 50)).testTag`)).toBe('c');
  }, 60_000);

  it('an ephemeral morph can be interleaved between persistent siblings via zIndex', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.b = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.b.testTag = 'b';
Lively.e = Lively.addEphemeralMorph(new Morph(rect(10, 10, 100, 100))); Lively.e.testTag = 'e';
`);
    // fresh ephemeral starts frontmost in its band
    expect(drawTags(rt)).toBe('a,b,e');
    // slot it between a and b
    rt.eval(`
Lively.e.zIndex = (Lively.a.zIndex + Lively.b.zIndex) / 2;
Lively.zOrderChanged();
`);
    expect(drawTags(rt)).toBe('a,e,b');
    // hit-testing respects the interleaved order: b is now frontmost
    expect(rt.eval(`Lively.topMorphAt(pt(50, 50)).testTag`)).toBe('b');
    // ...and the ephemeral morph still never touches the document
    expect(rt.eval(`Lively.submorphs.length`)).toBe(2);
  }, 60_000);

  it('promote raises a persistent morph above an ephemeral sibling without splicing the doc list', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.b = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.b.testTag = 'b';
Lively.e = Lively.addEphemeralMorph(new Morph(rect(10, 10, 100, 100))); Lively.e.testTag = 'e';
`);
    const listBefore = docWorldListIds(handle, rt);
    rt.eval(`Lively.promote(Lively.a);`);
    // a is now frontmost overall — above the ephemeral morph too (the old
    // scheme could never do this)
    expect(drawTags(rt)).toBe('b,e,a');
    // the persistent list itself was not reordered: promote is a zIndex write
    expect(docWorldListIds(handle, rt)).toEqual(listBefore);
    // promoting the frontmost morph again is a no-op
    const z = rt.eval(`Lively.a.zIndex`);
    rt.eval(`Lively.promote(Lively.a);`);
    expect(rt.eval(`Lively.a.zIndex`)).toBe(z);
  }, 60_000);

  it('zBands: fleeting menus and halos stay above ordinary morphs regardless of promotes', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.menu = Lively.addEphemeralMorph(new Morph(rect(10, 10, 50, 50)));
Lively.menu.isFleetingMenu = true; Lively.menu.testTag = 'menu';
Lively.cycleHaloAt(pt(50, 50)); // halo on a
Lively.world().eachSubmorph((m) => { if (m.className === 'HaloMorph') m.testTag = 'halo'; });
`);
    rt.eval(`Lively.promote(Lively.a);`);
    // ordinary a stays under the overlay bands even though it was just promoted
    expect(drawTags(rt)).toBe('a,halo,menu');
    expect(rt.eval(`Lively.frontmostInBand(0).testTag`)).toBe('a');
    expect(rt.eval(`Lively.frontmostSubmorph().testTag`)).toBe('menu');
  }, 60_000);

  it('repairSubmorphOwnership migrates a pre-zIndex document, preserving list-position stacking', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.b = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.b.testTag = 'b';
Lively.c = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.c.testTag = 'c';
// simulate a document written before zIndex existed
Lively.submorphs.forEach((m) => { m.zIndex = null; });
Lively.repairSubmorphOwnership();
`);
    expect(drawTags(rt)).toBe('a,b,c');
    expect(rt.eval(`Lively.a.zIndex < Lively.b.zIndex && Lively.b.zIndex < Lively.c.zIndex`)).toBe(
      true,
    );
  }, 60_000);

  it('bePersistent keeps the zIndex, so the morph stays put in the stacking order', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.b = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.b.testTag = 'b';
Lively.e = Lively.addEphemeralMorph(new Morph(rect(10, 10, 100, 100))); Lively.e.testTag = 'e';
Lively.e.zIndex = (Lively.a.zIndex + Lively.b.zIndex) / 2;
Lively.zOrderChanged();
`);
    expect(drawTags(rt)).toBe('a,e,b');
    rt.eval(`Lively.e.bePersistent();`);
    // now shared (3 persistent children), same stacking position
    expect(rt.eval(`Lively.submorphs.length`)).toBe(3);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(0);
    expect(drawTags(rt)).toBe('a,e,b');
  }, 60_000);

  it('morphCopy preserves the stacking order of copied submorphs', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.box = Lively.addMorph(new Morph(rect(10, 10, 200, 200)));
Lively.k1 = Lively.box.addMorph(new Morph(rect(0, 0, 50, 50))); // width 50
Lively.k2 = Lively.box.addMorph(new Morph(rect(0, 0, 60, 60))); // width 60
Lively.box.promote(Lively.k1); // k1 above k2
Lively.copy = Lively.box.morphCopy();
`);
    // copies carry zIndex, so the copy's draw order matches the original's:
    // k2 (width 60) behind, k1 (width 50) in front
    expect(
      rt.eval(`Lively.copy.drawList().map((m) => m.shape.getBounds().width()).join(',')`),
    ).toBe('60,50');
  }, 60_000);

  it('removing and re-adding morphs keeps the cached draw order fresh', () => {
    const { rt } = makeWorld();
    rt.eval(`
Lively.a = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.a.testTag = 'a';
Lively.b = Lively.addMorph(new Morph(rect(10, 10, 100, 100))); Lively.b.testTag = 'b';
`);
    expect(drawTags(rt)).toBe('a,b');
    rt.eval(`Lively.a.remove();`);
    expect(drawTags(rt)).toBe('b');
    rt.eval(`Lively.addMorph(Lively.a);`); // re-adding puts it back on top
    expect(drawTags(rt)).toBe('b,a');
  }, 60_000);
});
