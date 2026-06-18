import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// Configuration-free contributor marker (see color-styler/datatype.ts).
export type TimerSourceDoc = {
  "@patchwork": { type: "timer-source" };
};

export const TimerSourceDatatype: DatatypeImplementation<TimerSourceDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "timer-source" };
  },
  getTitle() {
    return "Timer Source";
  },
};
