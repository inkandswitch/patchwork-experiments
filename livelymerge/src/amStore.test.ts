/**
 * Shared Automerge kv (Lively.amStore) mirrors storage* for multiplayer docs.
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

describe('automerge storage (shared ToDo)', () => {
  it('set/get/keys and edit panel wire automergeKey', () => {
    const { rt } = setupMorphic();
    expect(
      rt.eval(`
(() => {
  automergeSetItem('ToDoList', 'Items yet to do in Livelymerge:');
  let g = automergeGetItem('ToDoList');
  let keys = automergeKeys();
  let panel = automergeEditItem('ToDoList');
  let key =
    panel &&
    panel.textPane &&
    panel.textPane.contentPane &&
    panel.textPane.contentPane.shape &&
    panel.textPane.contentPane.shape.automergeKey;
  return [g, keys.indexOf('ToDoList') >= 0, key, panel.className].join('|');
})()
`),
    ).toBe('Items yet to do in Livelymerge:|true|ToDoList|MethodPanel');
  }, 120_000);
});
