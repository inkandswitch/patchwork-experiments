// The status bar: how the sheet is being evaluated (and why), how far along that is,
// how many scenarios the filters let through, and the controls for changing it.

import { For, Show } from 'solid-js';
import { printCount, printNumber } from '../lang/values';
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
      <Show when={s.mask() !== null}>
        <span class="matching">
          {printNumber(s.passing())} match the filters ({((s.passing() / Math.max(1, run().n)) * 100).toFixed(1)}%)
        </span>
      </Show>
      <span class="reason">{run().reason}</span>

      <span class="controls">
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
