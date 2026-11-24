// The conditioned sampler, checked against cases where the right answer is known exactly.
// (Everything is seeded, so these tests are deterministic.)

import { describe, expect, test } from 'vitest';
import { AmbEngine } from '../src/engine/amb-engine';

const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const stdev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

/** The first `count` scenarios the sampler finds. */
function take<S>(sampler: Iterator<S>, count: number): S[] {
  const scenarios: S[] = [];
  while (scenarios.length < count) {
    const { done, value } = sampler.next();
    if (done) break;
    scenarios.push(value);
  }
  return scenarios;
}

/** How far short of `min` a value falls (0 if it doesn't). */
const atLeast = (value: number, min: number) => Math.max(0, min - value);

function dice(n: number) {
  const names = Array.from({ length: n }, (_, i) => 'd' + i);
  return new AmbEngine<any, any>(
    (amb) => Object.fromEntries(names.map((name) => [name, amb.range(1, 6)])),
    { total: (s) => names.reduce((sum, name) => sum + s[name], 0) },
  );
}

/** The exact distribution of the total of n dice: pmf[t] = P(total = t). */
function dicePmf(n: number): number[] {
  let pmf = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(pmf.length + 6).fill(0);
    pmf.forEach((p, t) => {
      for (let face = 1; face <= 6; face++) next[t + face] += p / 6;
    });
    pmf = next;
  }
  return pmf;
}

