# LLM Canvas

`llm-canvas` is a tool package that provides two complementary LLM-powered interfaces: a **Chat** UI for multi-turn conversations and a **Worker** UI for autonomous, reactive agent runs. Both share the same core streaming execution engine.

---

## Document types

The package revolves around four Automerge document types:

```
ChatDoc / WorkerDoc
  config: { apiUrl, model, skillsFolderUrl }
  workspaceUrl ──→ WorkspaceDoc
  processUrls[] ──→ ProcessDoc[]        ← one per run
  (WorkerDoc only)
    runMode: "auto" | "manual"
    autoInterval: number

ProcessDoc  (one per run)
  config, workspaceUrl, prompt
  history?: string          ← serialized prior runs (chat only)
  output: OutputBlock[]     ← live-streaming text + script results

WorkspaceDoc
  entries: WorkspaceEntry[] ← documents/tools with access level
  mappings?: WorkspaceChange[]  ← copy-on-write clone tracking
```

---

## Key files

| File | Role |
|---|---|
| `src/process/llm-process.ts` | Core engine — streaming loop, script eval, skill loading |
| `src/process/parser.ts` | Streaming `<script>` block parser (state machine) |
| `src/process/types.ts` | `ProcessDoc`, `OutputBlock`, `ParsedBlock`, `ChatMessage` |
| `src/process/components/ProcessView.tsx` | React UI that reactively renders a `ProcessDoc` as it streams |
| `src/chat/components/ChatUI.tsx` | Chat interface — creates `ProcessDoc`s, invokes `runLLMProcess` |
| `src/chat/serialize-process.ts` | Builds conversation history from prior `ProcessDoc` runs |
| `src/worker/components/WorkerUI.tsx` | Worker agent UI — auto/manual run modes, read/write drop zones |
| `src/workspace/workspace-repo.ts` | Copy-on-write `WorkspaceRepo` wrapper with access-level enforcement |
| `src/workspace/types.ts` | `WorkspaceDoc`, `WorkspaceEntry`, `WorkspaceChange`, `ActivityEvent` |

---

## The core engine: `runLLMProcess`

There are no browser Web Workers or Node worker threads. Everything runs in the main browser thread via async functions. `runLLMProcess` is the single shared entry point for both Chat and Worker:

```
runLLMProcess(repo, docUrl, signal?, options?)
  │
  ├─ Resolve ProcessDoc from Automerge
  ├─ Resolve WorkspaceDoc, wrap with getWorkspaceRepo() (COW + activity tracking)
  ├─ discoverSkills(repo, skillsFolderUrl)
  │    → reads Automerge FolderDoc tree, returns SkillInfo[]{ name, description, importUrl }
  │
  ├─ Expose on globalThis:
  │    globalThis.repo           ← COW-wrapped, access-enforced WorkspaceRepo
  │    globalThis.loadSkill      ← dynamic import by skill name
  │    globalThis.__llmCapturedConsole
  │
  └─ for (iteration = 0..19):
       buildLLMMessages(doc, ...)     ← construct OpenAI-style messages array
       streamChatCompletion(...)      ← POST to apiUrl, returns AsyncGenerator<string>
         └─ parseScriptBlocks(stream) ← yields ParsedBlock (text | script)
              │
              ├─ text blocks  → handle.change() appends to ProcessDoc.output
              ├─ script (partial) → handle.change() updates live code preview
              └─ script (complete):
                   evalScript(code)   ← eval("(async () => { ... })()")
                   handle.change() writes output/error to ProcessDoc
                   → continue to next iteration
       if no script found → break (LLM gave a final answer)
```

Each iteration represents one LLM turn. The loop continues as long as the model emits a `<script>` block to execute, enabling multi-step agentic behavior within a single run.

---

## Message construction

Messages use the standard OpenAI `{ role, content }` format. `buildLLMMessages` assembles them from the `ProcessDoc`:

```
[
  { role: "system",    content: SYSTEM_PROMPT + skillDescriptions + entryDescriptions + systemContextSuffix },
  { role: "user",      content: doc.prompt },
  { role: "user",      content: "Here is the history of previous runs:\n..." },  // if doc.history
  // then for each completed iteration already in doc.output:
  { role: "assistant", content: "...text...\n<script>...code...</script>" },
  { role: "user",      content: "[Output: ...]" | "[Error: ...]" | "[Done]" },
  // ...repeat for each prior iteration
]
```

