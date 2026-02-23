# Tiles Architecture

Tiles is a TLDraw-based canvas where documents and tools become material objects you can arrange, connect, and process. It runs as a Patchwork plugin backed by Automerge for persistence and real-time collaboration.

## High-level structure

```
tiles/src/
├── main.tsx                  Plugin entry point (registers datatype + tool)
├── datatype.ts               TilesDoc schema, init, title management
├── tool.tsx                  TilesTool component (Tldraw canvas wrapper)
├── main.css                  Styles (tldraw overrides)
├── PatchworkTokenShape.tsx   Token shapes (doc rectangles + tool diamonds)
├── PatchworkViewShape.tsx    View shapes (doc+tool rendered via <patchwork-view>)
├── automerge/                Bidirectional TLDraw ↔ Automerge sync
│   ├── useAutomergeStore.ts  React hook: creates TLDraw store synced to Automerge
│   ├── AutomergeToTLStore.ts Automerge patches → TLDraw store
│   ├── TLStoreToAutomerge.ts TLDraw changes → Automerge doc
│   └── index.ts              Automerge doc initialization
└── process/                  LLM process engine (self-contained, no external imports)
    ├── types.ts              WorkspaceDoc, LLMProcessDoc, entry types
    ├── fs.ts                 AutomergeFS: flat workspace + deep COW + snapshot
    ├── llm-process.ts        LLM streaming loop, script eval, message building
    ├── parser.ts             Streaming <script> block parser
    └── LLMProcessShape.tsx   TLDraw shape: drop zone, prompt, output, change summary
```

## Document model

**TilesDoc** is the root Automerge document for a canvas. It stores a serialized TLDraw store (all shapes, pages, assets) and schema version.

```
TilesDoc
├── store: SerializedStore<TLRecord>   (all tldraw shapes/records)
└── schema: SerializedSchema           (tldraw schema version)
```

## Patchwork plugin system

`main.tsx` exports two plugins:
- **Datatype plugin** (`tiles`): defines how to create/init a TilesDoc
- **Tool plugin** (`tiles`): renders the TLDraw canvas for a TilesDoc

The tool plugin lazy-loads `TilesTool` which sets up a `<Tldraw>` instance with custom shape utils and bidirectional Automerge sync.

## Custom shapes

### PatchworkTokenShape (`patchwork-token`)
Small draggable chips representing documents (rounded rectangles) or tools (diamond/hexagon shapes). Carry serialized drag-and-drop data. Can be dropped onto view shapes or process shapes to assign a doc/tool.

### PatchworkViewShape (`patchwork-view`)
Resizable container with a header (doc + tool token slots) and a body that renders a `<patchwork-view>` custom element when both doc and tool are assigned. Supports drag-in preview and drag-out to extract tokens.

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
