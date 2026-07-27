/**
 * CPU profile + phase timings for the QBF frame loop.
 *
 * Run with:   PROFILE=1 pnpm vitest run src/qbfFrameProfile.test.ts --disableConsoleIntercept
 * (skipped during normal `pnpm test` runs)
 *
 * Boots the game exactly like ephemeral openQBF() (via qbfHarness/makeGame), then:
 *   1. times the phases of a frame (empty change, tick, render, full frame), and
 *   2. writes a V8 .cpuprofile of ~400 frames to PROFILE_OUT (default: CWD/qbf-frames.cpuprofile).
 */
import { describe, it } from 'vitest';
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { makeGame } from './qbfHarness';

const RUN = !!process.env.PROFILE;
const OUT = process.env.PROFILE_OUT || 'qbf-frames.cpuprofile';

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(label: string, fn: () => void, { n = 200, warmup = 5 } = {}): number {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  const med = median(samples);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(
    `${label.padEnd(46)} median ${med.toFixed(2)} ms   mean ${mean.toFixed(2)} ms   max ${Math.max(...samples).toFixed(2)} ms`,
  );
  return med;
}

describe.runIf(RUN)('QBF frame profile', () => {
  it('times frame phases and captures a CPU profile', { timeout: 600_000 }, async () => {
    const { rt, game, runFrame } = makeGame();

    // Warm up: let JIT settle, letters reach the rack, etc.
    for (let i = 0; i < 60; i++) runFrame();

    const world = rt.eval('Lively') as any;
    const ctxProxy = rt.eval('ctx') as any;
    const renderProxy = rt.eval('render') as () => void;

    console.log('\n--- phase timings (each inside one runtime.change) ---');
    measure('empty change (tx + gc floor)', () => rt.change(() => 0));
    measure('game.tick() only', () => rt.change(() => game.tick()));
    measure('world.handleStepList() only', () => rt.change(() => world.handleStepList()));
    measure('world.renderOn(ctx) only (no steps)', () => rt.change(() => world.renderOn(ctxProxy)));
    measure('render() (steps + full redraw)', () => rt.change(() => renderProxy()));
    measure('full frame (runFrame: events + render)', () => runFrame());

    console.log('\n--- capturing CPU profile ---');
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: 100 });
    await session.post('Profiler.start');
    const t0 = performance.now();
    let frames = 0;
    // ~400 frames or 20s, whichever comes first.
    while (frames < 400 && performance.now() - t0 < 20_000) {
      runFrame();
      frames++;
    }
    const elapsed = performance.now() - t0;
    const { profile } = await session.post('Profiler.stop');
    writeFileSync(OUT, JSON.stringify(profile));
    console.log(
      `profiled ${frames} frames in ${elapsed.toFixed(0)} ms (${(elapsed / frames).toFixed(2)} ms/frame) -> ${OUT}`,
    );
    session.disconnect();
  });
});
