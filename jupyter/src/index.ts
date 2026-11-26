/**
 * Plugin registration — metadata only, as Patchwork evaluates this module in
 * a worker and clones every entry; each implementation is behind its load().
 *
 * This package is a fork of @patchwork/jupyter that installs beside it: its
 * own tool ids, the same `jupyter-notebook` documents. It registers no
 * datatype. The registry keeps one plugin per id, the last registered winning
 * (with a warning), and unregistering a package removes the id outright, even
 * when another package still provides it. So registering `jupyter-notebook`
 * here too would make which package's datatype is live depend on load order,
 * and uninstalling either would leave notebooks with none until a reload.
 * The datatype stays the original package's.
 */

const CELLS = {
  description:
    'Which cells: "all" (the default: every code cell, in order), or a list of cell numbers counted from 1 over all cells, as this tool and the register print them ("cell 3"), or cell ids.',
  anyOf: [{ type: "string", enum: ["all"] }, { type: "array", items: { type: ["number", "string"] } }],
}

export const plugins = [
  {
    type: "patchwork:tool",
    id: "jupyter-linked",
    name: "Notebook (linked)",
    icon: "NotebookPen",
    supportedDatatypes: ["jupyter-notebook"],
    async load() {
      return (await import("../native/tool")).default
    },
  },
  {
    type: "agent:tool",
    id: "notebook_run",
    name: "Run a notebook",
    // The page: Pyodide runs in a dedicated Worker the page starts, and the
    // kernel is kept between calls in the page. The agent's bursts run in a
    // pool's worker and import no plugin code, so a call to this parks there
    // until a page showing the session (or driving its workflow) runs it.
    where: "host",
    risk: "edit",
    description:
      "Run a Jupyter notebook's cells headless, the way a person runs them: first every linked document (the notebook's imports) is read as it is now and made importable from Python as a module, then the cells run in Pyodide, their outputs and execution counts are written into the notebook for anyone watching, and the run is recorded in the notebook (when, each import's version, the code's fingerprint). Returns, per cell, ok or the error with its traceback's tail, the `id value` result lines the cells printed (what an assumptions register reads), and the tail of what they printed. The kernel is kept between calls for the same notebook, so a later call can run just the cells that changed; `restart` starts a fresh one. To link a document, pass `link`: an assumptions register imports as its Python export (`import nootka as reg; reg.boat_mass_kg`), another notebook as its code cells (its functions), a .py file as its text, anything else as its JSON in the dict `data`. In a cell, `patchwork.load(url_or_import_name)` reads any document as plain Python (dicts, lists, str, numbers; `as_=\"json\"` for its datatype's JSON view, a register's flat id → value dict); write the URL literally in the code so the run reads it first. Every document read, and the keys read from it, is recorded, so the report says whether the notebook was stale before the run and why; `check` asks that alone, without running. Never paste a register's values or another notebook's code into a cell; link or load it.",
    input_schema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "automerge: URL of the notebook." },
        cells: CELLS,
        restart: { type: "boolean", description: "Start a fresh kernel first, throwing away what earlier calls defined. Default false: carry on in the kernel earlier calls left, or a fresh one when there is none." },
        link: {
          type: "array",
          description: "Documents to link before running, each importable as a Python module: { url, name? }. `name` defaults to one made from the document's title; linking a document already linked renames it.",
          items: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", description: "automerge: URL of the document to import." },
              name: { type: "string", description: "The Python module name, e.g. 'register' or 'hull_model'." },
            },
          },
        },
        unlink: { type: "array", items: { type: "string" }, description: "Import names to remove before running." },
        check: { type: "boolean", description: "Only say whether the notebook is stale — whether anything its last run read has changed in what it read — and why, without running anything. Cheap." },
        timeout: { type: "number", description: "Seconds the whole run may take before the kernel is shut down. Default 600, at most 1800." },
      },
    },
    async load() {
      return (await import("./agent-tool")).notebookRun
    },
  },
]
