import { cachedRun, scenarioLabel, scenarioSettings, withKnob } from "../engine/scenarios.ts";
import type { Run, Settings, StockFlowChartDoc, StockFlowModelDoc, VariableId } from "../types.ts";

export type Series = {
  label: string;
  points: [number, number][];
  color: string;
  dashed?: boolean;
  axis?: "left" | "right";
  markers?: boolean;
};

export type ChartSpec = {
  title: string;
  series: Series[];
  format: (value: number) => string;
  formatRight?: (value: number) => string;
  guide?: { value: number; label: string };
  axisTitles?: [string, string];
};

/** One run per scenario, or per sweep value when the chart sweeps a knob over one scenario. */
export type ChartLine = { label: string; reference: string; settings: Settings; run: Run };

type ChartFields = Pick<StockFlowChartDoc, "title" | "scenarios" | "series" | "data" | "sweep" | "years" | "guide">;

export function chartSpec(model: StockFlowModelDoc, chart: ChartFields): { spec: ChartSpec; lines: ChartLine[] } {
  validate(model, chart);
  const lines = chartLines(model, chart);
  const units = [...new Set([...chart.series.map((id) => model.variables[id].unit), ...chart.data.map((id) => model.data[id].unit)])];
  if (units.length > 2) throw new Error(`A chart holds two units at most; this one has ${units.join(", ")}`);
  const series = [...modelSeries(model, chart, lines, units), ...dataSeries(model, chart, units)];
  const spec: ChartSpec = {
    title: chart.title || chart.series.map((id) => model.variables[id].label).join(" and "),
    series,
    format: formatter(units[0]),
    ...(units[1] ? { formatRight: formatter(units[1]), axisTitles: [units[0], units[1]] as [string, string] } : {}),
    ...(chart.guide ? { guide: chart.guide } : {}),
  };
  return { spec, lines };
}

export function chartLines(model: StockFlowModelDoc, chart: Pick<ChartFields, "scenarios" | "sweep">): ChartLine[] {
  if (chart.sweep) {
    if (chart.scenarios.length !== 1) throw new Error("A sweep varies one scenario; name exactly one");
    const reference = chart.scenarios[0];
    const base = scenarioSettings(model, reference);
    const { knob, values } = chart.sweep;
    return values.map((value) => {
      const settings = withKnob(model, base, knob, value);
      return { label: `${knob} = ${value}`, reference, settings, run: cachedRun(model, settings) };
    });
  }
  return chart.scenarios.map((reference) => {
    const settings = scenarioSettings(model, reference);
    return { label: scenarioLabel(model, reference), reference, settings, run: cachedRun(model, settings) };
  });
}

export function modelPoints(model: StockFlowModelDoc, run: Run, id: VariableId, years?: [number, number]): [number, number][] {
  const scale = model.variables[id].scale ?? 1;
  return clip(
    run.years.map((year, index) => [year, run.values[id][index] * scale]),
    years,
  );
}

export function formatter(unit: string): (value: number) => string {
  if (unit.startsWith("%")) return (value) => `${value.toFixed(1)}%`;
  if (unit.startsWith("€")) return (value) => `€${value.toFixed(2)}`;
  if (unit.includes("index")) return (value) => value.toFixed(2);
  return (value) => {
    if (Math.abs(value) >= 10_000) return `${(value / 1000).toLocaleString("en", { maximumFractionDigits: 1 })}k`;
    if (Math.abs(value) < 10) return value.toFixed(2);
    return Math.round(value).toLocaleString("en");
  };
}

function validate(model: StockFlowModelDoc, chart: ChartFields): void {
  if (!chart.series.length) throw new Error("Name at least one model variable to chart");
  for (const id of chart.series) if (!(id in model.variables)) throw new Error(`Unknown variable "${id}"`);
  if (!chart.scenarios.length) throw new Error("Name at least one scenario");
  for (const id of chart.data) if (!(id in model.data)) throw new Error(`Unknown data series "${id}"`);
}

function modelSeries(model: StockFlowModelDoc, chart: ChartFields, lines: ChartLine[], units: string[]): Series[] {
  const many = lines.length > 1;
  return chart.series.flatMap((id, keyIndex) =>
    lines.map((line, lineIndex) => {
      const label = model.variables[id].label;
      return {
        label: many && chart.series.length > 1 ? `${label} · ${line.label}` : many ? line.label : label,
        points: modelPoints(model, line.run, id, chart.years),
        color: COLORS[(many ? lineIndex : keyIndex) % COLORS.length],
        dashed: many && keyIndex > 0,
        axis: rightAxis(model.variables[id].unit, units) ? "right" : "left",
      } satisfies Series;
    }),
  );
}

function dataSeries(model: StockFlowModelDoc, chart: ChartFields, units: string[]): Series[] {
  return chart.data.map((id, index) => {
    const series = model.data[id];
    return {
      label: `${series.label} (data)`,
      points: clip(
        series.points.map(([year, value]) => [year, value]),
        chart.years,
      ),
      color: DATA_COLORS[index % DATA_COLORS.length],
      markers: true,
      axis: rightAxis(series.unit, units) ? "right" : "left",
    } satisfies Series;
  });
}

function rightAxis(unit: string, units: string[]): boolean {
  return unit === units[1] && units[0] !== units[1];
}

function clip(points: [number, number][], years?: [number, number]): [number, number][] {
  return years ? points.filter(([year]) => year >= years[0] && year <= years[1]) : points;
}

const COLORS = ["#4c6ef5", "#e8590c", "#0c8599", "#c2255c", "#7048e8", "#2b8a3e"];
const DATA_COLORS = ["#495057", "#a61e4d"];
