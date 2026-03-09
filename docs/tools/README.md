# Tools

The `tools/` directory contains all of the built-in tool plugins. They are regular workspace packages that register themselves into the `PluginRegistry` at runtime — there is nothing special about them beyond following the plugin contract.

```
tools/
├── codemirror/
│   ├── codemirror-base/      @grjte/codemirror-base
│   ├── codemirror-embed/     @grjte/codemirror-embed
│   └── codemirror-markdown/  @grjte/codemirror-markdown
├── editors/
│   ├── tenfold/              @inkandswitch/tenfold
│   ├── tldraw/               @patchwork/tldraw   (tldraw v2)
│   └── tldraw4/              @patchwork/tldraw4  (tldraw v4)
├── sidebars/
│   ├── comments-view/        @tiny-patchwork/comments-view
│   ├── context-sidebar/      @tiny-patchwork/context-sidebar
│   ├── context-view/         @tiny-patchwork/context-view
│   ├── history-view/         @tiny-patchwork/history-view
│   └── sideboard/            @chee/patchwork-sideboard
├── tiny-patchwork/
│   ├── commands/             @orion/commands
│   ├── frame-configurator/   @tiny-patchwork/frame-configurator
│   ├── module-settings-manager/
│   └── patchwork-frame/      @tiny-patchwork/patchwork-frame
├── toolbar/
│   ├── add-doc-to-sidebar-button/
│   ├── back-link-button/
│   ├── doc-title/
│   ├── sidebar-toggles/
│   ├── spacer/
│   └── sync-indicator/
├── account-picker/           @patchwork/account-picker
└── contact/                  @patchwork/contact
```

## The plugin contract

Every tool package must export a `plugins` array as a named export. Each entry is a `LoadablePlugin` — a plugin description plus a `load()` function that returns the implementation:

```ts
export const plugins = [
  {
    // required for all plugins
    id: "my-tool",
    type: "patchwork:tool",       // or "patchwork:datatype"
    name: "My Tool",

    // tool-specific
    supportedDatatypes: ["my-datatype"], // or "*" for any doc
    unlisted: false,              // true to hide from public tool lists
    forTitleBar: false,           // true for toolbar button tools
    tags: [],

    // the lazy-loaded implementation
    async load() {
      const { myTool } = await import("./tool.ts");
      return myTool; // ToolImplementation: (handle, element) => () => void
    },
  },
];
```

A single package can export multiple plugins — for example, a package that registers both a `patchwork:datatype` and the `patchwork:tool` that renders it.

## Deployment

Tools are **not bundled into the host app**. Instead, each tool package is built into a standard npm-style folder structure and stored in an Automerge document:

```
FolderDoc (the tool package root)
├── package.json         → UnixFileEntry (JSON)
└── dist/
    └── index.js         → UnixFileEntry (JS bundle)
```

The `pushwork` CLI syncs local build output into this Automerge folder. `tiny-patchwork` loads a default tools module from a hardcoded Automerge URL (`automerge:2LZBb891v37vggWYQPJRbYdyBGGE`), plus any additional modules the user has added to their `ModuleSettingsDoc`.

## Hot-reload

When `pushwork` syncs a new build, it bumps `FolderDoc.lastSyncAt`. `ModuleWatcher` detects the change, imports the module at the new content-addressed URL (the current heads), and calls `registerPlugins` again. Any `<patchwork-view>` element rendering that tool sees the `importUrl` change and re-mounts with the new code. No page reload is needed.

## CSS cascade layers

Tools should use `@layer` to slot their styles into the appropriate precedence tier:

```css
@layer patchwork, tool, user;

@layer tool {
  /* tool-specific styles here */
}
```

The order `patchwork < tool < user` means tool styles override patchwork base styles, and any user-defined styles override both — without needing `!important`.

## Tool sections

- [frame.md](./frame.md) — the `patchwork-frame` application shell
- [sidebars.md](./sidebars.md) — sidebar panel tools (sideboard, context-sidebar, history, comments)
- [editors.md](./editors.md) — document editor tools (CodeMirror, tldraw, tenfold)
