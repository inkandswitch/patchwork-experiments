import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";

export type SurfaceDoc = {
  title: string;
  frameDocUrl: string;
  sourceFolderUrl: string;
};

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;

export const SurfaceDatatype = {
  init(doc: SurfaceDoc, repo: Repo): void {
    doc.title = "Surface";
    doc.sourceFolderUrl = DEFAULT_SOURCE_FOLDER;
    const frameHandle = repo.create();
    doc.frameDocUrl = frameHandle.url;
  },
  getTitle(doc: SurfaceDoc): string {
    return doc.title || "Surface";
  },
  setTitle(doc: SurfaceDoc, title: string): void {
    doc.title = title;
  },
};
