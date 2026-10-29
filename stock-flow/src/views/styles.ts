import { diagramStyles } from "./diagram.ts";

export const styles = `${diagramStyles}
.sf {
  --sf-ink: #212529;
  --sf-muted: #6c757d;
  --sf-line: #adb5bd;
  --sf-panel: #f8f9fa;
  --sf-border: #dee2e6;
  --sf-accent: #4c6ef5;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--sf-ink);
  background: #fff;
  box-sizing: border-box;
}
.sf *, .sf *::before, .sf *::after { box-sizing: inherit; }
.sf h1 { font-size: 1.15rem; margin: 0; }
.sf h2 { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sf-muted); margin: 14px 0 6px; }
.sf h3 { font-size: 0.85rem; font-weight: 600; margin: 0; }
.sf code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--sf-panel); padding: 1px 4px; border-radius: 3px; }
.sf button, .sf select { font: inherit; font-size: 0.8rem; border: 1px solid var(--sf-border); background: #fff; border-radius: 6px; padding: 3px 9px; cursor: pointer; color: inherit; }
.sf button:hover { border-color: var(--sf-line); }
.sf .sf-muted { color: var(--sf-muted); font-size: 0.8rem; }
.sf .sf-error { color: #c92a2a; font-size: 0.85rem; padding: 8px 0; }

/* Model viewer */
.sf-model { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.sf-model > header { padding: 12px 18px 8px; border-bottom: 1px solid var(--sf-border); display: grid; gap: 6px; }
.sf-model > header p { margin: 0; color: var(--sf-muted); font-size: 0.85rem; max-width: 70em; }
.sf-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.sf-tabs { display: flex; gap: 3px; background: var(--sf-panel); border-radius: 8px; padding: 3px; }
.sf-tabs button { border: 0; background: transparent; color: var(--sf-muted); padding: 4px 13px; }
.sf-tabs button[aria-selected="true"] { background: #fff; color: var(--sf-ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
.sf-knockouts { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.sf-chip { display: inline-flex; gap: 5px; align-items: center; font-size: 0.78rem; border: 1px solid var(--sf-border); border-radius: 999px; padding: 1px 9px 1px 5px; cursor: pointer; user-select: none; }
.sf-chip.off { text-decoration: line-through; color: var(--sf-muted); background: var(--sf-panel); }
.sf-chip input { margin: 0; }
.sf-badge { font-weight: 700; font-size: 0.72rem; background: var(--sf-ink); color: #fff; border-radius: 4px; padding: 0 5px; }
.sf-badge.reinforcing { background: #e8590c; }
.sf-badge.inactive, .sf-badge.mixed { background: var(--sf-line); }
.sf-body { flex: 1; min-height: 0; overflow: auto; padding: 14px 18px; }

.sf-loops { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.sf-loops .sf-diagram-panel { overflow: auto; border: 1px solid var(--sf-border); border-radius: 10px; padding: 6px; }
.sf-loops .sf-diagram { max-width: 100%; height: auto; display: block; margin: 0 auto; }
.sf-loop-list { display: grid; gap: 8px; }
.sf-loop { border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; font-size: 0.82rem; cursor: default; }
.sf-loop:hover { border-color: var(--sf-line); background: var(--sf-panel); }
.sf-loop header { display: flex; gap: 6px; align-items: center; }
.sf-loop p { margin: 4px 0 0; color: var(--sf-muted); }
.sf-loop .sf-cycle { font-size: 0.75rem; color: var(--sf-muted); margin-top: 3px; }
.sf-tooltip { position: fixed; z-index: 10; max-width: 300px; background: #fff; border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 14px rgba(0,0,0,.12); font-size: 0.8rem; pointer-events: none; }
.sf-tooltip p { margin: 4px 0 0; }

.sf-run { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
.sf-run .sf-charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
.sf-run .sf-controls { display: grid; gap: 8px; font-size: 0.8rem; }
.sf-slider { display: grid; gap: 2px; }
.sf-slider span { display: flex; justify-content: space-between; gap: 8px; }
.sf-slider input { width: 100%; }

.sf table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
.sf th, .sf td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--sf-border); }
.sf th { font-weight: 600; color: var(--sf-muted); font-size: 0.75rem; }
.sf td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sf td code { white-space: pre-wrap; }

.sf-data { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
.sf-series { border: 1px solid var(--sf-border); border-radius: 8px; padding: 10px; font-size: 0.8rem; }
.sf-series ul { margin: 6px 0 0; padding-left: 18px; color: var(--sf-muted); }
.sf-scenarios { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }

/* Chart */
.sf-chart { padding: 4px 2px; }
.sf-chart-box { height: 300px; display: flex; flex-direction: column; }
.sf-chart-box .sf-plot { flex: 1; min-height: 0; }
.sf-chart-box svg { display: block; overflow: visible; }
.sf-legend { display: flex; flex-wrap: wrap; gap: 2px 12px; list-style: none; margin: 4px 0 0; padding: 0; font-size: 0.75rem; color: var(--sf-muted); }
.sf-legend li { display: inline-flex; align-items: center; gap: 5px; }
.sf-legend .swatch { width: 16px; height: 0; border-top: 2px solid var(--color); }
.sf-legend .swatch.dashed { border-top-style: dashed; }
.sf-legend .swatch.markers { width: 7px; height: 7px; border: 0; border-radius: 50%; background: var(--color); }
.sf-readout { margin: 2px 0 0; min-height: 1.2em; font-size: 0.75rem; color: var(--sf-muted); font-variant-numeric: tabular-nums; }
.sf .grid { stroke: #f1f3f5; }
.sf .tick { font-size: 10.5px; fill: var(--sf-muted); }
.sf .baseline { stroke: var(--sf-line); }
.sf .guide { stroke: var(--sf-muted); stroke-dasharray: 3 3; }
.sf .guide-label { font-size: 10.5px; fill: var(--sf-muted); }
.sf .axis-title { font-size: 10px; fill: var(--sf-muted); }
.sf .hover-line { stroke: var(--sf-line); }
.sf-chart footer, .sf-scenario footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; font-size: 0.75rem; color: var(--sf-muted); }

/* Scenario card */
.sf-scenario { border: 1px solid var(--sf-border); border-radius: 8px; padding: 10px 12px; font-size: 0.85rem; }
.sf-scenario header { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.sf-scenario p { margin: 6px 0 0; }
.sf-expectation { color: var(--sf-muted); font-style: italic; }
.sf-curves { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.sf-curve { margin: 0; width: 160px; font-size: 0.72rem; }
.sf-curve figcaption { color: var(--sf-muted); }
.sf-curve svg { width: 160px; height: 44px; display: block; background: var(--sf-panel); border-radius: 4px; }
.sf-curve .balance { stroke: var(--sf-line); stroke-dasharray: 2 2; }
.sf-curve .line { fill: none; stroke: var(--sf-accent); stroke-width: 1.6; }
.sf-curve.unchanged .line { stroke: var(--sf-line); }
.sf-curve-axis { display: flex; justify-content: space-between; color: var(--sf-muted); }
.sf-changes { margin: 8px 0 0; padding-left: 18px; font-size: 0.8rem; }
.sf-changes:empty { display: none; }
.sf-derived { margin-top: 6px; font-size: 0.78rem; color: var(--sf-muted); }
`;
