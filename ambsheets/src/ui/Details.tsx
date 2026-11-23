// The details panel: everything about the selected cell. For a cell with several values
// that means a set of "value viewers", each a different way of looking at (and filtering
// on) those values.

import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import { examples } from '../examples';
import { isError, posOf, printNumber, printValue } from '../lang/values';
import { ambLabel, ambSize, displayName, options, type AmbInfo, type CellInfo } from '../model/compile';
import {
  aggregate,
  histogram,
  isRangeValued,
  lineChart,
  pivot,
  tableDimensions,
  type Aggregation,
  type Filter,
  type NumberSummary,
  type Summary,
} from '../model/analysis';
import { RangeSlider } from './RangeSlider';
import { Reference } from './Reference';
import { useSheet } from './state';

export function Details() {
  const s = useSheet();
  const info = s.activeInfo;
  const summary = () => (info() ? s.summaries().get(info()!.addr) : undefined);
  const isEmptySheet = () => s.run().compiled.cells.size === 0;

  return (
    <aside class="details">
      <div class="panel-title">
        <span>{s.panel() === 'reference' ? 'Reference' : info() ? displayName(info()!) : s.activeAddr()}</span>
        <Show when={s.panel() === 'reference'}>
          <button class="link" onClick={() => s.setPanel('cell')}>
            Back to the cell
          </button>
        </Show>
      </div>
      <Show when={s.panel() === 'reference'}>
        <div class="panel-body">
          <Reference />
        </div>
      </Show>
      <div class="panel-body" hidden={s.panel() === 'reference'}>
        <Show when={isEmptySheet()}>
          <Welcome />
        </Show>
        <Show when={info()}>
          {(info) => (
            <>
              <div class="cell-kind">{describe(info())}</div>
              <Show when={info().kind !== 'const' && s.scenarioRow() !== null}>
                <div class="in-scenario">
                  In the scenario on show: <b>{printValue(s.scenarioValue(info().addr)) || '(empty)'}</b>
                </div>
              </Show>
              <Show when={info().kind === 'const' && isError(info().value)}>
                <div class="error">
                  {printValue(info().value)}: {(info().value as any).msg}
                </div>
              </Show>
              <Show when={info().kind !== 'const' && summary()}>
                <Viewers info={info()} summary={summary()!} />
              </Show>
            </>
          )}
        </Show>
      </div>
    </aside>
  );
}

function describe(info: CellInfo): string {
  const spec = info.spec;
  if (spec) {
    switch (spec.kind) {
      case 'discrete':
      case 'pick':
        return `Amb with ${printNumber(ambSize(spec))} choice${ambSize(spec) === 1 ? '' : 's'}`;
      case 'normal':
        return `Normal distribution (mean ${printNumber(spec.mean)}, standard deviation ${printNumber(spec.stdev)})`;
      case 'uniform':
        return `Uniform distribution (from ${printNumber(spec.min)} to ${printNumber(spec.max)})`;
      case 'derived':
        return spec.description;
      case 'permutation':
        return `${printNumber(spec.values.length)} values in any order (${printNumber(ambSize(spec))} possible orders)`;
    }
  }
  if (info.kind === 'formula') return 'Formula with several possible values';
  return isError(info.value) ? 'Error' : 'A single value';
}

