/**
 * makeBouncer op economy: local bugs stay out of Automerge; shared bugs use
 * $transform so per-tick motion does not rewrite the document.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Automerge from '@automerge/automerge';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function setup() {
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  g.window = globalThis;
  g.canvas = {
    width: 800,
    height: 600,
    style: {},
    getContext: () => ({
      measureText: () => ({ width: 10 }),
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      fillText() {},
    }),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    }),
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = {
    createElement: () => ({
      style: {},
      setAttribute() {},
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      getContext: () => g.canvas.getContext(),
    }),
    body: {},
    documentElement: {},
    querySelector: () => g.canvas,
  };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'a' };
  g.HTMLImageElement = class {};
  g.HTMLCanvasElement = class {};
  g.Image = class {
    width = 0;
    height = 0;
    set src(_v: string) {}
  };
  g.OffscreenCanvas = class {
    width = 0;
    height = 0;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return { measureText: () => ({ width: 10 }) };
    }
  };
  // Minimal broadcast stub so ephStreamRegister can run.
  g.handle.broadcast = () => {};
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8').replace(/\binit\(\)\s*$/, ''));
  return { handle, rt };
}

function opsDuring(handle: ReturnType<typeof createAutomergeTestDocHandle>, act: () => void) {
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
      keys.push(`${op.action} key=${String(op.key ?? op.elemId ?? '?')}`.slice(0, 100));
    }
  }
  return { count, keys };
}

describe('makeBouncer op economy', () => {
  it('ephemeral and shared bouncer ticks are Automerge-free', () => {
    const { handle, rt } = setup();
    rt.eval(`
initUI(); initLively();
Lively.submorphs.slice().forEach((m) => m.remove());
if (Lively.$submorphs) Lively.$submorphs.slice().forEach((m) => m.remove());
`);
    // Do not bind the return value to a non-$ name — that would promote the graph.
    const spawnEph = opsDuring(handle, () => {
      rt.eval(`Lively.makeBouncer();`);
    });
    expect(spawnEph.count, `ephemeral spawn:\n  ${spawnEph.keys.join('\n  ')}`).toBe(0);
    expect(rt.eval(`$bouncers[$bouncers.length-1].$transform != null`)).toBe(true);

    const stepsEph = opsDuring(handle, () => {
      rt.eval(`for (let i = 0; i < 20; i++) $bouncers[$bouncers.length-1].bouncerStep();`);
    });
    expect(stepsEph.count, `ephemeral steps:\n  ${stepsEph.keys.join('\n  ')}`).toBe(0);

    const spawnShared = opsDuring(handle, () => {
      rt.eval(`Lively.makeBouncer(true);`);
    });
    // Spawn pays once to enter the document; ticks must not keep writing.
    expect(spawnShared.count).toBeGreaterThan(0);
    expect(rt.eval(`$bouncers[$bouncers.length-1].$transform != null`)).toBe(true);
    expect(rt.eval(`!$bouncers[$bouncers.length-1].isEphemeralSubmorph()`)).toBe(true);

    const stepsShared = opsDuring(handle, () => {
      rt.eval(`for (let i = 0; i < 20; i++) $bouncers[$bouncers.length-1].bouncerStep();`);
    });
    expect(stepsShared.count, `shared steps:\n  ${stepsShared.keys.join('\n  ')}`).toBe(0);
  }, 120_000);
});
