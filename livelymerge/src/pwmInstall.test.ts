/**
 * PWM author → transpile → install rehearsal.
 * Uses runtime.replaceMethod (same path as the Morphic browser) to install a
 * class fragment into a Morphic-loaded heap, then invokes it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

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
  g.Automerge = g.Automerge || { getActorId: () => 'pwm-agent' };
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

function fragmentBody(path: string): string {
  // Strip leading // comments so replaceMethod gets a single class member.
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');
  while (lines.length && (lines[0].trim() === '' || lines[0].trim().startsWith('//'))) {
    lines.shift();
  }
  return lines.join('\n').trim();
}

describe('PWM install (replaceMethod)', () => {
  it('transpiles a WorldMorph fragment and installs it live', () => {
    const { rt } = setupMorphic();
    const frag = fragmentBody(
      join(__dirname, '..', 'pwm', 'fragments', 'WorldMorph_pwmPing.js'),
    );
    expect(frag.startsWith('pwmPing(')).toBe(true);

    const ok = rt.eval(`replaceMethod('WorldMorph', ${JSON.stringify(frag)})`);
    expect(ok).toBe(true);

    const result = rt.eval(`Lively.pwmPing()`) as string;
    expect(result).toBe('pong');

    const note = rt.eval(`
(() => {
  let found = Lively.submorphs.find((m) =>
    m.className === 'TextMorph' && m.shape && String(m.shape.string).indexOf('pong from Grok') >= 0);
  return found ? String(found.shape.string) : 'missing';
})()
`) as string;
    expect(note).toContain('pong from Grok');
  }, 120_000);
});
