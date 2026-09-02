/**
 * makeBouncer collision: ephemeral bugs must bounce off persistent world morphs
 * and off each other (they live in $submorphs, not submorphs).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    getContext: () => ({ measureText: () => ({ width: 10 }) }),
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
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8').replace(/\binit\(\)\s*$/, ''));
  return { rt };
}

describe('makeBouncer collisions', () => {
  it('ephemeral bouncer flips when it hits a persistent world morph', () => {
    const { rt } = setup();
    const vx = rt.eval(`
(() => {
  initUI();
  initLively();
  Lively.submorphs.slice().forEach((m) => m.remove());
  if (Lively.$submorphs) Lively.$submorphs.slice().forEach((m) => m.remove());
  Lively.addMorph(new Morph(rect(200, 100, 40, 200)));
  Lively.makeBouncer();
  let $bug = $bouncers[$bouncers.length - 1];
  if (!$bug.isEphemeralSubmorph()) throw new Error('expected ephemeral bug');
  $bug.$velocity = pt(8, 0);
  $bug.$pen.location = pt(170, 180);
  $bug.moveTo($bug.$pen.location);
  for (let k = 0; k < 20; k++) {
    $bug.bouncerStep();
    if ($bug.$velocity.x < 0) break;
  }
  return $bug.$velocity.x;
})()
`) as number;
    expect(vx).toBeLessThan(0);
  }, 120_000);

  it('two ephemeral bouncers bounce off each other', () => {
    const { rt } = setup();
    const vx = rt.eval(`
(() => {
  initUI();
  initLively();
  Lively.submorphs.slice().forEach((m) => m.remove());
  if (Lively.$submorphs) Lively.$submorphs.slice().forEach((m) => m.remove());
  Lively.makeBouncer();
  Lively.makeBouncer();
  let $a = $bouncers[$bouncers.length - 2];
  let $b = $bouncers[$bouncers.length - 1];
  $a.$velocity = pt(6, 0);
  $b.$velocity = pt(0, 0);
  $a.$pen.location = pt(150, 200);
  $b.$pen.location = pt(185, 200);
  $a.moveTo($a.$pen.location);
  $b.moveTo($b.$pen.location);
  for (let k = 0; k < 30; k++) {
    $a.bouncerStep();
    if ($a.$velocity.x < 0) break;
  }
  return $a.$velocity.x;
})()
`) as number;
    expect(vx).toBeLessThan(0);
  }, 120_000);
});
