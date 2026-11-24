// Ambs and distributions written inside larger formulas.

import { describe, expect, test } from 'vitest';
import { moveRefs, shiftAddr, shiftRefs } from '../src/lang/rewrite';
import { ASError, valueKey, type RawValue } from '../src/lang/values';
import { histogram, lineChart, pivot, summarize, tableDimensions, viewOf, type Filter } from '../src/model/analysis';
import { ambLabel, compileSheet } from '../src/model/compile';
import { findMatching } from '../src/model/focus';
import { DEFAULT_SETTINGS, evaluate, type EvalSettings } from '../src/model/run';
import { sheet } from './sheet';

function run(cells: Record<string, string>, settings: Partial<EvalSettings> = {}) {
  return evaluate(compileSheet(sheet(cells)), { ...DEFAULT_SETTINGS, ...settings });
}
const values = (r: ReturnType<typeof run>, addr: string) =>
  summarize(r.compiled.cells.get(addr)!, viewOf(r)).values!.map((v) => v.value);
const only = (...vs: RawValue[]): Filter => ({ kind: 'values', keys: new Set(vs.map(valueKey)) });

describe('an amb inside a formula', () => {
  test('is a choice like any other', () => {
    const r = run({ A1: '10', A2: '=A1 + {1, 2, 3}' });
    expect(r.compiled.cardinality).toBe(3);
    expect(values(r, 'A2')).toEqual([11, 12, 13]);

    const a2 = r.compiled.cells.get('A2')!;
    expect(a2.kind).toBe('formula');
    expect(a2.deps).toEqual(['A2#1']);
    expect(r.compiled.ambs).toMatchObject([{ id: 'A2#1', addr: 'A2', whole: false, source: '{1, 2, 3}' }]);
    expect(ambLabel(r.compiled.ambs[0], r.compiled)).toBe('{1, 2, 3} in A2');
  });

  test('every amb that is written is a separate choice', () => {
    const r = run({ A1: '={1, 2} * 10 + {1, 2}' });
    expect(r.compiled.cardinality).toBe(4);
    expect(values(r, 'A1')).toEqual([11, 12, 21, 22]);
    expect(r.compiled.cells.get('A1')!.deps).toEqual(['A1#1', 'A1#2']);
  });

  test('...whereas a cell used twice has one value', () => {
    const cells = { A1: '=normal(0, 1)', A2: '=A1 + A1', A3: '=normal(0, 1) + normal(0, 1)' };
    const r = run(cells, { samples: 40_000 });
    // twice the same number: standard deviation 2. Two different numbers: sqrt(2).
    expect(Math.abs(histogram(viewOf(r), 'A2')!.all.stdev - 2)).toBeLessThan(0.05);
    expect(Math.abs(histogram(viewOf(r), 'A3')!.all.stdev - Math.SQRT2)).toBeLessThan(0.05);
  });

  test('a cell that is nothing but an amb is still an amb cell', () => {
    const r = run({ A1: '{1, 2}', A2: 'car = {3, 4}', A3: '=uniform(0, 1)', A4: '=({5, 6})' });
    expect(['A1', 'A2', 'A3'].map((addr) => r.compiled.cells.get(addr)!.kind)).toEqual(['amb', 'amb', 'amb']);
    expect(r.compiled.ambs.map((amb) => [amb.id, amb.whole])).toEqual([
      ['A1', true],
      ['A2', true],
      ['A3', true],
      ['A4', true], // (parentheses don't make it a different thing)
    ]);
  });

  test('distributions, in arithmetic and in conditions', () => {
    const r = run(
      { A1: '1000', A2: '=A1 * normal(1, 0.1)', A3: '=IF(uniform(0, 1) < 0.3, 1, 0)', A4: '=MAX(normal(0, 1), 0)' },
      { samples: 40_000 },
    );
    expect(r.mode).toBe('montecarlo');
    const a2 = histogram(viewOf(r), 'A2')!.all;
    expect(Math.abs(a2.avg - 1000)).toBeLessThan(2);
    expect(Math.abs(a2.stdev - 100)).toBeLessThan(2);
    expect(Math.abs(histogram(viewOf(r), 'A3')!.all.avg - 0.3)).toBeLessThan(0.01);
    expect(histogram(viewOf(r), 'A4')!.all.min).toBe(0);
  });

  test('ambify and deambify inside formulas', () => {
    const r = run({ A1: '10', A2: '20', A3: '{1, 2}', B1: '=ambify(A1:A2) * 2', B2: '=SUM(deambify(A3)) + 100' });
    expect(values(r, 'B1')).toEqual([20, 40]);
    expect(r.compiled.cells.get('B2')).toMatchObject({ kind: 'const', value: 103 });
  });

  test('mistakes are errors in the cell, wherever the amb is', () => {
    const r = run({ A1: '{1, 2}', A2: '=5 + normal(A1, -1)', A3: '=1 + uniform(3, 2)', A4: '=2 * {}' });
    for (const addr of ['A3', 'A4']) {
      const info = r.compiled.cells.get(addr)!;
      expect(info.kind).toBe('const');
      expect(info.value).toBeInstanceOf(ASError);
    }
    expect((r.compiled.cells.get('A3')!.value as ASError).shortMsg).toBe('#VALUE!');
    // (a bad parameter in a distribution that isn't the whole formula still takes the cell down)
    expect((r.columns.A2 as RawValue[]).every((v) => v instanceof ASError)).toBe(true);
  });

  test('downstream cells depend on the choice', () => {
    const r = run({ A1: '={1, 2} + 0', A2: '=A1 * 10', A3: 'car = {100, 200}', A4: '=A2 + car' });
    expect(r.compiled.cells.get('A4')!.deps).toEqual(['A1#1', 'A3']);
    expect(values(r, 'A4')).toEqual([110, 120, 210, 220]);
  });
});

