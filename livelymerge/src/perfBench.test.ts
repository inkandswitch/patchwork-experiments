/**
 * Performance benchmarks for the closure/scope-object/global machinery.
 *
 * Run with:   BENCH=1 pnpm vitest run src/perfBench.test.ts
 * (skipped during normal `pnpm test` runs)
 *
 * Each scenario is defined ONCE via runtime.eval (setup), then measured as
 * repeated `runtime.change(() => storedFn(n))` transactions — the same path the
 * 30Hz rAF loop takes in production (no per-sample transpilation). Plain-JS
 * baselines run the equivalent code outside the runtime.
 */
import { describe, it } from 'vitest';
import { createLivelymergeRuntime } from './livelymergeRuntime';
import { createAutomergeTestDocHandle } from './testDocHandle';

const RUN = !!process.env.BENCH;

// Sink to keep JIT from dead-code-eliminating baselines.
let sink: unknown;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Median ms per call of fn, sampled for ~minTimeMs. */
function measure(fn: () => void, { minTimeMs = 250, maxSamples = 500, warmup = 3 } = {}): number {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  const t0 = performance.now();
  while (performance.now() - t0 < minTimeMs && samples.length < maxSamples) {
    const s = performance.now();
    fn();
    samples.push(performance.now() - s);
  }
  return median(samples);
}

type Row = {
  scenario: string;
  msPerChange: number;
  innerOps: number;
  nsPerOp: number; // change overhead subtracted
  baselineNsPerOp?: number;
  slowdown?: number;
};

function formatTable(rows: Row[], txOverheadMs: number): string {
  const cols = ['scenario', 'ms/change', 'inner ops', 'ns/op', 'baseline ns/op', 'slowdown'];
  const lines = rows.map((r) => [
    r.scenario,
    r.msPerChange.toFixed(3),
    String(r.innerOps),
    r.nsPerOp.toFixed(0),
    r.baselineNsPerOp === undefined ? '-' : r.baselineNsPerOp.toFixed(1),
    r.slowdown === undefined ? '-' : `${r.slowdown.toFixed(0)}x`,
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...lines.map((l) => l[i].length)));
  const render = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [
    `empty-change overhead (subtracted from ns/op): ${txOverheadMs.toFixed(3)} ms`,
    render(cols),
    render(widths.map((w) => '-'.repeat(w))),
    ...lines.map(render),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Plain-JS baselines
// ---------------------------------------------------------------------------

function plainInc(x: number) {
  return x + 1;
}

const plainGlobals: { g: number } = { g: 1 };

class PlainThing {
  vals: number[];
  factor: number;
  constructor(vals: number[], factor: number) {
    this.vals = vals;
    this.factor = factor;
  }
  plain() {
    return this.factor;
  }
  mapNoCapture() {
    return this.vals.map((v) => v * 2).length;
  }
  mapThisOnly() {
    return this.vals.map((v) => v * this.factor).length;
  }
  sumLocal() {
    let s = 0;
    this.vals.forEach((v) => {
      s += v;
    });
    return s;
  }
  sumThis() {
    let s = 0;
    this.vals.forEach((v) => {
      s += v * this.factor;
    });
    return s;
  }
}

const baselines = {
  globalFnCall(n: number) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc = plainInc(acc);
    return acc;
  },
  globalVarRead(n: number) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += plainGlobals.g;
    return acc;
  },
  mathSqrt(n: number) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += Math.sqrt(i);
    return acc;
  },
  propRead(p: { a: number }, n: number) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += p.a;
    return acc;
  },
  scopeRead(n: number) {
    let x = 1;
    const f = () => x;
    let acc = 0;
    for (let i = 0; i < n; i++) acc += x;
    return acc + f();
  },
  objAlloc(n: number) {
    let last: { x: number; y: number } | null = null;
    for (let i = 0; i < n; i++) last = { x: i, y: i };
    return last!.x;
  },
  methodCalls(
    t: PlainThing,
    n: number,
    method: 'plain' | 'sumLocal' | 'sumThis' | 'mapNoCapture' | 'mapThisOnly',
  ) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += t[method]();
    return acc;
  },
};

// ---------------------------------------------------------------------------
// LM scenario definitions (transpiled once, promoted into the doc)
// ---------------------------------------------------------------------------

