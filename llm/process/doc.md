# code-agent

A minimal coding agent that runs in the browser main thread. The LLM's output is text interleaved with `<script>` blocks that get evaluated incrementally. It operates on an Automerge-based filesystem with copy-on-write protection (original documents are never mutated) and can import skills (folders following the Agent Skills spec with SKILL.md + optional scripts).

## Architecture

```
Main Thread
┌──────────────────────────────────────────────┐
│  LLMProcessUI.tsx (React)                    │
│    useDocument(LLMProcessDoc)                │
│    task input, model selector, run display   │
│                                              │
│  llm-process.ts (Agent Loop)                 │
│    1. Create/load WorkspaceDoc (COW overlay) │
│    2. Call LLM (stream)                      │
│    3. Parse <script> tags                    │
│    4. eval() in main thread                  │
│    5. Write output to LLMProcessDoc          │
│    6. Repeat if script ran                   │
│                                              │
│  Globals for eval:                           │
│    fs      - AutomergeFS (backed by          │
│              WorkspaceDoc, COW-protected)     │
│    console - captured                        │
└──────────────────────────────────────────────┘
```

All output is written to the `LLMProcessDoc` Automerge doc; the UI re-renders automatically via `useDocument()`. The filesystem is backed by a separate `WorkspaceDoc` that tracks a copy-on-write overlay — original documents linked into the workspace are never mutated directly.

## Document schemas (types.ts)

### LLMProcessDoc

```typescript
type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string; // OpenAI-compatible endpoint
    model: string;  // e.g. "anthropic/claude-opus-4.6"
  };
  workspaceUrl: AutomergeUrl;  // points to WorkspaceDoc
  runs: TaskRun[];             // all task runs, most recent last
};

type TaskRun = {
  task: string;           // user's instruction
  output: OutputBlock[];  // appended as the agent runs
  timestamp: number;
};

type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string; description?: string; output?: string; error?: string };
```

Task lifecycle: user writes a task → pushed as new `TaskRun` → agent streams output into `output[]` → done. Prior runs stay in `runs[]` and are fed to the LLM as context. Clear context = empty `runs[]`. Individual runs can be deleted.

Script blocks have an optional `description` (from `<script data-description="...">`) shown as the collapsed header. `output` and `error` are set after eval completes; their presence signals the block has finished executing.

### WorkspaceDoc

```typescript
type MappingEntry = {
  cloneUrl: AutomergeUrl;
  originalUrlWithHeads: AutomergeUrl; // original URL with heads at clone time baked in
};

type WorkspaceDoc = {
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, MappingEntry>; // originalUrl → { cloneUrl, originalUrlWithHeads }
  createdUrls: AutomergeUrl[];            // new files created by the agent
};
```

The workspace is a self-contained document that can be loaded independently of the LLM process (e.g. for change review via the workspace-review tool). It holds the root folder reference and a COW overlay map. When the agent writes to an existing file or modifies a folder, the original doc is cloned via `repo.clone()` and the mapping is recorded here. The `originalUrlWithHeads` field captures the original document URL with its Automerge heads baked in at clone time (via `stringifyAutomergeUrl`), providing a reliable "before" snapshot for diffing. Reads transparently resolve through the overlay.

## Files

