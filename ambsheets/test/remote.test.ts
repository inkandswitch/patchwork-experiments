// The two halves of remote evaluation, talking to each other the way they would across a
// worker boundary: every message is copied with structuredClone, which is what
// postMessage does (and which is what strips error values of their class).

import { describe, expect, test } from 'vitest';
import { ASError, valueKey, type RawValue } from '../src/lang/values';
import { summarize, viewOf, type Filter, type Filters } from '../src/model/analysis';
import { compileSheet } from '../src/model/compile';
import type { ExactCount } from '../src/model/exact';
import type { Focus } from '../src/model/focus';
import { EvaluationServer, RemoteEvaluator } from '../src/model/remote';
import { DEFAULT_SETTINGS, evaluate, type EvalSettings, type Run } from '../src/model/run';
import { BUDGET, sheet } from './sheet';

const only = (...vs: RawValue[]): Filter => ({ kind: 'values', keys: new Set(vs.map(valueKey)) });

function connect() {
  const runs: Run[] = [];
  const focuses: Focus[] = [];
  const counts: ExactCount[] = [];
  let wake: () => void = () => {};
  const notify = () => wake();
  const server: EvaluationServer = new EvaluationServer((message) => client.receive(structuredClone(message)));
  const client: RemoteEvaluator = new RemoteEvaluator(
    (message) => setTimeout(() => server.receive(structuredClone(message)), 0),
    {
      onRun: (run) => (runs.push(run), notify()),
      onFocus: (focus) => (focuses.push(focus), notify()),
      onExact: (count) => (counts.push(count), notify()),
    },
  );
  /** Waits until `condition` holds (it is checked whenever a message arrives). */
  const until = (condition: () => boolean) =>
    new Promise<void>((resolve) => {
      const check = () => (condition() ? resolve() : (wake = check));
      check();
    });
  return { server, client, runs, focuses, counts, until };
}

describe('evaluating in a worker', () => {
  test('gives the same run as evaluating in place', async () => {
    const settings: EvalSettings = { ...DEFAULT_SETTINGS, samples: 30_000 };
    const data = sheet({ A1: '=normal(10, 2)', A2: '{1, 2, 3}', A3: '=A1 * A2', A4: '=10 / (A2 - 2)' });
    const compiled = compileSheet(data);
    const { client, runs, until, server } = connect();

    client.setSheet(compiled, data, settings, true);
    await until(() => runs.at(-1)?.done === true);
    server.dispose();

    const remote = runs.at(-1)!;
    const local = evaluate(compiled, settings);
    expect(remote.n).toBe(30_000);
    expect(remote.mode).toBe('montecarlo');
    expect(remote.columns.A3).toEqual(local.columns.A3);
    expect(runs.length).toBeGreaterThan(1); // it arrived in batches
    expect(runs.map((run) => run.n)).toEqual([...runs.map((run) => run.n)].sort((a, b) => a - b));

    // summaries (which rely on the engine's analysis) come out the same
    for (const addr of ['A2', 'A3', 'A4']) {
      const info = compiled.cells.get(addr)!;
      expect(summarize(info, viewOf(remote))).toEqual(summarize(info, viewOf(local)));
    }
    // error values arrive as error values, and equal ones are the same object
    const errors = (remote.columns.A4 as RawValue[]).filter((v) => v instanceof ASError);
    expect(errors.length).toBeGreaterThan(9_000);
    expect(new Set(errors).size).toBe(1);
  });

  test('a new version of the sheet replaces the old one, even mid-run', async () => {
    const { client, runs, until, server } = connect();
    const first = sheet({ A1: '=normal(0, 1)' });
    const second = sheet(BUDGET);
    client.setSheet(compileSheet(first), first, { ...DEFAULT_SETTINGS, samples: 500_000 }, true);
    await until(() => runs.length > 0);
    client.setSheet(compileSheet(second), second, DEFAULT_SETTINGS, true);
    await until(() => runs.at(-1)?.compiled.cells.has('B7') === true && runs.at(-1)!.done);
    server.dispose();
    const last = runs.at(-1)!;
    expect(last.mode).toBe('exhaustive');
    expect(last.n).toBe(6);
    expect(summarize(last.compiled.cells.get('B7')!, viewOf(last)).values!.length).toBe(6);
  });

  test('more samples can be asked for, also when the first ones were drawn in place', async () => {
    const settings: EvalSettings = { ...DEFAULT_SETTINGS, samples: 2_000 };
    const data = sheet({ A1: '=uniform(0, 1)' });
    const compiled = compileSheet(data);
    const { client, runs, until, server } = connect();
    const local = evaluate(compiled, settings);
    client.setSheet(compiled, data, settings, false); // (not asked to run: the UI did that itself)
    client.adopt(local.columns);
    client.sampleMore(2_000);
    await until(() => runs.at(-1)?.done === true);
    server.dispose();
    const remote = runs.at(-1)!;
    expect(remote.n).toBe(4_000);
    // the worker drew the same first 2,000 for itself, and sent only the ones after them:
    // all 4,000 are what a single evaluation of 4,000 would have drawn
    expect(remote.columns.A1.length).toBe(4_000);
    expect(remote.columns.A1).toEqual(evaluate(compiled, { ...settings, samples: 4_000 }).columns.A1);
  });

  test('focused search and exact counting', async () => {
    const cells: Record<string, string> = { B1: 'total = SUM(A1:A4)', B2: '=total >= 23' };
    for (let i = 1; i <= 4; i++) cells['A' + i] = '{1 to 6}';
    const data = sheet(cells);
    const { client, focuses, counts, until, server } = connect();
    const filters: Filters = new Map([['B2', only(true)]]);
    client.setSheet(compileSheet(data), data, DEFAULT_SETTINGS, false);
    client.focus(filters, { target: 3_000, seed: 0.5 });
    client.exact(filters);
    await until(() => focuses.at(-1)?.done === true && counts.at(-1)?.done === true);
    server.dispose();

    const focus = focuses.at(-1)!;
    expect(focus.phase).toBe('sampling');
    expect(focus.n).toBe(3_000);
    expect(focus.filters).toBe(filters);
    expect(focus.columns.B1.every((total: number) => total >= 23)).toBe(true);
    expect(counts.at(-1)).toMatchObject({ cardinality: 1296, matching: 5, done: true, filters });
    expect(Math.abs(focus.probability - 5 / 1296) / (5 / 1296)).toBeLessThan(0.35);
  });

  test('stopping, and answers to questions about an older version, are ignored', async () => {
    const data = sheet({ A1: '{1 to 6}', A2: '{1 to 6}', A3: '=A1 + A2 >= 12' });
    const { client, focuses, counts, runs, until, server } = connect();
    const filters: Filters = new Map([['A3', only(true)]]);
    client.setSheet(compileSheet(data), data, DEFAULT_SETTINGS, false);
    client.focus(filters, { target: 1_000_000, seed: 0.5 });
    client.exact(filters);
    await until(() => focuses.length > 0);
    client.stopFocus();
    client.stopExact();
    const [seenFocuses, seenCounts] = [focuses.length, counts.length];
    client.setSheet(compileSheet(data), data, DEFAULT_SETTINGS, true);
    await until(() => runs.at(-1)?.done === true);
    server.dispose();
    expect(focuses.length).toBe(seenFocuses);
    expect(counts.length).toBe(seenCounts);
  });
});
