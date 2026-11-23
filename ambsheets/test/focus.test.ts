// Focused sampling at the level of a sheet: filters become conditions, and comparisons
// know how far they are from being true.

import { describe, expect, test } from 'vitest';
import { printShare, valueKey, type RawValue } from '../src/lang/values';
import { histogram, pivot, summarize, viewOf, type Filter, type Filters, type View } from '../src/model/analysis';
import { compileSheet } from '../src/model/compile';
import { conditionsFor, findMatching } from '../src/model/focus';
import { evaluate } from '../src/model/run';
import { sheet } from './sheet';

const only = (...values: RawValue[]): Filter => ({ kind: 'values', keys: new Set(values.map(valueKey)) });
const settings = { target: 5_000, seed: 0.5 };

describe('margins: how true a comparison is', () => {
  const compiled = compileSheet(
    sheet({
      A1: '{1 to 10}',
      B1: '{1 to 10}',
      A2: '=A1 > 7',
      A3: '=A1 <= B1',
      A4: '=AND(A2, B1 >= 4)',
      A5: '=OR(A2, B1 >= 4)',
      A6: '=NOT(A2)',
      A7: '=A1 = B1',
      A8: '=IF(A1 > 7, B1 >= 4, false)',
      A9: '=A1 + B1',
      A10: '=IF(A1 > 7, B1 >= 4, B1 < 2)',
    }),
  );
  const margin = (addr: string, a1: number, b1: number) => {
    const values: Record<string, number> = { A1: a1, B1: b1 };
    return compiled.cells.get(addr)!.margin!(values);
  };

  test('comparisons', () => {
    expect(margin('A2', 9, 0)).toBe(2); // true, by 2
    expect(margin('A2', 4, 0)).toBe(-3); // false, by 3
    expect(margin('A3', 4, 6)).toBe(2);
    expect(margin('A7', 4, 6)).toBe(-2);
    expect(margin('A7', 5, 5) === 0).toBe(true);
  });

  test('AND is as true as its weakest part, OR as its strongest, and NOT flips', () => {
    expect(margin('A4', 9, 5)).toBe(1); // min(2, 1)
    expect(margin('A4', 9, 1)).toBe(-3); // min(2, -3)
    expect(margin('A5', 4, 1)).toBe(-3); // max(-3, -3)
    expect(margin('A5', 4, 9)).toBe(5); // max(-3, 5)
    expect(margin('A6', 9, 0)).toBe(-2);
  });

  test('IF is read as "the condition and the first, or not the condition and the second"', () => {
    expect(margin('A8', 9, 6)).toBe(2); // both hold: min(2, 2)
    expect(margin('A8', 9, 1)).toBe(-3); // the condition holds, but B1 >= 4 is off by 3
    expect(margin('A8', 5, 9)).toBe(-2); // the condition is off by 2 (and the other branch is plain false)
    expect(margin('A10', 5, 1)).toBe(1); // the condition is false (by 2), and B1 < 2 holds (by 1)
    expect(margin('A10', 5, 6)).toBe(-2); // max(min(-2, 2), min(2, -4))
    // the sign always agrees with the formula's value
    const a10 = compiled.cells.get('A10')!;
    for (let a = 1; a <= 10; a++) {
      for (let b = 1; b <= 10; b++) {
        const value = a > 7 ? b >= 4 : b < 2;
        expect(margin('A10', a, b) > 0 || (margin('A10', a, b) === 0 && value)).toBe(value);
      }
    }
    expect(a10.kind).toBe('formula');
  });

  test('other formulas have none', () => {
    expect(compiled.cells.get('A9')!.margin).toBeNull();
    expect(compiled.cells.get('A1')!.margin).toBeNull();
  });
});

