# New Space (Sketchy)

A themed spatial canvas for Patchwork folders — no tldraw. Solid (JSX, vite),
perfect-freehand ink + rough.js shapes drawn over live embedded tools.

This file is the **operating manual**: names, build, policies. Design rationale
lives in [ARCHITECTURE.md](./ARCHITECTURE.md); the wiring system in
[NODES.md](./NODES.md); layouts/lenses/complement in [LAYOUTS.md](./LAYOUTS.md);
open work in [TODO.md](./TODO.md).

## Names

One canonical name per layer (decided in optimization-plan-3 Phase 0).
Persisted identifiers are **never** renamed; the renames are limited to
non-persisted namespace.

| Layer | Current value(s) | Persisted? | Canonical (this plan) |
|---|---|---|---|
| Directory | `newspace/` | no | **`newspace/`** (keep — moving a patchwork tool dir churns the host's path mapping for no value) |
| Datatype id | `newspace` **and** `sketch` (both registered, both in every `supportedDatatypes`) | **yes** (stored on docs) | **keep both, as-is** — `sketch` is the forward name, `newspace` stays as a back-compat alias forever |
| Doc field | `.sketch` (was `.newspace`) | **yes** | **`.sketch`** (read `.newspace` for back-compat, as the code already does) |
| Plugin type prefix | `sketchy:brush` **and** `newspace:brush` (split — see Phase 1) | no (registry key) | **`sketchy:`** for all plugin types |
| Tool id | `sketchy`, `sketchy:list`, `sketchy:grid`, `sketchy:dock`, `sketchy:pencil` | yes (tool registration) | **keep as-is** (already consistent) |
| Console tag | `[newspace]` **and** `[sketchy]` mixed | no | **`[sketchy]`** (one logger — Phase 2) |
| localStorage prefix | `newspace:camera:` | no | **`sketchy:camera:`** with a one-time migrate-read of the old key (Phase 2) |
| Design doc codename | `LITTLEBOOK4.md` | no (a doc) | **keep the codename** — it's a name for the *project*, not a code identifier; just stop using it as if it were a fourth runtime name |

(The design doc itself is now [ARCHITECTURE.md](./ARCHITECTURE.md); "Littlebook
4" survives only as the project codename.)

## Build & deploy

```sh
pnpm build      # vite build  →  dist/index.js (+ chunks)
pushwork sync   # publish dist + source to automerge
```

Published at `automerge:3EoRD6Adef8TitsP2SX3peY5bWxq`.

## Bundling notes

`vite.config.js` externalizes everything the **host importmap** provides
(solid-js + subpaths, all `@automerge/*`, the patchwork packages) and bundles
only our own deps (perfect-freehand, roughjs, automerge-repo-solid-primitives).
The installed `@inkandswitch/patchwork-bootloader/externals` list lags the live
host (it predates solid-js being host-provided), so the config augments it — if
solid-js were bundled we'd get a second reactive runtime and every signal would
break.

## State homes

Every piece of non-shared state has exactly one home, chosen by whose state it
is — never by what's convenient at the call site:

- **Device state** — belongs to this browser/machine, not to the person:
  camera position (`sketchy:camera:<docUrl>`), the op-debug toggle
  (`sketchy:debug`). Lives in **localStorage** (via `makePersisted`).
- **Person state** — yours, follows you across devices: per-brush config
  (`brushCfg`), chrome placement overrides (`chrome[part]`), floating
  inspectors (`floats`), flap open/closed (`flaps[id].open`). Lives in the
  **top-layer user doc** (`accountDoc.tools.sketchy.docs[folderUrl]`, written
  through `changeTop`).
- Shared state (items, layers, palette entries…) is the layout doc — not this
  section's concern.

Session-only UI state (an open menu, the properties panel's drag position) is
plain signals: if losing it on reload is fine, don't persist it at all.

## Undoability

What ⌘Z touches, by provenance:

- **User intent is undoable** — draw/move/resize/rotate/delete/reorder/paste,
  entering text, wiring: every gesture lands in the canvas history
  (`transact` / `beginTxn`…`endTxn`).
- **Derived/measured state is not** — a text item's auto-measured w/h, view
  persistence, reconcile/upgrade passes: written outside any txn (rafBatch
  deferrals keep them out of gesture windows) so undo never fights a measurer.
- **Per-viewer state never is** — camera, debug, everything in the top-layer
  user doc (brush config, floats, flap open). Undo is about the shared
  artifact, not your viewport.

Open question (TODO.md): node `setConfig` edits (params, palette config) are
user intent but currently bypass the history — should config edits join it?

## Comment policy

- A comment answers **why**, once. If the *why* is non-obvious and stable, it's
  a doc paragraph; inline, leave a pointer.
- Don't argue with an imagined reviewer. "not a workaround", "on purpose",
  "this is fine" — banned phrases; if the choice is genuinely surprising, state
  the invariant it preserves instead.
- Caps comments (`// ATTACH THE PROVIDER FIRST`) are allowed **only** for
  ordering invariants whose violation causes a silent bug.

## Commit messages

- Subject line: imperative, ≤72 chars, lowercase prefix matching the area
  (`canvas:`, `brush:`, `nodes:`, `docs:`, `rename:`, `fix:`).
- No subjects that are only a codename or interjection (`lb`, `ok`, `prable`).
  A genuine scratch commit is `wip: <thing>` — squash before it lands on
  `main`, or follow up.
- Frustration goes in the **body**, not the subject. `fix: block recursive
  frame render in picker` with a body explaining why it's fragile is the ideal.
