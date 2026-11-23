// The probability distributions of the formula language.
//
// A distribution with fixed parameters, like normal(100, 15), is handed to amb-engine as
// it is. One whose parameters depend on the scenario, like normal(B1, 2) where B1 is
// itself uncertain, can't be, because the engine's ambs are set up before any scenario
// exists. So those are *derived*: the amb is a standard draw (a standard normal, or a
// number between 0 and 1), and the distribution's value is computed from that draw and
// the parameters as they are in the scenario. normal(m, s) is m + s * z.

import { ASError } from '../lang/values';

export interface Distribution {
  /** What the parameters are called, for error messages. */
  params: string[];
  /** What is wrong with these parameter values, if anything. */
  check(args: number[]): string | null;
  /** The standard draw that values are derived from. */
  base: 'normal' | 'uniform';
  /** The value for a standard draw and parameter values. */
  derive(draw: number, args: number[]): number;
  /** How to say what it is: "Normal distribution (mean 100, standard deviation 15)". */
  describe(args: string[]): string;
}

export const DISTRIBUTIONS: Record<string, Distribution> = {
  normal: {
    params: ['the mean', 'the standard deviation'],
    check: ([, stdev]) => (stdev < 0 ? "the standard deviation can't be negative" : null),
    base: 'normal',
    derive: (z, [mean, stdev]) => mean + stdev * z,
    describe: ([mean, stdev]) => `Normal distribution (mean ${mean}, standard deviation ${stdev})`,
  },
  uniform: {
    params: ['the minimum', 'the maximum'],
    check: ([min, max]) => (min > max ? "the minimum can't exceed the maximum" : null),
    base: 'uniform',
    derive: (u, [min, max]) => min + (max - min) * u,
    describe: ([min, max]) => `Uniform distribution (from ${min} to ${max})`,
  },
};

/** The parameter values as numbers, or the first thing wrong with them. */
export function checkArgs(dist: Distribution, args: unknown[]): number[] | ASError {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg instanceof ASError) return arg;
    if (typeof arg !== 'number' || Number.isNaN(arg)) {
      return new ASError('#VALUE!', `${dist.params[i]} must be a number`);
    }
  }
  const problem = dist.check(args as number[]);
  return problem ? new ASError('#VALUE!', problem) : (args as number[]);
}
