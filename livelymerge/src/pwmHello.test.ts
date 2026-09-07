/**
 * PWM rehearsal: prove Hello TextMorph via runtime.eval on a Morphic-loaded doc.
 * Live URL join is documented in pwm/BRIDGE.md (needs Dan’s sync endpoint).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

const HELLO = 'Hello from Grok 4.5!';

function setupMorphic() {
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
      fillRect() {},
      strokeRect() {},
      clearRect() {},
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
  g.Automerge = { getActorId: () => 'pwm-agent' };
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
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8').replace(/\binit\(\)\s*$/, ''));
  rt.eval(`initUI(); initLively();`);
  return { handle, rt };
}

describe('PWM Hello rehearsal', () => {
  it('installs a shared TextMorph with the greeting via runtime.eval', () => {
    const { rt } = setupMorphic();
    const info = rt.eval(`
(() => {
  let t = new TextMorph(rect(60, 60, 320, 48), ${JSON.stringify(HELLO)});
  Lively.addMorph(t);
  let found = Lively.submorphs.find((m) => m.className === 'TextMorph' && m.shape && m.shape.string === ${JSON.stringify(HELLO)});
  return found ? ('ok:' + found.shape.string) : 'missing';
})()
`) as string;
    expect(info).toBe('ok:' + HELLO);
  }, 120_000);

  it('world-side PWM gate rejects eval until armed', () => {
    const { rt } = setupMorphic();
    rt.eval(readFileSync(join(__dirname, '..', 'pwm', 'worldSide.js'), 'utf8'));
    const blocked = rt.eval(`
(() => {
  try {
    Lively.$pwm.disarm();
    Lively.$pwm.acceptEval('1+1');
    return 'should-have-thrown';
  } catch (e) {
    return String(e.message || e);
  }
})()
`) as string;
    expect(blocked).toMatch(/arm/i);

    const hello = rt.eval(`
(() => {
  Lively.$pwm.hello();
  let found = Lively.submorphs.find((m) => m.className === 'TextMorph' && m.shape && m.shape.string === ${JSON.stringify(HELLO)});
  return found ? found.shape.string : 'missing';
})()
`) as string;
    expect(hello).toBe(HELLO);
  }, 120_000);
});
