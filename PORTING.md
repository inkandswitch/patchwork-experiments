# Porting tools from patchwork-extra to patchwork-tools

Notes for moving Patchwork 1.x tools (`patchwork-extra`, `@patchwork/sdk`) to Patchwork 2.0 / tiny-patchwork standards (`patchwork-tools`, `@inkandswitch/patchwork-plugins`).

Target stack: Patchwork-next / tiny-patchwork (gaios, etc.). See [README.md](./README.md).

---

## Quick checklist

Use this as a per-tool punch list. Order matters for the first few steps.

1. **Copy the module folder** into `patchwork-tools/<tool-name>/` (keep the same folder name if possible).
2. **Keep plugin IDs unchanged** — `patchwork:datatype` id, `patchwork:tool` id(s), and `supportedDatatypes` values must match the old module so existing documents keep working.
3. **Replace SDK imports** — `@patchwork/sdk` → `@inkandswitch/patchwork-plugins` (and related `@inkandswitch/*` packages as needed).
4. **Rewrite the tool entrypoint** — `{ EditorComponent }` / `EditorProps` → `ToolRender` with manual `createRoot`.
5. **Simplify the datatype** — `DataTypeImplementation` → `DatatypeImplementation`; drop version-control hooks from the datatype (see below).
6. **Update `package.json`** — new deps, `sync`/`register` scripts, remove `file:../../patchwork/sdk`.
7. **Update `vite.config.ts`** — use `@inkandswitch/patchwork-bootloader/externals`.
8. **Add `tsconfig.json`** if missing (see template below).
9. **`pnpm install && pnpm build`** in the tool directory; fix type errors.
10. **`pnpm sync`** then **`pnpm register`** (or add the module URL to layout doc manually).
11. **Smoke-test** — create doc, open existing doc, edit collaboratively, reload.

---

## What changed (mental model)

| Concern | patchwork-extra (old) | patchwork-tools (new) |
|--------|------------------------|------------------------|
| Plugin types | `@patchwork/sdk` | `@inkandswitch/patchwork-plugins` |
| Tool render | React component via `EditorProps` | Imperative `ToolRender(handle, element) → cleanup` |
| Tool load return | `{ EditorComponent: Foo }` | The render function itself |
| Field name | `supportedDataTypes` | `supportedDatatypes` (lowercase **t**) |
| Doc type marker | Often implicit / title only | `@patchwork: { type: "<datatype-id>" }` on docs (set by host on create; safe to set in `init` too) |
| Datatype `init` | `init(doc)` via `initFrom()` | `init(doc, repo)` — mutate `doc` directly |
| Shared deps | `@patchwork/sdk/shared-dependencies` | `@inkandswitch/patchwork-bootloader/externals` |
| UI kit | `@patchwork/sdk/ui` (shadcn wrappers) | Tailwind/daisyUI, plain HTML, or local stubs |
| Version control | Hooks on datatype (`patchesToAnnotations`, etc.) | `@inkandswitch/annotations-*` inside the tool (optional, per-tool) |
| Deploy | `pushwork sync` | `pnpm sync` (= build + pushwork sync) |

Each tool folder must remain **independently buildable** with no imports from sibling tool folders.

---

## File layout (standard)

```
my-tool/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore          # dist/, node_modules/
└── src/
    ├── index.ts        # exports `plugins`
    ├── datatype.ts     # doc schema + DatatypeImplementation
    ├── tool.tsx        # ToolRender + React UI (or tool.ts for non-React)
    ├── index.css       # optional
    └── …               # components, actions, skills, etc.
```

`src/index.ts` always exports:

```ts
import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  { type: 'patchwork:datatype', id: '…', … },
  { type: 'patchwork:tool', id: '…', supportedDatatypes: ['…'], … },
  // optional: patchwork:action, patchwork:skill
];
```

---

## Datatype port

### Old (patchwork-extra)

```ts
import { type DataTypeImplementation, initFrom } from '@patchwork/sdk';
import { HasVersionControlMetadata } from '@patchwork/sdk/versionControl';

export type Doc = HasVersionControlMetadata<…> & { title: string; … };

export const init = (doc: Doc) => {
  initFrom(doc, { title: '…', … });
};

export const dataType: DataTypeImplementation<Doc, Anchor> = {
  init, getTitle, setTitle, markCopy,
  includeChangeInHistory,
  includePatchInChangeGroup,
  patchesToAnnotations,
  promptForAIChangeGroupSummary,
};
```

