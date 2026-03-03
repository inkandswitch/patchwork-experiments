# LLM Canvas Architecture

LLM Canvas is a TLDraw-based canvas where you can embed Patchwork documents as tiles, run LLM agents, and build chat-driven workflows. It runs as a set of Patchwork plugins backed by Automerge for persistence and real-time collaboration.

## Directory structure

```
llm-canvas/src/
├── main.tsx              Aggregates all plugin arrays and re-exports them
├── tldraw/               TLDraw canvas (plugin id: "tile-canvas")
│   ├── index.ts          Plugin registration
│   ├── datatype.ts       TLDrawDoc schema and init
│   ├── mount.tsx         Tool mount — renders TldrawTool into a ToolElement
│   ├── mount-datatype.ts Datatype mount
│   ├── tool.tsx          TldrawTool component (Tldraw canvas wrapper)
│   ├── main.css          Styles (tldraw overrides, injected by vite)
│   ├── automerge/        Bidirectional TLDraw ↔ Automerge sync
│   │   ├── useAutomergeStore.ts   React hook: creates TLDraw store synced to Automerge
│   │   ├── AutomergeToTLStore.ts  Automerge patches → TLDraw store
│   │   └── TLStoreToAutomerge.ts  TLDraw changes → Automerge doc
│   └── EmbedShape/       Custom shape: embeds a Patchwork document as a tile
│       ├── EmbedShapeUtil.tsx   Shape geometry, component, tool picker
│       ├── EmbedShapeTool.tsx   Draw-to-create tool + EmbedToolbar
│       ├── EmbedShapeMenu.tsx   Datatype picker dropdown (portal)
│       └── index.ts             Barrel exports
├── process/              LLM process (plugin id: "process")
│   ├── index.ts
│   ├── datatype.ts       ProcessDoc schema and init
│   ├── mount.tsx / mount-datatype.ts
│   ├── tool-plugin.tsx   React mount function
│   ├── types.ts          ProcessDoc, OutputBlock, ChatMessage types
│   ├── llm-process.ts    LLM streaming loop, script eval, skill loading
│   ├── parser.ts         Streaming <script> block parser
│   └── components/ProcessView.tsx
├── chat/                 Chat interface (plugin id: "chat")
│   ├── index.ts
│   ├── datatype.ts       ChatDoc schema: config, workspaceUrl, processUrls
│   ├── mount.tsx / mount-datatype.ts
│   ├── tool-plugin.tsx
│   ├── types.ts          ChatDoc type
│   ├── serialize-process.ts  Build conversation history from process docs
│   └── components/ChatUI.tsx
├── worker/               Worker agent (plugin id: "worker")
│   ├── index.ts
│   ├── datatype.ts
│   ├── mount.tsx / mount-datatype.ts
│   ├── tool-plugin.tsx
│   └── types.ts
└── workspace/            Workspace doc browser (plugin id: "workspace")
    ├── index.ts
    ├── datatype.ts
    ├── mount.tsx / mount-datatype.ts
    ├── tool-plugin.tsx
    ├── types.ts           WorkspaceDoc, WorkspaceEntry, WorkspaceChanges
    ├── workspace-repo.ts  getWorkspaceRepo — wraps repo with COW tracking
    ├── README.md
    └── components/WorkspaceUI.tsx
```

## Plugin system

Each module's `index.ts` exports a `plugins` array using the `async load()` pattern. `main.tsx` aggregates them:

```ts
export const plugins = [
  ...tldrawPlugins,
  ...processPlugins,
  ...chatPlugins,
  ...workerPlugins,
  ...workspacePlugins,
];
```

Every plugin pair follows the same structure:

```ts
[
  {
    type: "patchwork:datatype",
    id: "<id>",
    name: "...",
    async load() { return (await import("./datatype.ts")).datatype; }
  },
  {
    type: "patchwork:tool",
    id: "<id>",
    supportedDatatypes: ["<id>"],
    async load() { return (await import("./mount.tsx")).default; }
  },
]
```

Implementations are loaded on demand — only when a document of that type is first opened.

### Registered plugins

| Type | ID | Module |
|------|----|--------|
| `patchwork:datatype` | `tile-canvas` | `tldraw/` |
| `patchwork:tool` | `tile-canvas` | `tldraw/` |
| `patchwork:datatype` | `process` | `process/` |
| `patchwork:tool` | `process` | `process/` |
| `patchwork:datatype` | `chat` | `chat/` |
| `patchwork:tool` | `chat` | `chat/` |
| `patchwork:datatype` | `worker` | `worker/` |
| `patchwork:tool` | `worker` | `worker/` |
| `patchwork:datatype` | `workspace` | `workspace/` |
| `patchwork:tool` | `workspace` | `workspace/` |

## Document models

