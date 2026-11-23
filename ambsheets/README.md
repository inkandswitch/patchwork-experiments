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
  pass, filtered statistics, histograms, pivot tables) from the scenarios the run stores.

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
pnpm build       # dist/index.js + lazy chunks
pnpm sync        # build, then pushwork sync
```

`dev/dist-check.html` smoke-tests the built bundle the way Patchwork loads it.

`src/vendor/amb-engine.ts` is an unmodified copy of amb-engine (see the README next to it).
