# Linked notebooks

A fork of paulsonnentag's `@patchwork/jupyter` (its native tool: Solid,
CodeMirror, Pyodide) in which a notebook reads other documents live instead
of holding pasted copies of them, records what each run read, knows when it
is out of date, and can be run by the agent without a view.

It installs beside the original and edits the same `jupyter-notebook`
documents; open a notebook in either.

| plugin | id | what |
|---|---|---|
| tool | `jupyter-linked` ("Notebook (linked)") | the notebook, with imports, the last run, and staleness |
| agent:tool | `notebook_run` | run a notebook's cells headless, or ask whether it is stale |

It registers **no datatype**. Patchwork's registry keeps one plugin per id,
the last registered winning (with a warning), and unregistering a package
removes the id outright even when another package still provides it. Two
packages registering `jupyter-notebook` would make which one is live depend
on load order, and uninstalling either would leave notebooks without a
datatype until a reload. The datatype stays the original package's. The
JupyterLab tool and the `.ipynb` import action are left there too.

## Reading other documents

### Imports

A notebook's imports are in its nbformat metadata, so it stays a valid
`.ipynb` and other tools carry them along:

```
metadata.patchwork.imports   [{ name, docUrl }]
```

Before every run each import is opened as it is now and written into the
kernel as a module called `name`, first on `sys.path`; modules from the last
run are dropped from `sys.modules` and rebound where the notebook already
holds them, so edits show. The module's source, in order:

1. **its datatype's hook**: the document's `@patchwork.type` looked up in the
   plugin registry; if the implementation has `asSource(doc, "py")` returning
   a string, that (an assumptions register gives its Python export:
   `import nootka as reg; reg.boat_mass_kg`);
2. **a file document named `*.py`**: its text;
3. **another notebook**: its code cells, run quietly as their own module
   (their prints stay out, `if __name__ == "__main__":` blocks don't run,
   `%magic` and `!shell` lines are skipped), so one notebook imports
   another's functions;
4. **anything else**: the document as JSON, bound as the dict `data`.

A document that can't be opened becomes a module that raises `ImportError`
saying so. A name that would hide a module Python already has (`json`,
`numpy`) stops the run before any cell, saying which.

### `patchwork.load`

```python
import patchwork
reg = patchwork.load("automerge:…")                  # or an import's name
reg["entries"]["pack_series"]["value"]["nominal"]
patchwork.load("nootka", as_="json")["pack_series"]   # the datatype's JSON view
```

`load` returns a document as plain Python. It is **synchronous**: before the
run the tool opens every document the run may load (its imports, and every
`automerge:` URL written literally in its code cells) and writes them into
the kernel, so nothing is fetched while a cell runs. That also makes the run
record complete by construction: a URL no cell names can't be loaded, and
`load` says to write it out or link it.

Automerge's values arrive as plain Python, everywhere they occur (top level,
nested, in lists): immutable and collaborative strings as `str`, counters as
`int`, bytes as `bytes`, dates as ISO 8601 `str` (UTC). Keys starting with
`@` are left out. One function does this (`docToJson` in
`shared/imports.ts`), for `load`, for imports bound as `data`, and for the
hashes in the run record; bytes travel as `{"$bytes": base64}`.

`as_="json"` asks the datatype for `asSource(doc, "json")` (an assumptions
register gives a flat id → value object) and falls back to the document.
Every `asSource` call (imports, `load`, staleness) gets
`{ for: <this notebook's URL> }` as its third argument, so a register can
leave out the results this notebook computes itself.
Values come back as read-only mappings and sequences that record what is
read; `.plain()` gives ordinary dicts and lists.

## Run record

Every run (a person's or `notebook_run`'s) writes `metadata.patchwork.run`,
replacing the last one. Its shape is a contract other packages read (the
assumptions register does):

```
at            ISO time the run started
finished      ISO time it ended; null while running
status        "running" | "ok" | "error" | "stopped"
by            "person" | "agent"
cells         ids of the code cells run, in order
kernel        "fresh" | "continued"
code          fingerprint of the notebook's code cells when it started
outputs       fingerprint of its outputs and execution counts when it finished
              (the register's runKey, computed the same way)
startHeads    the notebook's heads when the run began, before it wrote anything
finishHeads   its heads right after the last output write, taken before the
              change that finishes this record; that change writes only
              metadata.patchwork.run, so the outputs at finishHeads are the
              outputs after it. null while running
imports       [{ name, docUrl, title, heads, as, type, hash, problem? }]
              heads: the document's when it was resolved; as: "hook" |
              "py-file" | "notebook" | "json" | "missing"; hash: its module
              text's, without the header line
reads         [{ docUrl, title, heads, as: "raw" | "json",
                 paths: [{ path, keys?, hash }] }]
              every document the cells loaded, at the version they read,
              and each path they read: a value, or with `keys` a mapping's
              keys or a list's length; path [] is the whole document. hash
              is of what was there (docToJson, keys sorted)
problem       why it didn't start, when it couldn't (status "error", cells [])
```

