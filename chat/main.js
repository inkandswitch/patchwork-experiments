export const plugins = [
  {
    type: "patchwork:datatype",
    id: "chat",
    name: "Chat",
    icon: "MessageCircle",
    async load() {
      const { ChatDatatype } = await import("./datatype.js");
      return ChatDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "chat",
    name: "Chat",
    icon: "MessageCircle",
    supportedDatatypes: ["chat"],
    async load() {
      const { Tool } = await import("./chitterchatter.js");
      return Tool;
    },
  },
];
