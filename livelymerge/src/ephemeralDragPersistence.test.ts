/**
 * Drags, copies, and drops preserve a morph's ephemeral/persistent status, and the
 * halo's new Persist handle promotes an ephemeral morph into the shared document.
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

function docEntryCount(handle: ReturnType<typeof createAutomergeTestDocHandle>) {
  return Object.keys(handle.doc().objectTable).length;
}

describe('drag preserves ephemeral/persistent status', () => {
  it('an ephemeral morph stays ephemeral through pickup and drop, with zero document writes', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      Lively.parentBox = Lively.addMorph(new Morph(rect(100, 100, 100, 80)));
      Lively.targetBox = Lively.addMorph(new Morph(rect(400, 100, 120, 90)));
      Lively.$note = Lively.parentBox.addEphemeralMorph(new Morph(rect(10, 10, 30, 20)));
    `);
    const before = docEntryCount(handle);

    // mid-drag pickup: same call onPointerMove's pick-up-on-drag path makes
    rt.eval(`Lively.$note.reparentToOwnerPreservingWorldAnchor(Lively, pt(15, 15));`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().includes(Lively.$note)`)).toBe(true);
    expect(rt.eval(`Lively.submorphs.includes(Lively.$note)`)).toBe(false);

    // drop over a persistent morph: the edge lands in the target's $submorphs
    rt.eval(`Lively.$note.dropOnTopMorphAt(pt(450, 140));`);
    expect(rt.eval(`Lively.$note.owner === Lively.targetBox`)).toBe(true);
    expect(rt.eval(`Lively.targetBox.ephemeralSubmorphs().includes(Lively.$note)`)).toBe(true);
    expect(rt.eval(`Lively.targetBox.submorphs.includes(Lively.$note)`)).toBe(false);

    // the whole interaction never promoted anything into the document
    expect(docEntryCount(handle)).toBe(before);
  }, 60_000);

  it('a persistent morph stays persistent through the same pickup/drop path', () => {
    const { rt } = makeWorld();
    rt.eval(`
      Lively.parentBox = Lively.addMorph(new Morph(rect(100, 100, 100, 80)));
      Lively.targetBox = Lively.addMorph(new Morph(rect(400, 100, 120, 90)));
      Lively.childBox = Lively.parentBox.addMorph(new Morph(rect(10, 10, 30, 20)));
    `);
    rt.eval(`Lively.childBox.reparentToOwnerPreservingWorldAnchor(Lively, pt(15, 15));`);
    expect(rt.eval(`Lively.submorphs.includes(Lively.childBox)`)).toBe(true);
    expect(rt.eval(`Lively.ephemeralSubmorphs().includes(Lively.childBox)`)).toBe(false);

    rt.eval(`Lively.childBox.dropOnTopMorphAt(pt(450, 140));`);
    expect(rt.eval(`Lively.childBox.owner === Lively.targetBox`)).toBe(true);
    expect(rt.eval(`Lively.targetBox.submorphs.includes(Lively.childBox)`)).toBe(true);
    expect(rt.eval(`Lively.targetBox.ephemeralSubmorphs().includes(Lively.childBox)`)).toBe(false);
  }, 60_000);

  it('dropping a persistent morph onto an ephemeral target is rejected (falls through)', () => {
    const { rt } = makeWorld();
    rt.eval(`
      Lively.$ephPanel = Lively.addEphemeralMorph(new Morph(rect(400, 100, 120, 90)));
      Lively.box = Lively.addMorph(new Morph(rect(30, 300, 60, 30)));
    `);
    rt.eval(`Lively.box.dropOnTopMorphAt(pt(450, 140));`); // over the ephemeral panel
    expect(rt.eval(`Lively.box.owner === Lively`)).toBe(true);
    expect(rt.eval(`Lively.submorphs.includes(Lively.box)`)).toBe(true);
    expect(rt.eval(`Lively.$ephPanel.hasSubmorphs()`)).toBe(false);
  }, 60_000);

  it('dropping an ephemeral morph onto an ephemeral target works', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      Lively.$ephPanel = Lively.addEphemeralMorph(new Morph(rect(400, 100, 120, 90)));
      Lively.$chip = Lively.addEphemeralMorph(new Morph(rect(30, 400, 20, 20)));
    `);
    const before = docEntryCount(handle);
    rt.eval(`Lively.$chip.dropOnTopMorphAt(pt(450, 140));`);
    expect(rt.eval(`Lively.$chip.owner === Lively.$ephPanel`)).toBe(true);
    expect(rt.eval(`Lively.$ephPanel.ephemeralSubmorphs().includes(Lively.$chip)`)).toBe(true);
    expect(docEntryCount(handle)).toBe(before);
  }, 60_000);

  it('a hand grab/drop keeps an ephemeral morph ephemeral', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      Lively.targetBox = Lively.addMorph(new Morph(rect(400, 100, 120, 90)));
      Lively.$chip = Lively.addEphemeralMorph(new Morph(rect(100, 100, 40, 30)));
      Lively.$hand = new HandMorph('actor-test', pt(0, 0), Color.red);
      Lively.$hand.owner = Lively;
    `);
    const before = docEntryCount(handle);
    rt.eval(`Lively.$hand.grabMorph(pt(110, 110));`);
    expect(rt.eval(`Lively.$hand.ephemeralSubmorphs().includes(Lively.$chip)`)).toBe(true);
    rt.eval(`Lively.$hand.dropMorph(pt(450, 140));`);
    expect(rt.eval(`Lively.$chip.owner === Lively.targetBox`)).toBe(true);
    expect(rt.eval(`Lively.targetBox.ephemeralSubmorphs().includes(Lively.$chip)`)).toBe(true);
    expect(docEntryCount(handle)).toBe(before);
  }, 60_000);
});

describe('shift-drag copies preserve the original status', () => {
  it('copying an ephemeral morph yields an ephemeral copy (no document writes)', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      Lively.parentBox = Lively.addMorph(new Morph(rect(100, 100, 200, 150)));
      Lively.$note = Lively.parentBox.addEphemeralMorph(new Morph(rect(10, 10, 30, 20)));
    `);
    const before = docEntryCount(handle);
    const ephBefore = rt.eval(`Lively.ephemeralSubmorphs().length`) as number;
    rt.eval(`Lively.$note.onPointerDown(pt(15, 15), { shiftKey: true });`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(ephBefore + 1);
    // the original never moved: it is still the parent's ephemeral submorph
    expect(rt.eval(`Lively.parentBox.ephemeralSubmorphs().includes(Lively.$note)`)).toBe(true);
    expect(docEntryCount(handle)).toBe(before);
  }, 60_000);

  it('copying a persistent morph yields a persistent copy', () => {
    const { rt } = makeWorld();
    rt.eval(`Lively.box = Lively.addMorph(new Morph(rect(500, 300, 60, 40)));`);
    const persBefore = rt.eval(`Lively.submorphs.length`) as number;
    rt.eval(`Lively.box.onPointerDown(pt(510, 310), { shiftKey: true });`);
    expect(rt.eval(`Lively.submorphs.length`)).toBe(persBefore + 1);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(0);
  }, 60_000);
});

describe('halo Persist handle', () => {
  it('shows only for ephemeral morphs', () => {
    const { rt } = makeWorld();
    rt.eval(`
      Lively.box = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
      Lively.$eph = Lively.addEphemeralMorph(new Morph(rect(300, 300, 60, 30)));
    `);
    rt.eval(`Lively.cycleHaloAt(pt(320, 315));`); // over the ephemeral morph
    expect(
      rt.eval(`
        let halo = Lively.ephemeralSubmorphs().find((m) => m.className == 'HaloMorph');
        halo.persistHandle != null && halo.persistHandle.handleName == 'Persist'
      `),
    ).toBe(true);
    rt.eval(`Lively.cycleHaloAt(pt(700, 550));`); // empty space clears the halo
    rt.eval(`Lively.cycleHaloAt(pt(50, 30));`); // over the persistent morph
    expect(
      rt.eval(`
        let halo = Lively.ephemeralSubmorphs().find((m) => m.className == 'HaloMorph');
        halo.persistHandle == null
      `),
    ).toBe(true);
  }, 60_000);

  it('clicking Persist moves the morph to submorphs and promotes its subtree into the document', () => {
    const { handle, rt } = makeWorld();
    rt.eval(`
      Lively.$eph = Lively.addEphemeralMorph(new Morph(rect(300, 300, 60, 30)));
      Lively.$eph.addMorph(new Morph(rect(5, 5, 10, 10))); // subtree rides along
    `);
    const before = docEntryCount(handle);
    const topLeftX = rt.eval(`Lively.$eph.getBounds().topLeft.x`) as number;
    rt.eval(`Lively.cycleHaloAt(pt(320, 315));`);
    rt.eval(`
      let halo = Lively.ephemeralSubmorphs().find((m) => m.className == 'HaloMorph');
      halo.pointerDownOnHandle(halo.persistHandle, pt(0, 0), {});
    `);
    expect(rt.eval(`Lively.submorphs.includes(Lively.$eph)`)).toBe(true);
    expect(rt.eval(`Lively.ephemeralSubmorphs().includes(Lively.$eph)`)).toBe(false);
    // same owner, same transform: it did not move on screen
    expect(rt.eval(`Lively.$eph.getBounds().topLeft.x`)).toBe(topLeftX);
    // the morph (and its submorph) now live in the shared document
    expect(docEntryCount(handle)).toBeGreaterThan(before);
    // the halo dismissed itself, as all click handles do
    expect(rt.eval(`Lively.allSubmorphs().some((m) => m.className == 'HaloMorph')`)).toBe(false);
  }, 60_000);

  it('canBePersisted is false anywhere inside an ephemeral subtree', () => {
    const { rt } = makeWorld();
    rt.eval(`
      Lively.$panel = Lively.addEphemeralMorph(new Morph(rect(200, 200, 150, 120)));
      Lively.$inner = Lively.$panel.addMorph(new Morph(rect(10, 10, 30, 20)));
      Lively.$badge = Lively.$panel.addEphemeralMorph(new Morph(rect(50, 50, 20, 20)));
    `);
    expect(rt.eval(`Lively.$panel.canBePersisted()`)).toBe(true);
    // persistent edge, but the subtree hangs off the panel's $-edge: nothing to persist
    expect(rt.eval(`Lively.$inner.canBePersisted()`)).toBe(false);
    // $-edge under an ephemeral panel: flipping it would not persist the morph either
    expect(rt.eval(`Lively.$badge.canBePersisted()`)).toBe(false);
  }, 60_000);
});
