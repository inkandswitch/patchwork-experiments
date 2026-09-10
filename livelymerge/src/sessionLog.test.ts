/**
 * Session log: shared Lively.sessionLogText + SessionLogPanel + Enter-to-send.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  g.Automerge = g.Automerge || { getActorId: () => 'session-log-test' };
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

describe('session log', () => {
  it('appends to Lively.sessionLogText and opens an ephemeral SessionLogPanel', () => {
    const { rt } = setupMorphic();
    rt.eval(`sessionLog('Dan', 'jettison unused X')`);
    const className = rt.eval(`(() => { let p = openSessionLog(); return p && p.className; })()`) as string;
    expect(className).toBe('SessionLogPanel');
    const ephemeral = rt.eval(`(() => { let p = findSessionLogPanel(); return p && p.isEphemeralSubmorph(); })()`) as boolean;
    expect(ephemeral).toBe(true);
  });

  it('Enter submits via owner-chain detection (no $ flags); Shift-Enter newlines; Ctrl-S does not eval', () => {
    const { rt } = setupMorphic();
    const out = rt.eval(`
(() => {
  let p = openSessionLog();
  let shape = p.promptPane.contentPane.shape;
  // Must work without any $-flag on the shape.
  delete shape.$isSessionPromptBox;
  shape.setText('hello from Enter');
  shape.acceptKeyboardInput({ key: 'Enter', keyCode: 13, shiftKey: false, metaKey: false, ctrlKey: false, actorID: 't' });
  let afterEnter = String(Lively.sessionPromptLatest || '');
  shape.setText('line1');
  shape.acceptKeyboardInput({ key: 'Enter', keyCode: 13, shiftKey: true, metaKey: false, ctrlKey: false, actorID: 't' });
  let withBreak = String(shape.string || '');
  shape.setText('not code');
  shape.handleKeyboardShortcuts({ key: 's', metaKey: true, ctrlKey: false, preventDefault() {}, stopPropagation() {} });
  let afterSave = String(Lively.sessionPromptLatest || '');
  return {
    afterEnter: afterEnter,
    withBreak: withBreak,
    afterSave: afterSave,
    isPrompt: isSessionLogPromptTextBox(shape),
    hasSend: !!p.sendBtn,
  };
})()
`) as any;
    expect(out.isPrompt).toBe(true);
    expect(out.afterEnter).toBe('hello from Enter');
    expect(out.withBreak.includes('\n') || out.withBreak.includes('\r')).toBe(true);
    expect(out.afterSave).toBe('not code');
    expect(out.hasSend).toBe(false);
  });
});