The system prompt instructs the model to emit `<script>` tags (with an optional `data-description` attribute) when it needs to take an action. The scripts have access to `repo.find(url)`, `repo.create()`, `handle.change(fn)`, `loadSkill(name)`, and `console.log()`.

---

## Streaming pipeline

```
fetch (SSE stream)
  └─ streamChatCompletion          ← reads response.body, parses SSE data: lines
       └─ AsyncGenerator<string>   ← yields token chunks
            └─ parseScriptBlocks   ← state machine: "text" | "script"
                 │
                 ├─ ParsedBlock { type: "text",   complete: true  }
                 ├─ ParsedBlock { type: "script", complete: false, code: partial }
                 └─ ParsedBlock { type: "script", complete: true,  code: full    }
```

`streamChatCompletion` POSTs to `{apiUrl}/chat/completions` with `stream: true` and reads the response body with `getReader()` / `TextDecoder`, buffering partial SSE lines.

`parseScriptBlocks` (in `parser.ts`) is a two-state machine that scans the token stream for `<script ...>` / `</script>` boundaries. It yields incremental partial blocks as the script body accumulates (for live UI rendering), then a final complete block when the closing tag is seen. `findPartialTag()` prevents flushing text that might be the beginning of an opening tag at a chunk boundary.

---

## Live UI updates via Automerge

Every write during the streaming loop goes through `handle.change(fn)`, which produces an Automerge patch immediately visible to any React component subscribed via `useDocument<ProcessDoc>()`:

```
token arrives → parseScriptBlocks → handle.change() mutates ProcessDoc.output
  → Automerge patch applied
    → useDocument re-renders ProcessView
      → Markdown / ScriptBlockView renders the latest content
```

`updateText()` (from `@automerge/automerge-repo`) does character-level merging, enabling concurrent collaborative editing without conflicts even while a stream is in progress.

---

## The WorkspaceRepo: access control and copy-on-write

`getWorkspaceRepo()` wraps the raw `Repo` with a policy-enforcing facade. The returned object is assigned to `globalThis.repo` so LLM-eval'd scripts interact with it directly.

Each `WorkspaceEntry` carries one of three access levels:

| Level | Behavior |
|---|---|
| `read` | `.change()` throws immediately — the document is read-only |
| `reviewed` | First `.change()` call clones the document (copy-on-write); all mutations go to the clone; the original is untouched until the user explicitly merges |
| `full` | `.change()` writes directly to the live document |

`WorkspaceChanges` (tracked in `WorkspaceDoc.mappings[]`) records all clones and newly created documents. The Chat UI exposes these as clickable change badges after a run. `mergeAll()` / `mergeSingle()` replay the COW edits back onto the originals via `handle.merge(cloneHandle)`.

---

## Chat vs. Worker

Both surfaces use `runLLMProcess` identically. Their differences are behavioural:

| Aspect | Chat | Worker |
|---|---|---|
| **History** | Serializes prior `ProcessDoc`s into `doc.history` for multi-turn conversation | No history; each run is independent |
| **Workspace context** | Passes full entry list via `includeWorkspaceContext: true` | Passes explicit read/write file lists as `systemContextSuffix` |
| **Run trigger** | Manual only — user submits a prompt | Manual **or** Auto |
| **Auto mode** | — | Subscribes to Automerge `change` events on all entries; fires `handleRun` after a debounced `autoInterval` |
| **Re-run after write** | — | After each run, compares entry `heads()` before/after; if anything changed externally, re-runs immediately |
| **Workspace attachment** | User drag-drops items onto the input (added as `reviewed`) | Two explicit drop zones: Read (→ `read`) and Write (→ `full`) |

---

## Cancellation

An `AbortController` is the sole mechanism for stopping a running process. The `signal` is threaded through `runLLMProcess` → `streamChatCompletion` → `fetch()`. Aborting mid-stream leaves the `ProcessDoc` in whatever partial state it had accumulated.

---

## Skills

Skills are user-defined modules stored as Automerge folder documents (the same format as tool packages). `discoverSkills` walks the `skillsFolderUrl` folder tree, reads each `package.json` for a `description` field, and builds a `SkillInfo[]`. These descriptions are injected into the system prompt so the model knows which skills are available. When the model calls `loadSkill(name)`, the runtime does a dynamic `import()` of the skill's `index.js` bundle via the Automerge virtual filesystem.