| File                   | Purpose                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`         | All shared types: `WorkspaceDoc`, `MappingEntry`, `LLMProcessDoc`, `TaskRun`, `OutputBlock`, `ParsedBlock`                                                                                  |
| `src/datatype.ts`      | Patchwork datatype registration (`LLMProcessDatatype`) with init defaults                                                                                                                   |
| `src/index.ts`         | Plugin exports: `patchwork:tool` (id: "llm-process") + `patchwork:datatype` (id: "llm-process")                                                                                            |
| `src/LLMProcessUI.tsx` | React component. Renders runs/output, provides task input, model selector, per-task deletion, clear context                                                                                 |
| `src/llm-process.ts`   | Agent loop. Creates WorkspaceDoc, calls LLM streaming endpoint, parses `<script>` blocks, evals them, feeds results back. Injects `fs`/`console` as globals                                |
| `src/parser.ts`        | Simple `<script>`/`</script>` state machine. Async generator over a token stream, yields `{type:"text"}` or `{type:"script"}` blocks                                                       |
| `src/fs.ts`            | `AutomergeFS` class. COW filesystem backed by `WorkspaceDoc`. Resolves paths by walking `FolderDoc.docs` arrays with overlay resolution at each step. Clones docs on first write. Includes `patchFile` for targeted search-and-replace edits |
| `src/styles.css`       | Tailwind import                                                                                                                                                                             |

## Agent loop (llm-process.ts)

```
1. Load LLMProcessDoc, ensure root folder exists
2. Create or load WorkspaceDoc (COW overlay)
3. Create AutomergeFS backed by workspace handle
4. Auto-link any patchwork URLs found in the task text (supports both #doc= fragment URLs and bare automerge: URLs)
5. Link external skills folder into the workspace (from hardcoded automerge URL)
6. Discover skills by reading SKILL.md frontmatter from /skills/*

for each iteration (max 20):
  5. Build messages from all runs
  6. Call LLM streaming endpoint (OpenAI-compatible)
  7. Feed tokens through parseScriptBlocks()
  8. Text blocks → concatenated into the last text block in output
     (streamed incrementally, not one block per token)
  9. When <script> closes:
     a. Append script block to output
     b. eval() wrapped in async IIFE: `(async () => { ...code... })()`
     c. Capture console output, return value, + errors
     d. Append result block to output
     e. Break parse loop, start new LLM call (so LLM sees the result)
  10. If no script found → agent is done
```

The eval context has `fs` (AutomergeFS) and `console` (captured) injected as globals. Variables declared with `var` persist across script blocks (REPL behavior). The LLM can use `return` to produce a value from a script block. Modules are imported via native `import()` — the platform service worker handles `automerge:` protocol URLs.

Console output and return values are JSON-stringified with `JSON.stringify(value, null, 2)`. If stringification fails (e.g. circular references), the fallback is `[object]`.

## Copy-on-write filesystem (fs.ts)

`AutomergeFS` is initialized with a single `DocHandle<WorkspaceDoc>`. It never mutates original documents:

- **Path resolution**: At every step of folder traversal, the URL from each `DocLink` is checked against `WorkspaceDoc.mappings`. If a clone exists, the clone URL is used instead.
- **Writing to an existing file**: The file doc is cloned via `repo.clone()`, the mapping `originalUrl → { cloneUrl, originalUrlWithHeads }` is recorded in the workspace, and the write goes to the clone. The `originalUrlWithHeads` captures the original's heads at clone time via `stringifyAutomergeUrl`. Subsequent writes to the same file reuse the existing clone. `writeFile` uses `updateText` for efficient text diffs, with a fallback to direct assignment for docs with incompatible content types (e.g. older Automerge Text objects).
- **Patching a file** (`patchFile`): Reads the file, finds `oldStr`, replaces it with `newStr`, and writes back via `writeFile`. This is the preferred method for targeted edits — avoids full-file rewrites and the token cost of re-generating unchanged content.
- **Modifying a folder** (adding/removing files via `writeFile`, `createFolder`, `remove`, `move`, `linkDoc`): The parent folder is cloned via COW before mutation, same mechanism.
- **Moving files** (`move`): Removes the DocLink from the source folder and adds it to the destination folder, both via COW. The underlying document URL is preserved — only the folder links change.
- **Creating new docs**: New files get `{ "@patchwork": { type: "file" } }` metadata. New folders get `{ "@patchwork": { type: "folder" } }`. Created file URLs are tracked in `WorkspaceDoc.createdUrls`.
- **Reading**: Fully transparent — `readDoc` and `listFolder` go through `resolvePath` which resolves through the overlay automatically. Both `readDoc` and `getDocHandle` accept filesystem paths only — automerge URLs must be linked into the filesystem first via `linkDoc`.
- **Getting doc handles** (`getDocHandle`): Always returns a cloned handle via COW — never a handle to the original document. Accepts a filesystem path only.

The COW helpers (`resolveOverlayUrl`, `getWritableHandle`) are private methods on `AutomergeFS`, so the LLM's eval context cannot access them — only the public FS API is exposed.

## Eval context APIs

Available inside `<script>` blocks:

- `fs.readDoc(path)` → `Promise<string>` — accepts a filesystem path only (automerge URLs must be linked first via `linkDoc`)
- `fs.writeFile(path, content)` → `Promise<void>` (creates if missing, COW if existing)
- `fs.patchFile(path, oldStr, newStr)` → `Promise<void>` — replace the first occurrence of `oldStr` with `newStr`. Preferred over `writeFile` for targeted edits to existing files.
- `fs.listFolder(path)` → `Promise<{name, type, url}[]>` — `url` is the automerge URL (resolved through COW overlay)
- `fs.createFolder(path)` → `Promise<void>`
- `fs.move(srcPath, destPath)` → `Promise<void>` (move or rename a file/folder)
- `fs.remove(path)` → `Promise<void>` (unlinks from parent folder)
- `fs.linkDoc(path, automergeUrl)` → `Promise<void>` — link an existing automerge doc into a folder (type is read from the doc's `@patchwork` metadata)
- `fs.getDocHandle(path)` → `Promise<DocHandle<any>>` — get a cloned Automerge DocHandle by filesystem path (always returns a clone, never the original; automerge URLs must be linked first via `linkDoc`)
- `import("/automerge:docId/path")` → `Promise<module>` — native import via service worker
- `import("https://...")` → `Promise<module>` — import from URL
- `console.log(...)` — captured and returned as output to LLM (values are JSON-stringified)
- `return value` — return a value from the script block (included in output)

## UI features (LLMProcessUI.tsx)

- **Model selector**: Dropdown in config bar to switch between models (persisted in `doc.config.model`)
- **Per-task deletion**: Hover over a task header to reveal a delete button
- **Streaming output**: Text tokens are concatenated into a single growing text block (not one line per token)
- **In-progress indicator**: Spinner shown while waiting for first output on active task
- **Script blocks**: Collapsible cards with a description header (from `data-description` attribute). Shows code, output (neutral), and errors (red). Last script block defaults to expanded; completed non-last blocks start collapsed.
- **Review changes link**: Top bar link navigates to the workspace-review tool for the current workspace
- **Clear context**: Empties all runs

## Skills

Skills follow the [Agent Skills](https://agentskills.io) format and are loaded from an external Automerge folder. At startup, the agent links the skills folder from `automerge:2qTWd74BsagyJCDqn5dpYHYBHWsc/skills` into the workspace at `/skills` (skipped if `/skills` already exists).

Each skill is a folder containing a `SKILL.md` file with YAML frontmatter:

```
skills/
  some-skill/
    SKILL.md        ← required: frontmatter (name, description) + instructions
    scripts/        ← optional: executable code the agent can import
    references/     ← optional: additional documentation
    assets/         ← optional: templates, data files, etc.
```

### Skill discovery (progressive disclosure)

1. **Metadata** (~100 tokens): `name` and `description` from SKILL.md frontmatter are loaded at startup for all skills and included in the system prompt
2. **Instructions**: The full SKILL.md body is loaded when the agent activates a skill via `fs.readDoc("/skills/<name>/SKILL.md")`
3. **Resources**: Files in `scripts/`, `references/`, `assets/` are loaded only when referenced by SKILL.md

### SKILL.md frontmatter

```yaml
---
name: some-skill
description: What this skill does and when to use it.
---
```

The `name` field must be lowercase alphanumeric + hyphens (max 64 chars, must match the directory name). The `description` field (max 1024 chars) should describe both what the skill does and when to use it.

## Config

- API key: read from `.env` as `VITE_LLM_API_KEY` (injected at build time, never in Automerge)
- API URL + model: stored in `LLMProcessDoc.config`, model switchable from UI
- Build: Vite with `vite-plugin-wasm` for the worker (bundles automerge + WASM)
- Main thread externals provided by patchwork bootloader
