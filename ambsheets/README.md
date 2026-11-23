# Ambsheets

A spreadsheet where one cell can hold multiple values at once, for exploring scenarios.
See the [lab notebook](https://www.inkandswitch.com/ambsheets/notebook/).

This is a port of the original Ambsheets (the `packages/ambsheet` React/Handsontable tool
on the old Patchwork) to the current Patchwork. The formula language and the UI are the
same in spirit; the evaluator is new. Sheets are now evaluated by
[amb-engine](https://github.com/inkandswitch/amb-engine), either **exhaustively** (every
scenario) or by **Monte Carlo** sampling.

Documents keep the original shape (`{ title, data: string[][] }`) and datatype id
(`ambsheet`), so old Ambsheets documents open here.

## The language

A cell holds a literal, an amb, or a formula.

| Cell text | Meaning |
|---|---|
| `{500, 1200}` | an amb: either 500 or 1200 |
| `{1 to 10}`, `{0 to 1 by 0.25}` | a range of values |
| `{true, false x 3}` | repeats: `false` is three times as likely as `true` |
| `=ambify(A1:A5)` | one choice per (non-empty) cell of a range |
| `=normal(100, 15)` | a normal distribution (continuous; new) |
| `=uniform(0, 10)` | a uniform distribution (continuous; new) |
| `=normal(100, 15, 30)` | 30 fixed samples of a normal distribution, as in the original |
| `=deambify(B3)` | all of B3's values, collected into a range |
| `=SUM(B3:B5)`, `=IF(total <= 4200, "ok", "no")` | ordinary formulas |
| `total = SUM(B3:B5)` | a formula with a name, which other formulas can use |
| `=A6:B11` | a range as a value; the cell is shown as a line chart (one line per scenario) |

Functions: `sum product count avg min max and or not concat unique vlookup abs sqrt exp ln
floor ceil round pow mod`. Parameters of distributions must be numbers or cells that don't
vary.

## Help while typing

- **Autocomplete.** In a formula, suggestions appear as you type: functions, named cells,
  and (right after the `=`) the functions that make a cell hold several values. Arrow
  keys choose, Tab or Enter inserts, Esc dismisses, and Ctrl+Space shows everything.
  Related words work too: `=rand` or `=dist` finds `normal` and `uniform`.
- **Argument hints.** Inside a call, a hint shows the function's arguments with the one
  being typed highlighted and explained.
- **Reference.** The Reference button at the end of the formula bar opens a searchable
  page of the whole language. Clicking an example puts it in the formula bar for the
  selected cell.

All three are generated from one table, `src/lang/reference.ts`, and a test checks that
it documents exactly the functions that exist and that every example parses. What to
suggest where is decided in `src/lang/complete.ts` (no DOM, unit-tested).

## How evaluation works

- `src/model/compile.ts` turns the sheet into an amb-engine model: each amb cell becomes
  an amb, each cell that varies becomes a formula, and everything else is folded into
  constants (including reference cycles and syntax errors, which become error values).
- `src/model/run.ts` runs the model and decides how. In **Auto** mode it enumerates every
  scenario when that is cheap and samples otherwise, based on the model's cardinality (how
  many scenarios exist) and a measurement of how long one scenario takes:
  - continuous distributions → Monte Carlo (there are infinitely many scenarios);
  - no more scenarios than the sample size (100,000 by default) → exhaustive;
  - up to 250,000 scenarios → exhaustive if it is estimated to take under 3 seconds;
  - otherwise → Monte Carlo.

  The status bar says which was chosen and why, and lets you force either one. The choice
  (and the sample size) is stored in the document as `evaluation`.
- Evaluation happens in short time slices on the UI thread, and results are published to
  the UI as they accumulate, so during a Monte Carlo run you see values, counts and
  averages update as more scenarios are sampled. Unfiltered per-cell summaries come from
  amb-engine's own running analysis (`sampler.getLatestAnalysisResults()`).
- `src/model/analysis.ts` computes everything that involves filters (which scenarios
  pass, filtered statistics, histograms, pivot tables) from stored scenarios.

## Filters that hardly anything matches

Filtering a Monte Carlo sample only helps if the sample contains scenarios that match. If
one scenario in a million does, 100,000 samples contain none. So when a finished sample
has fewer than 1,000 matches, Ambsheets goes looking for more ("Seek matches" in the
status bar turns this off):

- `src/model/focus.ts` turns each filter into a *condition*: a function that says how far
  a scenario is from passing. For a range filter that is the distance to the range.
- For a filter on a true/false cell it uses the formula's **margin**. Formulas are
  compiled twice: once to their value, and (for comparisons, `AND`, `OR`, `NOT` and
  references to such cells) once to a number saying how far they are from flipping.
  `=total <= 4200` has margin `4200 - total`. See `compileMargin` in `compile.ts`. A
  true/false formula of any other shape (an `IF`, say), and any filter on text, can only
  say yes or no, and is found by chance or not at all.
- amb-engine's conditioned sampler (`src/engine/conditioned-sampler.ts`) then homes in:
  a population of scenarios is repeatedly culled to its closer half and re-diversified
  with MCMC moves, until all of it matches. The scenarios it goes on to produce are
  distributed like the matching scenarios really are, and the culling fractions multiply
  out to an estimate of how rare matching is ("about 1 in 7,100 scenarios").

While that sample is in use, "filtered" statistics, greyed-out values and blue histogram
bars all describe it, and "all" still describes the ordinary sample. The histogram draws
the two to separate scales. The scenarios are correlated (each is a small change from
another), which the status bar's tooltip reports as the share of attempted changes that
succeeded.

## What changed from the original

- A cell's values are its *distinct* values across scenarios, with counts (or, when
  sampling, shares). The original listed one value per combination of upstream choices.
- A cell with more than 25 distinct values is summarized (min … max, average) instead of
  listed, and is filtered with a range slider. (25 is amb-engine's limit for histograms.)
- Filters are value-based and local to your view, as before. Filter state isn't saved.
- Rows and columns are inserted and deleted from a right-click menu (on a cell, or on a
  row or column header; it acts on the selected rows/columns). Unlike the original, this
  rewrites the formulas that refer to cells that moved (`src/lang/rewrite.ts`): `B7`
  becomes `B8`, `SUM(B3:B5)` grows or shrinks, and a reference to something deleted
  becomes `#REF!`. A sheet has at most 26 columns (they are named by a single letter), so
  inserting a column into a full sheet needs its last column to be empty.
- The line chart viewer draws one line per combination of the choices a range-valued cell
  depends on; with continuous inputs it draws a sample of 150 lines.

## Development

```sh
pnpm install
pnpm test        # the language and the evaluation model (vitest, no DOM)
pnpm dev         # the tool on an in-memory Automerge doc; add ?example=0..4 to the URL
                 # (2 and 4 have a rare true/false cell to filter on)
pnpm build       # dist/index.js + lazy chunks
pnpm sync        # build, then pushwork sync
```

`dev/dist-check.html` smoke-tests the built bundle the way Patchwork loads it.

`src/engine/` is a working copy of amb-engine with conditioned sampling added (see the README
next to it).
