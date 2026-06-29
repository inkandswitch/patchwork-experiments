import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// Configuration-free contributor marker: the card carries no settings, so the
// document is just its `@patchwork.type` tag.
export type TimerSourceDoc = {
  "@patchwork": { type: "timer-source" };
};

export const TimerSourceDatatype: DatatypeImplementation<TimerSourceDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "timer-source" };
  },
  getTitle() {
    return "Timer";
  },
};
