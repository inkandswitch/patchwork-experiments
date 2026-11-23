import { describe, expect, test } from 'vitest';
import { parseCell } from '../src/lang/parse';
import { ASError, valueKey, type RawValue } from '../src/lang/values';
import { compileSheet } from '../src/model/compile';
import {
  chooseMode,
  DEFAULT_SETTINGS,
  evaluate,
  Evaluation,
  EXHAUSTIVE_MAX_AUTO,
  EXHAUSTIVE_MAX_FORCED,
  type EvalSettings,
  type Run,
} from '../src/model/run';
import {
  aggregate,
  histogram,
  lineChart,
  passMask,
  pivot,
  summarize,
  tableDimensions,
  viewOf,
  type Filters,
} from '../src/model/analysis';
import { BUDGET, sheet } from './sheet';

function run(cells: Record<string, string>, settings: Partial<EvalSettings> = {}): Run {
  return evaluate(compileSheet(sheet(cells)), { ...DEFAULT_SETTINGS, ...settings });
}

/** The value of a constant cell. */
function constant(r: Run, addr: string): RawValue {
  const info = r.compiled.cells.get(addr)!;
  expect(info.kind).toBe('const');
  return info.value;
}

/** The distinct values of a varying cell. */
function values(r: Run, addr: string, filters: Filters = new Map()) {
  const summary = summarize(r.compiled.cells.get(addr)!, viewOf(r, filters));
  return summary.values!.map((v) => v.value);
}

const only = (...vs: RawValue[]): Filters extends Map<any, infer F> ? F : any =>
  ({ kind: 'values', keys: new Set(vs.map(valueKey)) }) as any;

describe('parsing', () => {
  test('literals', () => {
    expect(parseCell('')).toEqual({ kind: 'empty' });
    expect(parseCell('42')).toEqual({ kind: 'literal', value: 42 });
    expect(parseCell('-3.5')).toEqual({ kind: 'literal', value: -3.5 });
    expect(parseCell('TRUE')).toEqual({ kind: 'literal', value: true });
    expect(parseCell('"hi"')).toEqual({ kind: 'literal', value: 'hi' });
    expect(parseCell('Car payment')).toEqual({ kind: 'literal', value: 'Car payment' });
  });

  test('ambs, with and without "=" and a name', () => {
    const bare = parseCell('{500, 1200}');
    expect(bare).toMatchObject({ kind: 'formula', name: null, formula: { type: 'amb' } });
    expect(parseCell('={1 to 3}')).toMatchObject({ kind: 'formula', formula: { type: 'amb' } });
    expect(parseCell('car = {500, 1200}')).toMatchObject({ kind: 'formula', name: 'car' });
  });

  test('a broken formula is an error, not text', () => {
    const parsed = parseCell('=SUM(');
    expect(parsed.kind).toBe('error');
  });

  test('distributions', () => {
    expect(parseCell('=normal(100, 15)')).toMatchObject({
      formula: { type: 'normal', mean: 100, stdev: 15, samples: null },
    });
    expect(parseCell('=normal(100, 15, 30)')).toMatchObject({ formula: { samples: 30 } });
    expect(parseCell('=uniform(B1, 10)')).toMatchObject({
      formula: { type: 'uniform', min: { type: 'cellRef', row: 0, col: 1 }, max: 10 },
    });
  });
});

describe('the budget from lab note 1', () => {
  const r = run(BUDGET);

  test('is evaluated exhaustively: 2 cars x 3 apartments', () => {
    expect(r.compiled.cardinality).toBe(6);
    expect(r.mode).toBe('exhaustive');
    expect(r.n).toBe(6);
    expect(r.done).toBe(true);
  });

  test('the total has one value per scenario', () => {
    expect(values(r, 'B7')).toEqual([3318, 4018, 4218, 4718, 4918, 5418]);
    expect(values(r, 'B3')).toEqual([500, 1200]);
    expect(values(r, 'B8')).toEqual([false, true]);
  });

  test('cells that do not depend on an amb are constants', () => {
    expect(constant(r, 'B5')).toBe(18);
    expect(constant(r, 'A7')).toBe('TOTAL');
    expect(r.compiled.varying.map((info) => info.addr)).toEqual(['B3', 'B4', 'B7', 'B8']);
  });

  test('dependencies are tracked through names', () => {
    expect(r.compiled.cells.get('B8')!.deps).toEqual(['B3', 'B4']);
    expect(r.compiled.ambs.map((info) => info.addr)).toEqual(['B3', 'B4']);
  });
});