### New (patchwork-tools)

```ts
import type { Repo } from '@automerge/automerge-repo';
import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';

export type MyDoc = {
  '@patchwork'?: { type: 'my-tool' };
  title: string;
  // …
};

export const MyDatatype: DatatypeImplementation<MyDoc> = {
  init(doc: MyDoc, _repo: Repo) {
    doc.title = 'Untitled';
    // …
  },
  getTitle(doc) {
    return doc.title || 'My Tool';
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
```

**Changes:**

- Drop `initFrom` — assign fields on `doc` directly.
- Drop `HasVersionControlMetadata`, `markCopy`, and all version-control hooks from the datatype. Patchwork 2.0 does not call these on `DatatypeImplementation` today.
- `init` now receives `repo` (use for `repo.create()` if the tool creates linked docs on init).
- Naming convention: export `FooDatatype` (PascalCase), not `dataType`.
- **Do not rename the datatype `id`** in `index.ts` — existing Automerge docs key off `@patchwork.type`.

### Version control / diff annotations (optional follow-up)

Old tools (e.g. **datagrid**) pushed diff logic into the datatype. New tools wire this in the UI layer:

- `@inkandswitch/annotations-context` — register annotation sets
- `@inkandswitch/annotations-diff` — highlight changes (`Diff` class)
- `@inkandswitch/annotations-selection` — selection highlights
- `@inkandswitch/annotations-comments` — comment threads anchored to refs

See `todo/src/Todo.tsx` and `datalog/src/tool.tsx` for working examples. Porting VC hooks is **not required** for initial bring-over; defer unless the tool depends on history UI.

---

## Tool port (React)

### Old pattern

```tsx
import { EditorProps } from '@patchwork/sdk';

export const MyTool: React.FC<EditorProps<MyDoc, string>> = ({
  docUrl,
  annotations = [],
}) => {
  const [doc, changeDoc] = useDocument<MyDoc>(docUrl);
  // …
};

// index.ts load():
return { EditorComponent: MyTool };
```

### New pattern

```tsx
import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';

function MyEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<MyDoc>(docUrl);
  // … same UI as before …
}

export const MyTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <MyEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// index.ts load():
return MyTool;
```

**Changes:**

- Wrap with `RepoContext.Provider` so hooks see the repo.
- Return an **unmount cleanup** from `ToolRender`.
- `annotations` prop is gone — subscribe via `@inkandswitch/annotations-context` if needed.
- Prefer `handle.change()` or `useDocument`'s `changeDoc` — both work; datagrid used `useDocHandle` + `handle.change` before, either is fine.
- Inner editor can stay a normal React component; only the outer shell changes.

### Non-React tools

Some tools (e.g. `file/`, vanilla-DOM chat tools) mount with DOM APIs inside `ToolRender`. Same signature: `(handle, element) => cleanup`.

---

## index.ts port

```ts
// OLD
import { type Plugin } from '@patchwork/sdk';
export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    supportedDataTypes: ['datagrid'],  // ← capital T
    async load() {
      const { tool } = await import('./tool');
      return tool;  // { EditorComponent }
    },
  },
];

// NEW
import type { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:datatype',
    id: 'datagrid',
    name: 'Spreadsheet',
    icon: 'Sheet',
    async load() {
      const { DatagridDatatype } = await import('./datatype');
      return DatagridDatatype;
    },
  },
  {
    type: 'patchwork:tool',
    id: 'datagrid',
    name: 'Spreadsheet',
    icon: 'Sheet',
    supportedDatatypes: ['datagrid'],  // ← lowercase t
    async load() {
      const { DatagridTool } = await import('./tool');
      return DatagridTool;
    },
  },
];
```

Use `satisfies Tool` / `as Datatype` if you want stricter typing (see `mergecraft`, `geolog`).

---

## package.json

Template (adjust name and deps):

