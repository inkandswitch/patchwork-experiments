export const plugins = [
  {
    type: "patchwork:tool",
    id: "site-viewer",
    name: "Site",
    icon: "Globe",
    // A directory doc (`@patchwork.type: "directory"`) holds a whole tree of files in one
    // document; a folder doc holds a document per file. Patchwork's service worker serves
    // both at /<url>/<path>, so both are browsable and this tool does not care which it has.
    supportedDatatypes: ["directory", "folder"],
    async load() {
      return (await import("./tool.js")).default;
    },
  },
];
