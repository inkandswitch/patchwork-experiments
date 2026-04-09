import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";

export type PaperWorldDoc = {
  title: string;
  frameDocUrl: string;
  sourceFolderUrl: string;
  toolUrl?: string;
};

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;

export const PaperWorldDatatype = {
  init(doc: PaperWorldDoc, repo: Repo): void {
    doc.title = "Paper World";
    doc.sourceFolderUrl = DEFAULT_SOURCE_FOLDER;
    const frameHandle = repo.create();
    doc.frameDocUrl = frameHandle.url;
  },
  getTitle(doc: PaperWorldDoc): string {
    return doc.title || "Paper World";
  },
  setTitle(doc: PaperWorldDoc, title: string): void {
    doc.title = title;
  },
};
