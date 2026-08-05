/**
 * Regression test (reported 2026-08-03): after rescaling the demo star with the
 * halo's Scale handle, meta-clicking the star no longer produced a halo.
 *
 * Root cause: PolyLine.includesPt only hit-tested within a fixed ~9px tolerance
 * of the outline segments (the star from Pen.star() is filled but its `closed`
 * flag is false). At the original ~57px extent every point of the fill is near
 * an edge, so the bug was invisible; after scaling up, clicks on the fill were
 * farther than the tolerance from any segment and missed entirely. The fix adds
 * a nonzero-winding point-in-polygon test for filled (or closed) polylines,
 * matching what ctx.fill() paints.
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

type Harness = { listeners: Map<string, Array<(e: any) => void>>; rafQueue: Array<() => void> };

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

describe('PolyLine fill hit test', () => {
  it('a filled star stays halo-clickable on its fill after a halo Scale-handle rescale', () => {
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
    const handle = createAutomergeTestDocHandle();
    const rt = createLivelymergeRuntime(handle);
    const g = globalThis as any;
    g.handle = handle;
    g.runtime = rt;
    const src = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
    // Strip the trailing top-level init(): it boots a demo world whose rAF
    // closure and timers go stale once the test's own initUI()/initLively()
    // replace them.
    rt.eval(src.replace(/\binit\(\)\s*$/, ''));
    rt.eval(`
initUI();
initLively();
Lively.star = Lively.addMorph(new Morph(null, new Pen().star(10, 30, Color.black)));
Lively.star.setColor(Color.yellow);
Lively.star.moveBy(pt(200, 200).subPt(Lively.star.getBounds().topLeft));
`);
    const pumpFrame = () => {
      const cbs = harness.rafQueue.splice(0, harness.rafQueue.length);
      cbs.forEach((cb) => cb());
    };
    const dispatch = (type: string, x: number, y: number) => {
      (harness.listeners.get(type) ?? []).forEach((fn) =>
        fn({ type, pointerId: 1, button: 0, offsetX: x, offsetY: y, pointerType: 'mouse' }),
      );
      pumpFrame();
    };
    pumpFrame();

    // World-space centroid of each arm (inner vertex, outer tip, next inner
    // vertex) — a point solidly inside the painted fill, the natural click spot.
    const armCentroids = (): Array<[number, number]> => {
      const s = rt.eval(
        `Lively.star.shape.vertices.map(v => { let w = Lively.star.globalize(v); return w.x + ',' + w.y; }).join(';')`,
      ) as string;
      const vs = s.split(';').map((p) => p.split(',').map(Number) as [number, number]);
      const pts: Array<[number, number]> = [];
      for (let i = 1; i < vs.length - 1; i += 2) {
        const [a, b, c] = [vs[i - 1], vs[i], vs[i + 1]];
        pts.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]);
      }
      return pts;
    };
    const armHits = () =>
      armCentroids().filter(
        ([x, y]) => rt.eval(`Lively.topMorphAtExcludingHaloUI(pt(${x}, ${y})) === Lively.star`) === true,
      ).length;

    expect(armHits(), 'every arm hittable before rescale').toBe(5);

    // Concave notches between arms are outside the fill and must NOT hit
    // (midpoint of two adjacent outer tips, well past the inner vertices).
    const notchMiss = rt.eval(`(() => {
      let m = Lively.star;
      let vs = m.shape.vertices;
      let mid = pt((vs[1].x + vs[3].x) / 2, (vs[1].y + vs[3].y) / 2);
      return m.includesPt(m.owner.localize(m.globalize(mid)));
    })()`);
    expect(notchMiss, 'concave notch between arms is not a hit').toBe(false);

    // Show the halo and rescale via the real pointer pipeline (+80, +80).
    const [cx, cy] = armCentroids()[0];
    rt.eval(`Lively.cycleHaloAt(pt(${cx}, ${cy})); null`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`), 'halo appears before rescale').toBe(1);
    const hx = rt.eval(
      `(() => { let halo = Lively.ephemeralSubmorphs().at(0); return halo.globalize(halo.resizeHandle.getBounds().center()).x; })()`,
    ) as number;
    const hy = rt.eval(
      `(() => { let halo = Lively.ephemeralSubmorphs().at(0); return halo.globalize(halo.resizeHandle.getBounds().center()).y; })()`,
    ) as number;
    dispatch('pointerdown', hx, hy);
    dispatch('pointermove', hx + 40, hy + 40);
    dispatch('pointermove', hx + 80, hy + 80);
    dispatch('pointerup', hx + 80, hy + 80);
    pumpFrame();

    const extent = rt.eval(`Lively.star.boundsInWorld().extent.x`) as number;
    expect(extent, 'star actually grew').toBeGreaterThan(100);

    expect(armHits(), 'every arm still hittable after rescale').toBe(5);

    // And the user's actual gesture: meta-click on the fill brings up a halo.
    const [ax, ay] = armCentroids()[0];
    rt.eval(`Lively.cycleHaloAt(pt(${ax}, ${ay})); null`);
    expect(
      rt.eval(
        `(() => { let h = Lively.ephemeralSubmorphs().find(m => m.className == 'HaloMorph'); return h ? h.target === Lively.star : false; })()`,
      ),
      'meta-click on the rescaled star shows its halo',
    ).toBe(true);
  }, 120_000);
});