**TLDrawDoc** — root document for a canvas:
```
TLDrawDoc
├── store: SerializedStore<TLRecord>   (all tldraw shapes/records)
└── schema: SerializedSchema           (tldraw schema version)
```

**ChatDoc** — a chat session:
```
ChatDoc
├── title: string
├── config: { apiUrl, model, skillsFolderUrl? }
├── workspaceUrl: AutomergeUrl         (associated WorkspaceDoc)
└── processUrls: AutomergeUrl[]        (ordered list of process runs)
```

**ProcessDoc** — a single LLM process run:
```
ProcessDoc
├── title, timestamp
├── config: { apiUrl, model, skillsFolderUrl? }
├── workspaceUrl: AutomergeUrl
├── prompt: string
├── history?: string                   (serialized prior runs)
└── output: OutputBlock[]              (text and script blocks with results)
```

**WorkspaceDoc** — the set of documents accessible to an LLM agent:
```
WorkspaceDoc
├── entries: WorkspaceEntry[]          (documents and tools by name)
└── restrictToEntries: boolean
```

## EmbedShape (`tldraw/EmbedShape/`)

A custom tldraw shape (`tile-embed`) that renders an embedded Patchwork document as a resizable tile on the canvas.

**Props**: `w`, `h`, `docUrl`, `docName`, `docType`, `toolId`

**Titlebar**: doc name on the left, tool name (clickable switcher) on the right. Unlisted tools are filtered out.

**Content**: renders `<patchwork-view doc-url="..." tool-id="...">`. Events (keyboard, wheel, pointer) are blocked from reaching tldraw while the tile is focused.

**EmbedShapeTool**: draw a rectangle to create a new document. On pointer-down a dashed preview rect appears; on pointer-up:
1. `EmbedShapeMenu` (a portal dropdown) was already used to pick a datatype
2. A placeholder `tile-embed` shape is created immediately
3. `createDocOfDatatype2` runs async to create the actual doc
4. The placeholder is replaced with the final shape; `toolId` is set to the first non-unlisted, type-specific tool for the chosen datatype (wildcards are deprioritised)

## LLM process engine (`process/llm-process.ts`)

`runLLMProcess()` drives a single agent run:

1. Loads `WorkspaceDoc` and wraps it with `getWorkspaceRepo()` for copy-on-write tracking
2. Discovers skills from `skillsFolderUrl` (see Skills section)
3. Exposes `repo`, `loadSkill(name)` on `globalThis` for script eval
4. Streams tokens from the LLM endpoint, parsing `<script>` blocks
5. Evals each complete script block, captures console output and return value
6. Feeds results back as user messages and repeats (up to 20 iterations)
7. Returns a `RunResult` with the `WorkspaceChanges` tracker

## Skills (`llm-skills/`)

Skills are plain JavaScript modules that the LLM can load at runtime via `await loadSkill("name")`. They live in the top-level `llm-skills/` package (separate from `llm-canvas/`) and are synced to an Automerge folder via `pushwork sync`.

Each skill is a sub-folder containing:
- `SKILL.md` — YAML frontmatter (`name`, `description`) + usage docs
- `index.js` — the skill implementation (plain ESM, no build step)

Discovery at runtime (`discoverSkills`):
1. Opens the `skillsFolderUrl` Automerge folder
2. For each sub-folder, reads `SKILL.md` frontmatter and finds `index.js`
3. Constructs an `importUrl` of the form `/<skillsFolderUrl>/<folderName>/index.js` (served by the patchwork service worker)

Available skills: `folder`, `markdown-file`, `search`, `create-patchwork-tool`

## Automerge sync (`tldraw/automerge/`)

Bidirectional sync between TLDraw's in-memory store and the Automerge document:

```
TLDraw store ──(user changes)──→ applyTLStoreChangesToAutomerge() ──→ Automerge doc
TLDraw store ←──(remote patches)── applyAutomergePatchesToTLStore() ←── Automerge doc
```

A `preventPatchApplications` flag prevents feedback loops. Collaborative presence (cursors) is synced via Automerge awareness.

## Version number

`tool.tsx` exports a `VERSION` constant (e.g. `"0.0.2"`) that is:
- Logged to the console on mount (`[llm-canvas] version X.Y.Z`)
- Displayed as a small badge in the bottom-left corner of the canvas via `InFrontOfTheCanvas`

**Bump `VERSION` whenever you make a meaningful change** so it is easy to confirm which build is running in the host app.

## Build

Vite builds a single entry point:

| Entry | Output |
|-------|--------|
| `src/main.tsx` | `dist/main.js` |

All sub-module implementations are dynamically imported via the `async load()` functions in each `index.ts` — they become separate Rollup chunks. CSS is injected into JS via `vite-plugin-css-injected-by-js`.

External dependencies (`@automerge/*`, `@inkandswitch/*`, `react`, `react-dom`) are excluded from the bundle and resolved at runtime by the host application.
