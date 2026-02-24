# Tiles Architecture

Tiles is a TLDraw-based canvas where documents and tools become material objects you can arrange, connect, and process. It runs as a Patchwork plugin backed by Automerge for persistence and real-time collaboration.

## High-level structure

```
tiles/src/
├── main.tsx                  Plugin descriptions (importPath references)
├── mount.tsx                 Tool mount: renders TilesTool into a ToolElement
├── mount-datatype.ts         Datatype mount: re-exports datatype implementation
├── datatype.ts               TilesDoc schema, init, title management
├── tool.tsx                  TilesTool component (Tldraw canvas wrapper)
├── NewDocTool.tsx            Tldraw tool: draw-to-create new Patchwork documents
├── main.css                  Styles (tldraw overrides)
├── PatchworkTokenShape.tsx   Token shapes (doc rectangles + tool diamonds)
├── PatchworkViewShape.tsx    View shapes (doc+tool rendered via <patchwork-view>)
├── automerge/                Bidirectional TLDraw ↔ Automerge sync
│   ├── useAutomergeStore.ts  React hook: creates TLDraw store synced to Automerge
│   ├── AutomergeToTLStore.ts Automerge patches → TLDraw store
│   └── TLStoreToAutomerge.ts TLDraw changes → Automerge doc
└── process/                  LLM process engine
    ├── mount.tsx             Tool mount: re-exports llmProcessToolImpl
    ├── mount-datatype.ts     Datatype mount: re-exports llmProcessDatatype
    ├── datatype.ts           LLMProcessDoc init, title management
    ├── tool-plugin.tsx       React mount function for LLMProcessInner
    ├── types.ts              WorkspaceDoc, LLMProcessDoc, entry types
    ├── fs.ts                 AutomergeFS: flat workspace + deep COW + snapshot
    ├── llm-process.ts        LLM streaming loop, script eval, message building
    ├── parser.ts             Streaming <script> block parser
    ├── LLMProcessShape.tsx   TLDraw shape: drop zone, prompt, output, change summary
    └── LLMProcessUI.tsx      React UI for the LLM process panel
```

## Plugin system

Tiles uses the `importPath` plugin format. `main.tsx` exports a `plugins` array of plain description objects — no `load()` functions, no runtime imports. Each description has an `importPath` pointing to a built mount file:

```
main.tsx (plugin descriptions)
  ├── ./dist/mount.js          → mount.tsx (tiles tool)
  ├── ./dist/mount-datatype.js → mount-datatype.ts (tiles datatype)
  ├── ./dist/mount-process.js  → process/mount.tsx (LLM process tool)
  └── ./dist/mount-process-datatype.js → process/mount-datatype.ts (LLM process datatype)
```

The host app's `ModuleWatcher` imports `main.js`, reads the descriptions, resolves each `importPath` against the package's base URL to produce a fully-qualified `importUrl`, and registers them in the `PluginRegistry`. Implementations are loaded on demand via `import(importUrl)`.

### Four plugins registered

| Type | ID | Mount file |
|------|----|-----------|
| `patchwork:datatype` | `tiles` | `mount-datatype.ts` → `datatype.ts` |
| `patchwork:tool` | `tiles` | `mount.tsx` → `tool.tsx` |
| `patchwork:datatype` | `llm-process` | `process/mount-datatype.ts` → `process/datatype.ts` |
| `patchwork:tool` | `llm-process` | `process/mount.tsx` → `process/tool-plugin.tsx` |

## Document model

**TilesDoc** is the root Automerge document for a canvas. It stores a serialized TLDraw store (all shapes, pages, assets) and schema version.

```
TilesDoc
├── store: SerializedStore<TLRecord>   (all tldraw shapes/records)
└── schema: SerializedSchema           (tldraw schema version)
```

## Custom shapes

### PatchworkTokenShape (`patchwork-token`)

Small draggable chips representing documents (rounded rectangles) or tools (diamond/hexagon shapes). Carry serialized drag-and-drop data. Can be dropped onto view shapes or process shapes to assign a doc/tool.

### PatchworkViewShape (`patchwork-view`)

