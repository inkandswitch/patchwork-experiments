export const plugins = [
  {
    // A `patchwork:component`: render signature `(element) => cleanup`, with no document bound
    // to it. It finds the repo to build by asking the host what is selected, and keeps what it
    // remembers in the account-scoped storage document the host hands out. Tagged
    // `context-tool`, so it appears beside whatever you are looking at.
    type: "patchwork:component",
    id: "cakewalk-build",
    name: "Site Build",
    icon: "Hammer",
    tags: ["context-tool"],
    async load() {
      return (await import("./context-tool.js")).default;
    },
  },
  {
    // The editor: a site's pages, the one you picked, and what it looks like — composed from
    // the `file` tool, `site-viewer`, and this package's builder. Bound to the repo document,
    // because that is the thing being edited.
    type: "patchwork:tool",
    id: "cakewalk-editor",
    name: "Site Editor",
    icon: "PenLine",
    supportedDatatypes: ["folder", "directory"],
    async load() {
      return (await import("./editor.js")).default;
    },
  },
];
