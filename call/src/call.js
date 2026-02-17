/**
 * Call — Patchwork datatype and tool definitions.
 *
 * @typedef {Object} CallDoc
 * @property {string} content - Transcription text
 * @property {string} title - Document title
 */

export const CallDatatype = {
  init(doc) {
    doc.title = "Call";
    doc.content = "";
  },

  getTitle(doc) {
    return doc.title || "Call";
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "call",
    name: "Call",
    icon: "Video",
    async load() {
      return CallDatatype;
    },
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
    },
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
    },
  },
];
