# Assumptions

A register of every number a task's models compute with: cell data, material
properties, loads, limits, design choices, and the models' own outputs. Every
value is either a claim on a quoted source, an estimate with its reasoning, an
unknown, a decision, or computed — by a formula in the register or by a model
that records its inputs. Requirements are checks decided over the values'
bounds. The register says how far to trust each result, and never blocks on
uncertainty: real engineering rests on approximations, guesses and unknowns,
and the job is to show them.

Built after a review of the agent's marine-battery runs with a domain expert.
In those runs a safety case estimated vent gas from an H₂ fraction "from
memory"; a report and its notebook disagreed on a short-circuit voltage; a
"single source of truth" JSON carried values with no sources; and an audit of
one report against its sources (Run 5) found twelve discrepancies. Those twelve
are this package's acceptance test (`src/run5.test.js`).

## What's in the package

| plugin | id | what |
|---|---|---|
| datatype | `assumptions` | the register document |
| tool | `assumptions` | the view: Needs attention, Entries, Requirements, and the entry panel |
| skill | `assumptions-register` | when to keep a register and how to work from one |
| agent:tool | `assumptions_create` | make a register, filed in and scoped to a task folder |
| agent:tool | `assumptions_read` | summary, judgements to answer, problems, figure lines and cite strings |
| agent:tool | `assumptions_set` | add or change entries, answer judgements |
| agent:tool | `assumptions_check` | the before-you-finish call: scan the folder and list everything to act on |
| agent:tool | `assumptions_where` | where one entry is used, in the register and the folder |
| agent:tool | `assumptions_export` | JSON / Python / OpenSCAD `id = value` file for models to read |

## The document

```
title, scope        scope = the task folder the entries serve
entries: { [id]: Entry }
scan:    the last where-used scan, with each document's heads (where.js)

Entry, as written:  label, unit, note, kind (fact | decision | requirement | result),
                    basis and its field: claims (+ pick) | estimate | unknown | choice |
                    formula | model | check (+ appliesIf), about, use, judgements
Entry, written back by the register:
                    value, support, derived, confidence, outcome, stale, broken
```

`register.js` documents every field. Ids are identifiers with at least one
underscore (`cell_vent_gas_L_per_Ah`), grouped by their first segment; the same
token appears in Python, OpenSCAD, JSON and prose, so where-used is a whole-word
search. Bounds export as `id_min` / `id_max`, so two ids that would export the
same name are refused.

## How it decides

- **A value comes from exactly one basis.** There is no free-standing value: a
  cited fact takes its value from its picked claim, a result from its formula.
- **Claims are read against their quotes.** The quote must be in the kept
  source, every stated number must be in the quote, and the quote's qualifier
  wins: "≤0.25" is an upper bound, never a nominal (`quote.js`).
- **Values are a nominal plus bounds**, either optional. A bare nominal has an
  *unstated* spread. Formulas are evaluated on nominals and on intervals;
  interval arithmetic is sound, so a check that holds over bounds holds
  everywhere (`formula.js`). A requirement holds, fails, depends or is n/a, and
  when it depends the register names the leaf that would settle it.
- **Support is computed, never approved** (`support.js`): corroborated,
  supported, weak or none, from the claims' kinds, verification and origins.
  A person adds claims or judgements; a judgement that disagrees makes the
  value conflicting until it's resolved, and the agent answers it. A result's
  support is its weakest leaf, and its confidence says what makes it wide.
- **Results are stored as computed** with what they were computed from, in the
  same change as the edit, so a consumer can read them without this package and
  tell when one is out of date (`consistency.js`, self-contained). The view
  checks and repairs stored results when it loads. Results are shown to the
  precision a hand calculation keeps: decimal places through sums, significant
  figures through products.
- **Version control is Automerge's.** History is the document's own: every
  change carries the why as its message, and the agent's changes name its
  session. Model results pin the heads they ran at; judgements and scans
  record heads. What-ifs are Patchwork drafts.
- **Use is intended against observed**: model, reference or unused, against
  what the scan sees. Five of the nine combinations are flagged; an entry kept
  unused says why (`uses.js`). Prose that cites an id without its number is
  flagged (`prose.js`), and the register's cite string passes by construction.

## Presentation

One content model, two renderings (`text.js`): each entry becomes ordered parts
(id, value with its qualifier, bounds, status, evidence, judgements, uses,
flags, cite), joined into a figure line for the agent and rendered as table
cells for people, and a test asserts they read the same. Output for the agent
is bounded: an unfiltered read is a summary, the judgements and problems, and
one line per group. In the view, colour appears only where something needs a
person; evidence is a glyph's fill (● corroborated, ◐ supported, ○ weak,
◌ none, ◆ chosen), always with its word.

## Not yet

- **Prose drift direction.** The scan records heads, but doesn't yet say
  whether the value or the line moved since they last agreed.
- **No solver for coupled loops.** The agent reruns models until nothing is stale.
- **Point-of-use hints** (register values beside ids in the markdown and code
  editors) are a later slice.
- **Unit algebra.** Ids carry their unit; a claim's factor is explicit.

## Tests

`pnpm test`. The same files run in Patchwork through the agent's
`package_test`, in a page, or in a worker for all but the two that declare
`// @vitest-environment happy-dom` (view and morph). So tests import nothing
from `node:`, and read package files with `fetch(new URL(…, import.meta.url))`
(`vitest.setup.js` lets Node's `fetch` read them). Each invariant is pinned
over a finite space of cases:

- **values.test.js**: figure reading, the qualifier surviving a render, the
  cite string passing the prose check (and failing without its qualifier).
- **formula.test.js**: interval soundness for every operator over every
  interval shape; checks never say holds where a point fails.
- **register.test.js**: cycles over all 4096 graphs on 4 nodes; pick rules;
  support over every combination of up to two claims and a judgement;
  staleness with tolerance; stored results, consistency and repair.
- **agent-tools.test.js**: the tools against an in-memory repo — refusals,
  model inputs, change messages, people's marks, incremental scans, exports.
- **run5.test.js**: Run 5's discrepancies, the presentation rules, and bounded output.
- **view.test.js**: rows read as figure lines, no meaning by colour alone,
  the requirements scale, navigation, keyboard, judgements and claims, repair.
