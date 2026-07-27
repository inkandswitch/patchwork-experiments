/**
 * WorldMorph.handleStepList scheduling: steps advance from their scheduled time
 * (not the frame time), late frames catch up on missed steps, and a long stall
 * drops the backlog instead of replaying it.
 *
 * Uses the same browser stubs as localUiState.test.ts: real transpiled newdefs.js,
 * real Automerge document, Date.now stubbed for deterministic frame times.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('step scheduler', () => {
  const realDateNow = Date.now;
  let rt: ReturnType<typeof createLivelymergeRuntime>;

  // The world (a 9k-line newdefs eval) boots ONCE for the whole file; each test
  // re-arms the stepper at its own epoch. Booting per test blows the default test
  // timeout when the whole suite runs in parallel.
  beforeAll(() => {
    installBrowserStubs();
    const handle = createAutomergeTestDocHandle();
    rt = createLivelymergeRuntime(handle);
    const g = globalThis as any;
    g.handle = handle;
    g.runtime = rt;
    rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8'));
    rt.eval(`
initUI();
initLively();
stepper = Lively.addMorph(new Morph(rect(0, 0, 10, 10)));
stepper.countStep = function () { stepCount = stepCount + 1; };
`);
    Date.now = () => (globalThis as any).__fakeNow;
  }, 120_000);

  afterAll(() => {
    Date.now = realDateNow;
    delete (globalThis as any).__fakeNow;
  });

  /** Reset the count and (re-)arm the 50ms stepper with nextStepTime = `start`. */
  function armStepperAt(start: number) {
    (globalThis as any).__fakeNow = start;
    rt.eval(`stepCount = 0; stepper.startStepping('countStep', null, 50)`);
  }

  /** Run a frame sequence in ONE eval (each eval is an Automerge change, so
   *  per-frame evals would dominate the test's wall clock): every simulated frame
   *  sets the fake clock through `window.__fakeNow`, then runs the step list. */
  function framesAt(times: number[]) {
    rt.eval(`[${times.join(', ')}].forEach((t) => {
      window.__fakeNow = t;
      Lively.handleStepList();
    })`);
  }

  const count = () => rt.eval('stepCount') as number;

  it('holds a 50ms step at ~20Hz on 33ms frames (no re-anchoring drift)', () => {
    armStepperAt(1000);
    // One simulated second of 30Hz frames. Re-anchoring on the frame time would
    // stretch the period to ~67ms (15 fires); scheduled-time advance gives 20.
    framesAt(Array.from({ length: 30 }, (_, k) => 1000 + (k + 1) * 33));
    expect(count()).toBeGreaterThanOrEqual(19);
    expect(count()).toBeLessThanOrEqual(20);
  });

  it('runs the steps a late frame missed, staying on the original grid', () => {
    armStepperAt(2000);
    // 160ms late: owes the steps scheduled at 2000/2050/2100/2150...
    framesAt([2160]);
    expect(count()).toBe(4);
    // ...and the schedule stays on its grid: nothing at 2190, the next fire at 2210.
    framesAt([2190]);
    expect(count()).toBe(4);
    framesAt([2210]);
    expect(count()).toBe(5);
  });

  it('drops the backlog after a long stall instead of replaying it', () => {
    armStepperAt(3000);
    framesAt([13_000]); // 10s stall (hidden tab): capped catch-up, then re-anchor
    expect(count()).toBe(4);
    // Re-anchored at the stall frame: nothing due again until 13050.
    framesAt([13_040]);
    expect(count()).toBe(4);
    framesAt([13_060]);
    expect(count()).toBe(5);
  });
});
