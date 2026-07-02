import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The Schedule card: a document-backed sticker source. The doc is a
// configuration-free marker — all working state lives in the shared canvas
// context; the document exists only so the card has a stable url instead of
// being a handle-less component.
export type ScheduleDoc = {
  "@patchwork": { type: "schedule" };
};

export const ScheduleDatatype: DatatypeImplementation<ScheduleDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "schedule" };
  },
  getTitle() {
    return "Schedule";
  },
};
