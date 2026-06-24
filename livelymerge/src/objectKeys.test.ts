/**
 * Object.keys / values / entries / getOwnPropertyNames on LM proxies.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createLivelymergeRuntime, type LivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle } from './testDocHandle';

function createFreshRuntime(): LivelymergeRuntime {
  return createLivelymergeRuntime(createAutomergeTestDocHandle());
}

/** Collect LM array elements via eval (avoids depending on print formatting). */
function arrayElements(rt: LivelymergeRuntime, expr: string): unknown[] {
  const arr = rt.eval(expr) as { length: number; [i: number]: unknown };
  const out: unknown[] = [];
  for (let i = 0; i < arr.length; i++) {
    out.push(arr[i]);
  }
  return out;
}

describe('Object.keys / values / entries', () => {
  let rt: LivelymergeRuntime;

  beforeEach(() => {
    rt = createFreshRuntime();
  });

  it('printIt: Object.keys on object literal (exact user example)', () => {
    expect(rt.printIt('Object.keys({x: 1, y: 2})')).toBe('[x,y]');
  });

  it('printIt: Object.entries on object literal (exact user example)', () => {
    expect(rt.printIt('Object.entries({x: 1, y: 2})')).toBe('[[x,1],[y,2]]');
  });

  it('printIt: Object.entries on array literal (exact user example)', () => {
    expect(rt.printIt('Object.entries([1, 2, 3])')).toBe('[[0,1],[1,2],[2,3]]');
  });

  it('Object.keys on a plain object returns user property names', () => {
    expect(arrayElements(rt, 'Object.keys({ x: 1, y: 2 })')).toEqual(['x', 'y']);
  });

  it('Object.values on a plain object returns property values', () => {
    expect(arrayElements(rt, 'Object.values({ x: 1, y: 2 })')).toEqual([1, 2]);
  });

  it('Object.entries on a plain object returns [key, value] pairs', () => {
    const entries = arrayElements(rt, 'Object.entries({ a: 1, b: 2 })');
    expect(entries).toHaveLength(2);
    expect(arrayElements(rt, 'Object.entries({ a: 1, b: 2 })[0]')).toEqual(['a', 1]);
    expect(arrayElements(rt, 'Object.entries({ a: 1, b: 2 })[1]')).toEqual(['b', 2]);
  });

  it('Object.keys on an array returns index strings, not internal $type', () => {
    expect(arrayElements(rt, 'Object.keys([10, 20, 30])')).toEqual(['0', '1', '2']);
  });

  it('Object.values on an array returns elements', () => {
    expect(arrayElements(rt, 'Object.values([10, 20])')).toEqual([10, 20]);
  });

  it('Object.entries on an array returns index/value pairs', () => {
    expect(arrayElements(rt, 'Object.entries(["a", "b"])[0]')).toEqual(['0', 'a']);
    expect(arrayElements(rt, 'Object.entries(["a", "b"])[1]')).toEqual(['1', 'b']);
  });

  it('Object.getOwnPropertyNames on an array includes length', () => {
    expect(arrayElements(rt, 'Object.getOwnPropertyNames([1, 2])')).toEqual(['0', '1', 'length']);
  });

  it('Object.keys on the result of Object.keys does not throw', () => {
    expect(arrayElements(rt, 'Object.keys(Object.keys({ x: 1 }))')).toEqual(['0']);
  });

  it('for..of over Object.entries on an object works', () => {
    const code = `
      const out = [];
      for (const [k, v] of Object.entries({ a: 1, b: 2 })) {
        out.push(k + '=' + v);
      }
      return out;
    `;
    const arr = rt.eval(code) as { length: number; [i: number]: unknown };
    expect(arr[0]).toBe('a=1');
    expect(arr[1]).toBe('b=2');
  });
});
