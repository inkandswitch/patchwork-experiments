// Sampling scenarios that satisfy conditions, including conditions that almost no
// scenario satisfies.
//
// Drawing scenarios at random and keeping the ones that qualify stops working when
// qualifying is rare: if one scenario in a million does, a million draws find about one.
// This sampler gets there in stages instead (the method is known as sequential Monte
// Carlo, multilevel splitting, or subset simulation):
//
//   1. Start with a population of ordinary random scenarios ("particles").
//   2. Each condition says how far a scenario is from satisfying it, so every particle
//      has a distance from the goal. Keep the closer half of the population, and call
//      the distance of the farthest survivor the new *level*.
//   3. Replace the particles that were dropped with copies of survivors, then let every
//      particle wander: nudge one of its ambs, and keep the change if the particle is
//      still within the level. (This wandering is Markov chain Monte Carlo. It is what
//      turns the copies back into a varied population.)
//   4. Repeat from 2 until the level reaches zero. Now every particle satisfies the
//      conditions, and wandering some more yields as many such scenarios as are wanted.
//
// Two things come out. One is the scenarios, distributed the way they would be among
// *all* scenarios that satisfy the conditions (not biased towards the easy ones). The
// other is an estimate of how rare such scenarios are: each stage keeps a known fraction
// of the population, and the product of those fractions is the probability.
//
// The wandering relies on Amb.move being reversible (see its comment): because a move
// never changes how likely a value is, "keep it if it's still within the level" is all
// the bookkeeping a step needs.

import type { Amb } from './amb-engine';

export interface ConditionedConfig<S> {
  /**
   * One function per condition. Each returns 0 for a scenario that satisfies it, and
   * otherwise a positive number saying how far off the scenario is (in any units; the
   * sampler rescales each condition by its typical size). A condition that can only say
   * yes or no should return Infinity for no. That works too, but it gives the sampler
   * nothing to home in on: such a condition is only ever met by chance.
   */
  conditions: ((scenario: S) => number)[];
  /** The size of the population. More particles: slower, but more accurate. */
  particles?: number;
  /** How many moves each particle makes per round of wandering. */
  moves?: number;
  randomSeed?: number;
}

export interface ConditionedStatus {
  /**
   * 'searching' while the levels are still being lowered, 'sampling' once the population
   * satisfies the conditions, 'failed' if it could not be brought to.
   */
  phase: 'searching' | 'sampling' | 'failed';
  /** How many times the level has been lowered. */
  levels: number;
  /** The current level: how far particles may be from satisfying the conditions. */
  distance: number;
  /**
   * The estimated probability that a random scenario satisfies the conditions. (While
   * searching: that it is within the current level, which is an upper bound.)
   */
  probability: number;
  /**
   * A rough idea of the estimate's relative error (0.2 = give or take 20%). It assumes
   * the particles are independent, which they aren't quite, so it is on the low side.
   */
  relativeError: number;
  /** The fraction of moves that were kept in the last round. Near 0 means poor variety. */
  acceptance: number;
  /** How many scenarios have been evaluated. */
  evaluations: number;
  /** How many scenarios have been produced. */
  produced: number;
}

/** The fraction of the population that survives each lowering of the level. */
const SURVIVAL = 0.5;
const MAX_LEVELS = 300;
/** Give up after this many rounds in a row in which no particle got any closer. */
const MAX_STALLED_ROUNDS = 25;

interface Particle {
  ambs: Record<string, any>;
  distance: number;
}

export class ConditionedSampler<S> implements IterableIterator<S> {
  readonly status: ConditionedStatus = {
    phase: 'searching',
    levels: 0,
    distance: Infinity,
    probability: 1,
    relativeError: 0,
    acceptance: 1,
    evaluations: 0,
    produced: 0,
  };

  private readonly conditions: ((scenario: S) => number)[];
  private readonly size: number;
  private readonly moves: number;
  private readonly continuousAmbs: [string, Amb<any>][];