```json
{
  "name": "@patchwork/my-tool",
  "version": "0.0.1",
  "type": "module",
  "exports": "./dist/index.js",
  "scripts": {
    "build": "tsc && vite build",
    "sync": "pnpm build && pushwork sync",
    "register": "pw-modules add \"$MODULE_SETTINGS_DOC_URL\" \"$(pushwork url)\""
  },
  "dependencies": {
    "@automerge/automerge": "3.2.1",
    "@automerge/automerge-repo": "2.5.0",
    "@automerge/automerge-repo-react-hooks": "2.5.0",
    "@inkandswitch/patchwork-plugins": "^0.0.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@inkandswitch/patchwork-bootloader": "^0.0.3",
    "@types/react": "^18.3.23",
    "@types/react-dom": "^18.3.7",
    "@vitejs/plugin-react": "^4.5.1",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vite-plugin-css-injected-by-js": "^3.5.2",
    "vite-plugin-top-level-await": "^1.5.0",
    "vite-plugin-wasm": "^3.4.1"
  }
}
```

Notes:

- Package names vary: `@patchwork/*` and `@tiny-patchwork/*` both appear. Match siblings you're deploying alongside.
- Remove `"@patchwork/sdk": "file:../../patchwork/sdk"`.
- Add `@inkandswitch/patchwork-bootloader` as devDependency (for externals list).
- **React tools:** filter `@automerge/automerge-repo-react-hooks` from `external` and alias `react`/`react-dom` to a single copy (see `datagrid/vite.config.ts`). Otherwise large bundled deps can cause a dual-React crash at runtime.
- Keep tool-specific deps (Handsontable, AG Grid, etc.) in `dependencies`.
- Automerge versions: align with other tools in this repo when possible.

---

## vite.config.ts

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import topLevelAwait from 'vite-plugin-top-level-await';
import wasm from 'vite-plugin-wasm';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import external from '@inkandswitch/patchwork-bootloader/externals';

