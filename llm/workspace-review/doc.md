# workspace-review

A PR-style change review tool for Automerge workspaces. Displays side-by-side diffs for text files and inline change annotations for other document types (via `patchwork-view`). Supports modified, added, deleted, moved, and unchanged files. Includes a merge button that writes cloned content back to originals and propagates updated heads through the folder tree.

## Architecture

```
WorkspaceReviewUI.tsx (React)
┌─────────────────────────────────────────────────────┐
│  useDocument(WorkspaceDoc)                          │
│                                                     │
│  computeChangeset()                                 │
│    walkTree(original) vs walkTree(overlay)           │
│    → FileChange[] (modified/added/deleted/moved/unchanged) │
│                                                     │
│  For each change:                                   │
│    docType === "file" → FileDiffView                │
│      side-by-side text diff (diffLines)             │
│    docType !== "file" → DocDiffView                 │
│      <patchwork-view> + annotation context          │
│                                                     │
│  mergeChanges()                                     │
│    Phase 1: Content merge (clone → original)        │
│    Phase 2: Heads propagation (bottom-up)           │
│    Phase 3: Clear mappings                          │
└─────────────────────────────────────────────────────┘
```

The tool loads a `WorkspaceDoc` by URL and computes the diff between the original document tree and the COW overlay. The UI renders each changed file as a collapsible card. Merging writes everything back and clears the workspace overlay.

## Document schemas (types.ts)

### WorkspaceDoc

```typescript
type MappingEntry = {
  cloneUrl: AutomergeUrl;
  originalUrlWithHeads: AutomergeUrl; // original URL with heads at clone time baked in
};

type WorkspaceDoc = {
  "@patchwork": { type: "workspace" };
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, MappingEntry>; // originalUrl → { cloneUrl, originalUrlWithHeads }
  createdUrls: AutomergeUrl[];            // new files created by the agent
};
```

### FileChange

```typescript
type FileChange = {
  path: string;
  oldPath?: string;             // previous path (set only on moves)
  changeType: "modified" | "added" | "deleted" | "moved" | "unchanged";
  docType: string;              // @patchwork.type (e.g. "file", "tldraw")
  originalContent?: string;     // text content before (file type only)
  modifiedContent?: string;     // text content after (file type only)
  originalUrl?: AutomergeUrl;
  cloneUrl?: AutomergeUrl;
  originalUrlWithHeads?: AutomergeUrl;
};
```

Change types:
- **modified**: Same path, content differs (clone exists in mappings)
- **added**: New doc created by the agent (tracked in `createdUrls`)
- **deleted**: Doc present in original tree but gone from overlay
- **moved**: Doc's URL appears at a different path in the overlay. May also be modified (has `cloneUrl` + content diff). Carries `oldPath` for display.
- **unchanged**: Doc present in both trees at the same path with no mapping. Carries `path`, `docType`, and `originalUrl` only.

## Files

