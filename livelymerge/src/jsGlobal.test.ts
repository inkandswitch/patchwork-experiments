import { beforeEach, describe, expect, it } from 'vitest';
import { createLivelymergeRuntime, type LivelymergeRuntime } from './livelymergeRuntime';
import type { Obj } from './types';
import { createAutomergeTestDocHandle } from './testDocHandle';

const TEST_GLOBAL = 'lmTestJsBox';

function createFreshRuntime(): LivelymergeRuntime {
  return createLivelymergeRuntime(createAutomergeTestDocHandle());
}

function installTestJsGlobal(rt: LivelymergeRuntime) {
  (globalThis as Record<string, unknown>)[TEST_GLOBAL] = {
    count: 0,
    label: 'hello',
    inc() {
      this.count++;
    },
  };

  rt.change(() => {
    const doc = rt.doc();
    doc.objectTable['test-box'] = {
      $type: 'obj',
      $id: 'test-box',
      $jsGlobal: TEST_GLOBAL,
    };
    (doc.objectTable.global as Obj)['@testBox'] = { $type: 'ref', $id: 'test-box' };
  });
  // Raw doc writes bypass the runtime's write barrier (and its materialized read
  // cache) — same as a remote replica's writes, so report them the same way.
  rt.noteExternalChanges(['test-box', 'global']);
}

describe('jsGlobal proxies', () => {
  let rt: LivelymergeRuntime;

  beforeEach(() => {
    rt = createFreshRuntime();
  });

  it('reads properties from the JS global target', () => {
    installTestJsGlobal(rt);
    expect(rt.eval('$global.testBox.label')).toBe('hello');
    expect(rt.eval('$global.testBox.count')).toBe(0);
  });

  it('writes properties through to the JS global target', () => {
    installTestJsGlobal(rt);
    rt.eval('$global.testBox.count = 7');
    expect((globalThis as Record<string, { count: number }>)[TEST_GLOBAL].count).toBe(7);
    expect(rt.eval('$global.testBox.count')).toBe(7);
  });

  it('calls methods on the JS global target with correct this', () => {
    installTestJsGlobal(rt);
    rt.eval('$global.testBox.inc()');
    rt.eval('$global.testBox.inc()');
    expect(rt.eval('$global.testBox.count')).toBe(2);
  });

  it('exposes canvas, ctx, and document on $global by default', () => {
    (globalThis as Record<string, unknown>).canvas = { width: 640 };
    (globalThis as Record<string, unknown>).ctx = { lineWidth: 3 };
    expect(rt.eval('$global.canvas.width')).toBe(640);
    expect(rt.eval('$global.ctx.lineWidth')).toBe(3);
    expect(rt.eval('typeof $global.document')).toBe('object');
  });

  it('calls function jsGlobals like String', () => {
    expect(rt.eval('$global.String(42)')).toBe('42');
    expect(rt.eval('$global.String.fromCharCode(65, 66)')).toBe('AB');
  });

  it('constructs with function jsGlobals like String', () => {
    expect(rt.eval('new ($global.String)("hi").length')).toBe(2);
  });

  it('reads properties from object jsGlobals like Math', () => {
    expect(rt.eval('$global.Math.PI > 3')).toBe(true);
    expect(rt.eval('$global.Math.floor(3.7)')).toBe(3);
  });

  describe('late-bound console', () => {
    it('resolves console on $global to the formatting wrapper', () => {
      expect(rt.eval('typeof $global.console.log')).toBe('function');
      expect(() => rt.eval(`console.log('late-bound console works')`)).not.toThrow();
    });

    it('formats LM values before handing them to the native console', () => {
      rt.eval(`class Pt {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  toString() {
    return \`(\${this.x}, \${this.y})\`;
  }
}

const p1 = new Pt(1, 2);`);
      const expected = rt.formatEvalResult(rt.eval('p1'));
      const logged: unknown[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logged.push(...args);
      };
      try {
        rt.eval('console.log(p1)');
      } finally {
        console.log = origLog;
      }
      expect(logged).toEqual([expected]);
    });

    it('lets LM code replace console methods without touching the real console', () => {
      // The transcript mirror in newdefs.js does exactly this: it swaps console.log
      // for an LM function and escapes to the page console via window.console.log.
      const origLog = console.log;
      rt.eval('f = (msg) => { captured = msg; }');
      rt.eval('console.log = f');
      expect(console.log).toBe(origLog);
      rt.eval(`console.log('mirrored')`);
      expect(rt.eval('captured')).toBe('mirrored');
    });
  });
});
