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
    // Strip the trailing top-level init(): it boots a demo world whose rAF
    // closure and timers go stale (and crash/write ops) once the test's own
    // initUI()/initLively() replace them.
    rt.eval(src.replace(/\binit\(\)\s*$/, ''));
    rt.eval(`
initUI();
initLively();
Lively.testBox = Lively.addMorph(new Morph(rect(30, 20, 60, 30)));
Lively.testPanel = Lively.addMorph(new MethodPanel(rect(300, 100, 300, 200), 'hello', 'Test Panel'));
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

    // Panel title-bar drag: as cheap as a plain morph drag. The panel at
    // (300,100) has chrome buttons in the bar's left/right 28px, so press the
    // middle (450,110). Was ~200 ops/drag when savePanelLocation assigned a
    // fresh rect copy (new doc object graph per drag) instead of updating
    // lastLocationExpanded in place.
    const drag = (x0: number, y0: number, x1: number, y1: number) => () => {
      dispatch('pointerdown', { type: 'pointerdown', pointerId: 1, button: 0, offsetX: x0, offsetY: y0, pointerType: 'mouse' });
      pumpFrame();
      for (let i = 1; i <= 10; i++) {
        move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10)();
      }
      dispatch('pointerup', { type: 'pointerup', pointerId: 1, button: 0, offsetX: x1, offsetY: y1, pointerType: 'mouse' });
      pumpFrame();
    };
    // First title-bar drag pays one-time costs (gesture-state keys, zIndex raise,
    // the lastLocationExpanded rect allocation)...
    drag(450, 110, 470, 160)();
    pumpFrame();
    // ...steady-state drags write only translation + bounds + saved-location values.
    const panelDrag = opsDuring(drag(470, 160, 450, 110));
    expect(
      panelDrag.count,
      `panel title-bar drag:\n  ${panelDrag.keys.join('\n  ')}`,
    ).toBeLessThanOrEqual(8);

    // Collapse/expand cycle: geometry and text layout update doc objects in
    // place (was ~8.6k ops/cycle when every setBounds/compose allocated fresh
    // Rectangles/Points/TextLineSpecs into the doc). What remains is the
    // membership churn of stashing/unstashing content (list splices + ref
    // wrappers), the collapse-glyph string, and the values that genuinely
    // differ between the two layouts.
    const toggle = () => {
      rt.eval('Lively.testPanel.toggleCollapse()');
      pumpFrame();
    };
    // First cycle pays one-time allocations (lastLocation rects, gesture keys).
    toggle();
    toggle();
    const collapseCycle = opsDuring(() => {
      toggle();
      toggle();
    });
    expect(
      collapseCycle.count,
      `steady-state collapse/expand cycle generated ${collapseCycle.count} ops:\n  ${collapseCycle.keys.join('\n  ')}`,
    ).toBeLessThanOrEqual(220);

    // Programmatic moveBy (steppers, scripts): moves translation + cached
    // bounds in place — 4 value writes per move, no fresh Points (replacing
    // the points allocated a doc object per call and orphaned the old one).
    rt.eval('Lively.testBox.moveBy(pt(1, 1))'); // warm-up: one-time keys
    pumpFrame();
    const moves = opsDuring(() => {
      for (let i = 0; i < 10; i++) {
        rt.eval('Lively.testBox.moveBy(pt(1, 1))');
        pumpFrame();
      }
    });
    expect(
      moves.count,
      `10 programmatic moveBy generated ${moves.count} ops:\n  ${moves.keys.join('\n  ')}`,
    ).toBeLessThanOrEqual(40);

    // morphCopy independence: transforms are deep-copied (translation/scale
    // are mutated in place now, so a shared point would move both morphs).
    const positions = rt.eval(`
Lively.boxCopy = Lively.addMorph(Lively.testBox.morphCopy());
Lively.boxCopy.moveBy(pt(50, 0));
Lively.testBox.getBounds().topLeft.toString() + ' / ' + Lively.boxCopy.getBounds().topLeft.toString()
`) as string;
    const [origPos, copyPos] = positions.split(' / ');
    expect(copyPos).not.toBe(origPos);
  }, 120_000);
});
