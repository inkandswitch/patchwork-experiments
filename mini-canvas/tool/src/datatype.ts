import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { MiniCanvasDoc } from "./index";

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;
const FRAME_TOOL_URL = "/automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m/frame.js";

const { schema } = await import(/* @vite-ignore */ FRAME_TOOL_URL);

export const MiniCanvasDatatype = {
  init(doc: MiniCanvasDoc, repo: Repo): void {
    doc.title = "Mini Canvas";
    doc.sourceFolderUrl = DEFAULT_SOURCE_FOLDER;
    const frameHandle = repo.create(schema.init());
    doc.frameDocUrl = frameHandle.url;
  },
  getTitle(doc: MiniCanvasDoc): string {
    return doc.title || "Mini Canvas";
  },
  setTitle(doc: MiniCanvasDoc, title: string): void {
    doc.title = title;
  },
};
