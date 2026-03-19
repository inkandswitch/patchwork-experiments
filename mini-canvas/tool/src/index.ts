import { createRef } from "./ref";
import { registerRefView } from "./ref-view";
import { createFilesystem } from "./filesystem";
import type { AnyDocumentId, AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { RefViewHostElement } from "./ref-view";

const repo = (globalThis as any).repo;

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;

/** Module URL for `frame.js` (see README). */
const FRAME_TOOL_URL = "/automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m/frame.js";

export { createRef, findRef, encodeRefToURL, parseRefURL } from "./ref";
export { registerRefView } from "./ref-view";
export { createFilesystem } from "./filesystem";
export type { MiniCanvasFilesystem } from "./filesystem";
export type { Ref, RefPathSegment } from "./ref";
export type { RefViewHostElement } from "./ref-view";

// this is wrong setting the file system on the ref-view element but for now it's fine
registerRefView(repo, createFilesystem(repo, DEFAULT_SOURCE_FOLDER));

let adoptedMiniCanvasSheet: CSSStyleSheet | null = null;

export interface MiniCanvasDoc {
  title?: string;
  worldUrl?: string;
  sourceRootUrl?: string;
  sourceFolder?: string;
}

export function MiniCanvasTool(handle: DocHandle<MiniCanvasDoc>, element: RefViewHostElement & { repo?: Repo }): () => void {
  const repo = element.repo ?? (globalThis as any).repo;
  if (!repo) {
    const pre = document.createElement("pre");
    pre.textContent = "mini-canvas: no repo (set element.repo or window.repo)";
    element.appendChild(pre);
    return () => pre.remove();
  }
  let child: HTMLElement | null = null;
  let disposed = false;

  void (async () => {
    try {
      if (typeof handle.whenReady === "function") await handle.whenReady();
      if (disposed) return;

      const mc = handle.doc();
      const sourceRootUrl = mc.sourceRootUrl || mc.sourceFolder || DEFAULT_SOURCE_FOLDER;

      let worldHandle: DocHandle<unknown>;
      const wu = mc.worldUrl;
      if (!wu) {
        worldHandle = repo.create() as DocHandle<unknown>;
        handle.change((d) => {
          (d as MiniCanvasDoc).worldUrl = worldHandle.url;
        });
      } else {
        worldHandle = (await repo.find(wu as AnyDocumentId)) as DocHandle<unknown>;
        if (typeof worldHandle.whenReady === "function") await worldHandle.whenReady();
      }
      if (disposed) return;

      const worldRef = createRef(worldHandle);
      const rv = document.createElement("ref-view") as RefViewHostElement;
      rv.setAttribute("tool-url", encodeURIComponent(FRAME_TOOL_URL));
      rv.setAttribute("ref-url", encodeURIComponent(worldRef.toURL()));
      rv.style.cssText = "display:block;width:100%;height:100%;min-height:0;";
      element.appendChild(rv);
      child = rv;
    } catch (err) {
      if (disposed) return;
      const pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.textContent = err instanceof Error ? err.message : String(err);
      element.appendChild(pre);
      child = pre;
    }
  })();

  return () => {
    disposed = true;
    child?.remove();
  };
}

export const MiniCanvasDatatype = {
  init(doc: MiniCanvasDoc): void {
    doc.title = "Mini Canvas";
    doc.worldUrl = "";
    doc.sourceRootUrl = DEFAULT_SOURCE_FOLDER;
  },
  getTitle(doc: MiniCanvasDoc): string {
    return doc.title || "Mini Canvas";
  },
  setTitle(doc: MiniCanvasDoc, title: string): void {
    doc.title = title;
  },
};

export const plugins = [
  {
    type: "patchwork:tool",
    id: "mini-canvas",
    name: "Mini Canvas",
    supportedDatatypes: ["mini-canvas"],
    async load(): Promise<typeof MiniCanvasTool> {
      return MiniCanvasTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "mini-canvas",
    name: "Mini Canvas",
    icon: "LayoutTemplate",
    async load(): Promise<typeof MiniCanvasDatatype> {
      return MiniCanvasDatatype;
    },
  },
];