  private particles: Particle[] = [];
  /** Each condition's raw distances for the initial population, until they are rescaled. */
  private raw: number[][] | null = [];
  private scales: number[] = [];
  private level = Infinity;
  /** The next particle to create (at first) or to move. */
  private cursor = 0;
  private stalledRounds = 0;
  private stepSize = 0.5;
  private proposed = 0;
  private accepted = 0;
  private nudges = 0;
  private nudgesAccepted = 0;
  private variance = 0;
  private produced: S[] = [];

  constructor(
    private readonly ambs: [string, Amb<any>][],
    private readonly random: () => number,
    /** Wraps amb values in a scenario whose formulas are computed when they are read. */
    private readonly lazy: (ambValues: Record<string, any>) => S,
    /** Computes every formula, turning amb values into a complete scenario. */
    private readonly complete: (ambValues: Record<string, any>) => S,
    config: ConditionedConfig<S>
  ) {
    this.conditions = config.conditions;
    this.size = Math.max(2, config.particles ?? 2000);
    this.moves = config.moves ?? Math.max(8, Math.min(40, 3 * ambs.length));
    this.continuousAmbs = ambs.filter(([_, amb]) => amb.continuous);
  }

  /**
   * Does a small, bounded amount of work (about `moves` scenario evaluations). Call this
   * repeatedly; scenarios that satisfy the conditions accumulate, to be collected with
   * drain(). Nothing happens once the sampler has failed.
   */
  advance(): void {
    if (this.status.phase === 'failed') {
      return;
    }
    if (this.raw) {
      this.populate();
    } else {
      this.moveParticle();
    }
  }

  /** The scenarios produced since the last call. */
  drain(): S[] {
    const scenarios = this.produced;
    this.produced = [];
    return scenarios;
  }

  // The sampler is also an iterator over the scenarios it finds. (Mind that the first
  // call to next() does the whole search, which can take a while; use advance() and
  // drain() to do the work in slices.)

  private pending: S[] = [];

  next(): IteratorResult<S> {
    while (this.pending.length === 0) {
      if (this.status.phase === 'failed') {
        return { done: true, value: undefined };
      }
      this.advance();
      this.pending = this.drain().reverse();
    }
    return { done: false, value: this.pending.pop()! };
  }

  [Symbol.iterator]() {
    return this;
  }

  // --- the initial population ---

  private populate() {
    const ambs: Record<string, any> = {};
    for (const [name, amb] of this.ambs) {
      ambs[name] = amb.next();
    }
    this.particles.push({ ambs, distance: 0 });
    this.raw!.push(this.rawDistances(ambs));
    if (this.particles.length < this.size) {
      return;
    }

    // Rescale each condition by its typical (median) distance when it isn't satisfied,
    // so that conditions measured in different units can be added up.
    const raw = this.raw!;
    this.raw = null;
    this.scales = this.conditions.map((_, c) => {
      const misses = raw
        .map((distances) => distances[c])
        .filter((d) => d > 0 && Number.isFinite(d))
        .sort((a, b) => a - b);
      return misses.length > 0 ? misses[Math.floor(misses.length / 2)] : 1;
    });
    this.particles.forEach((particle, i) => {
      particle.distance = this.combine(raw[i]);
    });
    this.lowerLevel();
  }

  private rawDistances(ambs: Record<string, any>): number[] {
    this.status.evaluations++;
    // (a copy, because the lazy scenario keeps what it computes in the object it is given)
    const scenario = this.lazy({ ...ambs });
    return this.conditions.map((condition) => {
      const d = condition(scenario);
      return d > 0 ? d : d <= 0 ? 0 : Infinity; // (NaN counts as "nowhere near")
    });
  }

  private combine(raw: number[]): number {
    let distance = 0;
    for (let c = 0; c < raw.length; c++) {
      distance += raw[c] / this.scales[c];
    }
    return distance;
  }

  // --- lowering the level ---