const SETUP = `
function inc(x) { return x + 1; }

function benchGlobalFnCall(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc = inc(acc); }
  return acc;
}

function benchGlobalVarRead(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += g; }
  return acc;
}

function benchMathSqrt(n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += Math.sqrt(i); }
  return acc;
}

function benchPropRead(p, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += p.a; }
  return acc;
}

function benchShadowPropRead(n) {
  const p = { a: 1 };
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += p.a; }
  return acc;
}

function benchScopeRead(n) {
  let x = 1;
  const f = () => x;   // forces x onto this function's scope object
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += x; }
  return acc + f();
}

function benchObjAlloc(n) {
  let last = null;
  for (let i = 0; i < n; i++) { last = { x: i, y: i }; }
  return last.x;
}

class BenchThing {
  constructor(vals, factor) {
    this.vals = vals;
    this.factor = factor;
  }
  plain() {
    return this.factor;
  }
  sumLocal() {
    let s = 0;
    this.vals.forEach((v) => { s += v; });
    return s;
  }
  sumThis() {
    let s = 0;
    this.vals.forEach((v) => { s += v * this.factor; });
    return s;
  }
  mapNoCapture() {
    return this.vals.map((v) => v * 2).length;
  }
  mapThisOnly() {
    return this.vals.map((v) => v * this.factor).length;
  }
}

function benchMethodPlain(t, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += t.plain(); }
  return acc;
}

function benchMethodArrowLocal(t, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += t.sumLocal(); }
  return acc;
}

function benchMethodArrowThisLocal(t, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += t.sumThis(); }
  return acc;
}

function benchMethodArrowNoCapture(t, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += t.mapNoCapture(); }
  return acc;
}

function benchMethodArrowThisOnly(t, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += t.mapThisOnly(); }
  return acc;
}

function benchLocalFnCall(f, n) {
  let acc = 0;
  for (let i = 0; i < n; i++) { acc = f(acc); }
  return acc;
}

function benchMethodFlatShadow(n) {
  const t = { factor: 2, plain: function () { return this.factor; } };
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += t.plain(); }
  return acc;
}

function makeRange(n) {
  const xs = [];
  for (let i = 0; i < n; i++) { xs.push(i); }
  return xs;
}

g = 1;
flat = { factor: 2, plain: function () { return this.factor; } };
p = { a: 1 };
thing1 = new BenchThing([1], 2);
thingN = new BenchThing(makeRange(1000), 2);
`;

