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

  it('Object.keys includes ephemeral $-properties, after persistent keys', () => {
    const code = `
      const o = { x: 1, y: 2 };
      o.$halo = 42;
      return Object.keys(o);
    `;
    const arr = rt.eval(code) as { length: number; [i: number]: unknown };
    expect([arr[0], arr[1], arr[2]]).toEqual(['x', 'y', '$halo']);
  });

  it('Object.values / entries include ephemeral $-property values', () => {
    const code = `
      const o = { x: 1 };
      o.$halo = 42;
      return Object.values(o);
    `;
    const arr = rt.eval(code) as { length: number; [i: number]: unknown };
    expect([arr[0], arr[1]]).toEqual([1, 42]);
    const entry = rt.eval(`
      const o = { x: 1 };
      o.$halo = 42;
      return Object.entries(o)[1];
    `) as { [i: number]: unknown };
    expect([entry[0], entry[1]]).toEqual(['$halo', 42]);
  });

  it('Object.keys on the global object includes top-level $-vars', () => {
    rt.eval('$inspectorScratch = 7');
    const keys = arrayElements(rt, 'Object.keys($global)');
    expect(keys).toContain('$inspectorScratch');
  });

  it('Object.keys / getOwnPropertyNames on an array include $-properties', () => {
    const keys = rt.eval(`
      const a = [10, 20];
      a.$sel = true;
      return Object.keys(a);
    `) as { length: number; [i: number]: unknown };
    expect([keys[0], keys[1], keys[2]]).toEqual(['0', '1', '$sel']);
    const names = rt.eval(`
      const a = [10, 20];
      a.$sel = true;
      return Object.getOwnPropertyNames(a);
    `) as { length: number; [i: number]: unknown };
    expect([names[0], names[1], names[2], names[3]]).toEqual(['0', '1', 'length', '$sel']);
  });

  it('Object.keys on a function includes $-properties', () => {
    const keys = rt.eval(`
      const f = () => 1;
      f.$meta = 'm';
      return Object.keys(f);
    `) as { length: number; [i: number]: unknown };
    expect(keys[keys.length - 1]).toBe('$meta');
  });

  it('Object.hasOwn sees ephemeral $-properties', () => {
    expect(
      rt.eval(`
        const o = {};
        o.$halo = 1;
        return Object.hasOwn(o, '$halo');
      `),
    ).toBe(true);
    expect(rt.eval(`return Object.hasOwn({}, '$halo');`)).toBe(false);
  });

  it('Object.getOwnPropertyDescriptor reports ephemeral $-properties as data slots', () => {
    expect(
      rt.eval(`
        const o = {};
        o.$x = 7;
        return Object.getOwnPropertyDescriptor(o, '$x').value;
      `),
    ).toBe(7);
    expect(rt.eval(`return Object.getOwnPropertyDescriptor({}, '$x');`)).toBe(undefined);
  });

  it('proxy-protocol keys never show up in Object.keys', () => {
    expect(arrayElements(rt, 'Object.keys({})')).toEqual([]);
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
