export const plugins = [
  {
    type: "patchwork:datatype",
    id: "workspace",
    name: "Workspace",
    icon: "FolderOpen",
    async load() {
      const { workspaceDatatype } = await import("./datatype.ts");
      return workspaceDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "workspace",
    name: "Workspace",
    supportedDatatypes: ["workspace"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
];
