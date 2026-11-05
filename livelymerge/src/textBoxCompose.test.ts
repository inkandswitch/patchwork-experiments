/**
 * TextBox.compose: wrap at identifier boundaries without empty-line storms
 * when a name is wider than the box (e.g. fabrikClassNamesInCategory).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

const FAB_FN = 'function (category) { return fabrikClassNamesInCategory(category); }';

function makeCtxStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return (s: unknown) => ({ width: String(s ?? '').length * 8 });
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
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
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
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = () => {};
  g.AbortController = class {
    abort() {}
  };
  g.Automerge = { getActorId: () => 'actor-test' };
}

function makeRuntime() {
  installBrowserStubs();
  const handle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(handle);
  const g = globalThis as any;
  g.handle = handle;
  g.runtime = rt;
  const newdefs = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8').replace(
    /\binit\(\)\s*(?:\/\/[^\n]*\s*)*$/,
    '',
  );
  rt.eval(newdefs);
  rt.eval('initUI(); initLively();');
  return rt;
}

function composeReport(rt: ReturnType<typeof makeRuntime>, width: number, src: string) {
  return String(
    rt.eval(`(() => {
      let src = ${JSON.stringify(src)};
      let box = new TextBox(rect(0, 0, ${width}, 20), src);
      box.inset = pt(2, 2);
      box.compose();
      let n = box.lines.length;
      let empty = 0;
      let joined = '';
      let returnWithLongName = false;
      let longNameSplitOk = true;
      for (let i = 0; i < n; i++) {
        let s = box.lines[i].string || '';
        joined += s;
        let t = '';
        for (let j = 0; j < s.length; j++) {
          let ch = s.charAt(j);
          if (ch !== ' ' && ch !== String.fromCharCode(10) && ch !== String.fromCharCode(13)) t += ch;
        }
        if (t === '') empty++;
        if (s.indexOf('return') >= 0 && s.indexOf('fabrikClassNamesInCategory') >= 0) returnWithLongName = true;
      }
      return [n, empty, joined === src ? 1 : 0, returnWithLongName ? 1 : 0].join('|');
    })()`),
  );
}

describe('TextBox.compose wrap', () => {
  it(
    'wraps a long identifier without a run of empty lines',
    () => {
      const rt = makeRuntime();
      const r = composeReport(rt, 80, 'return fabrikClassNamesInCategory(category);');
      const [n, empty, joined, returnWithLong] = r.split('|').map(Number);
      expect(empty).toBe(0);
      expect(joined).toBe(1);
      expect(returnWithLong).toBe(0);
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThan(16);
    },
    20000,
  );

  it(
    'wraps the Fabrik function-view source without blank lines after return',
    () => {
      const rt = makeRuntime();
      // Function view content is ~150px (250 part minus pin pads).
      const r = composeReport(rt, 150, FAB_FN);
      const [n, empty, joined, returnWithLong] = r.split('|').map(Number);
      expect(empty).toBe(0);
      expect(joined).toBe(1);
      expect(returnWithLong).toBe(0);
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThan(16);
    },
    20000,
  );
});
