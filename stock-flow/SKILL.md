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
- **stock-flow-tests**: Sterman's test battery over a model (structure, equilibrium, integration error, extreme conditions, loop knockouts, fit and holdout statistics), rerun live.
- **stock-flow-sensitivity**: outcomes read off runs while parameters vary one at a time (tornado) or all at once (Latin hypercube), optionally ranking scenarios across the samples.
- **stock-flow-attribution**: Shapley shares of a change in one variable across the drivers that caused it (waterfall).
- **markdown**: the analysis. Embed any of these with `[patchwork:<id>/<type>]`, where `<id>` is the URL without `automerge:`.

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

   Other chart keys: `sweep: householdRentElasticity = 0.1, 0.25, 0.4` (one scenario, one line per value), `guide: 3 normal vacancy`, `fit: 2010–2024` (or `fit: true`) to print RMSE, MAPE, R² and Theil's U with its bias / variation / covariation split for each data series under the chart.
4. Group things with `sf folder new "<title>" <url>…`. Every command that writes prints a Patchwork link; send the user those links.

## Validation

Three more fences, each runnable offline first: `sf tests <model.json> --spec <file.md>`, `sf sensitivity …`, `sf attribution …` (the first matching fence in the file is used; `sf fit <model> <scenario> --data id,id` gives fit statistics alone). Publish them through `sf md new` like charts. Passing a test proves nothing; the battery shows where the model fails and whether an edit broke something.

````markdown
```tests
scenario: real
structure                                      sf check issues, plus parameters with neither `source` nor `estimated`
equilibrium                                    stocks stay put with no inputs; optional tolerance
integration 0.02                               halving dt changes no stock by more than this share
extreme "no students" inputs intake=0 expect students settles 0, rent min 0
extreme "no land" set landYears=1 inputs landDesignated=0 expect buildableLand min 0, flats finite
extreme "late flood" inputs intake=3 from 2012 expect rent finite    inputs held from 2012 on, as recorded before
knockout supply starts 0.05                    cutting the loop must move the variable by this share of its range
knockout growthResponse=0 starts 0.05          the same for a switch that is not a loop
inert growthResponse=0 rent,flats inputs population=1 0.001    the switch may move none of them by more than this
fit askingRentReal 2010–2024 mape 0.1          limits: rmse mape r2 theilU bias variation covariation
fit landPriceIndex 2010–2019 index 2010        both divided by their 2010 value (or `index mean`): changes, not levels
fit landSales 2007–2018 index mean lead 0–1    data compared with the model 0 or 1 years later, the better kept
holdout askingRentReal fit 2010–2019 test 2020–2024
```

```sensitivity
scenario: real
parameters: landYears 5–30, rentSensitivity ±50%, householdRentElasticity      bare names take `spread:` (default 50%)
method: one-at-a-time                          or: latin-hypercube 200 seed 1
outcomes: rent@2024, peak rent 2020–2040, vacancy crosses 3 after 2025, change rent 2010–2024 relative
ranking: forecast-low, forecast-high by 0 lower    which scenario wins on outcome 0 in each sample
```

```attribution
scenario: real
outcome: change rent 2010–2024 relative
drivers: Students = intake; Everyone else = population, householdSize; Land = landDesignated, landYears=30
uncertainty: rentSensitivity ±50%, landYears 5–30; 40 samples seed 1    optional: 5–95% bands on the shares
```
````

Expectation checks: `min v`, `max v`, `between a b`, `finite`, `settles v` (final value within 1% of the variable's range). Levels and values are in the units charts show (a share with `scale: 100` is given in percent). A driver "off" holds its inputs at their year‑0 multiplier and sets its parameters to the given values; shares always add up to the total, and the view reports the interaction (total minus the one‑at‑a‑time effects). Parameters may carry `source` (a string or a `DataSource`) and `estimated: { from, years, method, range }`; the structure test lists those with neither. Start a source string with `Data:`, `Literature:`, `Estimated`, `Assumption:`, `Switch:`, `Definition:` or `Derived:` and the model tool's Sources tab groups parameters by it.

Estimation: `sf estimate <model> <scenario> --params baseRent=5..6.5,rentSensitivity --data askingRentReal,vacancyRate*0.5 --years 2005-2019 [--write]` runs bounded least squares (Nelder–Mead on a logistic map of the bounds) on the normalised squared error over the fit window; a parameter without bounds uses its `range` or ±50%, `*w` weights a series. `--write` stores the values and an `estimated` record in the model (file or document), which is what makes a later `holdout` test honest: keep the test years out of `--years`. Values that land on a bound are flagged; widen the range or question the structure.

## Scenarios and knockouts

Scenario references are a scenario id with optional knockouts: `real without spillover and land` (named loops), `real without rent→profitability` (a link). Knockouts set link gains to 0. `sf run … --set name=value,…` overrides parameters, loop gains (by loop id) or `dt` for one run.

## Equations

Expressions use `+ - * / ^`, parentheses, and `min max clamp abs exp ln sqrt`. They can name variables, parameters and `time` (years since `simulation.startYear`). Stock initial values and derived parameters may call `inputAt(input, year)`. `sf check` reports unknown names, algebraic loops, a balanced run that drifts, results that change when `dt` halves, annotations that don't match the loop view, and unit errors. Fix every error before publishing.

Units: give every variable and parameter a `unit` written the way a reader would ("dwellings per year", "€ per m² per month, 2000 prices", "share", "% of dwellings", "years"); qualifiers after a comma are ignored, and phrases with `%`, `share`, `index`, `ratio`, `elasticity` or `=` are dimensionless. The checker derives each equation's unit and warns when it differs from the declared one, when `+`, `-`, `min`, `max` or `clamp` mix units, when a dimensioned quantity is raised to a non-constant power, and when a flow is not its stock's unit per year. The literal `0` matches any unit. A conversion between two counts (households → dwellings) wants an explicit parameter such as `flatsPerHousehold`, not an implicit 1.
