/**
 * Removed morphs must stop stepping, no matter how they were removed: remove(),
 * a bare removeMorph, or removal of an enclosing container. remove() keeps the
 * owner back-pointer (see Morph.remove), so the scheduler prunes by checking
 * actual containment (Morph.isInWorld) when a spec comes due.
 *
 * Same boot-once harness as stepScheduler.test.ts.
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
        if (prop === 'querySelector') return (sel: string) => (sel === 'canvas' ? canvas : null);
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

describe('stepping stops when a morph is removed', () => {
  const realDateNow = Date.now;
  let rt: ReturnType<typeof createLivelymergeRuntime>;
  let epoch = 1000;

  beforeAll(() => {
    installBrowserStubs();
    const handle = createAutomergeTestDocHandle();
    rt = createLivelymergeRuntime(handle);
    const g = globalThis as any;
    g.handle = handle;
    g.runtime = rt;
    rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8'));
    rt.eval('initUI(); initLively();');
    Date.now = () => (globalThis as any).__fakeNow;
  }, 120_000);

  afterAll(() => {
    Date.now = realDateNow;
    delete (globalThis as any).__fakeNow;
  });

  /** Make a fresh 50ms stepper (optionally inside a fresh container), run one
   * frame to confirm it fires, and return the confirmed step count. */
  function makeStepper(opts: { inContainer?: boolean } = {}) {
    epoch += 10_000;
    (globalThis as any).__fakeNow = epoch;
    rt.eval(`
stepCount = 0;
${opts.inContainer
    ? `container = Lively.addMorph(new Morph(rect(0, 0, 50, 50)));
stepper = container.addMorph(new Morph(rect(0, 0, 10, 10)));`
    : `stepper = Lively.addMorph(new Morph(rect(0, 0, 10, 10)));`}
stepper.countStep = function () { stepCount = stepCount + 1; };
stepper.startStepping('countStep', null, 50);
`);
    frame(60);
    const n = count();
    expect(n).toBeGreaterThan(0);
    return n;
  }

  function frame(dtFromEpoch: number) {
    rt.eval(`window.__fakeNow = ${epoch + dtFromEpoch}; Lively.handleStepList();`);
  }

  const count = () => rt.eval('stepCount') as number;

  it('stops when the morph is removed with remove()', () => {
    const n = makeStepper();
    rt.eval('stepper.remove()');
    frame(300);
    expect(count()).toBe(n);
  });

  it('stops when an enclosing container is removed', () => {
    const n = makeStepper({ inContainer: true });
    rt.eval('container.remove()');
    frame(300);
    expect(count()).toBe(n);
  });

  it('stops when the morph is dropped via a bare removeMorph', () => {
    const n = makeStepper();
    rt.eval('Lively.removeMorph(stepper)');
    frame(300);
    expect(count()).toBe(n);
  });

  it('keeps stepping while riding in a hand', () => {
    const n = makeStepper();
    // Wire the hand like WorldMorph.addHand, minus the immediate canvas render
    // (the headless ctx stub can't survive a real render pass).
    rt.eval(`hand = new HandMorph($actorID, pt(0, 0), Color.red)`);
    rt.eval(`
if (!Lively.hands) Lively.hands = [];
Lively.hands.push(hand);
hand.owner = Lively;
`);
    rt.eval(`hand.addMorph(stepper)`);
    frame(300);
    expect(count()).toBeGreaterThan(n);
    rt.eval('stepper.remove()'); // clean up: don't leak steps into later tests
  });
});
