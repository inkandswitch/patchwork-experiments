# Jupyter notebooks on Automerge

Two tools for the same `jupyter-notebook` document, so one notebook can be opened in either:

| Folder | Tool | What it is |
|---|---|---|
| `lab/` | Jupyter Notebook (JupyterLab) | The real JupyterLite Notebook app in an iframe. An extension (`lab/extension`) gives it an Automerge-backed `ISharedNotebook` and a Patchwork contents drive. It keeps JupyterLab's extensions and polish. |
| `native/` | Jupyter Notebook | A notebook UI built for Patchwork in Solid and CodeMirror. It uses JupyterLab only for its lower-level parts: the kernel protocol (`@jupyterlab/services`), output renderers (`@jupyterlab/rendermime`) and the Pyodide kernel (`@jupyterlite/pyodide-kernel`, run without the JupyterLite app). It takes part in strand's draft comparison (`native/src/compare/`). |
| `shared/` | — | What both tools rely on: the document schema and nbformat conversion, the datatype and `.ipynb` import, and the `patchwork` Python package with its kernel-side node (`pyfs/`). |

The document schema in `shared/schema.ts` is the contract between the two tools. Both run Python in the browser with Pyodide, offline, and `import patchwork` mounts Patchwork files and folders in either.

## Building

```sh
pnpm run setup   # .venv (with uv) for the JupyterLite build, and node_modules
pnpm build       # build:lab, build:native, build:pyfs, build:tool
pnpm push        # build, then pushwork sync
```

- `setup` makes `.venv` with [uv](https://docs.astral.sh/uv/) (`uv venv`, then `uv pip install -r lab/requirements.txt`). That way it doesn't depend on the system Python having venv or pip.
- `build:native` needs only `python3` (standard library) and `node_modules`. It writes Pyodide and the kernel's piplite index to `dist/native/`.
- `build:lab` needs the venv. It runs `jupyter-builder` for the extension and `jupyter lite build` for the app, writing to `dist/lite/`. Check that `dist/lite/notebooks/index.html` exists before syncing, or the JupyterLab tool can't load.

## Checking

```sh
pnpm typecheck                                    # root (native, shared) and lab/extension
pnpm test                                         # root (test/) and lab/extension unit tests (vitest)
vite build --config dev/vite.config.ts
node dev/e2e.mjs [lab] [native]                   # headless Chrome; CHROME_PATH to pick one
```

`dev/harness.html?tool=native` (or `lab`) shows either tool on a local repo. `dev/kernel.html` starts the native Pyodide kernel on its own.

## Comparing drafts

The native tool answers strand's `compare:view` (see strand's `packages/projects/src/compare.ts`) in three modes, folding unchanged cells away when the panel asks:

- **Stacked**: the panel lays out both drafts' views. Each marks what its own draft changed since the two parted (their common ancestor): added cells, changed source and outputs, and removed cells where they were.
- **Side by side**: the notebook draws both versions in one scrolling list, a row per cell, matched by id. Differing cells and lines are amber on both sides. A cell only one side has is green where its draft added it, and red where the other draft took it out. The other version is read-only.
- **Combined**: the notebook draws both versions in one, read-only. Where they differ, this draft's cells and lines are in its colour and the other's are shown alongside in theirs.

Outputs count as different only when they show differently: an `execute_result`'s execution count, stream output split into pieces, and cell metadata don't count. While a merge is looked over, it shows the result and the target before it, in green and red.

The JupyterLab tool doesn't take part: the panel lays out two independent copies of it.
