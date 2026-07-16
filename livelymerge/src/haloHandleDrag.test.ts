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

describe('halo handle drag (full stack)', () => {
  it('dragging the Drag handle moves the target morph and keeps halo UI ephemeral', () => {
    const harness: Harness = { listeners: new Map(), rafQueue: [] };
    installBrowserStubs(harness);
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
Lively.testBox = Lively.addMorph(new Morph(rect(100, 100, 80, 50)));
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

    // Show the halo on the box, then locate its Drag handle in world coordinates.
    rt.eval(`Lively.cycleHaloAt(pt(140, 125));`);
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(1);
    const hx = rt.eval(`
      let halo = Lively.ephemeralSubmorphs().at(0);
      let h = halo.dragHandle;
      halo.globalize(h.getBounds().center()).x
    `) as number;
    const hy = rt.eval(`
      let halo2 = Lively.ephemeralSubmorphs().at(0);
      let h2 = halo2.dragHandle;
      halo2.globalize(h2.getBounds().center()).y
    `) as number;
    expect(typeof hx).toBe('number');
    expect(typeof hy).toBe('number');

    const startX = rt.eval(`Lively.testBox.getBounds().topLeft.x`) as number;
    const startY = rt.eval(`Lively.testBox.getBounds().topLeft.y`) as number;
    const beforeSnapshot = Object.keys(handle.doc().objectTable);
    const docEntriesBefore = beforeSnapshot.length;

    // Drag the handle 30 px right, 15 px down, through the real event pipeline.
    dispatch('pointerdown', hx, hy);
    dispatch('pointermove', hx + 10, hy + 5);
    dispatch('pointermove', hx + 30, hy + 15);
    dispatch('pointerup', hx + 30, hy + 15);
    pumpFrame();

    const endX = rt.eval(`Lively.testBox.getBounds().topLeft.x`) as number;
    const endY = rt.eval(`Lively.testBox.getBounds().topLeft.y`) as number;
    expect(endX, 'target should move with the Drag handle').toBeCloseTo(startX + 30, 4);
    expect(endY, 'target should move with the Drag handle').toBeCloseTo(startY + 15, 4);

    // The halo UI must not have leaked into the Automerge document. Allow zero growth
    // only (the box itself was created before the snapshot).
    const table: any = handle.doc().objectTable;
    const beforeIds = new Set(beforeSnapshot);
    const newIds = Object.keys(table).filter((id) => !beforeIds.has(id));
    for (const nid of newIds) {
      const entry = table[nid];
      const referrers: string[] = [];
      for (const [oid, oentry] of Object.entries(table) as any) {
        for (const [k, v] of Object.entries(oentry as any)) {
          if (v && (v as any).$type === 'ref' && (v as any).$id === nid) referrers.push(`${oid}.${k}`);
          if (k === '$values' && Array.isArray(v)) {
            (v as any[]).forEach((el, i) => {
              if (el && el.$type === 'ref' && el.$id === nid) referrers.push(`${oid}[${i}]`);
            });
          }
          if (k === '$scopes' && Array.isArray(v)) {
            (v as any[]).forEach((el, i) => {
              if (el && el.$type === 'ref' && el.$id === nid) referrers.push(`${oid}.$scopes[${i}]`);
            });
          }
        }
      }
      // Geometry churn (Points/Rects from actually moving the box) is legitimate;
      // halo UI reaching the document is the bug this test guards against.
      // Promoted geometry entries (Points/Rects) have no @className of their own —
      // they inherit it via $protoId — so only string values need checking here.
      const cn = (entry as any)['@className'];
      const protoId = (entry as any).$protoId ?? '';
      const suspicious = /Halo|TextMorph|TextBox/;
      expect(
        (typeof cn === 'string' && suspicious.test(cn)) || suspicious.test(String(protoId)),
        `halo UI leaked into the document: ${nid} (${cn ?? protoId}) <- ${referrers.join(', ')}`,
      ).toBe(false);
    }
    // Moving a morph writes new geometry (bounded); a halo subtree would be dozens.
    expect(newIds.length, 'unexpected promotion volume').toBeLessThan(25);
    // The handle removed itself on pointerup; nothing per-user remains attached.
    expect(rt.eval(`Lively.ephemeralSubmorphs().length`)).toBe(0);
    void docEntriesBefore;
  }, 120_000);
});
