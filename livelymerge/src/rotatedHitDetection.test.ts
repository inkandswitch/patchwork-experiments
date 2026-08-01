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
    // Strip the trailing top-level init() (see the halo test below for why).
    rt.eval(src.replace(/\binit\(\)\s*$/, ''));

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

  it('frames halos around rotated morphs where they are rendered (boundsInWorld)', () => {
    // Regression (July 2026): boundsInWorld() applied only the owner chain's
    // transforms, never this morph's own rotation/scale, so a re-summoned halo
    // (meta-click after rotating via the halo's R handle) framed the morph's
    // unrotated footprint. The drift is c - R·c for shape-local center c, so it
    // was worst for shapes whose local bounds sit far from their origin, like
    // the spiral trail polyline in populateLively().
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
    const docHandle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(docHandle);
    const g = globalThis as any;
    g.handle = docHandle;
    g.runtime = rt;
    const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
    // Strip the file's trailing top-level init(): it boots a demo world and
    // schedules timers against it, which crash later once the test's own
    // initLively() replaces the global Lively.
    rt.eval(src.replace(/\binit\(\)\s*$/, ''));

    rt.eval(`
initUI();
initLively();
Lively.rotBox = Lively.addMorph(new Morph(rect(200, 200, 100, 20)));
Lively.rotBox.rotateBy(Math.PI / 2);
`);

    // boundsInWorld matches the rendered footprint (same as fullBounds for a
    // top-level morph): the strip renders vertically, centered at (250,210).
    const biw = rt.eval(
      `let b = Lively.rotBox.boundsInWorld(); [b.topLeft.x, b.topLeft.y, b.bottomRight().x, b.bottomRight().y].join(',')`,
    );
    const [left, top, right, bottom] = String(biw).split(',').map(Number);
    expect(left).toBeCloseTo(240, 6);
    expect(top).toBeCloseTo(160, 6);
    expect(right).toBeCloseTo(260, 6);
    expect(bottom).toBeCloseTo(260, 6);

    // The spiral-trail scenario: a polyline whose shape bounds are far from its
    // local origin (vertices near (60,210), identity translation), rotated a
    // half turn. Pre-fix, boundsInWorld didn't even overlap the real footprint.
    rt.eval(`
Lively.trail = Lively.addMorph(
  new Morph(null, new PolyLine([pt(60, 210), pt(160, 210), pt(110, 260)], 4, Color.black)));
Lively.trail.rotateBy(Math.PI);
`);
    expect(
      rt.eval(`
let fb = Lively.trail.fullBounds();
let bw = Lively.trail.boundsInWorld();
Math.abs(fb.topLeft.x - bw.topLeft.x) < 1e-6 &&
  Math.abs(fb.topLeft.y - bw.topLeft.y) < 1e-6 &&
  Math.abs(fb.extent.x - bw.extent.x) < 1e-6 &&
  Math.abs(fb.extent.y - bw.extent.y) < 1e-6
`),
    ).toBe(true);

    // Meta-click flow: the halo built for the rotated morph surrounds its
    // rendered extent (halo frame = clippedBoundsInWorld inset by -10).
    expect(
      rt.eval(`
Lively.trail.showHalo();
let halo = Lively.ephemeralSubmorphs().find((m) => m.className == 'HaloMorph');
halo && halo.getBounds().containsRect
  ? halo.getBounds().containsRect(Lively.trail.fullBounds())
  : halo.getBounds().includesPt(Lively.trail.fullBounds().topLeft) &&
    halo.getBounds().includesPt(Lively.trail.fullBounds().bottomRight())
`),
    ).toBe(true);
  }, 60_000);

  it('scale handle resizes rotated morphs about a fixed anchor', () => {
    // Regression (July 2026), three Scale-handle bugs:
    //  1. dragMovedBy moved the handle by delta twice, so resizes ran at 2x
    //     pointer speed.
    //  2. The resize path set owner-coord bounds via setBounds, which warps a
    //     rotated target (setBounds math assumes an identity rotation).
    //  3. The shift (transform-scale) path scaled about the local origin with
    //     no translation compensation, so rotated / origin-offset targets
    //     drifted while scaling.
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
    const docHandle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(docHandle);
    const g = globalThis as any;
    g.handle = docHandle;
    g.runtime = rt;
    const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
    // Strip the trailing top-level init() (see the halo-frame test above).
    rt.eval(src.replace(/\binit\(\)\s*$/, ''));
    rt.eval(`
initUI();
initLively();
`);
    const pumpFrame = () => {
      const cbs = harness.rafQueue.splice(0, harness.rafQueue.length);
      cbs.forEach((cb) => cb());
    };
    const dispatch = (type: string, x: number, y: number, extra: object = {}) => {
      (harness.listeners.get(type) ?? []).forEach((fn) =>
        fn({ type, pointerId: 1, button: 0, offsetX: x, offsetY: y, pointerType: 'mouse', ...extra }),
      );
      pumpFrame();
    };
    pumpFrame();
    // NOTE: no top-level `let` bindings to halo UI in these evals — non-$
    // globals are persistent, so a binding would promote the (ephemeral) halo
    // into the document and wreck the op-economy assertions below.
    const scaleHandleCenter = (): [number, number] => {
      const x = rt.eval(
        `(() => { let halo = Lively.ephemeralSubmorphs().find((m) => m.className == 'HaloMorph'); return halo.globalize(halo.resizeHandle.getBounds().center()).x; })()`,
      ) as number;
      const y = rt.eval(
        `(() => { let halo = Lively.ephemeralSubmorphs().find((m) => m.className == 'HaloMorph'); return halo.globalize(halo.resizeHandle.getBounds().center()).y; })()`,
      ) as number;
      return [x, y];
    };

    // --- Unrotated resize tracks the pointer 1:1 (not 2x). While dragging,
    // the target's bottomRight snaps to the handle's center and then follows
    // it exactly, so the final extent is (handle center + drag delta - topLeft).
    rt.eval(`
Lively.box = Lively.addMorph(new Morph(rect(100, 100, 80, 50)));
Lively.box.showHalo();
`);
    const [bx, by] = scaleHandleCenter();
    dispatch('pointerdown', bx, by);
    dispatch('pointermove', bx + 40, by + 20);
    dispatch('pointerup', bx + 40, by + 20);
    expect(rt.eval(`Lively.box.getBounds().topLeft.x`)).toBeCloseTo(100, 4);
    expect(rt.eval(`Lively.box.getBounds().topLeft.y`)).toBeCloseTo(100, 4);
    expect(rt.eval(`Lively.box.getBounds().extent.x`)).toBeCloseTo(bx + 40 - 100, 4);
    expect(rt.eval(`Lively.box.getBounds().extent.y`)).toBeCloseTo(by + 20 - 100, 4);

    // --- Rotated resize: reshapes the shape in local coords. The rendered
    // anchor corner (the shape's local topLeft) stays fixed and the rendered
    // opposite corner ends up under the handle.
    rt.eval(`
Lively.rotBox = Lively.addMorph(new Morph(rect(200, 200, 100, 20)));
Lively.rotBox.rotateBy(Math.PI / 2);
Lively.rotBox.showHalo();
`);
    const anchorBefore = [
      rt.eval(`Lively.rotBox.globalize(Lively.rotBox.shape.getBounds().topLeft).x`) as number,
      rt.eval(`Lively.rotBox.globalize(Lively.rotBox.shape.getBounds().topLeft).y`) as number,
    ];
    const [rx, ry] = scaleHandleCenter();
    dispatch('pointerdown', rx, ry);
    dispatch('pointermove', rx - 10, ry - 15);
    dispatch('pointermove', rx - 30, ry - 40);
    dispatch('pointerup', rx - 30, ry - 40);
    expect(rt.eval(`Lively.rotBox.transform.rotation`)).toBeCloseTo(Math.PI / 2, 6);
    expect(
      rt.eval(`Lively.rotBox.globalize(Lively.rotBox.shape.getBounds().topLeft).x`),
    ).toBeCloseTo(anchorBefore[0], 4);
    expect(
      rt.eval(`Lively.rotBox.globalize(Lively.rotBox.shape.getBounds().topLeft).y`),
    ).toBeCloseTo(anchorBefore[1], 4);
    expect(
      rt.eval(`Lively.rotBox.globalize(Lively.rotBox.shape.getBounds().bottomRight()).x`),
    ).toBeCloseTo(rx - 30, 4);
    expect(
      rt.eval(`Lively.rotBox.globalize(Lively.rotBox.shape.getBounds().bottomRight()).y`),
    ).toBeCloseTo(ry - 40, 4);

    // --- Shift-drag (uniform transform scale) on a rotated morph: the shape
    // is untouched, the scale follows the pointer's distance from the anchor,
    // and the rendered anchor corner stays pinned.
    rt.eval(`
Lively.rotBox2 = Lively.addMorph(new Morph(rect(400, 300, 100, 20)));
Lively.rotBox2.rotateBy(Math.PI / 2);
Lively.rotBox2.showHalo();
`);
    const anchor2 = [
      rt.eval(`Lively.rotBox2.globalize(Lively.rotBox2.shape.getBounds().topLeft).x`) as number,
      rt.eval(`Lively.rotBox2.globalize(Lively.rotBox2.shape.getBounds().topLeft).y`) as number,
    ];
    const [sx, sy] = scaleHandleCenter();
    dispatch('pointerdown', sx, sy, { shiftKey: true });
    dispatch('pointermove', sx + 20, sy + 60, { shiftKey: true });
    dispatch('pointerup', sx + 20, sy + 60, { shiftKey: true });
    const startDist = Math.max(Math.hypot(sx - anchor2[0], sy - anchor2[1]), 1);
    const expectedR = Math.hypot(sx + 20 - anchor2[0], sy + 60 - anchor2[1]) / startDist;
    expect(rt.eval(`Lively.rotBox2.transform.scale.x`)).toBeCloseTo(expectedR, 4);
    expect(rt.eval(`Lively.rotBox2.transform.scale.y`)).toBeCloseTo(expectedR, 4);
    expect(rt.eval(`Lively.rotBox2.shape.getBounds().extent.x`)).toBeCloseTo(100, 6);
    expect(rt.eval(`Lively.rotBox2.shape.getBounds().extent.y`)).toBeCloseTo(20, 6);
    expect(
      rt.eval(`Lively.rotBox2.globalize(Lively.rotBox2.shape.getBounds().topLeft).x`),
    ).toBeCloseTo(anchor2[0], 4);
    expect(
      rt.eval(`Lively.rotBox2.globalize(Lively.rotBox2.shape.getBounds().topLeft).y`),
    ).toBeCloseTo(anchor2[1], 4);

    // --- Resizing a rotated panel still runs the panel's relayout (title bar
    // chrome and content panes follow the new shape).
    rt.eval(`
Lively.panel = Lively.addMorph(new MethodPanel(rect(500, 350, 200, 120), 'hello world', 'T'));
Lively.panel.rotateBy(Math.PI / 6);
Lively.panel.showHalo();
`);
    const panelAnchor = [
      rt.eval(`Lively.panel.globalize(Lively.panel.shape.getBounds().topLeft).x`) as number,
      rt.eval(`Lively.panel.globalize(Lively.panel.shape.getBounds().topLeft).y`) as number,
    ];
    const [px, py] = scaleHandleCenter();
    dispatch('pointerdown', px, py);
    // Op economy: while the pointer moves, the resize is a purely ephemeral
    // preview — the document must not change until the commit on pointer-up.
    const headsAfterDown = JSON.stringify(Automerge.getHeads(docHandle.doc() as any));
    dispatch('pointermove', px + 10, py + 8);
    dispatch('pointermove', px + 30, py + 25);
    expect(
      JSON.stringify(Automerge.getHeads(docHandle.doc() as any)),
      'pointer moves during a resize must be op-free',
    ).toBe(headsAfterDown);
    dispatch('pointerup', px + 30, py + 25);
    expect(
      JSON.stringify(Automerge.getHeads(docHandle.doc() as any)),
      'pointer-up must commit the resize',
    ).not.toBe(headsAfterDown);
    expect(rt.eval(`Lively.panel.transform.rotation`)).toBeCloseTo(Math.PI / 6, 6);
    expect(
      rt.eval(`Lively.panel.globalize(Lively.panel.shape.getBounds().topLeft).x`),
    ).toBeCloseTo(panelAnchor[0], 4);
    expect(
      rt.eval(`Lively.panel.globalize(Lively.panel.shape.getBounds().topLeft).y`),
    ).toBeCloseTo(panelAnchor[1], 4);
    // The rendered corner tracked the handle, so the shape genuinely resized...
    expect(
      rt.eval(`Lively.panel.globalize(Lively.panel.shape.getBounds().bottomRight()).x`),
    ).toBeCloseTo(px + 30, 4);
    expect(
      rt.eval(`Lively.panel.globalize(Lively.panel.shape.getBounds().bottomRight()).y`),
    ).toBeCloseTo(py + 25, 4);
    // ...and the chrome relayout ran: the title bar spans the new shape width.
    expect(
      rt.eval(`Lively.panel.titleBar.getBounds().width() - Lively.panel.shape.getBounds().width()`),
    ).toBeCloseTo(0, 4);

    // All halo UI cleaned up after the drags.
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(0);
  }, 120_000);
});
