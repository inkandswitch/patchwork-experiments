# Architecture: Workspace, Process, Chat, and Worker

This document describes the four-datatype architecture for the patchwork AI
tooling layer.

## Overview

```
+------------------+     +------------------+
|      Chat        |     |     Worker       |
|  (multi-turn)    |     |  (fixed prompt)  |
+--------+---------+     +--------+---------+
         |                         |
         | creates per prompt      | creates per click
         v                         v
+------------------------------------------+
|              ProcessDoc                   |
|          (single LLM run)                 |
+--------------------+---------------------+
                     |
                     | uses at runtime
                     v
+------------------------------------------+
|            WorkspaceDoc                   |
|  (documents + tools with access levels)  |
+------------------------------------------+
```

## Workspace

A flat list of document and tool references, each with an access level.

### Access levels (most restrictive first)

| Level      | Read | Write                     | Use case                        |
|------------|------|---------------------------|---------------------------------|
| `read`     | Yes  | No (throws)               | Reference material, specs       |
| `reviewed` | Yes  | COW clone; merge required  | Source code, config files       |
| `full`     | Yes  | Direct to original         | Scratch files, logs             |

### Options

- `restrictToEntries` -- when true, `getWorkspaceRepo().find()` rejects URLs
  not in the workspace entries.

### Runtime: `getWorkspaceRepo()`

Returns `{ workspaceRepo, changes }` where the repo wrapper enforces access
levels and changes tracks reviewed modifications for merge/revert.

## Process

A single LLM execution run. One document = one prompt + one output sequence.

### ProcessDoc schema

- `prompt` -- the user's instruction
- `history` -- optional serialized transcript of prior runs (set by chat)
- `output` -- array of text and script output blocks
- `workspaceUrl` -- reference to the workspace
- `config` -- API URL, model, skills folder

### Execution loop

1. Load workspace, create `workspaceRepo` via `getWorkspaceRepo()`
2. Build messages: system prompt + prompt + history + partial output
3. Stream LLM completion, parse `<script>` blocks
4. Execute scripts against `workspaceRepo`
5. Feed results back; repeat until no scripts or max iterations

## Chat

Multi-turn conversation. Each user message spawns a new Process.

### ChatDoc schema

- `config` -- inherited by spawned processes
- `workspaceUrl` -- shared workspace
- `processUrls` -- ordered list of ProcessDoc URLs

### History threading

Before each new process, chat serializes all prior processes into a `history`
string using `serializeProcess()` + `buildHistory()`. This gives each process
full conversational context.

### UI

Two tabs: Chat (process list + input) and Workspace (embedded WorkspaceUI).

## Worker

Repeatable single-prompt runner. Same prompt runs each time.

### WorkerDoc schema

- `prompt` -- the fixed prompt (editable, reused across runs)
- `config`, `workspaceUrl`, `processUrls` -- same as chat

### Key difference from Chat

Worker does NOT set `history` on spawned processes. Each run is independent.

### UI

Two tabs: Worker (prompt editor + run history) and Workspace.
Latest run is always expanded; previous runs are collapsed with click-to-expand.

## File layout

```
llm-canvas/src/
  process/
    types.ts              -- ProcessDoc, OutputBlock, ParsedBlock, ChatMessage
    datatype.ts           -- init, getTitle, setTitle
    llm-process.ts        -- execution engine
    parser.ts             -- streaming script parser
    mount.tsx / mount-datatype.ts / tool-plugin.tsx
    components/
      ProcessView.tsx     -- embeddable output renderer

  chat/
    types.ts              -- ChatDoc
    datatype.ts           -- init (creates workspace), getTitle, setTitle
    serialize-process.ts  -- serializeProcess() + buildHistory()
    mount.tsx / mount-datatype.ts / tool-plugin.tsx
    components/
      ChatUI.tsx          -- Chat + Workspace tabs

  worker/
    types.ts              -- WorkerDoc
    datatype.ts           -- init (creates workspace), getTitle, setTitle
    mount.tsx / mount-datatype.ts / tool-plugin.tsx
    components/
      WorkerUI.tsx        -- Worker + Workspace tabs

  workspace/
    types.ts              -- WorkspaceDoc, WorkspaceEntry, AccessLevel
    datatype.ts           -- init, getTitle, setTitle
    workspace-repo.ts     -- getWorkspaceRepo() runtime wrapper
    mount.tsx / mount-datatype.ts / tool-plugin.tsx
    components/
      WorkspaceUI.tsx     -- bucket-based entry management

  tldraw/                 -- tldraw canvas integration (unchanged)
```
