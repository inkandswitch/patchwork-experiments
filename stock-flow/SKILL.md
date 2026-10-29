---
name: stock-flow
description: Build, run and explain stock and flow (system dynamics) models stored in Patchwork with the `sf` CLI, and write markdown analyses that embed live charts and scenario cards. Use when asked to model a system with stocks, flows and feedback loops in Patchwork, to change or check an existing stock-flow-model document, or to write up what a model shows.
---

# Stock and flow models in Patchwork

Patchwork shows the artifacts; you change them with `sf`. Run it from this package: `node cli/sf.ts …` (or `pnpm sf …`). `sf --help` lists every command.

## Documents

- **stock-flow-model**: the model. Variables (stock, flow, auxiliary, input), parameters, data series, scenarios, loop annotations. The type is `StockFlowModelDoc` in `src/types.ts`; `examples/aachen/model.json` is a complete example.
- **stock-flow-chart**: a chart over a model: scenarios × variables, optional data series, sweep, year range, guide line.
- **stock-flow-scenario**: a card describing one scenario of a model.
- **markdown**: the analysis. Embed charts and cards with `[patchwork:<id>/stock-flow-chart]` and `[patchwork:<id>/stock-flow-scenario]`, where `<id>` is the URL without `automerge:`.

There is no separate causal loop diagram. The Loops and Stock and flow tabs (and `sf graph`) derive links, signs, delays and loops from the equations; annotations only name loops (`cut`: the links whose gain set to 0 switches the loop off) and explain links.

The optional `layout` places the two diagrams: `layout.loops` and `layout.stockFlow`, each with `nodes` (the variables shown, with `x`, `y` and optional `lines` for the label), `bends` per link (pixels the arrow bows to the right of its direction), `markers` per named loop, and a `viewBox`. Variables left out, stocks included, are folded into the arrows between the ones shown. Without a layout the diagrams are laid out automatically. `sf graph <model> --view loops` lists exactly the links a view draws, and `sf check` warns about bends on links that aren't drawn. Readers tweak delays, loop strengths and input curves on the Stock and flow tab; that stays in their view and never changes the document.

## Workflow

1. Write or edit a model as JSON, and iterate offline: `sf check model.json`, `sf run model.json <scenario> --series a,b --every 5`, `sf graph model.json`.
2. Publish it: `sf model new model.json`. Update it later with `sf model put <url> model.json`, or edit fields in place with `sf set <url> parameters.rentSensitivity.value 0.3`.
3. Write the analysis in markdown with fences, then `sf md new analysis.md --model <model-url>`; each fence becomes an embedded document. Rewrite it with `sf md put <md-url> analysis.md --model <model-url>`.

   ````markdown
   ```chart
   title: Rent with and without the surge
   scenarios: real, no-surge
   series: rent
   data: askingRentReal
   years: 2005–2030
   ```

   ```scenario
   no-surge
   ```
   ````

   Other chart keys: `sweep: householdRentElasticity = 0.1, 0.25, 0.4` (one scenario, one line per value), `guide: 3 normal vacancy`.
4. Group things with `sf folder new "<title>" <url>…`. Every command that writes prints a Patchwork link; send the user those links.

## Scenarios and knockouts

Scenario references are a scenario id with optional knockouts: `real without spillover and land` (named loops), `real without rent→profitability` (a link). Knockouts set link gains to 0. `sf run … --set name=value,…` overrides parameters, loop gains (by loop id) or `dt` for one run.

## Equations

Expressions use `+ - * / ^`, parentheses, and `min max clamp abs exp ln sqrt`. They can name variables, parameters and `time` (years since `simulation.startYear`). Stock initial values and derived parameters may call `inputAt(input, year)`. `sf check` reports unknown names, algebraic loops, a balanced run that drifts, results that change when `dt` halves, and annotations that don't match the loop view. Fix every error before publishing.
