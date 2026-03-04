export const plugins = [
  {
    type: "patchwork:datatype",
    id: "dropzone-playground",
    name: "Drop Zone Playground",
    icon: "FlaskConical",
    async load() {
      const { datatype } = await import("./datatype.ts");
      return datatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "dropzone-playground",
    name: "Drop Zone Playground",
    supportedDatatypes: ["dropzone-playground"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
  {
    type: "patchwork:datatype",
    id: "drag-token-test",
    name: "Drag Token Test",
    icon: "GripHorizontal",
    async load() {
      return {
        init(doc: any) { doc.title = "Drag Token Test"; },
        getTitle(doc: any) { return doc.title || "Drag Token Test"; },
        setTitle(doc: any, title: string) { doc.title = title; },
      };
    },
  },
  {
    type: "patchwork:tool",
    id: "drag-token-test",
    name: "Drag Token Test",
    supportedDatatypes: ["drag-token-test"],
    async load() {
      const { mountDragTokenTest } = await import("./components/DragTokenTest.tsx");
      return mountDragTokenTest;
    },
  },
];
