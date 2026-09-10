/**
 * Probe: openSessionLog must not cascade tool panels or flood presentError.
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
      canvas: { width: 800, height: 600 },
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
  g.Automerge = g.Automerge || { getActorId: () => 'probe' };
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
  return { rt };
}

describe('session log crash probe', () => {
  it('openSessionLog is ephemeral and re-open does not multiply panels', () => {
    const { rt } = setup();
    const result = rt.eval(`
(() => {
  let p = openSessionLog();
  for (let i = 0; i < 25; i++) {
    if (Lively.handleStepList) Lively.handleStepList();
  }
  openSessionLog();
  openSessionLog();
  for (let i = 0; i < 10; i++) {
    if (Lively.handleStepList) Lively.handleStepList();
  }
  let eph = Lively.ephemeralSubmorphs ? Lively.ephemeralSubmorphs() : [];
  let sessionsEph = eph.filter(m => m.className === 'SessionLogPanel').length;
  let sessionsPers = (Lively.submorphs || []).filter(m => m.className === 'SessionLogPanel').length;
  let ephErrors = eph.filter(m => m.className === 'ErrorStackPanel' || m.className === 'MethodPanel' || m.className === 'BrowserPanel').length;
  return {
    ok: !!(p && p.className === 'SessionLogPanel'),
    ephemeral: !!(p && p.isEphemeralSubmorph && p.isEphemeralSubmorph()),
    sessionsEph: sessionsEph,
    sessionsPers: sessionsPers,
    ephErrors: ephErrors,
    logLen: String(Lively.sessionLogText || '').length,
  };
})()
`) as any;
    expect(result.ok).toBe(true);
    expect(result.ephemeral).toBe(true);
    expect(result.sessionsEph).toBe(1);
    expect(result.sessionsPers).toBe(0);
    expect(result.ephErrors).toBe(0);
    expect(result.logLen).toBeGreaterThan(0);
  }, 120000);

  it('presentError re-entry does not open a second error panel', () => {
    const { rt } = setup();
    const result = rt.eval(`
(() => {
  let n = 0;
  let _open = openErrorStackPanel;
  openErrorStackPanel = function(err, ctx, title) {
    n++;
    return _open(err, ctx, title);
  };
  presentError(new Error('outer'), 'test');
  // Simulate nested present during first present's window construction path:
  _errorPresentInProgress = true;
  presentError(new Error('inner'), 'nested');
  _errorPresentInProgress = false;
  let eph = Lively.ephemeralSubmorphs ? Lively.ephemeralSubmorphs() : [];
  let errors = eph.filter(m => m.className === 'ErrorStackPanel').length;
  return { openCalls: n, errorPanels: errors };
})()
`) as any;
    expect(result.openCalls).toBe(1);
    expect(result.errorPanels).toBe(1);
  }, 120000);
});