describe('with no conditions', () => {
  test('the scenarios are distributed as they always were (moves are reversible)', () => {
    const engine = new AmbEngine<any, any>(
      (amb) => ({
        die: amb.range(1, 6),
        coin: amb.oneOf(['heads', 'tails', 'tails']), // a repeated value: tails is twice as likely
        height: amb.normal(170, 10),
        fraction: amb.uniform(0, 1),
        order: amb.permutationOf([1, 2, 3]),
      }),
      {},
    );
    const sampler = engine.conditionedSampler({ conditions: [], randomSeed: 0.1 });
    // (skip the first rounds, which are closest to the initial random draws)
    const scenarios = take(sampler, 40_000).slice(20_000);
    expect(sampler.status.phase).toBe('sampling');
    expect(sampler.status.probability).toBe(1);

    for (let face = 1; face <= 6; face++) {
      const share = scenarios.filter((s) => s.die === face).length / scenarios.length;
      expect(Math.abs(share - 1 / 6)).toBeLessThan(0.015);
    }
    const tails = scenarios.filter((s) => s.coin === 'tails').length / scenarios.length;
    expect(Math.abs(tails - 2 / 3)).toBeLessThan(0.015);

    const heights = scenarios.map((s) => s.height);
    expect(Math.abs(mean(heights) - 170)).toBeLessThan(0.3);
    expect(Math.abs(stdev(heights) - 10)).toBeLessThan(0.3);

    const fractions = scenarios.map((s) => s.fraction);
    expect(Math.abs(mean(fractions) - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(stdev(fractions) - Math.sqrt(1 / 12))).toBeLessThan(0.01);

    const firsts = scenarios.filter((s) => s.order[0] === 1).length / scenarios.length;
    expect(Math.abs(firsts - 1 / 3)).toBeLessThan(0.015);
  });
});

describe('dice', () => {
  test('two dice totalling 12: one scenario in 36', () => {
    const sampler = dice(2).conditionedSampler({
      conditions: [(s) => atLeast(s.total, 12)],
      randomSeed: 0.2,
    });
    const scenarios = take(sampler, 1_000);
    expect(scenarios.length).toBe(1_000);
    expect(scenarios.every((s) => s.d0 === 6 && s.d1 === 6 && s.total === 12)).toBe(true);
    expect(Math.abs(sampler.status.probability - 1 / 36) / (1 / 36)).toBeLessThan(0.2);
  });

  test('ten dice totalling at least 52: about one scenario in 1,400', () => {
    const pmf = dicePmf(10);
    const exact = pmf.slice(52).reduce((sum, p) => sum + p, 0);
    expect(Math.round(1 / exact)).toBe(1403);

    const sampler = dice(10).conditionedSampler({
      conditions: [(s) => atLeast(s.total, 52)],
      randomSeed: 0.3,
    });
    const scenarios = take(sampler, 40_000);
    expect(scenarios.every((s) => s.total >= 52)).toBe(true);

    // how rare such scenarios are...
    expect(Math.abs(sampler.status.probability - exact) / exact).toBeLessThan(0.3);

    // ...and what they look like: the totals are distributed as they are among *all*
    // scenarios with a total of at least 52
    for (const total of [52, 53, 54, 55]) {
      const share = scenarios.filter((s) => s.total === total).length / scenarios.length;
      expect(Math.abs(share - pmf[total] / exact)).toBeLessThan(0.03);
    }
    // each die is high, but not always a 6
    const sixes = scenarios.filter((s) => s.d0 === 6).length / scenarios.length;
    expect(sixes).toBeGreaterThan(0.45);
    expect(sixes).toBeLessThan(0.7);
    for (const name of ['d0', 'd5', 'd9']) {
      expect(Math.abs(mean(scenarios.map((s) => s[name])) - mean(scenarios.map((s) => s.total)) / 10)).toBeLessThan(0.1);
    }
  });

  test('ten sixes: one scenario in 60 million', () => {
    const sampler = dice(10).conditionedSampler({
      conditions: [(s) => atLeast(s.total, 60)],
      randomSeed: 0.4,
    });
    const scenarios = take(sampler, 100);
    expect(scenarios.length).toBe(100);
    expect(scenarios.every((s) => s.total === 60)).toBe(true);
    const exact = 1 / 6 ** 10;
    expect(sampler.status.probability / exact).toBeGreaterThan(0.4);
    expect(sampler.status.probability / exact).toBeLessThan(2.5);
    // far fewer evaluations than the 60 million a blind search would need
    expect(sampler.status.evaluations).toBeLessThan(3_000_000);
  });
});

describe('continuous distributions', () => {
  const tail = () =>
    new AmbEngine<any, any>((amb) => ({ x: amb.normal(0, 1) }), { square: (s) => s.x * s.x });

  test('the far tail of a normal distribution', () => {
    const sampler = tail().conditionedSampler({
      conditions: [(s) => atLeast(s.x, 4)],
      randomSeed: 0.5,
    });
    const xs = take(sampler, 40_000).map((s) => s.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(4);
    // P(X >= 4) = 3.167e-5, and E[X | X >= 4] = 4.2256
    expect(Math.abs(sampler.status.probability - 3.167e-5) / 3.167e-5).toBeLessThan(0.35);
    expect(Math.abs(mean(xs) - 4.2256)).toBeLessThan(0.03);
  });

  test('both tails: separate regions are all found', () => {
    const sampler = tail().conditionedSampler({
      conditions: [(s) => atLeast(Math.abs(s.x), 3.5)],
      randomSeed: 0.6,
    });
    const xs = take(sampler, 40_000).map((s) => s.x);
    expect(xs.every((x) => Math.abs(x) >= 3.5)).toBe(true);
    const positive = xs.filter((x) => x > 0).length / xs.length;
    expect(positive).toBeGreaterThan(0.4);
    expect(positive).toBeLessThan(0.6);
    // P(|X| >= 3.5) = 4.653e-4
    expect(Math.abs(sampler.status.probability - 4.653e-4) / 4.653e-4).toBeLessThan(0.3);
  });

  test('a narrow ridge: x + y within 0.1 of 6', () => {
    const engine = new AmbEngine<any, any>(
      (amb) => ({ x: amb.normal(0, 1), y: amb.normal(0, 1) }),
      { sum: (s) => s.x + s.y },
    );
    const sampler = engine.conditionedSampler({
      conditions: [(s) => Math.max(0, Math.abs(s.sum - 6) - 0.1)],
      randomSeed: 0.7,
    });
    const scenarios = take(sampler, 60_000);
    expect(scenarios.every((s) => Math.abs(s.sum - 6) <= 0.1)).toBe(true);
    // Given the sum, x is normal around half of it with standard deviation sqrt(1/2), so
    // the particles have to spread out *along* the ridge, not just sit on it.
    const xs = scenarios.map((s) => s.x);
    expect(Math.abs(mean(xs) - 2.98)).toBeLessThan(0.08);
    expect(Math.abs(stdev(xs) - Math.SQRT1_2)).toBeLessThan(0.08);
    // P = 6.96e-6 (the density of N(0, 2) at 6, times the width 0.2, near enough)
    expect(sampler.status.probability / 6.96e-6).toBeGreaterThan(0.5);
    expect(sampler.status.probability / 6.96e-6).toBeLessThan(1.8);
  });

  test('several conditions in different units', () => {
    const engine = new AmbEngine<any, any>(
      (amb) => ({ dollars: amb.normal(50_000, 10_000), days: amb.uniform(0, 10) }),
      {},
    );
    const sampler = engine.conditionedSampler({
      conditions: [(s) => atLeast(s.dollars, 85_000), (s) => atLeast(s.days, 9.9)],
      randomSeed: 0.8,
    });
    const scenarios = take(sampler, 20_000);
    expect(scenarios.every((s) => s.dollars >= 85_000 && s.days >= 9.9)).toBe(true);
    // P(dollars >= mean + 3.5 sd) * P(days >= 9.9) = 2.326e-4 * 0.01
    expect(sampler.status.probability / 2.326e-6).toBeGreaterThan(0.5);
    expect(sampler.status.probability / 2.326e-6).toBeLessThan(1.8);
    expect(Math.abs(mean(scenarios.map((s) => s.days)) - 9.95)).toBeLessThan(0.005);
  });
});

describe('when it cannot be done', () => {
  test('conditions that nothing satisfies make the sampler give up', () => {
    const engine = new AmbEngine<any, any>((amb) => ({ x: amb.uniform(0, 1) }), {});
    const sampler = engine.conditionedSampler({
      conditions: [(s) => atLeast(s.x, 2)],
      particles: 500,
      randomSeed: 0.9,
    });
    expect(take(sampler, 10)).toEqual([]);
    expect(sampler.status.phase).toBe('failed');
    expect(sampler.status.evaluations).toBeLessThan(5_000_000);
  });

  test('a yes-or-no condition is found only if the population stumbles on it', () => {
    const yesOrNo = (wanted: number) =>
      dice(4).conditionedSampler({
        conditions: [(s) => (s.total === wanted ? 0 : 1)],
        particles: 500,
        randomSeed: 0.11,
      });
    // four sixes is 1 in 1,296: 500 particles and some wandering get there
    const sampler = yesOrNo(24);
    expect(take(sampler, 50).every((s) => s.total === 24)).toBe(true);
    // (the rounds spent waiting for a hit count towards how rare it is)
    expect(sampler.status.probability * 1296).toBeGreaterThan(0.3);
    expect(sampler.status.probability * 1296).toBeLessThan(3);
    // a total of 25 is impossible
    expect(take(yesOrNo(25), 1)).toEqual([]);
  });
});

describe('working in slices', () => {
  test('advance() does a little at a time, and drain() collects what was found', () => {
    const sampler = dice(10).conditionedSampler({
      conditions: [(s) => atLeast(s.total, 50)],
      particles: 400,
      randomSeed: 0.12,
    });
    let found = 0;
    let steps = 0;
    let mostAtOnce = 0;
    while (found < 2_000) {
      const before = sampler.status.evaluations;
      sampler.advance();
      mostAtOnce = Math.max(mostAtOnce, sampler.status.evaluations - before);
      found += sampler.drain().length;
      steps++;
    }
    expect(mostAtOnce).toBeLessThanOrEqual(30); // 3 moves per amb
    expect(steps).toBeGreaterThan(2_000);
    expect(sampler.status.produced).toBe(found);
    expect(sampler.status.acceptance).toBeGreaterThan(0.02);
  });
});