describe('everything else still works with them', () => {
  test('tables can be broken down by a choice inside a formula', () => {
    const r = run({ A1: 'car = {100, 200}', A2: '=car + {1, 2, 3}' });
    const dims = tableDimensions(r, r.compiled.cells.get('A2')!);
    expect(dims.map((amb) => ambLabel(amb, r.compiled))).toEqual(['car (A1)', '{1, 2, 3} in A2']);
    const table = pivot(viewOf(r), 'A2', dims[0], dims[1]);
    expect(table.xLabels).toEqual(['100', '200']);
    expect(table.yLabels).toEqual(['1', '2', '3']);
    expect(table.cells[2][1]).toMatchObject({ scenarios: 1, sum: 203 });
  });

  test('line charts label their lines by it', () => {
    const r = run({ A1: '=10 * {1, 2}', A2: '=A1 + 5', B1: '=A1:A2' });
    const chart = lineChart(viewOf(r), r.compiled.cells.get('B1')!)!;
    expect(chart.series.map((s) => s.label)).toEqual(['{1, 2}=1', '{1, 2}=2']);
  });

  test('a comparison of a distribution can be homed in on', () => {
    const compiled = compileSheet(sheet({ A1: '=normal(0, 1) + normal(0, 1) > 6' }));
    expect(compiled.cells.get('A1')!.margin).not.toBeNull();
    // the sum is normal with standard deviation sqrt(2): P(sum > 6) = 1 in 90,300
    const focus = findMatching(compiled, new Map([['A1', only(true)]]), { target: 2_000, seed: 0.5 });
    expect(focus.phase).toBe('sampling');
    expect(focus.columns.A1.every((v: boolean) => v === true)).toBe(true);
    expect(focus.probability * 90_300).toBeGreaterThan(0.6);
    expect(focus.probability * 90_300).toBeLessThan(1.6);
    // and what the two numbers add up to really is more than 6
    for (let i = 0; i < focus.n; i++) {
      expect(focus.columns['?A1#1'][i] + focus.columns['?A1#2'][i]).toBeGreaterThan(6);
    }
  });

  test('references inside them follow rows, columns and copies', () => {
    expect(shiftRefs('=B2 * normal(A1, A2)', { kind: 'insert', axis: 'row', index: 0, count: 1 })).toBe(
      '=B3 * normal(A2, A3)',
    );
    expect(moveRefs('=B2 * normal($A$1, A2) + SUM(ambify(C1:C3))', 1, 1)).toBe(
      '=C3 * normal($A$1, B3) + SUM(ambify(D2:D4))',
    );
  });
});

describe('filtering on a choice inside a formula', () => {
  test('its value is part of every scenario, under its id', () => {
    const r = run({ A1: 'car = {100, 200}', A2: '=car + {1, 2, 3}' });
    expect(r.compiled.subjects.map((s) => [s.id, s.label, s.isAmb])).toEqual([
      ['A1', 'car (A1)', true],
      ['A2', 'A2', false],
      ['A2#1', '{1, 2, 3} in A2', true],
    ]);
    expect(r.columns['A2#1']).toEqual([1, 2, 3, 1, 2, 3]);
    expect(r.columns['?A2#1']).toEqual([0, 1, 2, 0, 1, 2]); // (the raw choice)

    const amb = r.compiled.ambsById.get('A2#1')!;
    const summary = summarize({ addr: amb.id, spec: amb.spec }, viewOf(r));
    expect(summary.values!.map((v) => [v.value, v.count])).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
    ]);
  });

  test('a filter on it narrows everything else', () => {
    const r = run({ A1: 'car = {100, 200}', A2: '=car + {1, 2, 3}' });
    const view = viewOf(r, new Map([['A2#1', only(3)]]));
    const a2 = summarize(r.compiled.cells.get('A2')!, view);
    expect(a2.passing).toBe(2);
    expect(a2.values!.filter((v) => v.passing > 0).map((v) => v.value)).toEqual([103, 203]);
  });

  test('a rare range of a distribution inside a formula can be sought out', () => {
    const compiled = compileSheet(sheet({ A1: '=1000 * normal(1, 0.1)' }));
    const filters = new Map<string, Filter>([['A1#1', { kind: 'range', min: 1.4, max: 2 }]]);
    const focus = findMatching(compiled, filters, { target: 2_000, seed: 0.5 });
    expect(focus.phase).toBe('sampling');
    expect(focus.columns['A1#1'].every((x: number) => x >= 1.4)).toBe(true);
    expect(focus.columns.A1.every((x: number) => x >= 1400)).toBe(true);
    // P(Z >= 4) = 1 in 31,574
    expect(focus.probability * 31_574).toBeGreaterThan(0.6);
    expect(focus.probability * 31_574).toBeLessThan(1.6);
  });

  test('its filter follows it when rows move', () => {
    expect(shiftAddr('D4#2', { kind: 'insert', axis: 'row', index: 0, count: 1 })).toBe('D5#2');
    expect(shiftAddr('D4#2', { kind: 'delete', axis: 'row', index: 3, count: 1 })).toBeNull();
    expect(shiftAddr('D4', { kind: 'insert', axis: 'col', index: 0, count: 1 })).toBe('E4');
  });
});
