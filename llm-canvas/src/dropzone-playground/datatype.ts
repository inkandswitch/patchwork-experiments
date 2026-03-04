import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

type PlaygroundDoc = { title: string };

export const datatype: DatatypeImplementation<PlaygroundDoc> = {
  init(doc) {
    doc.title = "Drop Zone Playground";
  },
  getTitle(doc) {
    return doc.title || "Drop Zone Playground";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