export default defineConfig({
  base: './',
  plugins: [topLevelAwait(), wasm(), react(), cssInjectedByJsPlugin()],
  build: {
    rollupOptions: {
      external,
      input: './src/index.ts',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
      preserveEntrySignatures: 'strict',
    },
  },
});
```

- **`external`** is critical — React, Automerge, and patchwork packages are provided by the host import map; bundling them breaks loading.
- Use `vite-plugin-css-injected-by-js` so CSS from libraries (Handsontable, AG Grid) ships with the bundle.
- Add `@tailwindcss/vite` plugin if the tool uses Tailwind v4 (see `mergecraft`, `unconference`).
- Some tools set `minify: false` for easier debugging (`notes`).

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "allowJs": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

---

## UI components (`@patchwork/sdk/ui`)

The old shadcn-based `@patchwork/sdk/ui` (`Button`, `Select`, etc.) is **not** available in patchwork-tools.

Options:

1. **Plain HTML + Tailwind/daisyUI** — preferred for new work (`unconference`, `todo`).
2. **Local stubs** — see `lighterpack/src/ui.tsx` for minimal `Button`/`Input` stand-ins that accept the same prop names.
3. **Copy only what you need** into the tool folder.

---

## Optional plugin types (new capabilities)

Beyond datatype + tool:

| Type | Purpose | Example |
|------|---------|---------|
| `patchwork:action` | Programmatic doc mutations (AI / commands) | `notes/src/actions.ts` |
| `patchwork:skill` | Agent skill docs + API | `todo/src/index.ts` |

These are additive — not required for porting.

---

## Deploy and register

```bash
cd patchwork-tools/my-tool
pnpm install
pnpm build
pnpm sync          # build + pushwork sync → gives automerge: module URL
pnpm register      # adds URL to MODULE_SETTINGS_DOC_URL (env var)
```

For local iteration, some tools use:

```bash
pnpm dev           # vite build --watch, or pushwork watch
```

After syncing, add the module's Automerge URL to the layout / module-settings doc in your Patchwork instance if not using `register`.

---

## Example: porting **datagrid**

Source: `patchwork-extra/datagrid/`

### What to keep

- Data model: `data: any[][]`, 100×26 init grid
- Handsontable + HyperFormula integration
- Plugin ids: datatype `datagrid`, tool `datagrid`
- `beforeChange` / `beforeCreateRow` / `beforeCreateCol` Automerge write pattern

### What to change

| File | Action |
|------|--------|
| `package.json` | Swap SDK deps; add patchwork-plugins + bootloader |
| `vite.config.ts` | `EXTERNAL_DEPENDENCIES` → `externals` from bootloader |
| `src/index.ts` | `supportedDatatypes`; return `DatagridTool` directly |
| `src/datatype.ts` | Strip VC hooks (`includeChangeInHistory`, `patchesToAnnotations`, …); rename to `DatagridDatatype`; `init(doc, repo)` |
| `src/tool.tsx` | Wrap in `ToolRender`; drop `annotations` prop initially; remove `export const tool = { EditorComponent }` |

### What to defer

- **Diff green-cell renderer** — old code mapped `annotations` prop to Handsontable cell meta. Re-implement later with `@inkandswitch/annotations-diff` if history UI is needed.
- **AI change summaries** — old `promptForAIChangeGroupSummary` on datatype; no direct equivalent yet.
- **Data model redesign** — the `data[][]` merge caveat in the old comments still applies; port as-is first.

### datagrid-specific deps

Keep in `dependencies`:

- `handsontable`, `@handsontable/react`, `hyperformula`, `lodash`

Drop:

- `@patchwork/sdk`

---

## Example: porting **data-table** (slightly more work)

Source: `patchwork-extra/data-table/`

Same steps as datagrid, plus:

- **Three tools** in `index.ts`: `grid`, `schema`, `form` — each becomes its own `ToolRender`.
- **AG Grid + Tailwind + dnd-kit** — keep as local deps; add `@tailwindcss/vite` to vite config.
- **`valueViewers/`** — internal UI helpers; no SDK coupling, should port verbatim.
- **`@patchwork/sdk/ui`** in SchemaEditor — replace with Tailwind inputs or local stubs.

---

## Testing checklist

- [ ] `pnpm build` succeeds with no errors
- [ ] Module loads in Patchwork (no import map / external errors in console)
- [ ] **New document**: create via sidebar, default state looks correct
- [ ] **Existing document**: open a doc created with the old module (same datatype id)
- [ ] **Edit + sync**: change persists after reload
- [ ] **Two clients**: concurrent edits merge without crash (note known datagrid merge limits)
- [ ] **CSS**: third-party styles (Handsontable, AG Grid) render correctly
- [ ] **Cleanup**: navigating away doesn't leak (ToolRender cleanup runs)

---

## Common pitfalls

1. **Renaming datatype/tool ids** — breaks every existing document of that type. Never do this on a port.
2. **`supportedDataTypes` typo** — must be `supportedDatatypes` in the new API.
3. **Bundling React/Automerge** — forgot `external` in vite config.
4. **Missing `RepoContext`** — `useDocument` / hooks fail silently or throw.
5. **Returning `{ EditorComponent }`** — host expects a function `(handle, element) => cleanup`.
6. **Forgetting `pnpm sync` before register** — registering a stale or missing URL.
7. **Dual React / `useContext` crash** — If `@automerge/automerge-repo-react-hooks` stays external but React is bundled into your tool chunk (common with large deps like Handsontable), `useDocument` throws `null is not an object (evaluating '…useContext')`. Fix: filter `@automerge/automerge-repo-react-hooks` out of vite `external` so hooks bundle with your React, and add `resolve.alias` for `react` / `react-dom` (see `datagrid/vite.config.ts`, `todo/vite.config.ts`).
8. **Assuming VC hooks still work** — they aren't on `DatatypeImplementation`; either drop or reimplement in the tool.

---

## Reference implementations in patchwork-tools

| Tool | Why look at it |
|------|----------------|
| `mergecraft/` | Minimal React port from patchwork-extra; same 3D tool existed in both repos |
| `todo/` | Annotations, comments, selection |
| `datalog/` | Codemirror + diff annotations |
| `unconference/` | Tailwind v4 + daisyUI + multi-tool module |
| `notes/` | Actions + skills |
| `geolog/` | WASM + complex editor |

Old source for comparison: `patchwork-extra/<tool-name>/`.
