import { diagramStyles } from "./diagram.ts";

export const styles = `${diagramStyles}
.sf {
  --sf-ink: #212529;
  --sf-muted: #6c757d;
  --sf-line: #adb5bd;
  --sf-panel: #f8f9fa;
  --sf-border: #dee2e6;
  --sf-accent: #4c6ef5;
  --sf-active: #e8590c;
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

.sf-tooltip { position: fixed; z-index: 10; max-width: 300px; background: #fff; border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 14px rgba(0,0,0,.12); font-size: 0.8rem; pointer-events: none; }
.sf-tooltip p { margin: 4px 0 0; }
.sf .sf-hint { font-size: 0.75rem; color: var(--sf-muted); margin: 4px 2px 0; }
.sf .sf-cut-note { color: #c92a2a; }
.sf .sf-pill { font-size: 0.7rem; font-weight: 700; border: 1.2px solid var(--sf-ink); border-radius: 999px; padding: 0 6px; }
.sf-loop .sf-cycle, .sf .sf-cycle { font-size: 0.75rem; color: var(--sf-muted); margin-top: 3px; }

/* Loops page */
.sf-loops-view { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; align-items: start; }
.sf-loops-view > svg { width: 100%; height: auto; max-height: calc(100vh - 170px); display: block; user-select: none; }
.sf-loops-side { background: var(--sf-panel); border-radius: 8px; padding: 2px 14px 14px; font-size: 0.8rem; }
.sf-legend-loop { background: #fff; border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; display: block; }
.sf-legend-loop:hover { border-color: var(--sf-active); }
.sf-legend-loop.off { opacity: 0.6; }
.sf-legend-loop p { margin: 4px 0 0; color: var(--sf-muted); }
.sf-legend-loop summary, .sf-cycles summary { cursor: pointer; color: var(--sf-muted); font-size: 0.75rem; }
.sf-cycles { margin-top: 4px; }
.sf-key { list-style: none; margin: 0; padding: 0; line-height: 1.7; }
.sf-key strong { display: inline-block; width: 18px; }
.sf-check { display: flex; gap: 6px; align-items: flex-start; margin-top: 12px; }

/* Stock and flow page */
.sf-model-box { display: grid; grid-template-columns: 220px minmax(0, 1fr); grid-template-rows: auto auto; gap: 6px 10px; border: 1.5px solid var(--sf-line); border-radius: 10px; padding: 8px; }
.sf-controls-panel { background: var(--sf-panel); border-radius: 8px; padding: 2px 12px 12px; align-self: start; }
.sf-field { display: block; font-size: 0.78rem; margin-bottom: 6px; border-radius: 4px; }
.sf-field:hover { color: var(--sf-active); }
.sf-field output { float: right; color: var(--sf-muted); }
.sf-field input[type="range"] { display: block; width: 100%; margin-top: 1px; }
.sf-loop-card { background: #fff; border: 1px solid var(--sf-border); border-radius: 8px; padding: 7px 10px 4px; margin-bottom: 8px; }
.sf-loop-card:hover { border-color: var(--sf-active); }
.sf-loop-card.off .sf-strength { opacity: 0.45; }
.sf-toggle { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.sf-loop-title { font-weight: 600; font-size: 0.85rem; }
.sf-strength { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
.sf-strength input { flex: 1; min-width: 0; }
.sf-strength output { color: var(--sf-muted); width: 2.4em; text-align: right; }
.sf-diagram-panel { display: flex; flex-direction: column; min-width: 0; }
.sf-diagram-panel > svg { width: 100%; height: auto; max-height: calc(100vh - 330px); display: block; user-select: none; }
.sf-diagram-panel > .sf-hint { margin: 0; font-size: 0.68rem; }
.sf-input-strip { grid-column: 1 / -1; border-top: 1px solid var(--sf-border); padding: 4px 4px 0; }
.sf-input-controls { display: grid; grid-template-columns: 210px repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
.sf-input-intro h2 { margin: 2px 0 4px; }
.sf-input-intro .sf-hint { margin: 0; font-size: 0.68rem; line-height: 1.35; }
.sf-input-head { display: flex; align-items: baseline; gap: 6px; font-size: 0.78rem; }
.sf-input-head span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sf .sf-input-reset { margin-left: auto; border: 0; background: none; padding: 0; color: var(--sf-muted); cursor: pointer; }
.sf .sf-input-reset:hover { color: var(--sf-ink); }
.sf-input-editor svg { display: block; width: 100%; height: 38px; background: #fff; border: 1px solid var(--sf-border); border-radius: 4px; cursor: crosshair; touch-action: none; }
.sf-input-editor:hover svg { border-color: var(--sf-accent); }
.sf-input-editor .input-line { fill: none; stroke: var(--sf-accent); stroke-width: 1.8; vector-effect: non-scaling-stroke; }
.sf-input-editor .input-area { fill: var(--sf-accent); opacity: 0.12; }
.sf-input-editor .input-balance { stroke: var(--sf-muted); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.sf-input-editor .input-cursor { stroke: var(--sf-muted); vector-effect: non-scaling-stroke; }
.sf-input-axis { display: flex; gap: 6px; font-size: 0.62rem; color: var(--sf-muted); }
.sf-input-axis output { flex: 1; min-width: 0; text-align: center; color: var(--sf-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

/* Both diagrams */
.sf-cld .arrowhead, .sf-sfd .arrowhead { fill: var(--sf-line); }
.sf-cld .link .line, .sf-sfd .link .line { fill: none; stroke: var(--sf-line); stroke-width: 1.6; }
.sf-cld .link .hit, .sf-sfd .link .hit { fill: none; stroke: transparent; stroke-width: 14; cursor: help; }
.sf-cld .link .delay line, .sf-sfd .link .delay line { stroke: var(--sf-ink); stroke-width: 1.6; }
.sf-cld .link.zero .line, .sf-sfd .link.zero .line { stroke-dasharray: 3 3; opacity: 0.6; }
.sf-cld .link.zero .sign, .sf-sfd .link.zero .sign { fill: var(--sf-muted); font-weight: 400; }
.sf-cld .cld-loop, .sf-sfd .cld-loop { cursor: help; }
.sf-cld .cld-loop .hit, .sf-sfd .cld-loop .hit { fill: transparent; }
.sf-cld .cld-loop .loop-arrow, .sf-sfd .cld-loop .loop-arrow { fill: none; stroke: var(--sf-ink); stroke-width: 1.4; }
.sf-cld .cld-loop .loop-label, .sf-sfd .cld-loop .loop-label { font-size: 13px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
.sf-cld .cld-loop .loop-name { font-size: 12px; fill: var(--sf-muted); text-anchor: middle; dominant-baseline: middle; }
.sf-cld .cld-loop.off, .sf-sfd .cld-loop.off { opacity: 0.3; }

/* Loop diagram */
.sf-cld .node { font-size: 16px; text-anchor: middle; dominant-baseline: middle; fill: var(--sf-ink); }
.sf-cld .node.input { font-style: italic; fill: var(--sf-muted); }
.sf-cld .link .sign { font-size: 16px; font-weight: 600; text-anchor: middle; dominant-baseline: middle; fill: var(--sf-ink); }
.sf-cld.highlighting .link:not(.active), .sf-cld.highlighting .node:not(.active), .sf-cld.highlighting .cld-loop:not(.active) { opacity: 0.3; }
.sf-cld.highlighting .link.active .line { stroke: var(--sf-active); stroke-width: 2.2; }

/* Stock and flow diagram */
.sf-sfd .link .sign { font-size: 15px; font-weight: 600; fill: var(--sf-ink); text-anchor: middle; dominant-baseline: middle; }
.sf-sfd .link .delay-label { font-size: 10px; fill: var(--sf-muted); text-anchor: middle; dominant-baseline: middle; }
.sf-sfd .link .cut-mark { display: none; fill: #c92a2a; font-size: 16px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
.sf-sfd .link.cut .line { stroke-dasharray: 4 4; opacity: 0.5; }
.sf-sfd .link.cut .cut-mark { display: inline; }
.sf-sfd .node { cursor: pointer; }
.sf-sfd .node rect { fill: #fff; stroke: none; }
.sf-sfd .node:hover rect { stroke: var(--sf-line); }
.sf-sfd .node.expanded:not(.stock) rect { stroke: var(--sf-border); }
.sf-sfd .node.stock rect { fill: #edf2ff; stroke: var(--sf-accent); stroke-width: 1.8; }
.sf-sfd .node .label { font-size: 15px; text-anchor: middle; dominant-baseline: middle; pointer-events: none; fill: var(--sf-ink); }
.sf-sfd .node.input .label { font-style: italic; fill: var(--sf-muted); }
.sf-sfd .spark-line { fill: none; stroke: var(--sf-accent); stroke-width: 1.8; }
.sf-sfd .node:not(.stock) .spark-line { stroke: var(--sf-muted); }
.sf-sfd .spark-reference { fill: none; stroke: var(--sf-line); stroke-width: 1.4; stroke-dasharray: 3 3; }
.sf-sfd.highlighting .link:not(.active), .sf-sfd.highlighting .node:not(.active), .sf-sfd.highlighting .cld-loop:not(.active) { opacity: 0.2; }
.sf-sfd.highlighting .link.active .line { stroke: var(--sf-active); stroke-width: 2.6; }
.sf-sfd.highlighting .node.focus rect { stroke: var(--sf-active); stroke-width: 2.4; }

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

.sf-fit { list-style: none; margin: 6px 0 0; padding: 0; font-size: 0.75rem; color: var(--sf-muted); font-variant-numeric: tabular-nums; }
.sf-fit li { margin: 2px 0; }
.sf-fit strong { color: var(--sf-ink); font-weight: 600; }
.sf-attribution svg .whisker { stroke: #333; stroke-width: 1.2; }
.sf-attribution td.band { color: #666; white-space: nowrap; }
.sf-tests-tool footer, .sf-sensitivity-tool footer, .sf-attribution-tool footer { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; font-size: 0.75rem; color: var(--sf-muted); }

/* Tests */
.sf-tests header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.sf-tally { font-size: 0.78rem; color: var(--sf-muted); }
.sf-tally .pass { color: #2b8a3e; } .sf-tally .warn { color: #e67700; } .sf-tally .fail { color: #c92a2a; }
.sf-tests td.sf-status { width: 14px; padding-right: 0; }
.sf-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--sf-line); }
.sf-tests tr.pass .sf-dot { background: #2b8a3e; }
.sf-tests tr.warn .sf-dot { background: #e67700; }
.sf-tests tr.fail .sf-dot { background: #c92a2a; }
.sf-tests tr.fail td { background: #fff5f5; }
.sf-tests tr.warn td { background: #fff9db; }
.sf-tests details { margin-top: 3px; font-size: 0.72rem; }
.sf-tests details summary { cursor: pointer; color: var(--sf-muted); }
.sf-tests details code { display: block; white-space: pre; margin-top: 2px; }

/* Sensitivity */
.sf-tornadoes { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; margin-top: 8px; }
.sf-tornado { margin: 0; border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; }
.sf-tornado figcaption { font-size: 0.8rem; font-weight: 600; margin-bottom: 4px; }
.sf-tornado svg { width: 100%; height: auto; display: block; overflow: visible; }
.sf-tornado .centre { stroke: var(--sf-ink); stroke-width: 1; }
.sf-tornado rect.low { fill: #4c6ef5; opacity: 0.8; }
.sf-tornado rect.high { fill: #e8590c; opacity: 0.8; }
.sf-tornado .bar-label { font-size: 11px; fill: var(--sf-ink); }
.sf-tornado .end-label { font-size: 10px; fill: var(--sf-muted); }
.sf-ranking ul { list-style: none; margin: 4px 0 0; padding: 0; font-size: 0.82rem; }
.sf-ranking li { position: relative; padding: 4px 8px; margin: 2px 0; }
.sf-win-bar { position: absolute; left: 0; top: 0; bottom: 0; background: #edf2ff; border-radius: 4px; z-index: -1; }
.sf-ranking li { isolation: isolate; }

/* Attribution */
.sf-attribution svg { width: 100%; max-width: 560px; height: auto; display: block; margin: 8px 0; overflow: visible; }
.sf-attribution rect.level { fill: var(--sf-ink); opacity: 0.75; }
.sf-attribution rect.up { fill: #e8590c; }
.sf-attribution rect.down { fill: #0c8599; }
.sf-attribution .zero { stroke: var(--sf-line); }
.sf-attribution .connector { stroke: var(--sf-line); stroke-dasharray: 2 2; }
.sf-attribution .value { font-size: 10.5px; fill: var(--sf-ink); font-variant-numeric: tabular-nums; }
.sf-attribution .label { font-size: 10px; fill: var(--sf-muted); }
.sf-attribution tfoot td { font-weight: 600; border-top: 1px solid var(--sf-line); }

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
