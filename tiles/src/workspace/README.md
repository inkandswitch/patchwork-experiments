# Architecture: Workspace, LLM Process, and Chat

This document describes the three-datatype architecture for the patchwork AI
tooling layer.

## Overview

```
+------------------+
|      Chat        |  High-level conversation interface.
|                  |  Spawns an LLM Process per user prompt,
|                  |  threading context from prior processes.
+--------+---------+
         |
         | creates per prompt
         v
+------------------+
|   LLM Process    |  Single execution run against a workspace.
|                  |  Streams LLM responses, parses <script> blocks,
|                  |  executes code, iterates until done.
+--------+---------+
         |
         | references
         v
+------------------+
|    Workspace     |  Collection of documents and tools with
|                  |  per-entry access levels.
+------------------+
```

## Workspace

A workspace is a flat list of document and tool references, each assigned an
access level that controls how consumers interact with it.

### Access levels (most restrictive first)

| Level      | Read | Write                     | Use case                        |
|------------|------|---------------------------|---------------------------------|
| `read`     | Yes  | No (throws)               | Reference material, specs       |
| `reviewed` | Yes  | COW clone; merge required  | Source code, config files       |
| `full`     | Yes  | Direct to original         | Scratch files, logs             |

### Entry types

- **Document** (`type: 'document'`) -- any Automerge document (file, folder, etc.)
- **Tool** (`type: 'tool'`) -- a tool module referenced by URL + path

### Options

- `restrictToEntries` -- when `true`, `getWorkspaceRepo().find()` rejects any
  URL not explicitly listed in the workspace entries. When `false`, unknown URLs
  fall through to the underlying repo as read-only.

### Runtime: `getWorkspaceRepo()`

`getWorkspaceRepo(repo, workspaceDoc)` returns `{ workspaceRepo, changes }`:

- `workspaceRepo.find(url)` -- returns a handle wrapper whose `.change()`
  behavior depends on the entry's access level.
- `workspaceRepo.create()` -- creates a new document (tracked as an `added`
  change).
- `changes.getChanges()` -- lists all reviewed entries that were modified (COW
  clones) plus any newly created documents.
- `changes.mergeAll()` / `mergeSingle(url)` -- merges clones back into
  originals.
- `changes.revertSingle(url)` -- discards clone.

### UI

The workspace editor groups entries into three buckets stacked
most-restrictive-first (Read → Reviewed → Full Access). Dragging an entry
between buckets changes its access level. New entries dropped from patchwork
default to Read.

## LLM Process (planned)

A single LLM execution run. References a workspace and executes an iterative
agent loop:

1. Build messages from context (workspace entries, skills, task history)
2. Stream LLM completion
3. Parse `<script>` blocks from response
4. Execute scripts against `workspaceRepo`
5. Feed results back; repeat until done or max iterations

The LLM process document stores:
- Config (API URL, model, skills folder)
- Reference to a workspace URL
- Array of task runs (prompt + output blocks)

## Chat (planned)

The chat datatype manages a multi-turn conversation. Each user prompt spawns a
new LLM process that:

- Operates on the chat's workspace
- Receives context from all prior LLM processes in the conversation (their
  prompts, outputs, and script results)

This means the chat document stores:
- Reference to a workspace URL
- Ordered list of LLM process URLs (one per user message)
- Config inherited by spawned processes (model, API URL, etc.)

## File layout

```
tiles/src/
  workspace/
    types.ts            -- WorkspaceDoc, WorkspaceEntry, AccessLevel, change types
    datatype.ts         -- init, getTitle, setTitle
    workspace-repo.ts   -- getWorkspaceRepo() runtime wrapper
    mount.tsx           -- tool mount
    mount-datatype.ts   -- datatype mount
    components/
      WorkspaceUI.tsx   -- bucket-based entry management UI
  process/              -- (existing) LLM process implementation
    llm/                -- core engine: llm-process.ts, parser.ts, cow-repo.ts
    chat/               -- chat UI: LLMProcessUI.tsx, FilesView.tsx
  tldraw/               -- tldraw canvas integration
```
