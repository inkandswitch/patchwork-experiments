import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAutomergeTestDocHandle } from './testDocHandle';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { installBrowserStubs, type Harness } from './qbfHarness';

/**
 * Tests for newdefs' Map/Set shims, which shadow the host classes for all LM code.
 * The shims keep `entries` as the persisted truth but answer add/set/get/has for
 * primitive keys through an ephemeral $index (plain-object) cache; these tests pin
 * down the semantics across the indexed fast path and the identity-scan fallback.
 *
 * One runtime is shared by every test (evaluating newdefs.js is the expensive
 * part); each test builds its own fresh Set/Map instances. Timeouts are generous
 * because each rt.eval is a full Automerge change and the suite runs files in
 * parallel — under load these evals slow down well past the 5s default.
 */

const TIMEOUT = 60000;

let sharedRt: ReturnType<typeof createLivelymergeRuntime> | null = null;
function makeRuntime() {
  if (sharedRt) return sharedRt;
  const harness: Harness = { listeners: new Map(), rafQueue: [] };
  installBrowserStubs(harness);
  const docHandle = createAutomergeTestDocHandle();
  const rt = createLivelymergeRuntime(docHandle);
  const g = globalThis as any;
  g.handle = docHandle;
  g.runtime = rt;
  rt.eval(readFileSync(join(__dirname, '..', 'newdefs.js'), 'utf8'));
  sharedRt = rt;
  return rt;
}

describe('newdefs Set shim', () => {
  it(
    'add/has/delete/size with primitive values, without scans',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
s = new Set();
s.add('apple').add('banana').add('apple');
[s.size(), s.has('apple'), s.has('banana'), s.has('cherry')].join(',')
`),
      ).toBe('2,true,true,false');
      expect(
        rt.eval(`
s.delete('apple');
[s.size(), s.has('apple'), s.has('banana')].join(',')
`),
      ).toBe('1,false,true');
    },
    TIMEOUT,
  );

  it(
    'keeps 1, "1", true, "true", null, and undefined distinct',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
s = new Set();
s.add(1).add('1').add(true).add('true').add(null).add(undefined);
[s.size(), s.has(1), s.has('1'), s.has(true), s.has('true'), s.has(null), s.has(undefined), s.has(false)].join(',')
`),
      ).toBe('6,true,true,true,true,true,true,false');
    },
    TIMEOUT,
  );

  it(
    'treats NaN as equal to itself (SameValueZero, like the native Set)',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
s = new Set();
s.add(NaN).add(NaN);
[s.size(), s.has(NaN)].join(',')
`),
      ).toBe('1,true');
    },
    TIMEOUT,
  );

  it(
    'compares object values by identity via the scan fallback',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
a = pt(1, 2);
b = pt(1, 2);
s = new Set();
s.add(a).add(a).add('word');
[s.size(), s.has(a), s.has(b), s.has('word')].join(',')
`),
      ).toBe('2,true,false,true');
      expect(
        rt.eval(`
s.delete(a);
[s.size(), s.has(a), s.has('word')].join(',')
`),
      ).toBe('1,false,true');
    },
    TIMEOUT,
  );

  it(
    'stays correct across deletes (index positions rebuild)',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
s = new Set();
s.add('a').add('b').add('c').add('d');
s.delete('b');
[s.size(), s.has('a'), s.has('b'), s.has('c'), s.has('d'), s.values().join('')].join(',')
`),
      ).toBe('3,true,false,true,true,acd');
      expect(
        rt.eval(`
s.add('b');
s.clear();
[s.size(), s.has('a'), s.has('b')].join(',')
`),
      ).toBe('0,false,false');
    },
    TIMEOUT,
  );

  it(
    'builds a set of n items in roughly linear time (each add is indexed, not a scan)',
    () => {
      const rt = makeRuntime();
      // 2000 adds + 2000 re-adds + 2000 hits + 2000 misses in one eval (one
      // Automerge change). Under the old O(n^2) scan this shape was the hazard
      // that made a 179k-word install take hours; here it just has to come back
      // correct and promptly.
      expect(
        rt.eval(`
s = new Set();
for (let i = 0; i < 2000; i++) s.add('w' + i);
for (let i = 0; i < 2000; i++) s.add('w' + i);
ok = true;
for (let i = 0; i < 2000; i++) ok = ok && s.has('w' + i) && !s.has('x' + i);
[s.size(), ok].join(',')
`),
      ).toBe('2000,true');
    },
    TIMEOUT,
  );
});

describe('newdefs Map shim', () => {
  it(
    'set/get/has/delete with primitive keys, including value updates',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
m = new Map();
m.set('one', 1);
m.set('two', 2);
m.set('one', 11);
[m.size(), m.get('one'), m.get('two'), m.get('three'), m.has('one'), m.has('three')].join(',')
`),
      ).toBe('2,11,2,,true,false');
      expect(
        rt.eval(`
m.delete('one');
[m.size(), m.has('one'), m.get('two')].join(',')
`),
      ).toBe('1,false,2');
    },
    TIMEOUT,
  );

  it(
    'keeps numeric and string keys distinct and supports object keys by identity',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
k = pt(0, 0);
m = new Map();
m.set(7, 'num');
m.set('7', 'str');
m.set(k, 'obj');
m.set(k, 'obj2');
[m.size(), m.get(7), m.get('7'), m.get(k), m.get(pt(0, 0))].join(',')
`),
      ).toBe('3,num,str,obj2,');
    },
    TIMEOUT,
  );

  it(
    'keys/values/forEach reflect insertion order across mixed key types',
    () => {
      const rt = makeRuntime();
      expect(
        rt.eval(`
k = pt(0, 0);
m = new Map();
m.set('a', 1);
m.set(k, 2);
m.set('b', 3);
m.delete(k);
seen = [];
m.forEach((v, key) => seen.push(v));
[m.keys().join(''), m.values().join(''), seen.join('')].join('|')
`),
      ).toBe('ab|13|13');
      expect(
        rt.eval(`
m.clear();
[m.size(), m.has('a')].join(',')
`),
      ).toBe('0,false');
    },
    TIMEOUT,
  );
});