  private lowerLevel() {
    const { particles, size, status } = this;
    const sorted = particles.map((particle) => particle.distance).sort((a, b) => a - b);
    let level = sorted[Math.ceil(SURVIVAL * size) - 1];

    if (level > 0 && !(level < this.level)) {
      // Too many particles sit exactly at the current level for the usual cut to make
      // progress. Cut just below it instead, however few particles that keeps.
      level = -1;
      for (let i = size - 1; i >= 0; i--) {
        if (sorted[i] < this.level) {
          level = sorted[i];
          break;
        }
      }
      if (level < 0) {
        // No particle is any closer than the level. Let them wander some more.
        if (++this.stalledRounds > MAX_STALLED_ROUNDS) {
          status.phase = 'failed';
        }
        return;
      }
    }

    const survivors = particles.filter((particle) => particle.distance <= level);
    // The share of scenarios within the old level that are also within the new one. If
    // the population had to wander for some rounds before any particle got closer, each
    // of those rounds was another population's worth of failed attempts.
    const fraction = survivors.length / (size * (this.stalledRounds + 1));
    status.probability *= fraction;
    this.variance += (1 - fraction) / (fraction * size * (this.stalledRounds + 1));
    status.relativeError = Math.sqrt(this.variance);
    status.levels++;
    status.distance = this.level = level;
    this.stalledRounds = 0;

    // Refill the population with copies of the survivors, as evenly as possible.
    for (let i = survivors.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [survivors[i], survivors[j]] = [survivors[j], survivors[i]];
    }
    this.particles = Array.from({ length: size }, (_, i) => ({ ...survivors[i % survivors.length] }));

    if (level === 0) {
      status.phase = 'sampling';
    } else if (status.levels >= MAX_LEVELS) {
      // (conditions that can only be met approximately, like a continuous value being
      // exactly 3, end up here)
      status.phase = 'failed';
    }
  }

  // --- wandering ---

  private moveParticle() {
    const particle = this.particles[this.cursor];
    for (let i = 0; i < this.moves && this.ambs.length > 0; i++) {
      const { ambs, nudge } = this.propose(particle.ambs);
      const distance = this.combine(this.rawDistances(ambs));
      const keep = distance <= this.level;
      if (keep) {
        particle.ambs = ambs;
        particle.distance = distance;
      }
      this.proposed++;
      this.accepted += keep ? 1 : 0;
      if (nudge) {
        this.nudges++;
        this.nudgesAccepted += keep ? 1 : 0;
      }
    }

    if (this.status.phase === 'sampling') {
      this.produced.push(this.complete({ ...particle.ambs }));
      this.status.produced++;
    }

    if (++this.cursor === this.size) {
      this.cursor = 0;
      this.endRound();
    }
  }

  /**
   * A candidate next state for a particle. Most of the time one amb moves; sometimes it
   * is redrawn from scratch (which is how a particle jumps between separate regions); and
   * sometimes all the continuous ambs are nudged together (which is how particles follow
   * a constraint that ties several of them to each other, like A + B = 10).
   */
  private propose(current: Record<string, any>): { ambs: Record<string, any>; nudge: boolean } {
    const ambs = { ...current };
    const roll = this.random();
    if (this.continuousAmbs.length > 1 && roll < 0.25) {
      const step = this.stepSize * (0.3 + 0.7 * this.random());
      for (const [name, amb] of this.continuousAmbs) {
        ambs[name] = amb.move(current[name], step);
      }
      return { ambs, nudge: true };
    }
    const [name, amb] = this.ambs[Math.floor(this.random() * this.ambs.length)];
    const redraw = this.random() < 0.25;
    const step = redraw ? 1 : this.stepSize * (0.2 + 0.8 * this.random());
    ambs[name] = amb.move(current[name], step);
    return { ambs, nudge: !redraw };
  }

  private endRound() {
    this.status.acceptance = this.proposed > 0 ? this.accepted / this.proposed : 1;

    // Tune the size of nudges so that a fair share of them are kept: smaller steps as
    // the region the particles live in shrinks.
    if (this.nudges > 0) {
      const rate = this.nudgesAccepted / this.nudges;
      if (rate < 0.2) {
        this.stepSize = Math.max(1e-6, this.stepSize * 0.7);
      } else if (rate > 0.5) {
        this.stepSize = Math.min(1, this.stepSize * 1.3);
      }
    }
    this.proposed = this.accepted = this.nudges = this.nudgesAccepted = 0;

    if (this.status.phase === 'searching') {
      this.lowerLevel();
    }
  }
}
