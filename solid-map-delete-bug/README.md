# solid-map-delete-bug

Minimal Patchwork tool that reproduces a bug in
[`@automerge/automerge-repo-solid-primitives`](https://github.com/automerge/automerge-repo/tree/main/packages/automerge-repo-solid-primitives).

## The bug

`automerge-repo-solid-primitives` (`makeDocumentProjection` /
`createDocumentProjection` / `useDocument`) keeps its Solid store in sync with
a `DocHandle` by running incoming patches through `@automerge/automerge`'s
`applyPatches`.

Upstream `applyDelPatch` only handles list deletions and `text` (string)
deletions — both indexed by a numeric `prop`. When you delete a key from a map
(`Record<string, …>`) the resulting patch has a **string** `prop` (e.g. a
UUID), and `applyPatches` throws:

```
RangeError: index is not a number for patch
```

This breaks the Solid store update for that document.

## How this tool reproduces it

* The document type (`MapDeleteBugDoc`) has an `items` field of type
  `Record<string, MapItem>` — a map, not a list.
* `init` seeds three entries (`seed-a`, `seed-b`, `seed-c`).
* The Solid tool renders the items via `useDocument` (upstream primitives, no
  alias/patch).
* Clicking **Delete** on any row calls `handle.change((d) => { delete
  d.items[id] })`. The resulting `del` patch has a string `prop`, which throws
  inside `applyPatches`.

The error is caught and rendered in the tool itself, and the full stack trace
is logged to the devtools console.

## Compare with the workaround in `paper`

The `paper` tool in this repo works around this exact bug by aliasing
`@automerge/automerge-repo-solid-primitives` to a local
[`apply_patches.ts`](../paper/src/automerge-repo-solid-primitives/apply_patches.ts)
that adds an object branch to `applyDelPatch`. This tool intentionally does
**not** do that, so the upstream behaviour is what you see.
