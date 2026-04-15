import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type Doc = {
  title: string;
  cubes: [number, number, number][];
};

export const MergecraftDatatype: DatatypeImplementation<Doc> = {
  init(doc: Doc, _repo: Repo) {
    doc.title = "Mergecraft World";
    doc.cubes = [[0, 0.5, -10]];
  },
  getTitle(doc: Doc) {
    return doc.title || "Mergecraft World";
  },
  setTitle(doc: Doc, title: string) {
    doc.title = title;
  },
};
