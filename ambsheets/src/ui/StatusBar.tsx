// The status bar: how the sheet is being evaluated (and why), how far along that is,
// how many scenarios the filters let through, and the controls for changing it.

import { For, Show } from 'solid-js';
import { printCount, printNumber, printShare } from '../lang/values';
import { EXHAUSTIVE_MAX_FORCED, type EvalMode } from '../model/run';
import { useSheet } from './state';

const MODES: { mode: EvalMode; label: string; title: string }[] = [
  {
    mode: 'auto',
    label: 'Auto',
    title: 'Check every scenario when there are few enough of them; otherwise sample.',
  },
  { mode: 'exhaustive', label: 'Exhaustive', title: 'Always check every scenario. Exact, but can be slow.' },
  { mode: 'montecarlo', label: 'Monte Carlo', title: 'Always sample scenarios at random. Approximate, but fast.' },
];

export function StatusBar() {
  const s = useSheet();
  const run = s.run;
  const sampling = () => run().mode === 'montecarlo';
  const progress = () => (run().target > 0 ? Math.min(1, run().n / run().target) : 1);
  const canEnumerate = () => !run().compiled.continuous && run().compiled.cardinality <= EXHAUSTIVE_MAX_FORCED;

  const summary = () => {
    const r = run();
    const total = r.compiled.cardinality;
    if (sampling()) {
      return `${printNumber(r.n)} sample${r.n === 1 ? '' : 's'} of ${printCount(total)} scenarios`;
    }
    if (!r.done) return `${printNumber(r.n)} of ${printCount(total)} scenarios`;
    return total === 1 ? '1 scenario' : `all ${printCount(total)} scenarios`;
  };

  /** What to say about the scenarios that satisfy the filters. */
  const matching = (): { text: string; title?: string; searching?: boolean } | null => {
    const focus = s.focus();
    if (focus?.phase === 'searching') {
      return {
        text: `Looking for scenarios that match the filters… (step ${focus.levels + 1})`,
        title: `Too few of the sampled scenarios match, so Ambsheets is homing in on ones that do. ${printNumber(focus.evaluations)} scenarios tried so far.`,
        searching: true,
      };
    }
    if (focus?.phase === 'failed') {
      return {
        text: 'No matching scenarios found',
        title:
          `Ambsheets went looking for scenarios that match the filters (${printNumber(focus.evaluations)} tries) without finding any. ` +
          'They may not exist. Or the filters may give it nothing to home in on: a filter on text, or on a true/false cell that is not built from comparisons, is only met by chance.',
      };
    }
    if (focus?.phase === 'sampling') {
      const error = Math.round(focus.relativeError * 100);
      return {
        text:
          `About ${printShare(focus.probability)} scenarios match the filters · ${printNumber(s.passing())} of them shown` +
          (focus.acceptance < 0.02 ? ' · little variety' : ''),
        title:
          `Too few of the sampled scenarios match, so these were sought out (${printNumber(focus.evaluations)} scenarios tried, in ${focus.levels} steps). ` +
          `The estimate of how many match is rough: give or take ${Math.max(error, 5)}% or more. ` +
          `Consecutive scenarios resemble each other; ${Math.round(focus.acceptance * 100)}% of the attempts to vary them succeeded.`,
      };
    }
    if (!s.filtering()) return null;
    const share = ((s.passing() / Math.max(1, run().n)) * 100).toFixed(1);
    return { text: `${printNumber(s.passing())} match the filters (${share}%)` };
  };

  /** The true number of matching scenarios, when it can be (or is being) counted. */
  const exactly = (): string | null => {
    const exact = s.exact();
    if (!exact) return null;
    if (!exact.done) {
      return `Counting exactly… ${Math.floor((exact.checked / Math.max(1, exact.cardinality)) * 100)}%`;
    }
    const of = `${printNumber(exact.matching)} of ${printCount(exact.cardinality)}`;
    return exact.matching === 0
      ? `Exactly: none of ${printCount(exact.cardinality)}`
      : `Exactly: ${printShare(exact.matching / exact.cardinality)} scenarios (${of})`;
  };

  return (
    <footer class="status">
      <span class="mode" data-mode={run().mode} title={run().reason}>
        {sampling() ? 'Monte Carlo' : 'Exhaustive'}
      </span>
      <span class="summary" title={run().reason}>
        {summary()}
      </span>
      <Show when={!run().done}>
        <span class="progress" role="progressbar" aria-valuenow={Math.round(progress() * 100)}>
          <span style={{ width: progress() * 100 + '%' }} />
        </span>
      </Show>
      <Show when={matching()}>
        {(matching) => (
          <span class="matching" data-searching={matching().searching ? '' : undefined} title={matching().title}>
            {matching().text}
          </span>
        )}
      </Show>
      <Show when={exactly()}>
        {(exactly) => (
          <span
            class="exactly"
            title="This sheet is being sampled, but it has few enough scenarios to check them all. This is the true number that match the filters, counted in the background."
          >
            {exactly()}
          </span>
        )}
      </Show>
      <span class="stepper">
        <Show
          when={s.scenarioIndex() !== null}
          fallback={
            <button
              disabled={s.passing() === 0}
              title="See the whole sheet as it is in one scenario, and step through the scenarios (the ones that match the filters, if there are filters)."
              onClick={() => s.setScenario(0)}
            >
              One at a time
            </button>
          }
        >
          <button title="Previous scenario (Alt+←)" onClick={() => s.stepScenario(-1)}>
            ‹
          </button>
          <span>
            {s.filtering() ? 'Matching scenario' : 'Scenario'}{' '}
            <input
              type="number"
              min="1"
              max={s.passing()}
              value={s.scenarioIndex()! + 1}
              onChange={(e) => s.setScenario(Number(e.currentTarget.value) - 1)}
            />{' '}
            of {printNumber(s.passing())}
          </span>
          <button title="Next scenario (Alt+→)" onClick={() => s.stepScenario(1)}>
            ›
          </button>
          <button title="Back to showing every scenario at once (Esc)" onClick={() => s.setScenario(null)}>
            Show all
          </button>
        </Show>
      </span>
      <span class="reason">{run().reason}</span>

      <span class="controls">
        <Show when={sampling() && s.filters().size > 0}>
          <button
            data-on={s.focusEnabled() ? '' : undefined}
            title="When few of the sampled scenarios match the filters, look for ones that do."
            onClick={() => s.setFocusEnabled(!s.focusEnabled())}
          >
            Seek matches
          </button>
        </Show>
        <Show when={sampling()}>
          <select
            title="How many scenarios to sample"
            value={s.samples()}
            onChange={(e) => s.setEvaluation({ samples: Number(e.currentTarget.value) })}
          >
            <For each={[...new Set([...s.sampleSizes, s.samples()])].sort((a, b) => a - b)}>
              {(size) => <option value={size}>{printNumber(size)} samples</option>}
            </For>
          </select>
          <button disabled={!run().done} onClick={s.sampleMore} title="Draw more samples, adding to the ones so far">
            More
          </button>
          <button onClick={s.resample} title="Start over with different random samples">
            Resample
          </button>
        </Show>
        <span class="segmented" role="group" aria-label="Evaluation">
          <For each={MODES}>
            {({ mode, label, title }) => (
              <button
                data-on={s.mode() === mode ? '' : undefined}
                disabled={mode === 'exhaustive' && !canEnumerate()}
                title={
                  mode === 'exhaustive' && !canEnumerate()
                    ? 'This model has too many scenarios to check one by one.'
                    : title
                }
                onClick={() => s.setEvaluation({ mode })}
              >
                {label}
              </button>
            )}
          </For>
        </span>
      </span>
    </footer>
  );
}
