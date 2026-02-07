import type { Repo } from "@automerge/automerge-repo";
import type { UnconferenceDoc } from "./types";

export type UnconferenceDocType = UnconferenceDoc;

export const unconferenceDatatype = {
  init(doc: UnconferenceDoc, _repo: Repo) {
    doc.title = "Team Unconference";
    doc.sessions = [];
    doc.timeSlots = [
      "9:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
    ];
    doc.scheduleSlots = doc.timeSlots.map(() => []);
  },

  getTitle(doc: UnconferenceDoc) {
    return doc.title || "Unconference";
  },

  setTitle(doc: UnconferenceDoc, title: string) {
    doc.title = title;
  },
};
