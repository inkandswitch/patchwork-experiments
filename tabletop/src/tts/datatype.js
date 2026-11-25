// The tts-import datatype: one import of a Tabletop Simulator mod — its
// settings, what it asks to import (`request`: the files kept from a drop and
// the settings, request.js), how the last import of it ended (`imported`:
// the game and the report, or why it failed, written by the import's work,
// import-task.js), and every game it made. Whether an import is going on is
// not kept here: it is read from the work (status.js).

import { DEFAULT_SETTINGS } from "./settings.js";

export const TtsImportDatatype = {
  init(doc) {
    doc.title = "TTS import";
    doc.settings = { ...DEFAULT_SETTINGS };
    doc.request = null;
    doc.imported = null;
    doc.games = [];
  },
  getTitle(doc) {
    return doc?.title || "TTS import";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "TTS import"}`;
  },
};
