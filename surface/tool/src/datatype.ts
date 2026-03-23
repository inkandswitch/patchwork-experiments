import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { PaperDoc } from "./index";

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;

export const PaperDatatype = {
  init(doc: PaperDoc, repo: Repo): void {
    doc.title = "Paper";
    doc.sourceFolderUrl = DEFAULT_SOURCE_FOLDER;
    const frameHandle = repo.create();
    doc.frameDocUrl = frameHandle.url;
  },
  getTitle(doc: PaperDoc): string {
    return doc.title || "Paper";
  },
  setTitle(doc: PaperDoc, title: string): void {
    doc.title = title;
  },
};
