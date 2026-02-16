# code-agent

A minimal coding agent that runs in a browser SharedWorker. The LLM's output is text interleaved with `<script>` blocks that get evaluated incrementally. It operates on an Automerge-based filesystem and can import skills (folders with a README + JS SDK).

## Architecture

```
Main Thread (AgentUI.tsx)              SharedWorker (agent-worker.ts)
┌─────────────────────┐                ┌──────────────────────────┐
│  React UI            │                │  Own Automerge Repo       │
│  useDocument() ◄─────┼── automerge ──►│  (synced via MessagePort) │
│                      │    sync        │                          │
│  task input ─────────┼── postMessage ─►│  Agent Loop:             │
│  status display ◄────┼── postMessage ──┤   1. Call LLM (stream)   │
│                      │                │   2. Parse <script> tags  │
└─────────────────────┘                │   3. eval() in worker     │
                                       │   4. Write output to doc  │
                                       │   5. Repeat if script ran │
                                       │                          │
                                       │  Globals for eval:        │
                                       │   fs    - AutomergeFS     │
                                       │   console - captured      │
                                       └──────────────────────────┘
```

The worker has its own `Repo` connected to the main thread's repo via `MessageChannelNetworkAdapter`. All output is written to the `LLMProcessDoc` Automerge doc; the UI re-renders automatically via `useDocument()`. No custom streaming protocol — Automerge is the communication channel.

## LLMProcessDoc schema (types.ts)

```typescript
type LLMProcessDoc = {
  title: string;
  config: {
    apiUrl: string; // OpenAI-compatible endpoint
    model: string; // e.g. "gpt-4o"
  };
  rootFolderUrl: AutomergeUrl;
  runs: TaskRun[]; // all task runs, most recent last
};

type TaskRun = {
  task: string; // user's instruction
  output: OutputBlock[]; // appended by worker as it runs
  timestamp: number;
};

type OutputBlock =
  | { type: 'text'; content: string }
  | { type: 'script'; code: string }
  | { type: 'result'; output?: string; error?: string };
```

Task lifecycle: user writes a task → pushed as new `TaskRun` → worker streams output into `output[]` → done. Prior runs stay in `runs[]` and are fed to the LLM as context. Clear context = empty `runs[]`.

## Files

| File                  | Purpose                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`        | All shared types: `LLMProcessDoc`, `TaskRun`, `OutputBlock`, worker message protocol                                                                                               |
| `src/datatype.ts`     | Patchwork datatype registration (`LLMProcessDatatype`) with init defaults                                                                                                          |
| `src/index.ts`        | Plugin exports: `patchwork:tool` (id: "code-agent") + `patchwork:datatype` (id: "llm-process")                                                                                     |
| `src/AgentUI.tsx`     | React component. Creates SharedWorker on mount, wires MessageChannel for Automerge sync, renders runs/output, provides task input                                                  |
| `src/agent-worker.ts` | SharedWorker entry. Creates its own Repo, runs the agent loop (LLM → parse → eval → feedback), injects `fs`/`console` as worker globals                                            |
| `src/parser.ts`       | Simple `<script>`/`</script>` state machine. Async generator over a token stream, yields `{type:"text"}` or `{type:"script"}` blocks                                               |
| `src/fs.ts`           | `AutomergeFS` class. Wraps Automerge docs as a filesystem: `readFile`, `writeFile`, `listDir`, `mkdir`, `rm`, `linkDoc`. Resolves paths by walking `FolderDoc.docs` arrays          |
| `src/styles.css`      | Tailwind import                                                                                                                                                                    |

## Agent loop (agent-worker.ts)

```
for each iteration (max 20):
  1. Read LLMProcessDoc, build messages from all runs
  2. Call LLM streaming endpoint (OpenAI-compatible)
  3. Feed tokens through parseScriptBlocks()
  4. Text blocks → appended to doc.runs[last].output
  5. When <script> closes:
     a. Append script block to output
     b. eval() wrapped in async IIFE: `(async () => { ...code... })()`
     c. Capture console output, return value, + errors
     d. Append result block to output
     e. Break parse loop, start new LLM call (so LLM sees the result)
  6. If no script found → agent is done
```

The eval context has persistent globals on the worker's `self`: `fs` (AutomergeFS), `console` (captured). Variables declared with `var` persist across script blocks (REPL behavior). The LLM can use `return` to produce a value from a script block. Modules are imported via native `import()` — the platform service worker handles `automerge:` protocol URLs.

## Eval context APIs

Available inside `<script>` blocks:

- `fs.readFile(path)` → `Promise<string>`
- `fs.writeFile(path, content)` → `Promise<void>` (creates if missing)
- `fs.listDir(path)` → `Promise<{name, type}[]>`
- `fs.mkdir(path)` → `Promise<void>`
- `fs.rm(path)` → `Promise<void>` (unlinks from parent folder)
- `fs.linkDoc(path, automergeUrl, type?)` → `Promise<void>` — link an existing automerge doc into a folder
- `import("/automerge:docId/path")` → `Promise<module>` — native import via service worker
- `import("https://...")` → `Promise<module>` — import from URL
- `console.log(...)` — captured and returned as output to LLM
- `return value` — return a value from the script block (included in output)

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
- API URL + model: stored in `LLMProcessDoc.config`
- Build: Vite with `vite-plugin-wasm` for the worker (bundles automerge + WASM)
- Main thread externals provided by patchwork bootloader