function Welcome() {
  const s = useSheet();
  const load = (cells: Record<string, string>) =>
    s.setCells(Object.entries(cells).map(([addr, text]) => ({ ...posOf(addr), text })));
  return (
    <div class="welcome">
      <p>
        In an ambsheet a cell can hold several values at once. Type <code>{'{500, 1200}'}</code> into a cell and
        every formula that uses it is computed for both.
      </p>
      <p>Or start from an example:</p>
      <For each={examples}>
        {(example) => (
          <button class="example" onClick={() => load(example.cells)}>
            <b>{example.name}</b>
            <span>{example.blurb}</span>
          </button>
        )}
      </For>
    </div>
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <section class="viewer">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function Viewers(props: { info: CellInfo; summary: Summary }) {
  const s = useSheet();
  const values = () => props.summary.values;
  const numeric = () => {
    const vs = values();
    return vs === null
      ? props.summary.stats !== null
      : vs.filter((v) => typeof v.value === 'number').length > 1;
  };
  // the choices this cell depends on (other than the cell itself, if it is one)
  const dependencies = () =>
    props.info.deps
      .filter((id) => id !== props.info.addr)
      .map((id) => s.run().compiled.ambsById.get(id))
      .filter((amb): amb is AmbInfo => amb !== undefined);
  const dimensions = createMemo(() => tableDimensions(s.run(), props.info));
  const ranges = () => isRangeValued(s.run(), props.info.addr);
  const showTable = () => dimensions().length > 0 && props.info.kind === 'formula' && !ranges();
  const showStacks = () => {
    const vs = values();
    return (
      !ranges() && vs !== null && vs.length > 1 && vs.length <= 5 && vs.every((v) => printValue(v.value).length <= 15)
    );
  };
  const showShades = () => {
    const vs = values();
    return vs !== null && vs.length > 1 && vs.every((v) => typeof v.value === 'number');
  };

  return (
    <>
      <Show when={dependencies().length > 0}>
        <Section title="Choice dependencies">
          <div class="hint">This result depends on choices made in:</div>
          <ul class="dependencies">
            <For each={dependencies()}>
              {(amb) => (
                <li>
                  <button class="link" onClick={() => s.select(posOf(amb.addr))}>
                    {amb.addr === props.info.addr ? `${amb.source} (in this cell)` : ambLabel(amb, s.run().compiled)}
                  </button>
                  <Show when={s.scenarioRow() !== null}>
                    {' '}
                    = <b>{printValue(s.scenarioValue(amb.id))}</b>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Section>
      </Show>
      <Show when={ranges()}>
        <Section title="Line chart">
          <LineChartViewer info={props.info} />
        </Section>
      </Show>
      <Show when={showStacks()}>
        <Section title="Stacks">
          <Stacks info={props.info} summary={props.summary} />
        </Section>
      </Show>
      <Show when={numeric()}>
        <Section title="Histogram">
          <HistogramViewer info={props.info} />
        </Section>
      </Show>
      <Show when={showTable()}>
        <Section title="Table">
          <TableViewer info={props.info} dimensions={dimensions()} />
        </Section>
      </Show>
      <Show when={showShades()}>
        <Section title="Shades">
          <Shades info={props.info} summary={props.summary} />
        </Section>
      </Show>
    </>
  );
}

/** How much of the whole a count is: exact when enumerating, a percentage when sampling. */
function useShare() {
  const s = useSheet();
  return (count: number, n: number) =>
    s.run().mode === 'montecarlo' ? `${((count / Math.max(1, n)) * 100).toFixed(1)}%` : `×${printNumber(count)}`;
}

/** One little pile of cards per distinct value. Hover to preview a filter, click to pin it. */
function Stacks(props: { info: CellInfo; summary: Summary }) {
  const s = useSheet();
  const share = useShare();
  const addr = () => props.info.addr;
  return (
    <div class="stacks" onMouseLeave={() => s.setHover(null)}>
      <Index each={props.summary.values!}>
        {(v) => (
          <button
            class="stack"
            data-out={v().passing === 0 ? '' : undefined}
            data-on={s.isValueSelected(addr(), v().key) ? '' : undefined}
            onMouseEnter={() => s.hoverValues(addr(), [v().value])}
            onClick={() => s.toggleValue(addr(), v().value)}
          >
            <span class="cards">
              <Index each={Array.from({ length: Math.min(4, Math.max(1, v().count)) })}>
                {(_, i) => (
                  <span class="card" style={{ transform: `translate(${i * 2}px, ${-i * 2}px)` }}>
                    {printValue(v().value) || '(empty)'}
                  </span>
                )}
              </Index>
            </span>
            <span class="count">{share(v().count, props.summary.n)}</span>
          </button>
        )}
      </Index>
    </div>
  );
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 96;

function HistogramViewer(props: { info: CellInfo }) {
  const s = useSheet();
  const addr = () => props.info.addr;
  const data = createMemo(() => histogram(s.view(), addr()));
  const tallest = () => Math.max(1, ...data()!.bins.map((bin) => bin.count));
  // When the matching scenarios are a sample of their own (see focus.ts), their counts
  // say nothing about how common they are, so their bars get a scale of their own.
  const tallestPassing = () =>
    data()!.separate ? Math.max(1, ...data()!.bins.map((bin) => bin.passing)) : tallest();
  const barWidth = () => CHART_WIDTH / data()!.bins.length;
  const height = (count: number, most = tallest()) => (count / most) * CHART_HEIGHT;

  const rangeFilter = () => {
    const f = s.filters().get(addr());
    return f?.kind === 'range' ? f : null;
  };
  const lo = () => Math.max(data()!.min, rangeFilter()?.min ?? -Infinity);
  const hi = () => Math.min(data()!.max, rangeFilter()?.max ?? Infinity);

  const hoverBin = (i: number) => {
    const bin = data()!.bins[i];
    const last = i === data()!.bins.length - 1;
    const filter: Filter = { kind: 'range', min: bin.x0, max: bin.x1, maxExclusive: !last };
    s.setHover(new Map([[addr(), filter]]));
  };

  return (
    <Show when={data()} fallback={<div class="hint">No numbers to chart.</div>}>
      <div class="histogram">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          onMouseLeave={() => s.setHover(null)}
        >
          <Index each={data()!.bins}>
            {(bin, i) => (
              <g onMouseEnter={() => hoverBin(i)}>
                {/* a full-height (invisible) target, so short bars are easy to point at */}
                <rect class="target" x={i * barWidth()} y="0" width={barWidth()} height={CHART_HEIGHT} />
                <rect
                  class="bar"
                  x={i * barWidth() + 0.5}
                  y={CHART_HEIGHT - height(bin().count)}
                  width={Math.max(0.5, barWidth() - 1)}
                  height={height(bin().count)}
                />
                <rect
                  class="bar passing"
                  x={i * barWidth() + 0.5}
                  y={CHART_HEIGHT - height(bin().passing, tallestPassing())}
                  width={Math.max(0.5, barWidth() - 1)}
                  height={height(bin().passing, tallestPassing())}
                />
              </g>
            )}
          </Index>
        </svg>
        <RangeSlider
          min={data()!.min}
          max={data()!.max}
          lo={lo()}
          hi={hi()}
          onChange={(min, max) =>
            s.setFilter(addr(), min <= data()!.min && max >= data()!.max ? null : { kind: 'range', min, max })
          }
        />
        <div class="range-labels">
          <span>{printNumber(lo())}</span>
          <span>{printNumber(hi())}</span>
        </div>
        <StatsTable all={data()!.all} passing={data()!.passing} focused={data()!.separate} />
      </div>
    </Show>
  );
}

function StatsTable(props: { all: NumberSummary; passing: NumberSummary | null; focused: boolean }) {
  const s = useSheet();
  const rows: [string, (stats: NumberSummary) => number][] = [
    ['Count', (stats) => stats.count],
    ['Mean', (stats) => stats.avg],
    ['Std dev', (stats) => stats.stdev],
    ['Min', (stats) => stats.min],
    ['Max', (stats) => stats.max],
  ];
  return (
    <table class="stats">
      <thead>
        <tr>
          <th />
          <th>All</th>
          <th class="passing">Filtered</th>
        </tr>
      </thead>
      <tbody>
        <For each={rows}>
          {([label, get]) => (
            <tr>
              <th>{label}</th>
              <td>{printNumber(get(props.all))}</td>
              <td class="passing">{props.passing ? printNumber(get(props.passing)) : '–'}</td>
            </tr>
          )}
        </For>
      </tbody>
      <Show when={s.run().mode === 'montecarlo'}>
        <caption>
          Estimated from {printNumber(s.run().n)} sampled scenarios.
          <Show when={props.focused}>
            {' '}
            The filtered ones were sought out, and the blue bars are drawn to their own scale: they show where
            matching scenarios fall, not how common they are.
          </Show>
        </caption>
      </Show>
    </table>
  );
}

const MAX_TABLE_CHOICES = 20;

/** The cell's values broken down by the choices made in one or two of its dimensions. */
function TableViewer(props: { info: CellInfo; dimensions: AmbInfo[] }) {
  const s = useSheet();
  const [aggregation, setAggregation] = createSignal<Aggregation>('avg');
  const [xAddr, setXAddr] = createSignal<string | null>(null);
  const [yAddr, setYAddr] = createSignal<string | null | undefined>(undefined);

  // Default to the first two dimensions, and recover if a chosen one goes away.
  const x = () => props.dimensions.find((d) => d.id === xAddr()) ?? props.dimensions[0];
  const y = () => {
    if (yAddr() === null) return null;
    const others = props.dimensions.filter((d) => d !== x());
    return others.find((d) => d.id === yAddr()) ?? others[0] ?? null;
  };
  const numOptions = (amb: AmbInfo) => options(amb.spec).first.length;
  const tooBig = () => numOptions(x()) > MAX_TABLE_CHOICES || (y() !== null && numOptions(y()!) > MAX_TABLE_CHOICES);
  const table = createMemo(() => (tooBig() ? null : pivot(s.view(), props.info.addr, x(), y())));
  const filtering = s.filtering;

  const hoverChoice = s.hoverChoices;

  const DimensionSelect = (p: { value: string | null; onChange: (addr: string | null) => void; optional?: boolean }) => (
    <select value={p.value ?? ''} onChange={(e) => p.onChange(e.currentTarget.value || null)}>
      <Show when={p.optional}>
        <option value="">(none)</option>
      </Show>
      <For each={props.dimensions}>{(dim) => <option value={dim.id}>{ambLabel(dim, s.run().compiled)}</option>}</For>
    </select>
  );

  return (
    <div class="pivot">
      <div class="pivot-controls">
        <label>
          Columns <DimensionSelect value={x().id} onChange={(id) => setXAddr(id)} />
        </label>
        <Show when={props.dimensions.length > 1}>
          <label>
            Rows <DimensionSelect value={y()?.id ?? null} onChange={(id) => setYAddr(id)} optional />
          </label>
        </Show>
        <label>
          Show{' '}
          <select value={aggregation()} onChange={(e) => setAggregation(e.currentTarget.value as Aggregation)}>
            <For each={['avg', 'sum', 'count', 'min', 'max'] as Aggregation[]}>
              {(a) => <option value={a}>{a}</option>}
            </For>
          </select>
        </label>
      </div>
      <Show when={table()} fallback={<div class="hint">Too many distinct choices to display a table.</div>}>
        {(table) => (
          <div class="pivot-scroll">
            <table onMouseLeave={() => s.setHover(null)}>
              <thead>
                <tr>
                  <th />
                  <Index each={table().xLabels}>
                    {(label, i) => <th onMouseEnter={() => hoverChoice([[x(), table().xChoices[i]]])}>{label()}</th>}
                  </Index>
                </tr>
              </thead>
              <tbody>
                <Index each={table().cells}>
                  {(row, j) => (
                    <tr>
                      <th onMouseEnter={() => y() && hoverChoice([[y()!, table().yChoices[j]]])}>{table().yLabels[j]}</th>
                      <Index each={row()}>
                        {(cell, i) => (
                          <td
                            data-in={filtering() && cell().passing > 0 ? '' : undefined}
                            data-out={cell().passing === 0 ? '' : undefined}
                            onMouseEnter={() =>
                              hoverChoice(
                                y()
                                  ? [[x(), table().xChoices[i]], [y()!, table().yChoices[j]]]
                                  : [[x(), table().xChoices[i]]],
                              )
                            }
                          >
                            {cell().scenarios === 0
                              ? ''
                              : (() => {
                                  const value = aggregate(cell(), aggregation());
                                  return value === null ? '–' : printNumber(value);
                                })()}
                          </td>
                        )}
                      </Index>
                    </tr>
                  )}
                </Index>
              </tbody>
            </table>
          </div>
        )}
      </Show>
    </div>
  );
}

const LINE_WIDTH = 300;
const LINE_HEIGHT = 150;
const MAX_LEGEND = 12;

/**
 * For cells whose value is a range (like =A1:B5): one line per combination of the choices
 * the cell depends on. Hover a line to see what the rest of the sheet looks like for it.
 */
function LineChartViewer(props: { info: CellInfo }) {
  const s = useSheet();
  const chart = createMemo(() => lineChart(s.view(), props.info));
  const many = () => chart()!.series.length > MAX_LEGEND;

  const scale = (value: number, [min, max]: [number, number], size: number) =>
    max === min ? size / 2 : ((value - min) / (max - min)) * size;
  const path = (points: [number, number][]) =>
    points
      .map(([x, y]) => `${scale(x, chart()!.x, LINE_WIDTH)},${LINE_HEIGHT - scale(y, chart()!.y, LINE_HEIGHT)}`)
      .join(' ');
  const xLabel = (x: number) => chart()!.categories?.[x] ?? printNumber(x);

  const hoverSeries = s.hoverChoices;

  return (
    <Show when={chart()} fallback={<div class="hint">No numbers to chart.</div>}>
      <div class="line-chart" data-many={many() ? '' : undefined} onMouseLeave={() => s.setHover(null)}>
        <div class="axis">
          <span>{printNumber(chart()!.y[1])}</span>
        </div>
        <svg viewBox={`0 0 ${LINE_WIDTH} ${LINE_HEIGHT}`} preserveAspectRatio="none">
          <rect class="frame" x="0" y="0" width={LINE_WIDTH} height={LINE_HEIGHT} />
          <Index each={chart()!.series}>
            {(series, i) => (
              <g onMouseEnter={() => hoverSeries(series().choices)}>
                <polyline class="target" points={path(series().points)} />
                <polyline
                  class="line"
                  style={{ '--series': i }}
                  data-out={series().passing ? undefined : ''}
                  points={path(series().points)}
                />
              </g>
            )}
          </Index>
        </svg>
        <div class="axis">
          <span>{printNumber(chart()!.y[0])}</span>
        </div>
        <div class="axis">
          <span>{xLabel(chart()!.x[0])}</span>
          <span>{xLabel(chart()!.x[1])}</span>
        </div>
        <Show
          when={!many()}
          fallback={
            <div class="hint">
              {chart()!.total > chart()!.series.length
                ? `Showing ${printNumber(chart()!.series.length)} of ${printNumber(chart()!.total)} lines.`
                : `${printNumber(chart()!.series.length)} lines.`}
            </div>
          }
        >
          <div class="legend">
            <Index each={chart()!.series}>
              {(series, i) => (
                <div
                  style={{ '--series': i }}
                  data-out={series().passing ? undefined : ''}
                  onMouseEnter={() => hoverSeries(series().choices)}
                >
                  <i />
                  {series().label || 'all scenarios'}
                </div>
              )}
            </Index>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** One square per distinct number, darker for larger ones. */
function Shades(props: { info: CellInfo; summary: Summary }) {
  const s = useSheet();
  const stats = () => props.summary.stats!;
  const strength = (value: number) => {
    const { min, max } = stats();
    return max === min ? 0.5 : (value - min) / (max - min);
  };
  return (
    <div class="shades" onMouseLeave={() => s.setHover(null)}>
      <Index each={props.summary.values!}>
        {(v) => (
          <span
            class="shade"
            data-out={v().passing === 0 ? '' : undefined}
            style={{ '--strength': `${Math.round(10 + strength(v().value as number) * 90)}%` }}
            title={printValue(v().value)}
            onMouseEnter={() => s.hoverValues(props.info.addr, [v().value])}
          />
        )}
      </Index>
    </div>
  );
}
