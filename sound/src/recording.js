/**
 * Recording — Patchwork datatype and tool definitions.
 *
 * @typedef {Object} RecordingDoc
 * @property {string} title - Document title
 * @property {string} audio - Automerge URL to UnixFileEntry doc (empty = not yet recorded)
 */

export const RecordingDatatype = {
  init(doc) {
    doc.title = "Sound";
    doc.audio = "";
  },

  getTitle(doc) {
    return doc.title || "Sound";
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "recording",
    name: "Sound",
    icon: "Mic",
    async load() {
      return RecordingDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "recorder",
    name: "Sound Recorder",
    icon: "Mic",
    supportedDatatypes: ["recording"],
    async load() {
      const { default: RecorderTool } = await import("./recorder.js");
      return RecorderTool;
    },
  },
  {
    type: "patchwork:tool",
    id: "sound-editor",
    name: "Sound Editor",
    icon: "AudioWaveform",
    supportedDatatypes: ["recording"],
    async load() {
      const { default: SoundEditorTool } = await import("./sound-editor.js");
      return SoundEditorTool;
    },
  },
];
