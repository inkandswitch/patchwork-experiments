# code-agent

A minimal coding agent that runs in the browser main thread. The LLM's output is text interleaved with `<script>` blocks that get evaluated incrementally. It operates on an Automerge-based filesystem with copy-on-write protection (original documents are never mutated) and can import skills (folders with a README + JS SDK).

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
    model: string; // e.g. "anthropic/claude-opus-4.6"
  };
  rootFolderUrl: AutomergeUrl;
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
  | { type: 'script'; code: string }
  | { type: 'result'; output?: string; error?: string };
```

Task lifecycle: user writes a task → pushed as new `TaskRun` → agent streams output into `output[]` → done. Prior runs stay in `runs[]` and are fed to the LLM as context. Clear context = empty `runs[]`. Individual runs can be deleted.

### WorkspaceDoc

```typescript
type WorkspaceDoc = {
  "@patchwork": { type: "workspace" };
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, AutomergeUrl>; // originalUrl → clonedUrl
};
```

The workspace is a self-contained document that can be loaded independently of the LLM process (e.g. for change review). It holds the root folder reference and a COW overlay map. When the agent writes to an existing file or modifies a folder, the original doc is cloned via `repo.clone()` and the mapping is recorded here. Reads transparently resolve through the overlay.

## Files

| File                   | Purpose                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`         | All shared types: `WorkspaceDoc`, `LLMProcessDoc`, `TaskRun`, `OutputBlock`, `ParsedBlock`                                                                                                  |
| `src/datatype.ts`      | Patchwork datatype registration (`LLMProcessDatatype`) with init defaults                                                                                                                   |
| `src/index.ts`         | Plugin exports: `patchwork:tool` (id: "llm-process") + `patchwork:datatype` (id: "llm-process")                                                                                            |
| `src/LLMProcessUI.tsx` | React component. Renders runs/output, provides task input, model selector, per-task deletion, clear context                                                                                 |
| `src/llm-process.ts`   | Agent loop. Creates WorkspaceDoc, calls LLM streaming endpoint, parses `<script>` blocks, evals them, feeds results back. Injects `fs`/`console` as globals                                |
| `src/parser.ts`        | Simple `<script>`/`</script>` state machine. Async generator over a token stream, yields `{type:"text"}` or `{type:"script"}` blocks                                                       |
| `src/fs.ts`            | `AutomergeFS` class. COW filesystem backed by `WorkspaceDoc`. Resolves paths by walking `FolderDoc.docs` arrays with overlay resolution at each step. Clones docs on first write             |
| `src/styles.css`       | Tailwind import                                                                                                                                                                             |

## Agent loop (llm-process.ts)

```
1. Load LLMProcessDoc, ensure root folder exists
2. Create or load WorkspaceDoc (COW overlay)
3. Create AutomergeFS backed by workspace handle
4. Auto-link any patchwork URLs found in the task text

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

- **Path resolution**: At every step of folder traversal, the URL from each `DocLink` is checked against `WorkspaceDoc.mappings`. If a clone exists, the clone is used instead.
- **Writing to an existing file**: The file doc is cloned via `repo.clone()`, the mapping `originalUrl → cloneUrl` is recorded in the workspace, and the write goes to the clone. Subsequent writes to the same file reuse the existing clone.
- **Modifying a folder** (adding/removing files via `writeFile`, `mkdir`, `rm`, `linkDoc`): The parent folder is cloned via COW before mutation, same mechanism.
- **Creating new docs**: New files get `{ "@patchwork": { type: "file" } }` metadata. New folders get `{ "@patchwork": { type: "folder" } }`.
- **Reading**: Fully transparent — `readFile` and `listDir` go through `resolvePath` which resolves through the overlay automatically.

The COW helpers (`resolveOverlayUrl`, `getWritableHandle`) are private methods on `AutomergeFS`, so the LLM's eval context cannot access them — only the public FS API is exposed.

## Eval context APIs

Available inside `<script>` blocks:

- `fs.readFile(path)` → `Promise<string>`
- `fs.writeFile(path, content)` → `Promise<void>` (creates if missing, COW if existing)
- `fs.listDir(path)` → `Promise<{name, type}[]>`
- `fs.mkdir(path)` → `Promise<void>`
- `fs.rm(path)` → `Promise<void>` (unlinks from parent folder)
- `fs.linkDoc(path, automergeUrl, type?)` → `Promise<void>` — link an existing automerge doc into a folder
- `import("/automerge:docId/path")` → `Promise<module>` — native import via service worker
- `import("https://...")` → `Promise<module>` — import from URL
- `console.log(...)` — captured and returned as output to LLM (values are JSON-stringified)
- `return value` — return a value from the script block (included in output)

## UI features (LLMProcessUI.tsx)

- **Model selector**: Dropdown in config bar to switch between models (persisted in `doc.config.model`)
- **Per-task deletion**: Hover over a task header to reveal a delete button
- **Streaming output**: Text tokens are concatenated into a single growing text block (not one line per token)
- **In-progress indicator**: Spinner shown while waiting for first output on active task
- **Output blocks**: Script blocks and result blocks rendered as bordered cards with headers. Results show "output" (green) or "error" (red)
- **Clear context**: Empties all runs

## Skills

Skills are just folders in the Automerge filesystem:

```
skills/
  some-skill/
    README.md     ← agent reads for API docs
    index.js      ← agent imports via import("/automerge:<rootId>/skills/some-skill/index.js")
```

No registration. Agent discovers skills by listing `skills/` and reading READMEs.

## Config

- API key: read from `.env` as `VITE_LLM_API_KEY` (injected at build time, never in Automerge)
- API URL + model: stored in `LLMProcessDoc.config`, model switchable from UI
- Build: Vite with `vite-plugin-wasm` for the worker (bundles automerge + WASM)
- Main thread externals provided by patchwork bootloader
