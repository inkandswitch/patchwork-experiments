import { describe, expect, test } from 'vitest';
import type { Filter } from '../src/model/analysis';
import { decodeFilters, encodeFilters, filtersSignature } from '../src/model/savedFilters';

describe('filters in the document', () => {
  const filters = new Map<string, Filter>([
    ['B8', { kind: 'values', keys: new Set(['true']) }],
    ['B7', { kind: 'range', min: 3000, max: 4200 }],
    ['D4#1', { kind: 'values', keys: new Set(['n3', 'n1']) }],
  ]);

  test('are plain data, in a stable order', () => {
    expect(encodeFilters(filters)).toEqual({
      B7: { kind: 'range', min: 3000, max: 4200 },
      B8: { kind: 'values', keys: ['true'] },
      'D4#1': { kind: 'values', keys: ['n1', 'n3'] },
    });
    expect(Object.keys(encodeFilters(filters))).toEqual(['B7', 'B8', 'D4#1']);
  });

  test('come back as they were', () => {
    const back = decodeFilters(JSON.parse(JSON.stringify(encodeFilters(filters))));
    expect(filtersSignature(back)).toBe(filtersSignature(filters));
    expect((back.get('D4#1') as any).keys.has('n3')).toBe(true);
  });

  test('the same filters have the same signature, whatever order they were made in', () => {
    const reordered = new Map([...filters].reverse());
    expect(filtersSignature(reordered)).toBe(filtersSignature(filters));
    expect(filtersSignature(new Map())).toBe('{}');
  });

  test('anything in the document that is not a filter is ignored', () => {
    expect(decodeFilters(undefined).size).toBe(0);
    expect(decodeFilters('nope').size).toBe(0);
    const some = decodeFilters({
      A1: { kind: 'values', keys: [] }, // (selects nothing: not a filter)
      A2: { kind: 'range', min: 'low', max: 3 },
      A3: { kind: 'mystery' },
      A4: { kind: 'range', min: 1, max: 3 },
    });
    expect([...some.keys()]).toEqual(['A4']);
  });
});
