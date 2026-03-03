export const plugins = [
  {
    type: "patchwork:datatype",
    id: "chat",
    name: "Chat",
    icon: "MessageCircle",
    async load() {
      const { chatDatatype } = await import("./datatype.ts");
      return chatDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "chat",
    name: "Chat",
    supportedDatatypes: ["chat"],
    async load() {
      const { default: mount } = await import("./mount.tsx");
      return mount;
    },
  },
];