Resizable container with a header (doc + tool token slots) and a body that renders a `<patchwork-view>` custom element when both doc and tool are assigned. Supports drag-in preview and drag-out to extract tokens. A `ViewBody` wrapper shields interactive events from tldraw when the shape is in edit mode.

### LLMProcessShape (`llm-process`)

Resizable shape that runs an LLM coding agent. Layout:

```
┌─────────────────────────────────────┐
│ [doc tile] [tool tile] ...          │  Input zone: drag tokens in
├─────────────────────────────────────┤
│ Prompt / streaming output           │  Combined prompt+output area
│                                     │
│ [Run] / [Stop]                      │
├─────────────────────────────────────┤
│ Changed: [doc-A ●] [myTool/ ●]     │  Results summary
└─────────────────────────────────────┘
```

Auto-creates an `LLMProcessDoc` + `WorkspaceDoc` on first render.

## NewDocTool

A tldraw toolbar tool that lets users draw a rectangle to create a new Patchwork document. It queries the `PluginRegistry` for registered datatypes, presents them in a dropdown, and on pointer-up:

1. Looks up the `DatatypeDescription` via `registry.get(id)`
2. Calls `createDocOfDatatype2(description, repo)` which imports the datatype implementation via `importUrl` and initializes the document
3. Finds a compatible tool via `registry.filter()` on the tool registry
4. Updates the PatchworkView shape with the new `docUrl` and `toolId`

## LLM process engine (`process/`)

### WorkspaceDoc

Flat list of entries (no root folder):

```
WorkspaceDoc
├── entries: WorkspaceEntry[]    Unified list of docs + tools
│   ├── DocReference  { name, url, type: 'document' }
│   └── ToolReference { name, url, path, type: 'tool' }
├── mappings: Record<url, MappingEntry>   COW overlay
└── createdUrls: AutomergeUrl[]           New docs created during run
```

### AutomergeFS

Filesystem API backed by the WorkspaceDoc. Key design:

- **Flat top-level**: entries looked up by name, not by path from a root folder
- **Deep access**: any entry can be a folder; `readFile(name, path)` and `listFolder(name, path)` navigate into folder hierarchies
- **Copy-on-write**: all writes clone the target doc. For nested writes, all intermediate folders are cloned too (deep COW), creating a new folder chain from leaf to root
- **Snapshot (not merge)**: `snapshot(name)` returns URL-with-heads; `snapshotFolder(name)` deep-clones a folder tree. No merge-back into originals
- **Change tracking**: `mappings` = modified originals, `createdUrls` = new files

### LLM loop

`runLLMProcess()` streams tokens from an OpenAI-compatible endpoint, parses `<script>` blocks, evals them with `fs` in scope, feeds results back, and repeats (up to 20 iterations). All state is written to the `LLMProcessDoc.runs[]` array via Automerge.

## Automerge sync

Bidirectional sync between TLDraw's in-memory store and the Automerge document:

```
TLDraw store ──(user changes)──→ applyTLStoreChangesToAutomerge() ──→ Automerge doc
TLDraw store ←──(remote patches)── applyAutomergePatchesToTLStore() ←── Automerge doc
```

A `preventPatchApplications` flag prevents feedback loops. Collaborative presence is synced via Automerge awareness.

## Build

Vite builds five entry points into `dist/`:

| Entry | Output | Purpose |
|-------|--------|---------|
| `src/main.tsx` | `dist/main.js` | Plugin descriptions (loaded first, tiny) |
| `src/mount.tsx` | `dist/mount.js` | Tiles tool impl (includes tldraw CSS via `cssInjectedByJsPlugin`) |
| `src/mount-datatype.ts` | `dist/mount-datatype.js` | Tiles datatype impl |
| `src/process/mount.tsx` | `dist/mount-process.js` | LLM process tool impl |
| `src/process/mount-datatype.ts` | `dist/mount-process-datatype.js` | LLM process datatype impl |

External dependencies (`@automerge/*`, `@inkandswitch/*`, `react`, `react-dom`) are excluded from the bundle and resolved at runtime by the host app.

## Version number

The `VERSION` constant in `tool.tsx` is displayed in the top-right corner of the canvas. Bump it (patch increment) with every edit so that the running build can be visually confirmed as up to date.