| File                        | Purpose                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`              | Shared types: `WorkspaceDoc`, `MappingEntry`, `FileChange`, `DiffLine`, `DiffRow`                                |
| `src/datatype.ts`           | Patchwork datatype registration (`WorkspaceDatatype`) with init defaults                                         |
| `src/index.ts`              | Plugin exports: `patchwork:tool` (id: "workspace-review") + `patchwork:datatype` (id: "workspace")              |
| `src/WorkspaceReviewUI.tsx` | React component. Renders changeset, file diffs, doc diffs, merge button                                         |
| `src/workspace-diff.ts`     | Core logic: tree walking, changeset computation (with move detection), side-by-side text diff, merge + heads propagation |
| `src/elements.d.ts`         | JSX type declarations for the `<patchwork-view>` custom element                                                  |
| `src/styles.css`            | Tailwind import                                                                                                  |

## Changeset computation (workspace-diff.ts)

### Tree walking

`walkTree(repo, folderUrl, mappings)` recursively walks a `FolderDoc` tree and produces a flat `Map<AutomergeUrl, TreeEntry>` keyed by document URL. Each entry stores its `url`, `path`, `type`, and `docType` (read from the document's `@patchwork.type`). Keying by URL (rather than path) avoids collisions when multiple folder entries share the same name (e.g. several "Untitled" docs). When `mappings` is provided, folder URLs are resolved through the COW overlay (cloned folders are used instead of originals).

### Diff detection

`computeChangeset(repo, workspaceDoc)` builds two trees — the original (no overlay) and the overlay — then compares them by URL:

1. **Original tree scan**: For each leaf URL in the original tree, look it up in the overlay tree by URL:
   - **Not found** → deleted
   - **Found, path differs, no mapping** → pure move
   - **Found, path differs, has mapping** → moved + modified (content diff for file-type docs)
   - **Found, same path, has mapping** → modified (content diff for file-type docs; suppressed if text is identical)
   - **Found, same path, no mapping** → unchanged

2. **Added pass**: Overlay entries whose URL is in `createdUrls` → added.

Moves are detected naturally by comparing paths for the same URL across both trees, eliminating the need for a separate move-detection pass.

### Side-by-side text diff

`computeSideBySideDiff(oldText, newText)` uses the `diff` npm package (`diffLines`) to produce `DiffRow[]`. Adjacent removed+added chunks are paired side-by-side with spacer lines for alignment.

## Rendering (WorkspaceReviewUI.tsx)

### FileDiffView

For documents with `docType === "file"`:
- Side-by-side diff table with line numbers, color-coded (green for added, red for removed)
- Collapsible per file with a sticky header showing change badge, path, and +/- stats
- Moved files show `oldPath → newPath` in the header; pure moves (no content change) show a "File moved" message instead of a diff

### DocDiffView

For all other document types:
- Renders the clone via `<patchwork-view doc-url={cloneUrl}>`
- Computes structural diff annotations using `diffAnnotationsOfDoc(cloneHandle, beforeHeads)` from `@inkandswitch/annotations-diff`
- The `beforeHeads` are extracted from `originalUrlWithHeads` via `parseAutomergeUrl` and decoded with `decodeHeads`
- Annotations (diff + `ViewHeads`) are registered with the global `AnnotationSet` so the embedded tool can display inline change decorations
- Moved docs without content changes show a "Document moved" message

### UnchangedFileView / UnchangedDocView

For documents with `changeType === "unchanged"`:
- Collapsible card, collapsed by default
- `docType === "file"`: when expanded, loads and displays file content as plain text with line numbers (no diff coloring)
- `docType !== "file"`: when expanded, renders the original doc via `<patchwork-view doc-url={originalUrl}>` (no diff annotations)

### Change badges

| Badge | Color   | Meaning   |
| ----- | ------- | --------- |
| M     | warning | Modified  |
| R     | info    | Moved     |
| A     | success | Added     |
| D     | error   | Deleted   |
| --    | ghost   | Unchanged |

## Merge (workspace-diff.ts)

`mergeChanges(repo, workspaceHandle)` applies all overlay changes back to the originals in three phases:

1. **Content merge**: For each mapping entry, copy the clone's content to the original doc. For files, this is the `content` field. For folders, the `docs` array is synced with clone URLs translated back to original URLs via a reverse map.

2. **Heads propagation**: Walk the folder tree bottom-up. For any `DocLink` whose URL contains pinned heads (from `parseAutomergeUrl`), update it to reference the current heads of the target document (via `handle.heads()` and `stringifyAutomergeUrl`). Processing bottom-up ensures children are finalized before parents read their heads.

3. **Clear mappings**: Reset `mappings` to `{}` and `createdUrls` to `[]`.

## Dependencies

Key packages beyond the standard patchwork stack:
- `diff` — line-level text diffing (`diffLines`)
- `@inkandswitch/annotations` — `AnnotationSet` for managing annotation contexts
- `@inkandswitch/annotations-context` — global annotations registry
- `@inkandswitch/annotations-diff` — `diffAnnotationsOfDoc`, `ViewHeads` for structural Automerge diffs
- `@inkandswitch/patchwork-refs` — `ref()` for creating document references in annotation sets

## Config

- Build: Vite (mirrors the llm-process package config)
- Main thread externals provided by patchwork bootloader
- Styling: Tailwind CSS + DaisyUI