describe('filters (lab note 2)', () => {
  const r = run(BUDGET);

  test('filtering on an input narrows the outputs', () => {
    const filters: Filters = new Map([['B3', only(500)]]);
    const summary = summarize(r.compiled.cells.get('B7')!, viewOf(r, filters));
    expect(summary.passing).toBe(3);
    expect(summary.values!.filter((v) => v.passing > 0).map((v) => v.value)).toEqual([
      3318, 4218, 4718,
    ]);
    expect(summary.passingStats).toMatchObject({ min: 3318, max: 4718 });
    expect(summary.stats).toMatchObject({ min: 3318, max: 5418 });
  });

  test('filtering on an output shows which inputs are still possible', () => {
    const filters: Filters = new Map([['B8', only(true)]]);
    const apartments = summarize(r.compiled.cells.get('B4')!, viewOf(r, filters));
    // only the cheapest apartment is affordable (with either car)
    expect(apartments.values!.map((v) => [v.value, v.passing])).toEqual([
      [2800, 2],
      [3700, 0],
      [4200, 0],
    ]);
  });

  test('range filters', () => {
    const filters: Filters = new Map([['B7', { kind: 'range', min: 4000, max: 5000 }]]);
    const mask = passMask(r, filters)!;
    expect([...mask].reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('formulas', () => {
  test('arithmetic, comparisons, IF and functions', () => {
    const r = run({
      A1: '=1 + 2 * 3',
      A2: '=(1 + 2) * 3',
      A3: '=IF(A1 < A2, "less", "more")',
      A4: '=-A1 / 2',
      A5: '=AVG(A1:A2)',
      A6: '=MAX(A1, A2, 100)',
      A7: '=CONCAT("a", 1, "b")',
      A8: '=AND(A1 = 7, NOT(A2 <> 9))',
      A9: '=ROUND(10 / 3, 2)',
    });
    expect(constant(r, 'A1')).toBe(7);
    expect(constant(r, 'A2')).toBe(9);
    expect(constant(r, 'A3')).toBe('less');
    expect(constant(r, 'A4')).toBe(-3.5);
    expect(constant(r, 'A5')).toBe(8);
    expect(constant(r, 'A6')).toBe(100);
    expect(constant(r, 'A7')).toBe('a1b');
    expect(constant(r, 'A8')).toBe(true);
    expect(constant(r, 'A9')).toBe(3.33);
  });

  test('errors are values, and they propagate', () => {
    const r = run({
      A1: '=1 / 0',
      A2: '=A1 + 1',
      A3: '=nosuchfunction(1)',
      A4: '=nosuchname + 1',
      A5: '="a" + 1',
      A6: '=SUM(',
    });
    const short = (addr: string) => (constant(r, addr) as ASError).shortMsg;
    expect(short('A1')).toBe('#DIV/0!');
    expect(short('A2')).toBe('#DIV/0!');
    expect(short('A3')).toBe('#NAME?');
    expect(short('A4')).toBe('#REF!');
    expect(short('A5')).toBe('#VALUE!');
    expect(short('A6')).toBe('#SYNTAX!');
  });

  test('cycles are errors, and only for the cells on the cycle', () => {
    const r = run({ A1: '=A2 + 1', A2: '=A1 + 1', A3: '=A3', A4: '=A1', A5: '=1 + 1' });
    const short = (addr: string) => (constant(r, addr) as ASError).shortMsg;
    expect(short('A1')).toBe('#CYCLE!');
    expect(short('A2')).toBe('#CYCLE!');
    expect(short('A3')).toBe('#CYCLE!');
    expect(short('A4')).toBe('#CYCLE!'); // inherited through the reference
    expect(constant(r, 'A5')).toBe(2);
  });

  test('an error in some scenarios only', () => {
    const r = run({ A1: '{0, 1, 2}', A2: '=10 / A1' });
    expect(values(r, 'A2').map(String)).toEqual(['5', '10', '#DIV/0!']);
  });

  test('a cell used twice has the same value both times', () => {
    const r = run({ A1: '{1, 2, 3}', A2: '=A1 * A1' });
    expect(values(r, 'A2')).toEqual([1, 4, 9]);
  });

  test('amb ranges and repeats', () => {
    const r = run({
      A1: '{1 to 4}',
      B1: '{0 to 1 by 0.25}',
      C1: '{3 to 1}',
      D1: '{7 x 3, 9}',
    });
    expect(values(r, 'A1')).toEqual([1, 2, 3, 4]);
    expect(values(r, 'B1')).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(values(r, 'C1')).toEqual([3, 2, 1]);
    // repeated values are separate choices: 7 is three times as likely as 9
    expect(r.compiled.cardinality).toBe(4 * 5 * 3 * 4);
    const d1 = summarize(r.compiled.cells.get('D1')!, viewOf(r));
    expect(d1.values!.map((v) => [v.value, v.count / r.n])).toEqual([
      [7, 0.75],
      [9, 0.25],
    ]);
  });
});

describe('ambify and deambify', () => {
  test('ambify over constants is a choice among them (blanks skipped)', () => {
    const r = run({ A1: '10', A2: '20', A4: '40', B1: '=ambify(A1:A4)', B2: '=B1 * 2' });
    expect(values(r, 'B1')).toEqual([10, 20, 40]);
    expect(values(r, 'B2')).toEqual([20, 40, 80]);
  });

  test('ambify over cells that vary multiplies the possibilities', () => {
    const r = run({ A1: '{1, 2}', A2: '{10, 20}', B1: '=ambify(A1:A2)' });
    expect(r.compiled.cardinality).toBe(8);
    expect(values(r, 'B1')).toEqual([1, 2, 10, 20]);
    expect(r.compiled.cells.get('B1')!.deps).toEqual(['A1', 'B1', 'A2']); // sheet order
  });

  test('deambify collects every value of a cell into a range', () => {
    const r = run({ A1: '{1, 2, 3}', A2: '=A1 * 10', B1: '=deambify(A2)', B2: '=SUM(B1)' });
    expect(constant(r, 'B1')).toEqual([[10, 20, 30]]);
    expect(constant(r, 'B2')).toBe(60);
  });
});

describe('choosing how to evaluate', () => {
  const auto: EvalSettings = { mode: 'auto', samples: 20_000, seed: 0.5 };
  const finite = (cardinality: number) => ({ cardinality, continuous: false });

  test('small models are enumerated', () => {
    expect(chooseMode(finite(6), auto, 1000).mode).toBe('exhaustive');
    expect(chooseMode(finite(20_000), auto, 1000).mode).toBe('exhaustive');
  });

  test('mid-size models are enumerated only if that is quick', () => {
    expect(chooseMode(finite(100_000), auto, 0.01).mode).toBe('exhaustive');
    expect(chooseMode(finite(100_000), auto, 1).mode).toBe('montecarlo');
  });

  test('huge models are sampled, however quick a scenario is', () => {
    expect(chooseMode(finite(EXHAUSTIVE_MAX_AUTO + 1), auto, 0).mode).toBe('montecarlo');
    expect(chooseMode(finite(1e30), auto, 0).mode).toBe('montecarlo');
  });

  test('continuous models can only be sampled', () => {
    const continuous = { cardinality: Infinity, continuous: true };
    expect(chooseMode(continuous, auto, 0).mode).toBe('montecarlo');
    expect(chooseMode(continuous, { ...auto, mode: 'exhaustive' }, 0).mode).toBe('montecarlo');
  });

  test('explicit requests are honoured when possible', () => {
    expect(chooseMode(finite(6), { ...auto, mode: 'montecarlo' }, 0).mode).toBe('montecarlo');
    expect(chooseMode(finite(1e6), { ...auto, mode: 'exhaustive' }, 100).mode).toBe('exhaustive');
    expect(
      chooseMode(finite(EXHAUSTIVE_MAX_FORCED + 1), { ...auto, mode: 'exhaustive' }, 0).mode,
    ).toBe('montecarlo');
  });

  test('ten dice are too many to enumerate, so auto mode samples them', () => {
    const cells: Record<string, string> = { B1: '=SUM(A1:A10)' };
    for (let i = 1; i <= 10; i++) cells['A' + i] = '{1 to 6}';
    const r = run(cells, { samples: 5_000 });
    expect(r.compiled.cardinality).toBe(6 ** 10);
    expect(r.mode).toBe('montecarlo');
    expect(r.n).toBe(5_000);
    const total = summarize(r.compiled.cells.get('B1')!, viewOf(r));
    expect(total.stats!.avg).toBeGreaterThan(34);
    expect(total.stats!.avg).toBeLessThan(36);
  });
});

describe('Monte Carlo', () => {
  test('continuous distributions', () => {
    const r = run({ A1: '=normal(100, 15)', A2: '=uniform(0, 10)', A3: '=A1 + A2' }, { samples: 20_000 });
    expect(r.compiled.cardinality).toBe(Infinity);
    expect(r.mode).toBe('montecarlo');
    expect(r.n).toBe(20_000);

    const a1 = summarize(r.compiled.cells.get('A1')!, viewOf(r));
    expect(a1.values).toBeNull(); // too many distinct values to list
    expect(Math.abs(a1.stats!.avg - 100)).toBeLessThan(0.5);

    const a3 = histogram(viewOf(r), 'A3')!;
    expect(Math.abs(a3.all.avg - 105)).toBeLessThan(0.5);
    expect(Math.abs(a3.all.stdev - Math.sqrt(15 ** 2 + 100 / 12))).toBeLessThan(0.5);
    expect(a3.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(20_000);
  });

  test('distribution parameters can come from constant cells', () => {
    const r = run({ A1: '100', A2: '=A1 / 10', A3: '=normal(A1, A2)' }, { samples: 2_000 });
    expect(r.compiled.cells.get('A3')!.spec).toMatchObject({ kind: 'normal', mean: 100, stdev: 10 });
  });

  test('but not from cells that vary', () => {
    const r = run({ A1: '{1, 2}', A2: '=normal(A1, 1)' });
    expect((constant(r, 'A2') as ASError).shortMsg).toBe('#VALUE!');
  });

  test('the same seed gives the same samples', () => {
    const cells = { A1: '=normal(0, 1)', A2: '{1, 2, 3}', A3: '=A1 * A2' };
    const [a, b] = [run(cells, { samples: 500 }), run(cells, { samples: 500 })];
    expect(a.columns.A3).toEqual(b.columns.A3);
    const c = run(cells, { samples: 500, seed: 0.25 });
    expect(c.columns.A3).not.toEqual(a.columns.A3);
  });

  test('results are available while sampling is still going on', () => {
    const compiled = compileSheet(sheet({ A1: '=normal(0, 1)', A2: '=A1 > 0' }));
    const evaluation = new Evaluation(compiled, { ...DEFAULT_SETTINGS, samples: 200_000 });
    const seen: number[] = [];
    while (!evaluation.run.done) {
      evaluation.advance(1);
      seen.push(evaluation.run.n);
      const summary = summarize(compiled.cells.get('A2')!, viewOf(evaluation.run));
      expect(summary.values!.reduce((sum, v) => sum + v.count, 0)).toBe(evaluation.run.n);
    }
    expect(seen.length).toBeGreaterThan(2);
    expect(seen.at(-1)).toBe(200_000);
  });

  test('a finished run can be asked for more samples', () => {
    const evaluation = new Evaluation(compileSheet(sheet({ A1: '=uniform(0, 1)' })), {
      ...DEFAULT_SETTINGS,
      samples: 1_000,
    });
    evaluation.advance();
    expect(evaluation.run.n).toBe(1_000);
    evaluation.extend(1_000);
    expect(evaluation.run.done).toBe(false);
    evaluation.advance();
    expect(evaluation.run.n).toBe(2_000);
  });

  test('normal(mean, stdev, n) is still n fixed samples (a discrete amb)', () => {
    const r = run({ A1: '=normal(100, 15, 30)' });
    expect(r.mode).toBe('exhaustive');
    expect(r.compiled.cardinality).toBe(30);
    const vs = r.columns.A1 as number[];
    expect(new Set(vs).size).toBe(30);
    expect([...vs].sort((a, b) => a - b)).toEqual(vs);
    // more distinct values than amb-engine's analysis lists, so it is summarized by its stats
    const summary = summarize(r.compiled.cells.get('A1')!, viewOf(r));
    expect(summary.values).toBeNull();
    expect(Math.abs(summary.stats!.avg - 100)).toBeLessThan(10);
  });
});

describe('tables', () => {
  test('a cell broken down by two of its dimensions', () => {
    const r = run(BUDGET);
    const total = r.compiled.cells.get('B7')!;
    const [car, apartment] = tableDimensions(r, total);
    expect([car.addr, apartment.addr]).toEqual(['B3', 'B4']);

    const filters: Filters = new Map([['B8', only(true)]]);
    const table = pivot(viewOf(r, filters), 'B7', car, apartment);
    expect(table.xLabels).toEqual(['500', '1,200']);
    expect(table.yLabels).toEqual(['2,800', '3,700', '4,200']);
    expect(table.cells.map((row) => row.map((cell) => aggregate(cell, 'avg')))).toEqual([
      [3318, 4018],
      [4218, 4918],
      [4718, 5418],
    ]);
    expect(table.cells.map((row) => row.map((cell) => cell.passing))).toEqual([
      [1, 1],
      [0, 0],
      [0, 0],
    ]);
  });
});

describe('line charts', () => {
  const cells = {
    A1: '{1, 2}',
    A3: '2024',
    B3: '=10 * A1',
    A4: '2025',
    B4: '=B3 + 5',
    C1: '=A3:B4',
  };

  test('a range-valued cell is one line per combination of choices', () => {
    const r = run(cells);
    const chart = lineChart(viewOf(r), r.compiled.cells.get('C1')!)!;
    expect(chart.series.map((s) => [s.label, s.points])).toEqual([
      ['A1=1', [[2024, 10], [2025, 15]]],
      ['A1=2', [[2024, 20], [2025, 25]]],
    ]);
    expect(chart.x).toEqual([2024, 2025]);
    expect(chart.y).toEqual([10, 25]);
    expect(chart.categories).toBeNull();
  });

  test('filters grey out the lines that no longer apply', () => {
    const r = run(cells);
    const chart = lineChart(viewOf(r, new Map([['A1', only(2)]])), r.compiled.cells.get('C1')!)!;
    expect(chart.series.map((s) => s.passing)).toEqual([false, true]);
  });

  test('labels on the x axis, and a single column of ys', () => {
    const r = run({ ...cells, A3: 'Q1', A4: 'Q2', D1: '=B3:B4' });
    const chart = lineChart(viewOf(r), r.compiled.cells.get('C1')!)!;
    expect(chart.categories).toEqual(['Q1', 'Q2']);
    expect(chart.series[1].points).toEqual([[0, 20], [1, 25]]);
    const column = lineChart(viewOf(r), r.compiled.cells.get('D1')!)!;
    expect(column.series[0].points).toEqual([[1, 10], [2, 15]]);
  });

  test('with a continuous input there is a line per sample, up to a limit', () => {
    const r = run({ ...cells, A1: '=normal(1, 0.1)' }, { samples: 1_000 });
    const chart = lineChart(viewOf(r), r.compiled.cells.get('C1')!, 50)!;
    expect(chart.series.length).toBe(50);
    expect(chart.total).toBe(1_000);
  });
});
