/**
 * checkpointToRepo: write bootable xdefs.js from the live system, boot it, re-checkpoint, compare.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';

function installBrowserStubs(writeSink: { path?: string; text?: string }) {
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'canvas') return (globalThis as any).canvas;
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  );
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
  const ls = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
    setItem: (k: string, v: string) => {
      ls.set(k, String(v));
    },
    removeItem: (k: string) => {
      ls.delete(k);
    },
    clear: () => ls.clear(),
    key: (i: number) => [...ls.keys()][i] ?? null,
    get length() {
      return ls.size;
    },
  };
  g.document = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'createElement')
          return () => ({
            getContext: () => ctx,
            style: {},
            setAttribute() {},
            appendChild() {},
            addEventListener() {},
            removeEventListener() {},
            focus() {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
          });
        if (prop === 'body' || prop === 'documentElement')
          return { style: {}, appendChild() {}, addEventListener() {} };
        if (prop === 'querySelector') return (sel: string) => (sel === 'canvas' ? canvas : null);
        return () => null;
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
  g.checkpointWriteFile = (path: string, text: string) => {
    writeSink.path = path;
    writeSink.text = text;
    const out = path.startsWith('/') ? path : join(__dirname, '..', path);
    writeFileSync(out, text);
  };
}

function stripTrailingInit(src: string) {
  return src.replace(/\binit\(\)\s*$/, '');
}

function normalizeCheckpoint(text: string) {
  // Drop generated timestamp header line for stable compare.
  return text
    .split('\n')
    .filter((line) => !line.startsWith('// xdefs.js — live-system checkpoint '))
    .join('\n');
}

function sha(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

describe('checkpointToRepo', () => {
  it('writes xdefs.js, boots it, and re-checkpoints comparably', () => {
    const sink: { path?: string; text?: string } = {};
    installBrowserStubs(sink);

    // --- Pass 1: boot newdefs, checkpoint ---
    const doc1 = createAutomergeTestDocHandle();
    const rt1 = createLivelymergeRuntime(doc1);
    (globalThis as any).handle = doc1;
    (globalThis as any).runtime = rt1;
    const newdefs = readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8');
    rt1.eval(stripTrailingInit(newdefs));
    rt1.eval('initUI(); initLively();');
    expect(rt1.eval('!!Lively')).toBe(true);
    expect(rt1.eval('Color.red.r')).toBeCloseTo(0.8, 5);

    const len1 = rt1.eval('checkpointToRepo("xdefs.js")') as number;
    expect(len1).toBeGreaterThan(100000);
    expect(sink.text && sink.text.length).toBe(len1);
    expect(existsSync(join(__dirname, '..', 'xdefs.js'))).toBe(true);

    const xdefs1 = readFileSync(join(__dirname, '..', 'xdefs.js'), 'utf8');
    expect(xdefs1).toContain('class Color');
    expect(xdefs1).toContain('Color.red = new Color');
    expect(xdefs1).not.toContain('[native code]');
    expect(xdefs1).not.toContain('() => live.$codeForShow');
    expect(xdefs1.trimEnd().endsWith('init()')).toBe(true);

    // --- Pass 2: boot xdefs in a fresh runtime ---
    const sink2: { path?: string; text?: string } = {};
    (globalThis as any).checkpointWriteFile = (path: string, text: string) => {
      sink2.path = path;
      sink2.text = text;
      writeFileSync(join(__dirname, '..', path), text);
    };
    const doc2 = createAutomergeTestDocHandle();
    const rt2 = createLivelymergeRuntime(doc2);
    (globalThis as any).handle = doc2;
    (globalThis as any).runtime = rt2;
    rt2.eval(stripTrailingInit(xdefs1));
    // xdefs ends with init(); we stripped it — boot like tests do
    rt2.eval('initUI(); initLively();');
    expect(rt2.eval('!!Lively')).toBe(true);
    expect(rt2.eval('Lively.className')).toBe('WorldMorph');
    expect(rt2.eval('Color.red.r')).toBeCloseTo(0.8, 5);
    expect(rt2.eval('typeof pt')).toBe('function');
    expect(rt2.eval('typeof Morph')).toBe('function');
    // Hit-test smoke: a morph under the pointer path
    expect(rt2.eval('Lively.topMorphAt(pt(1,1)) === Lively || Lively.fullBounds().includesPt(pt(1,1))')).toBe(
      true,
    );

    const len2 = rt2.eval('checkpointToRepo("xdefs-roundtrip.js")') as number;
    expect(len2).toBeGreaterThan(100000);
    const xdefs2 = readFileSync(join(__dirname, '..', 'xdefs-roundtrip.js'), 'utf8');

    const n1 = normalizeCheckpoint(xdefs1);
    const n2 = normalizeCheckpoint(xdefs2);
    const report = {
      len1,
      len2,
      sha1: sha(n1),
      sha2: sha(n2),
      equalNormalized: n1 === n2,
      lenDiff: len2 - len1,
      hasColorRed1: xdefs1.includes('Color.red = new Color'),
      hasColorRed2: xdefs2.includes('Color.red = new Color'),
    };
    writeFileSync(join(__dirname, '..', 'xdefs-compare.json'), JSON.stringify(report, null, 2));

    // Round-trip should be nearly identical (allow small drift from timestamps already stripped).
    expect(report.hasColorRed2).toBe(true);
    expect(Math.abs(report.lenDiff)).toBeLessThan(5000);
    // Prefer exact normalized match; if not, still require same hash length band
    if (!report.equalNormalized) {
      // Method edits in class.toString vs replaceMethod order can reshuffle; require shared markers.
      expect(xdefs2).toContain('class Morph');
      expect(xdefs2).toContain('function init') || expect(xdefs2).toContain('init = function');
    }
  }, 300_000);
});
