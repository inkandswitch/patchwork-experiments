/**
 * Regression test: hit detection on rotated morphs (July 2026).
 *
 * Two bugs made pointer hits on rotated morphs land where the morph *would be*
 * unrotated, not where it is rendered:
 *  1. Morph.fullBounds() — the prefilter used by topMorphAt and pointer
 *     dispatch — applied only the transform's translation, ignoring rotation
 *     and scale.
 *  2. SimpleTransform.transformPt rotated with Point.rotatedBy(+rotation), but
 *     rotatedBy turns the opposite way from ctx.rotate (polarAngle is measured
 *     from +y), so globalize / transformed bounds were mirrored for rotated
 *     morphs.
 *
 * Uses the same browser stubs as newdefsDrag.test.ts: real transpiled
 * newdefs.js on an automerge-backed runtime.
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

describe('rotated morph hit detection', () => {
  it('hit-tests and globalizes rotated morphs where they are rendered', () => {
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
    const docHandle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(docHandle);
    const g = globalThis as any;
    g.handle = docHandle;
    g.runtime = rt;
    const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
    rt.eval(src);

    // A 100x20 strip anchored at (200,200), rotated +90° (ctx.rotate sense).
    // rotateBy pivots about the shape center (250,210), so the strip renders
    // vertically, still centered there: x in 240..260, y in 160..260.
    rt.eval(`
initUI();
initLively();
Lively.rotBox = Lively.addMorph(new Morph(rect(200, 200, 100, 20)));
Lively.rotBox.rotateBy(Math.PI / 2);
`);

    // The shape center stayed put through the rotation.
    expect(rt.eval(`Lively.rotBox.globalize(pt(50, 10)).x`)).toBeCloseTo(250, 6);
    expect(rt.eval(`Lively.rotBox.globalize(pt(50, 10)).y`)).toBeCloseTo(210, 6);

    // A point on the rendered (rotated) strip hits the morph...
    expect(rt.eval(`Lively.rotBox.includesPt(pt(250, 180))`)).toBe(true);
    expect(rt.eval(`Lively.topMorphAt(pt(250, 180)) === Lively.rotBox`)).toBe(true);
    // ...and a point inside the *unrotated* footprint (x:200..300, y:200..220)
    // no longer does.
    expect(rt.eval(`Lively.rotBox.includesPt(pt(220, 210))`)).toBe(false);
    expect(rt.eval(`Lively.topMorphAt(pt(220, 210)) === Lively.rotBox`)).toBe(false);

    // fullBounds matches the rendered footprint.
    const fb = rt.eval(
      `let b = Lively.rotBox.fullBounds(); [b.topLeft.x, b.topLeft.y, b.bottomRight().x, b.bottomRight().y].join(',')`,
    );
    const [left, top, right, bottom] = String(fb).split(',').map(Number);
    expect(left).toBeCloseTo(240, 6);
    expect(top).toBeCloseTo(160, 6);
    expect(right).toBeCloseTo(260, 6);
    expect(bottom).toBeCloseTo(260, 6);

    // At 45°, fullBounds is a strictly larger AABB than the rotated strip, so
    // topMorphAt must be shape-exact: corner wedges inside the AABB but off
    // the shape don't hit.
    rt.eval(`
Lively.rotBox2 = Lively.addMorph(new Morph(rect(400, 400, 100, 20)));
Lively.rotBox2.rotateBy(Math.PI / 4);
`);
    expect(
      rt.eval(`Lively.topMorphAt(Lively.rotBox2.globalize(pt(50, 10))) === Lively.rotBox2`),
    ).toBe(true);
    expect(rt.eval(`Lively.rotBox2.fullBounds().includesPt(pt(410, 370))`)).toBe(true);
    expect(rt.eval(`Lively.topMorphAt(pt(410, 370)) === Lively.rotBox2`)).toBe(false);

    // globalize agrees with ctx.rotate: local (100,0) is the strip's far end,
    // rendered straight down from the strip's fixed center (250,210).
    expect(rt.eval(`Lively.rotBox.globalize(pt(100, 0)).x`)).toBeCloseTo(260, 6);
    expect(rt.eval(`Lively.rotBox.globalize(pt(100, 0)).y`)).toBeCloseTo(260, 6);
    // localize is its inverse.
    expect(rt.eval(`Lively.rotBox.localize(pt(260, 260)).x`)).toBeCloseTo(100, 6);
    expect(rt.eval(`Lively.rotBox.localize(pt(260, 260)).y`)).toBeCloseTo(0, 6);
  }, 60_000);
});
