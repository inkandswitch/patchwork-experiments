# Assumptions

A register of every number a task's models compute with: cell data, material
properties, loads, limits, design choices, and the models' own outputs. Each
entry says where it came from. The register is where a person corrects a value
or tries an alternative, and where they find every place a value is used.

Built after a review of the agent's marine-battery runs with a domain expert.
In those runs:

- a safety case estimated vent gas from a cited L/Ah figure, an H₂ fraction
  "from memory" and a guessed compartment volume, while the design had no
  barrier between cells and nothing linked the three;
- a report and its notebook disagreed on a short-circuit voltage;
- a "single source of truth" JSON carried values with no sources;
- a later run had to audit one run's notebook by hand to find its 30-odd
  hidden assumptions.

## What's in the package

| plugin | id | what |
|---|---|---|
| datatype | `assumptions` | the register document |
| tool | `assumptions` | the view: entries by group, status, stale results, variants, edit, Find uses |
| skill | `assumptions-register` | when to keep a register and how to work from one; the agent names it in its prompt |
| agent:tool | `assumptions_create` | make a register, filed in and scoped to a task folder |
| agent:tool | `assumptions_read` | entries, statuses, stale results, variants |
| agent:tool | `assumptions_set` | add or change entries; status is decided by the tool |
| agent:tool | `assumptions_where` | uses of each id in the folder, unused entries, constants in model code, drifted copies |
| agent:tool | `assumptions_export` | JSON / Python / OpenSCAD `id = value` file for models to read |

## The document

```
title, scope                         scope = the task folder the entries serve
entries:  { [id]: Entry }
variants: { [name]: { note, entries: { [id]: partial Entry } } }

Entry: label, unit, value (number | {min, max, nominal?} | text),
       kind (fact | decision | requirement | result),
       status (verified | cited | estimated | chosen | derived),
       source, quote, note, inputs (results), by (results), at
```

Ids are identifiers with at least one underscore (`cell_vent_gas_L_per_Ah`).
The same token then appears in Python, OpenSCAD, JSON and prose, so finding
where an entry is used is a whole-word search that can't miss a use. The
first segment groups entries in the view.

## Invariants

- **Status is computed, not claimed** (`statusFor`).
  - `verified` only when a quote from a kept document was looked up in it and
    found. The tool refuses a quote that isn't there.
  - `cited` when there is a source but no checked quote.
  - `estimated` (or `chosen` for a decision) when there is no source.
  - A person's edit in the view keeps `verified` only if the value, source and
    quote are all unchanged, because the quote vouched for the old value.
- **Results snapshot their inputs.** `assumptions_set` with `inputs: [ids]`
  records those entries' current values itself; the caller never supplies them.
- **Stale means an input disagrees.** A result is stale when a recorded input
  is gone, has changed, or is itself stale. The propagation is monotone over a
  finite set, so it terminates.
  - A loop of results (mass → drag → energy → mass) is not stale in itself.
    It is stale only when some recorded input disagrees with its current
    value, and then everything around the loop is stale (tested).
- **A range has no implied midpoint.** It exports as `id_min` and `id_max`.
  The bare `id` appears only when the range has a nominal someone chose.

## Where-used and constants in model code

`whereUsed` walks the scope folder and reads:

- notebook cells;
- OpenSCAD source;
- code and markdown files;
- datagrids.

It skips kept sources and this register's own exports. For each document it
reports:

- every use of every id;
- entries nothing uses;
- **constants in model code**: plain `name = <number>` assignments and
  `"key": <number>` dict entries whose name the register doesn't export. Each
  is a world fact that has escaped the register.
- **drifted copies**: a register name assigned a number that differs from the
  register's.

Run against the real past runs, it flags 31 constants in Run 3's notebook,
covering the assumptions Run 5's audit found by hand (`R_DC25`, `R_contact`,
`P_MOTOR_PEAK`, `DUDT`, `VIC_CYC` "from memory"…). It also flags 14 constants
in Run 3's OpenSCAD model (`cell_t = 72` against the notebook's 71.7) and 9 in
the constants dict of Run 1's `pack_model.py`.

## Not yet

- **Research steps can't write to the register.** The tools aren't
  `scoped: true`, because a research step's repo can read only its ledger.
  Research steps keep sources and findings; the step that writes the register
  copies values over, with their quotes.
- **No in-place reading from notebooks.** A notebook or OpenSCAD model reads
  an export file. Whether the Jupyter datatype can read another document
  directly hasn't been checked.
- **No solver for coupled loops.** The register shows when a loop is
  inconsistent; the agent (or a person) re-runs the models until nothing is
  stale. The skill says how.

## Tests

`pnpm test`. They cover:

- **model.test.js**: ids, values, every status combination, variants,
  staleness including loops, exports, uses, constants.
- **agent-tools.test.js**: against a real in-memory repo — quote
  verification, input snapshots, variants, export in place, where-used across
  a notebook and an OpenSCAD model.
- **view.test.js**: rendering, an edit dropping `verified`, adding an entry.
- **index.test.js**: the metadata is plain data, every input the executors
  read is declared with a description, and the skill names only tools that
  exist.
