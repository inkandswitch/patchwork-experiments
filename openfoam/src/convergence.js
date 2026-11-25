// When has a run's resistance settled? Pure, so the run stops on it and
// the tool can say the same thing about any history.
//
// The rule, kept simple enough to check by hand: compare the mean of the last
// window of iterations with the mean of the window before it. The run has
// settled when the two agree within `tol` of the latest mean AND the scatter
// within the latest window (its standard deviation) is within `tol` too, once
// at least `minIter` iterations have run. The window is a tenth of the
// iterations so far, at least `minWindow`, so it grows with a slow run.
//
// Steady (simpleFoam) runs also stop on their residuals; this is for local
// time stepping (interFoam), whose drag can drift for thousands of iterations
// after its residuals stop saying anything.

export const DEFAULT_CRITERION = Object.freeze({ tol: 0.01, minWindow: 100, minIter: 500 });

/**
 * @param {number[]} values  the resistance, one per iteration, in order
 * @param {{ tol?: number, minWindow?: number, minIter?: number }} [c]
 * @returns {{ settled: boolean, window: number, mean: number, previous: number, change: number, scatter: number, why: string }}
 *   change and scatter as fractions of the latest window's mean
 */
export function settled(values, c = {}) {
  const { tol, minWindow, minIter } = { ...DEFAULT_CRITERION, ...c };
  const n = values.length;
  const window = Math.max(minWindow, Math.round(n / 10));
  const none = (why) => ({ settled: false, window, mean: NaN, previous: NaN, change: NaN, scatter: NaN, why });
  if (n < minIter) return none(`${n} of at least ${minIter} iterations`);
  if (n < 2 * window) return none("not two windows yet");
  const last = values.slice(n - window);
  const prev = values.slice(n - 2 * window, n - window);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const m1 = mean(last);
  const m0 = mean(prev);
  const scale = Math.abs(m1) || 1;
  const sd = Math.sqrt(last.reduce((s, v) => s + (v - m1) ** 2, 0) / last.length);
  const change = Math.abs(m1 - m0) / scale;
  const scatter = sd / scale;
  const ok = change <= tol && scatter <= tol && Number.isFinite(change);
  return {
    settled: ok,
    window,
    mean: m1,
    previous: m0,
    change,
    scatter,
    why: ok
      ? `settled: the last ${window} iterations average within ${(change * 100).toFixed(2)}% of the ${window} before, scatter ${(scatter * 100).toFixed(2)}%`
      : change > tol
        ? `still moving: ${(change * 100).toFixed(2)}% between the last two windows of ${window}`
        : `scattering: ${(scatter * 100).toFixed(2)}% within the last ${window}`,
  };
}

/**
 * The first iteration at which a history would have stopped under the rule,
 * or null: for comparing runs (the convergence experiment) after the fact.
 * Checked every `every` iterations, as the runner checks every flush.
 */
export function settledAt(values, c = {}, every = 10) {
  for (let n = every; n <= values.length; n += every) if (settled(values.slice(0, n), c).settled) return n;
  return null;
}
