// src/call.js
var CallDatatype = {
  init(doc) {
    doc.title = "Call";
    doc.content = "";
  },
  getTitle(doc) {
    return doc.title || "Call";
  },
  setTitle(doc, title) {
    doc.title = title;
  }
};
var plugins = [
  {
    type: "patchwork:datatype",
    id: "call",
    name: "Call",
    icon: "Video",
    async load() {
      return CallDatatype;
    }
  },
  {
    type: "patchwork:tool",
    id: "telephone",
    name: "Telephone",
    icon: "Video",
    supportedDatatypes: ["call"],
    async load() {
      const { default: TelephoneTool } = await import("./telephone.js");
      return TelephoneTool;
    }
  },
  {
    type: "patchwork:tool",
    id: "teleprint",
    name: "Teleprint",
    icon: "FileText",
    supportedDatatypes: ["call"],
    async load() {
      const { default: TeleprintTool } = await import("./teleprint.js");
      return TeleprintTool;
    }
  }
];
export {
  CallDatatype,
  plugins
};
//# sourceMappingURL=call.js.map
