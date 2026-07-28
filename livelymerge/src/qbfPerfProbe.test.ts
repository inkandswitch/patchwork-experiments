/**
 * Profile QBF as currently defined (merged sounds + word list in QBF.js).
 *
 * Run:  npx vitest run src/qbfPerfProbe.test.ts --testTimeout=180000
 * Writes JSON to /tmp/qbf-perf-latest.json for the canvas / report.
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeGame } from './qbfHarness';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

function measureSamples(fn: () => void, n = 40, warmup = 5): number[] {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

function summarize(samples: number[]) {
  return {
    n: samples.length,
    medianMs: +median(samples).toFixed(3),
    meanMs: +mean(samples).toFixed(3),
    p95Ms: +pct(samples, 95).toFixed(3),
    minMs: +Math.min(...samples).toFixed(3),
    maxMs: +Math.max(...samples).toFixed(3),
  };
}

describe('QBF performance profile', () => {
  it('profiles setup, tick phases, and hot paths', () => {
    const report: Record<string, unknown> = {
      when: new Date().toISOString(),
      ticksPerSec: 20,
      tickBudgetMs: 50,
      note: 'QBF.js now embeds sounds + compact word list (~113k words).',
    };

    // --- File sizes + warm game ---
    {
      // placeholder removed; setup continues below
    }

    const qbfBytes = readFileSync(join(__dirname, '..', 'QBF.js')).byteLength;
    const newdefsBytes = readFileSync(join(__dirname, '..', 'newdefs.js')).byteLength;
    report.files = {
      'QBF.js': { bytes: qbfBytes, kb: +(qbfBytes / 1024).toFixed(1) },
      'newdefs.js': { bytes: newdefsBytes, kb: +(newdefsBytes / 1024).toFixed(1) },
    };

    // Warm game for tick profiling (also exercises full load path once).
    const tMake0 = performance.now();
    const { rt, game, ticksUntil } = makeGame();
    report.makeGameMs = +(performance.now() - tMake0).toFixed(1);

    rt.eval(`
qbfPerfWordCount = 0;
if ($qbfWordList) qbfCompactStringForEach($qbfWordList, () => { qbfPerfWordCount++; });
qbfPerfSounds = typeof QBFSounds !== 'undefined' && !!QBFSounds;
true`);
    report.load = {
      makeGameMs: report.makeGameMs,
      embeddedWordCount: rt.eval(`qbfPerfWordCount`),
      soundsInstalled: rt.eval(`qbfPerfSounds`),
      note: 'makeGame = newdefs + QBF.js (scores+sounds+words) + openQBF',
    };

    // Fill rack toward a packed steady state (belt + several rack tiles).
    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 6`, 4000);

    const readState = () => {
      rt.eval(`
qbfPerfActive = qbfGame.activeLetters.length;
qbfPerfRack = qbfGame.activeLetters.filter((l) => l.loc == 'rack').length;
qbfPerfFalling = qbfGame.fallingLetters.length;
qbfPerfPaused = qbfGame.paused;
qbfPerfMorphs = qbfGame.submorphs ? qbfGame.submorphs.length : 0;
true`);
      return {
        active: rt.eval(`qbfPerfActive`) as number,
        rack: rt.eval(`qbfPerfRack`) as number,
        falling: rt.eval(`qbfPerfFalling`) as number,
        paused: rt.eval(`qbfPerfPaused`) as boolean,
        morphs: rt.eval(`qbfPerfMorphs`) as number,
      };
    };

    report.stateAtProbe = readState();

    // Empty Automerge change overhead.
    const emptyChange = measureSamples(() => {
      rt.change(() => {});
    }, 30);
    report.emptyChange = summarize(emptyChange);

    // One tick per change (production-like: each step is its own transaction).
    const oneTickPerChange = measureSamples(() => {
      rt.change(() => {
        game.tick();
      });
    }, 50);
    report.oneTickPerChange = summarize(oneTickPerChange);

    // Batched: 20 ticks in one change (isolates QBF work from commit tax).
    const batch20 = measureSamples(() => {
      rt.change(() => {
        for (let i = 0; i < 20; i++) game.tick();
      });
    }, 20);
    const batchSum = summarize(batch20);
    report.batch20TicksOneChange = {
      ...batchSum,
      msPerTickMedian: +(batchSum.medianMs / 20).toFixed(3),
      msPerTickMean: +(batchSum.meanMs / 20).toFixed(3),
    };

    // Implied Automerge tax ≈ oneTick − qbfWorkPerTick
    const qbfWork = (report.batch20TicksOneChange as any).msPerTickMedian as number;
    const oneTick = (report.oneTickPerChange as any).medianMs as number;
    report.impliedCommitTaxMs = +Math.max(0, oneTick - qbfWork).toFixed(3);
    report.headroomVs50msBudget = {
      qbfWorkMs: qbfWork,
      withCommitMs: oneTick,
      budgetMs: 50,
      okWithoutCommit: qbfWork < 50,
      okWithCommit: oneTick < 50,
    };

    // Pause: tick should be nearly free.
    rt.eval(`qbfGame.paused = true; true`);
    const pausedTicks = measureSamples(() => {
      rt.change(() => {
        game.tick();
      });
    }, 30);
    report.pausedTick = summarize(pausedTicks);
    rt.eval(`qbfGame.paused = false; true`);

    // Hot-path instrumentation: count calls (timing is wall-clock around the batch;
    // `performance` is not a LM global).
    rt.eval(`
$qbfPerf = {
  moveByCalls: 0,
  getBoundsCalls: 0,
  slideCalls: 0,
  ptCalls: 0,
  fallCalls: 0,
  ticks: 0
};
$qbfOrigMoveBy = Morph.prototype.moveBy;
$qbfOrigGetBounds = Morph.prototype.getBounds;
$qbfOrigSlide = QBFMorph.prototype.lettersSlideOnRack;
$qbfOrigFall = QBFMorph.prototype.letterFallToPile;
$qbfOrigPt = pt;
$qbfOrigTick = QBFMorph.prototype.tick;

Morph.prototype.moveBy = function (d) {
  $qbfPerf.moveByCalls++;
  return $qbfOrigMoveBy.call(this, d);
};
Morph.prototype.getBounds = function () {
  $qbfPerf.getBoundsCalls++;
  return $qbfOrigGetBounds.call(this);
};
QBFMorph.prototype.lettersSlideOnRack = function () {
  $qbfPerf.slideCalls++;
  return $qbfOrigSlide.call(this);
};
QBFMorph.prototype.letterFallToPile = function (letter) {
  $qbfPerf.fallCalls++;
  return $qbfOrigFall.call(this, letter);
};
pt = function (x, y) {
  $qbfPerf.ptCalls++;
  return $qbfOrigPt(x, y);
};
QBFMorph.prototype.tick = function () {
  $qbfPerf.ticks++;
  return $qbfOrigTick.call(this);
};
true`);

    const INSTR_TICKS = 40;
    const hotT0 = performance.now();
    rt.change(() => {
      for (let i = 0; i < INSTR_TICKS; i++) game.tick();
    });
    const hotBatchMs = performance.now() - hotT0;

    const hot = {
      ticks: rt.eval(`$qbfPerf.ticks`) as number,
      moveByCalls: rt.eval(`$qbfPerf.moveByCalls`) as number,
      getBoundsCalls: rt.eval(`$qbfPerf.getBoundsCalls`) as number,
      slideCalls: rt.eval(`$qbfPerf.slideCalls`) as number,
      fallCalls: rt.eval(`$qbfPerf.fallCalls`) as number,
      ptCalls: rt.eval(`$qbfPerf.ptCalls`) as number,
      batchMs: hotBatchMs,
    };

    // Restore originals.
    rt.eval(`
Morph.prototype.moveBy = $qbfOrigMoveBy;
Morph.prototype.getBounds = $qbfOrigGetBounds;
QBFMorph.prototype.lettersSlideOnRack = $qbfOrigSlide;
QBFMorph.prototype.letterFallToPile = $qbfOrigFall;
pt = $qbfOrigPt;
QBFMorph.prototype.tick = $qbfOrigTick;
true`);

    const perTickCalls = (n: number) => +(n / INSTR_TICKS).toFixed(2);
    report.hotPath = {
      instrumentedTicks: INSTR_TICKS,
      batchMs: +hotBatchMs.toFixed(2),
      msPerTick: +(hotBatchMs / INSTR_TICKS).toFixed(3),
      moveByCallsPerTick: perTickCalls(hot.moveByCalls),
      getBoundsCallsPerTick: perTickCalls(hot.getBoundsCalls),
      slideCallsPerTick: perTickCalls(hot.slideCalls),
      fallCallsPerTick: perTickCalls(hot.fallCalls),
      ptAllocsPerTick: perTickCalls(hot.ptCalls),
      state: readState(),
    };

    // Force some falling letters and re-measure briefly.
    ticksUntil(`qbfGame.fallingLetters.length >= 1`, 8000);
    const withFall = measureSamples(() => {
      rt.change(() => {
        game.tick();
      });
    }, 30);
    report.withFallingLetters = {
      ...summarize(withFall),
      state: readState(),
    };

    writeFileSync('/tmp/qbf-perf-latest.json', JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log('\n=== QBF PERF REPORT ===\n' + JSON.stringify(report, null, 2));

    expect((report.oneTickPerChange as any).medianMs).toBeGreaterThan(0);
    expect((report.load as any).embeddedWordCount).toBeGreaterThan(100000);
  }, 180_000);
});
