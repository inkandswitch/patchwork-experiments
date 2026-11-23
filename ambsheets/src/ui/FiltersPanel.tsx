// The filters panel: every cell that has more than one value, split into inputs (the
// ambs) and outputs (the formulas that depend on them). Checking values, or narrowing a
// range, keeps only the scenarios that match, and everything else on the sheet shows
// which of its values are still possible.

import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import { printNumber, printValue } from '../lang/values';
import { displayName, type CellInfo } from '../model/compile';
import { isRangeValued, type Summary, type ValueCount } from '../model/analysis';
import { RangeSlider } from './RangeSlider';
import { useSheet } from './state';

const COLLAPSED_VALUES = 5;

export function FiltersPanel() {
  const s = useSheet();
  // (an amb written inside a larger formula has no cell of its own to filter on; the
  // formula's cell shows up among the outputs)
  const inputs = () => s.run().compiled.varying.filter((info) => info.kind === 'amb');
  const outputs = createMemo(() =>
    s.run().compiled.varying.filter((info) => {
      if (info.kind !== 'formula' || isRangeValued(s.run(), info.addr)) return false;
      const summary = s.summaries().get(info.addr);
      return summary !== undefined && (summary.values === null || summary.values.length > 1);
    }),
  );

  return (
    <aside class="filters">
      <div class="panel-title">
        Filters
        <Show when={s.activeFilters().length > 0}>
          <span class="filter-count">
            {s.activeFilters().length} active ·{' '}
            <button class="link" onClick={s.clearFilters}>
              Clear
            </button>
          </span>
        </Show>
      </div>
      <div class="panel-body">
        <Show
          when={inputs().length > 0}
          fallback={
            <p class="hint">
              No cell has more than one value yet. Type an amb like <code>{'{500, 1200}'}</code> into a cell.
            </p>
          }
        >
          <h3>Inputs</h3>
          <For each={inputs()}>{(info) => <CellFilter info={info} />}</For>
          <Show when={outputs().length > 0}>
            <h3>Outputs</h3>
            <For each={outputs()}>{(info) => <CellFilter info={info} />}</For>
          </Show>
        </Show>
      </div>
    </aside>
  );
}

function CellFilter(props: { info: CellInfo }) {
  const s = useSheet();
  const addr = () => props.info.addr;
  const summary = () => s.summaries().get(addr());
  const [expanded, setExpanded] = createSignal(false);
  const values = () => summary()?.values ?? null;
  const shown = () => (expanded() ? values()! : values()!.slice(0, COLLAPSED_VALUES));

  return (
    <div class="cell-filter" data-filtered={s.filters().has(addr()) ? '' : undefined}>
      <button class="cell-filter-name" onClick={() => s.select(props.info.pos)} title="Select this cell">
        {displayName(props.info)}
      </button>
      <Show when={summary()}>
        {(summary) => (
          <Show when={values()} fallback={<RangeFilter addr={addr()} summary={summary()} />}>
            {/* by index, so the checkboxes stay put while new samples keep changing the counts */}
            <Index each={shown()}>{(v) => <ValueCheckbox addr={addr()} value={v()} n={summary().n} />}</Index>
            <Show when={values()!.length > COLLAPSED_VALUES}>
              <button class="link" onClick={() => setExpanded(!expanded())}>
                {expanded() ? 'Show less' : `+ Show ${values()!.length - COLLAPSED_VALUES} more`}
              </button>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
}

function ValueCheckbox(props: { addr: string; value: ValueCount; n: number }) {
  const s = useSheet();
  // Exact counts when every scenario was checked; shares of the sample otherwise.
  const share = () =>
    s.run().mode === 'montecarlo'
      ? `${((props.value.count / Math.max(1, props.n)) * 100).toFixed(1)}%`
      : printNumber(props.value.count);

  return (
    <label class="value-option" data-out={props.value.passing === 0 ? '' : undefined}>
      <input
        type="checkbox"
        checked={s.isValueSelected(props.addr, props.value.key)}
        onChange={() => s.toggleValue(props.addr, props.value.value)}
      />
      <span class="value">{printValue(props.value.value) || '(empty)'}</span>
      <span class="count">{share()}</span>
    </label>
  );
}

/** For cells with too many distinct values to list: filter on a range of numbers. */
function RangeFilter(props: { addr: string; summary: Summary }) {
  const s = useSheet();
  const stats = () => props.summary.stats;
  const filter = () => {
    const f = s.filters().get(props.addr);
    return f?.kind === 'range' ? f : null;
  };
  const lo = () => Math.max(stats()!.min, filter()?.min ?? -Infinity);
  const hi = () => Math.min(stats()!.max, filter()?.max ?? Infinity);

  return (
    <Show when={stats()} fallback={<div class="hint">many values</div>}>
      <div class="range-filter">
        <div class="range-labels">
          <span>{printNumber(lo())}</span>
          <span>{printNumber(hi())}</span>
        </div>
        <RangeSlider
          min={stats()!.min}
          max={stats()!.max}
          lo={lo()}
          hi={hi()}
          onChange={(min, max) =>
            s.setFilter(
              props.addr,
              min <= stats()!.min && max >= stats()!.max ? null : { kind: 'range', min, max },
            )
          }
        />
      </div>
    </Show>
  );
}