describe.runIf(RUN)('livelymerge perf benchmarks', () => {
  it('measures closure/global/this hot paths', { timeout: 600_000 }, () => {
    // Transaction floor on a pristine heap (just the roots): isolates Automerge's own
    // change cost from the per-transaction GC traversal of the user heap.
    const emptyRuntime = createLivelymergeRuntime(createAutomergeTestDocHandle());
    const txEmptyMs = measure(() => emptyRuntime.change(() => 0));

    const runtime = createLivelymergeRuntime(createAutomergeTestDocHandle());
    runtime.eval(SETUP);

    // Grab proxies once; they stay valid across transactions via the proxy cache.
    const lm = (name: string) => runtime.eval(name) as (...args: unknown[]) => unknown;
    const benchGlobalFnCall = lm('benchGlobalFnCall');
    const benchLocalFnCall = lm('benchLocalFnCall');
    const benchMethodFlatShadow = lm('benchMethodFlatShadow');
    const incProxy = runtime.eval('inc');
    const flatProxy = runtime.eval('flat');
    const benchGlobalVarRead = lm('benchGlobalVarRead');
    const benchMathSqrt = lm('benchMathSqrt');
    const benchPropRead = lm('benchPropRead');
    const benchShadowPropRead = lm('benchShadowPropRead');
    const benchScopeRead = lm('benchScopeRead');
    const benchObjAlloc = lm('benchObjAlloc');
    const benchMethodPlain = lm('benchMethodPlain');
    const benchMethodArrowLocal = lm('benchMethodArrowLocal');
    const benchMethodArrowNoCapture = lm('benchMethodArrowNoCapture');
    const benchMethodArrowThisOnly = lm('benchMethodArrowThisOnly');
    const benchMethodArrowThisLocal = lm('benchMethodArrowThisLocal');
    const pProxy = runtime.eval('p');
    const thing1 = runtime.eval('thing1');
    const thingN = runtime.eval('thingN');

    const txOverheadMs = measure(() => runtime.change(() => 0));

    const plainThing1 = new PlainThing([1], 2);
    const plainThingN = new PlainThing(Array.from({ length: 1000 }, (_, i) => i), 2);
    const plainP = { a: 1 };

    const rows: Row[] = [];
    const scenario = (
      name: string,
      innerOps: number,
      lmFn: () => void,
      baselineFn?: () => void,
    ) => {
      const ms = measure(() => runtime.change(lmFn));
      const nsPerOp = (Math.max(0, ms - txOverheadMs) * 1e6) / innerOps;
      let baselineNsPerOp: number | undefined;
      if (baselineFn) {
        baselineNsPerOp = (measure(baselineFn) * 1e6) / innerOps;
      }
      rows.push({
        scenario: name,
        msPerChange: ms,
        innerOps,
        nsPerOp,
        baselineNsPerOp,
        slowdown:
          baselineNsPerOp !== undefined && baselineNsPerOp > 0
            ? nsPerOp / baselineNsPerOp
            : undefined,
      });
    };

    const N = 10_000;

    scenario(
      'global fn call ($global.inc())',
      N,
      () => (sink = benchGlobalFnCall(N)),
      () => (sink = baselines.globalFnCall(N)),
    );
    scenario(
      'local fn call (fun proxy apply only)',
      N,
      () => (sink = benchLocalFnCall(incProxy, N)),
      () => (sink = baselines.globalFnCall(N)),
    );
    scenario(
      'global var read ($global.g)',
      N,
      () => (sink = benchGlobalVarRead(N)),
      () => (sink = baselines.globalVarRead(N)),
    );
    scenario(
      'native global (Math.sqrt)',
      N,
      () => (sink = benchMathSqrt(N)),
      () => (sink = baselines.mathSqrt(N)),
    );
    scenario(
      'persistent obj prop read',
      N,
      () => (sink = benchPropRead(pProxy, N)),
      () => (sink = baselines.propRead(plainP, N)),
    );
    scenario(
      'shadow obj prop read',
      N,
      () => (sink = benchShadowPropRead(N)),
      () => (sink = baselines.propRead(plainP, N)),
    );
    scenario(
      'captured local read ($scopeN.x)',
      N,
      () => (sink = benchScopeRead(N)),
      () => (sink = baselines.scopeRead(N)),
    );
    scenario(
      'obj literal alloc (shadow + gc)',
      2_000,
      () => (sink = benchObjAlloc(2_000)),
      () => (sink = baselines.objAlloc(2_000)),
    );
    scenario(
      'method call, no closure',
      2_000,
      () => (sink = benchMethodPlain(thing1, 2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'plain')),
    );
    scenario(
      'method call, flat persistent obj (own prop, no proto walk)',
      2_000,
      () => (sink = benchMethodPlain(flatProxy, 2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'plain')),
    );
    scenario(
      'method call, flat shadow obj (no Automerge)',
      2_000,
      () => (sink = benchMethodFlatShadow(2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'plain')),
    );
    scenario(
      'method call, arrow captures nothing',
      2_000,
      () => (sink = benchMethodArrowNoCapture(thing1, 2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'mapNoCapture')),
    );
    scenario(
      'method call, arrow captures ONLY this',
      2_000,
      () => (sink = benchMethodArrowThisOnly(thing1, 2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'mapThisOnly')),
    );
    scenario(
      'method call, arrow captures local',
      2_000,
      () => (sink = benchMethodArrowLocal(thing1, 2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'sumLocal')),
    );
    scenario(
      'method call, arrow captures local+this',
      2_000,
      () => (sink = benchMethodArrowThisLocal(thing1, 2_000)),
      () => (sink = baselines.methodCalls(plainThing1, 2_000, 'sumThis')),
    );
    scenario(
      'arrow iteration over 1000 elems (local+this)',
      1_000,
      () => (sink = benchMethodArrowThisLocal(thingN, 1)),
      () => (sink = baselines.methodCalls(plainThingN, 1, 'sumThis')),
    );
    scenario('do-it: eval("1 + 1") incl. transpile', 1, () => (sink = runtime.eval('1 + 1')));

    // GC floor: cost of an empty transaction when the persistent heap is big.
    // Every change re-traverses the whole reachable doc heap (visitPersistent).
    const bigRuntime = createLivelymergeRuntime(createAutomergeTestDocHandle());
    bigRuntime.eval(`
      function makeObjs(n) {
        const os = [];
        for (let i = 0; i < n; i++) { os.push({ v: i }); }
        return os;
      }
      objs = makeObjs(2000);
    `);
    const bigTxMs = measure(() => bigRuntime.change(() => 0));
    rows.push({
      scenario: 'empty change, 2000-obj persistent heap (gc floor)',
      msPerChange: bigTxMs,
      innerOps: 2_000,
      nsPerOp: (bigTxMs * 1e6) / 2_000,
    });

    console.log(
      `\nempty-change on pristine heap (Automerge change cost alone): ${txEmptyMs.toFixed(3)} ms`,
    );
    console.log('\n' + formatTable(rows, txOverheadMs) + '\n');
    void sink;
  });
});
