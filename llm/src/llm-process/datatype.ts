import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { Repo } from "@automerge/automerge-repo";
import type { LLMProcessDoc } from "../types";

export const LLMProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init(doc: LLMProcessDoc, repo: Repo) {
    doc["@patchwork"] = { type: "llm-process" };
    doc.title = "LLM Process";
    doc.model = "anthropic/claude-sonnet-4.6";
    doc.systemPrompt = "";
    doc.messages = [];
    doc.done = false;

    const folderHandle = repo.create<any>();
    folderHandle.change((d: any) => {
      d["@patchwork"] = { type: "folder" };
      d.title = "Documents";
      d.docs = [];
    });
    doc.docFolderUrl = folderHandle.url;
  },

  getTitle(doc: LLMProcessDoc) {
    return doc.title || "LLM Process";
  },
};
