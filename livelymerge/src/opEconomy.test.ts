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

describe('op economy: quiescent transactions generate no Automerge ops', () => {
  it('idle frames, pointer moves, and repeat clicks are op-free', () => {
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
Lively.testBox = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
`);

    const pumpFrame = () => {
      const cbs = harness.rafQueue.splice(0, harness.rafQueue.length);
      cbs.forEach((cb) => cb());
    };

    // settle one frame, then audit 5 idle frames
    pumpFrame();

    const dispatch = (type: string, e: any) => {
      (harness.listeners.get(type) ?? []).forEach((fn) => fn(e));
    };
    /** Ops generated across `act()`, with a readable dump for failures. */
    const opsDuring = (act: () => void): { count: number; keys: string[] } => {
      const headsBefore = Automerge.getHeads(handle.doc() as any);
      act();
      const changes = Automerge.getChanges(
        Automerge.view(handle.doc() as any, headsBefore) as any,
        handle.doc() as any,
      );
      let count = 0;
      const keys: string[] = [];
      for (const ch of changes) {
        const dec = Automerge.decodeChange(ch);
        count += dec.ops.length;
        for (const op of dec.ops as any[]) {
          keys.push(
            `${op.action} key=${String(op.key ?? op.elemId ?? '?')} val=${JSON.stringify(op.value ?? '')}`.slice(0, 110),
          );
        }
      }
      return { count, keys };
    };
    const expectOpFree = (label: string, act: () => void) => {
      const { count, keys } = opsDuring(act);
      expect(count, `${label} generated ops:\n  ${keys.join('\n  ')}`).toBe(0);
    };

    const move = (x: number, y: number) => () => {
      dispatch('pointermove', { type: 'pointermove', pointerId: 1, offsetX: x, offsetY: y, pointerType: 'mouse' });
      pumpFrame();
    };
    const click = () => {
      dispatch('pointerdown', { type: 'pointerdown', pointerId: 1, button: 0, offsetX: 700, offsetY: 500, pointerType: 'mouse' });
      pumpFrame();
      dispatch('pointerup', { type: 'pointerup', pointerId: 1, button: 0, offsetX: 700, offsetY: 500, pointerType: 'mouse' });
      pumpFrame();
    };

    // Idle frames: nothing happens, nothing is written.
    expectOpFree('idle frame 1', () => pumpFrame());
    expectOpFree('idle frame 2', () => pumpFrame());

    // Pointer movement (no hand, no focus): per-user state only.
    expectOpFree('pointermove over box', move(50, 30));
    expectOpFree('pointermove over empty space', move(700, 500));

    // First-ever click on a morph may create its gesture-state keys (a handful of
    // one-time ops: @actorID, @hitPoint, @didDrag, @_pickUpOnDrag)...
    const first = opsDuring(click);
    expect(first.count, `first click:\n  ${first.keys.join('\n  ')}`).toBeLessThanOrEqual(8);

    // ...but steady-state clicking is fully elided: the long-click timer registration
    // is ephemeral (was ~1000 ops/click when timer closures promoted into the doc),
    // and re-writing the same gesture-state values costs nothing.
    expectOpFree('second click', click);
    expectOpFree('third click', click);
    expectOpFree('idle frame after clicks', () => pumpFrame());
  }, 120_000);
});
