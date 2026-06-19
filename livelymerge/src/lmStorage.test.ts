import { describe, expect, it } from 'vitest';
import { lmGetWithDelegation, lmObjDelegatesTo, lmUserKey, type LmHeapEntry } from './lmStorage';

describe('lmUserKey', () => {
  it('does not double-prefix names that already start with @', () => {
    expect(lmUserKey('x')).toBe('@x');
    expect(lmUserKey('@toString')).toBe('@toString');
  });
});

describe('lmObjDelegatesTo', () => {
  const table: Record<string, LmHeapEntry> = {
    root: { $id: 'root' },
    mid: { $id: 'mid', $protoId: 'root' },
    leaf: { $id: 'leaf', $protoId: 'mid' },
  };
  const lookup = (id: string) => table[id];

  it('returns true when obj is the proto itself', () => {
    expect(lmObjDelegatesTo(table.mid, table.mid, lookup)).toBe(true);
  });

  it('returns true for transitive delegation', () => {
    expect(lmObjDelegatesTo(table.leaf, table.root, lookup)).toBe(true);
  });

  it('returns false when proto is not on the chain', () => {
    expect(lmObjDelegatesTo(table.leaf, { $id: 'other' }, lookup)).toBe(false);
  });

  it('returns false when obj has no proto chain match', () => {
    expect(lmObjDelegatesTo(table.root, table.mid, lookup)).toBe(false);
  });
});

describe('lmGetWithDelegation', () => {
  it('finds properties on prototypes resolved through a lookup function', () => {
    const committed: Record<string, LmHeapEntry & Record<string, unknown>> = {};
    const pending = new Map<string, LmHeapEntry & Record<string, unknown>>([
      ['proto', { $id: 'proto', '@m': 5 }],
    ]);
    const instance = { $id: 'inst', $protoId: 'proto' };
    const lookup = (id: string) => pending.get(id) ?? committed[id];
    expect(lmGetWithDelegation(instance, 'm', lookup, (v) => v)).toBe(5);
  });
});
