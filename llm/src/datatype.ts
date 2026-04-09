import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo";
import type { LLMProcessDoc } from "./types";

export const LLMProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init(doc: LLMProcessDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "llm-process" };
    doc.title = "Untitled";
  },

  getTitle(doc: LLMProcessDoc) {
    return doc.title || "LLM Process";
  },

  setTitle(doc: LLMProcessDoc, title: string) {
    doc.title = title;
  },
};