A reader should trust only `status: "ok"` records with `finished` set, and
only for the outputs they describe (`outputs`, or the outputs at
`finishHeads`).

## Staleness and rerunning

A run is **stale** when something it read has changed in what it read
(`shared/staleness.ts`): an import's module text, or the value (or keys) at
a path a cell loaded. A change elsewhere in a document doesn't count, nor
does renaming it; a document that can no longer be opened does.

Only the last run is recorded, and a run that failed or was stopped may have
read nothing (it failed early), so it can't vouch for being current. Instead of
a staleness verdict the notebook_run report says "Its last run failed: <why>;
rerun it."

While the notebook is open, the view watches every document its last run
read. When the run goes stale it says so ("Stale: "Nootka assumptions"
changed (entries.pack_series.value) since the last run") with a **Rerun**
button. With **Rerun when inputs change** on (`metadata.patchwork.rerun`,
on unless set to false), it reruns all code cells once those documents have
been quiet for 3 s, so it doesn't run while someone is typing in the
register. When nobody has the notebook open nothing reruns; the register's
check flags the stale results, and a person or the agent reruns.

## The view

Under the toolbar: **Imports** (each by its module name and its document's
title; click the title to open it, the name to rename it, × to remove it;
drop a document anywhere on the notebook to import it) and **Last run** (when,
by whom, how many cells, fresh or same kernel, and what it read by name and
version, marked when changed since).

## For agents

- Link documents instead of pasting them: `notebook_run { url, link: [{ url:
  <register>, name: "reg" }] }`, then `import reg` in a cell. Another
  notebook's functions: link it and `import model_1`. Or read any document
  with `patchwork.load("automerge:…")`, writing the URL in the cell.
- Run: `notebook_run { url }` runs every code cell; `cells: [3, 5]` (cell
  numbers from 1, as the report prints them, or ids) runs some, in the
  kernel earlier calls left; `restart: true` starts fresh. Outputs and
  execution counts are written into the notebook as they arrive.
- The report: whether the notebook was stale before the run and why, one
  line per cell (ok, or the error and its traceback's tail), the `id value`
  result lines the cells printed (only lines whose id is an entry of a linked
  assumptions register, an import or a `patchwork.load`; none when no register
  is linked), and the tail of what they printed. No need to read outputs back cell by cell.
- Before it runs, notebook_run waits (up to 4 s) until this realm holds
  everything the sync server last advertised for the notebook
  (`handle.isCaughtUpWith`, `remote-heads`; `shared/sync.ts`), so a change made
  elsewhere a moment ago, such as a just-added import, is not missed. Offline or
  past the time it runs on what is here and the report says so.
- `notebook_run { url, check: true }` says whether it is stale, and why,
  without running anything.
- Editing imports by hand: `metadata.patchwork.imports` is a list of
  `{ name, docUrl }`.

The tool loads in a worker as well as a page: no DOM, no `window`, no bare
imports. Automerge comes from `ctx.automerge` or the page's importmap, else a
stand-in (`automergeStandIn`); the plugin registry from `ctx.plugins` or the
importmap, else none, and then an import that needed its datatype's hook is
bound as JSON and the report says so. Python runs in Pyodide in its own
Worker.

## Building

```sh
pnpm install
pnpm build       # build:native, build:pyfs, build:tool
```

`build:native` needs Python 3.11 or later (`tomllib`) and the network the
first time: it writes Pyodide, the kernel's piplite index and this package's
`patchwork` wheel (`shared/python`) to `dist/native/`, caching downloads in
`.cache/`.

## Checking

```sh
pnpm typecheck
pnpm test                                    # vitest: imports, runs, staleness, values, compare
vite build --config dev/vite.config.ts
node dev/probe.mjs                           # notebook_run headless in Chromium
node dev/e2e.mjs                             # the native tool in Chromium
```

`dev/harness.html` shows the tool on a local repo; `dev/probe.html` runs
`notebook_run` on a notebook that imports a register and another notebook,
then changes the register and checks staleness.

## Comparing drafts

The tool answers strand's `compare:view` (see strand's
`packages/projects/src/compare.ts`) in three modes, folding unchanged cells
away when the panel asks:

- **Stacked**: the panel lays out both drafts' views. Each marks what its own draft changed since the two parted (their common ancestor): added cells, changed source and outputs, and removed cells where they were.
- **Side by side**: the notebook draws both versions in one scrolling list, a row per cell, matched by id. Differing cells and lines are amber on both sides. A cell only one side has is green where its draft added it, and red where the other draft took it out. The other version is read-only.
- **Combined**: the notebook draws both versions in one, read-only. Where they differ, this draft's cells and lines are in its colour and the other's are shown alongside in theirs.

Outputs count as different only when they show differently: an `execute_result`'s execution count, stream output split into pieces, and cell metadata don't count. While a merge is looked over, it shows the result and the target before it, in green and red.
