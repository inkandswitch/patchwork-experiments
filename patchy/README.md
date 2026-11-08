# patchy

Patch layers: a patch doc changes another document without writing on it. It
names its target (`on`), the target's heads when it was made (`at`), and a list
of entries: values put at paths, runs of text replaced or marked (held by
Automerge cursors, so they move with the target's edits), and runs of list
items. A folder of patch docs is laid over every document a view resolves, and
edits go into the patch covering what they touch, or to the target everywhere
else.

## What's here

- `src/layers/` — the library. `LayeredDoc` shows a target with patches laid
  over it, kept in step with the live target and routing writes; helpers to
  make, read, judge and land patches (`createPatch`, `textPatch`, `markPatch`,
  `fromAutomergePatches`, `readEntry`, `landPatch`, …); `providePatchLayers`,
  the remapper that lays a folder's patches over what's resolved beneath it.
- `src/provider.ts` — the **Patch Layers Provider** component: lays this
  browser's patch folder, and tells the panel and editors about it.
- `src/Panel.tsx`, `src/Card.tsx`, `src/Fields.tsx` — the **Patches** context
  tool: make patches from edits, switch them on and off, reorder, land them.
- `src/highlights.ts` — a `codemirror:extension` that washes what patches
  change in codemirror-base editors while the panel's Highlight is on.
- `src/tools/pwp/` — **pwp**, a vector layer editor for patternwitch drawings:
  each layer is a patch on the drawing.

## What it needs from the shell

- **Scratch backings in `@inkandswitch/patchwork-providers`**
  (`DocHandleDescriptor.scratchUrl`, `getScratchRepo`, `repo:scratch-lease`),
  from 0.5.5. A layered doc is computed, never saved or synced, so it lives in
  the realm's scratch repo and goes back to the view as the answer's
  `scratchUrl`, beside whatever `cloneUrl` a draft gave. On an older shell the
  provider still answers, but views show the documents unpatched (it warns
  once).
- **A `document-provider` slot around the document area** (threepane, in base
  since b0297aa), inside the draft overlay, where the provider component is
  mounted. Without it the provider is never mounted.

## Lifetimes

A layered doc is shared by every view laying the same patches over the same
backing. A view leases it (`repo:scratch-lease`) while it shows it. The
provider keeps it while any subscription's latest answer is it, or any lease
on it is open, and deletes it a little after neither is true (`keepFor`).
That grace covers the gap between answering a view and the view taking its
lease. A provider stacked under another leases the layered doc it lays over
from the one above.

## Tests

```sh
pnpm test
```

`test/provider.test.ts` drives the provider through the descriptor protocol
with a small stand-in for an `OverlayRepo`, since the providers release on npm
doesn't know `scratchUrl` yet. Once it does, the stand-in can go and the tests
can use `OverlayRepo` itself.
