# amb-engine (a working copy)

This started as `src/amb-engine.ts` from
[inkandswitch/amb-engine](https://github.com/inkandswitch/amb-engine) at commit `9f5efbf`
("refactoring", 2025-10-13). It lives in this project, rather than being vendored
untouched, while conditioned sampling is being worked out; the changes are meant to go
back upstream once they settle.

What has changed since that commit:

- **`Amb.move(current, step)`**: every kind of amb can make a random move away from a
  value that is reversible with respect to its own distribution (a nearby value in a
  `oneOf` list, a swap in a permutation, a bounce inside a uniform interval, a
  Crank-Nicolson step for a normal). `Amb.continuous` says which ambs are numbers on a
  continuum.
- **`AmbEngine.conditionedSampler({ conditions })`** and `conditioned-sampler.ts`: a
  sampler for scenarios that satisfy conditions, which keeps working when hardly any
  scenario does. It is sequential Monte Carlo with MCMC moves; the file's header comment
  explains the method. Besides scenarios it yields an estimate of how probable the
  conditions are.
- **Lazy scenarios**: formulas are computed through getters on a prototype that is set up
  once per sampler, instead of with `Object.defineProperty` on every scenario. The
  conditioned sampler uses this to evaluate only the cells its conditions read. The
  exhaustive and Monte Carlo samplers behave as before (and got faster).

`test/conditioned.test.ts` checks the sampler against cases whose exact answers are known.

The two files here are kept identical to the ones on the `main` branch of a local checkout
of amb-engine (`~/prog/amb-engine`), where the same changes are committed. (They import
each other with explicit `.ts` extensions because that repository runs under Deno.)