describe('finding scenarios that match filters', () => {
  test('a range filter on a rare total', () => {
    const cells: Record<string, string> = { B1: 'total = SUM(A1:A10)' };
    for (let i = 1; i <= 10; i++) cells['A' + i] = '{1 to 6}';
    const compiled = compileSheet(sheet(cells));
    const filters: Filters = new Map([['B1', { kind: 'range', min: 54, max: 60 }]]);

    // sampling at random barely finds any...
    const run = evaluate(compiled, { mode: 'auto', samples: 20_000, seed: 0.5 });
    expect(run.mode).toBe('montecarlo');
    const plain = summarize(compiled.cells.get('B1')!, viewOf(run, filters));
    expect(plain.passing).toBeLessThan(10);

    // ...so go looking
    const focus = findMatching(compiled, filters, settings);
    expect(focus.phase).toBe('sampling');
    expect(focus.n).toBe(5_000);
    expect(focus.columns.B1.every((total: number) => total >= 54 && total <= 60)).toBe(true);
    // P(total >= 54) = 1 in 7,560
    expect(focus.probability * 7_560).toBeGreaterThan(0.75);
    expect(focus.probability * 7_560).toBeLessThan(1.3);
    expect(printShare(focus.probability)).toMatch(/^1 in \d+,\d00$/);

    // The scenarios that were found stand in for "the ones that match" in every summary.
    const view: View = { all: run, matching: focus, mask: null };
    const total = summarize(compiled.cells.get('B1')!, view);
    expect(total.passing).toBe(5_000);
    expect(total.passingStats!.min).toBe(54);
    expect(total.passingStats!.avg).toBeGreaterThan(54);
    expect(total.passingStats!.avg).toBeLessThan(55.2);
    expect(total.stats!.avg).toBeLessThan(36); // "all" is still all

    // a die that is part of such a total is mostly fives and sixes
    const die = summarize(compiled.cells.get('A1')!, view);
    const share = (face: number) => die.values!.find((v) => v.value === face)!.passing / die.passing;
    expect(share(6) + share(5)).toBeGreaterThan(0.75);
    expect(share(1)).toBeLessThan(0.02);

    const bars = histogram(view, 'B1')!;
    expect(bars.separate).toBe(true);
    expect(bars.passing!.count).toBe(5_000);
    expect(bars.all.count).toBe(20_000);
    expect(bars.max).toBeGreaterThanOrEqual(bars.passing!.max);

    const [first, second] = [compiled.ambsById.get('A1')!, compiled.ambsById.get('A2')!];
    const table = pivot(view, 'B1', first, second);
    const matchingInTable = table.cells.flat().reduce((sum, cell) => sum + cell.passing, 0);
    expect(matchingInTable).toBe(5_000);
    expect(table.cells[0][0].passing).toBe(0); // two ones can't be part of a total of 54
  });

  test('a filter on a comparison homes in through its margin', () => {
    const compiled = compileSheet(sheet({ A1: '=normal(0, 1)', A2: '=A1 > 4' }));
    const focus = findMatching(compiled, new Map([['A2', only(true)]]), settings);
    expect(focus.phase).toBe('sampling');
    expect(focus.columns.A1.every((x: number) => x > 4)).toBe(true);
    // P(X > 4) = 1 in 31,574
    expect(focus.probability * 31_574).toBeGreaterThan(0.6);
    expect(focus.probability * 31_574).toBeLessThan(1.5);
  });

  test('a filter on an IF homes in through its condition', () => {
    const compiled = compileSheet(sheet({ A1: '=normal(0, 1)', A2: '=IF(A1 > 4, true, false)' }));
    const focus = findMatching(compiled, new Map([['A2', only(true)]]), settings);
    expect(focus.phase).toBe('sampling');
    expect(focus.columns.A1.every((x: number) => x > 4)).toBe(true);
    expect(focus.probability * 31_574).toBeGreaterThan(0.6);
    expect(focus.probability * 31_574).toBeLessThan(1.5);
  });

  test('a filter on text has nothing to home in on, and is only met by chance', () => {
    // (X > 6 is one scenario in a billion: chance isn't going to do it)
    const compiled = compileSheet(sheet({ A1: '=normal(0, 1)', A2: '=IF(A1 > 6, "yes", "no")' }));
    const focus = findMatching(compiled, new Map([['A2', only('yes')]]), { ...settings, particles: 300 });
    expect(focus.phase).toBe('failed');
    expect(focus.n).toBe(0);
    expect(focus.done).toBe(true);
  });

  test('several filters at once, on an AND and on a number', () => {
    const compiled = compileSheet(
      sheet({ A1: '=normal(0, 1)', B1: '=normal(0, 1)', C1: '=AND(A1 > 2, B1 > 2)', D1: '=A1 + B1' }),
    );
    const filters: Filters = new Map<string, Filter>([
      ['C1', only(true)],
      ['D1', { kind: 'range', min: 0, max: 5 }],
    ]);
    const focus = findMatching(compiled, filters, settings);
    expect(focus.phase).toBe('sampling');
    for (let i = 0; i < focus.n; i++) {
      expect(focus.columns.A1[i] > 2 && focus.columns.B1[i] > 2 && focus.columns.D1[i] <= 5).toBe(true);
    }
    // somewhat less than P(A1 > 2) * P(B1 > 2) = 5.2e-4
    expect(focus.probability).toBeGreaterThan(1e-4);
    expect(focus.probability).toBeLessThan(5.2e-4);
  });

  test('filters on single-valued cells', () => {
    const compiled = compileSheet(sheet({ A1: '{1, 2}', B1: '7' }));
    expect(conditionsFor(compiled, new Map([['B1', only(7)]]))).toBeNull(); // nothing to look for
    expect(conditionsFor(compiled, new Map([['B1', only(8)]]))).toBeNull(); // nothing can match
    expect(conditionsFor(compiled, new Map([['A1', only(2)]]))!.length).toBe(1);
    const focus = findMatching(compiled, new Map([['B1', only(8)]]), settings);
    expect(focus.phase).toBe('failed');
  });
});
