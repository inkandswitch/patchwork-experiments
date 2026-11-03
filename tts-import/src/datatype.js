// The tts-import datatype: one import of a Tabletop Simulator mod — its
// settings, how far it got, and the report. See README.md for the shape.

import { DEFAULT_SETTINGS } from "./settings.js";

export const TtsImportDatatype = {
  init(doc) {
    doc.title = "TTS import";
    doc.status = "empty";
    doc.error = null;
    doc.progress = null;
    doc.settings = { ...DEFAULT_SETTINGS };
    doc.report = null;
    doc.sceneUrl = null;
    doc.scenes = [];
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
