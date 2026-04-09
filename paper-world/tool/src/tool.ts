import { findRef } from "./ref";
import { registerRefView } from "./ref-view";
import { createFilesystem } from "./filesystem";
import { createPluginRegistry } from "./plugins";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { RefViewHostElement } from "./ref-view";
import type { PaperWorldDoc } from "./datatype";

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;
const BOOTSTRAP_VIEW_URL = "bootstrap.json";

const repo = (globalThis as any).repo;
(globalThis as any).findRef = findRef;
(globalThis as any).VITE_OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY;
const filesystem = createFilesystem(repo, DEFAULT_SOURCE_FOLDER);
const pluginRegistry = createPluginRegistry(filesystem);
registerRefView(repo, filesystem, pluginRegistry);

export function PaperWorldTool(
  handle: DocHandle<PaperWorldDoc>,
  element: RefViewHostElement & { repo?: Repo },
): () => void {
  const repo = element.repo ?? (globalThis as any).repo;
  if (!repo) {
    const pre = document.createElement("pre");
    pre.textContent = "paper-world: no repo (set element.repo or window.repo)";
    element.appendChild(pre);
    return () => pre.remove();
  }

  let child: HTMLElement | null = null;
  let disposed = false;
  let currentToolUrl: string | undefined;
  let onChangeHandler: (() => void) | null = null;

  function mountView(viewUrl: string, frameRefUrl: string) {
    if (child) child.remove();
    const rv = document.createElement("ref-view") as RefViewHostElement;
    rv.setAttribute("view-url", viewUrl);
    rv.setAttribute("ref-url", frameRefUrl);
    rv.style.cssText = "display:block;width:100%;height:100%;min-height:0;";

    rv.addEventListener("patchwork:set-tool-url", ((e: CustomEvent) => {
      const toolUrl = e.detail?.toolUrl;
      if (typeof toolUrl === "string" && toolUrl) {
        handle.change((d: PaperWorldDoc) => {
          d.toolUrl = toolUrl;
        });
      }
    }) as EventListener);

    element.appendChild(rv);
    child = rv;
  }

  void (async () => {
    try {
      if (typeof handle.whenReady === "function") await handle.whenReady();
      if (disposed) return;

      const doc = handle.doc();
      const frameRef = await findRef(repo, doc.frameDocUrl);
      if (disposed) return;

      currentToolUrl = doc.toolUrl;
      const viewUrl = currentToolUrl || BOOTSTRAP_VIEW_URL;
      mountView(viewUrl, frameRef.url);

      onChangeHandler = () => {
        if (disposed) return;
        const updatedDoc = handle.doc();
        if (updatedDoc.toolUrl !== currentToolUrl) {
          currentToolUrl = updatedDoc.toolUrl;
          const newViewUrl = currentToolUrl || BOOTSTRAP_VIEW_URL;
          mountView(newViewUrl, frameRef.url);
        }
      };
      handle.on("change", onChangeHandler);
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
    if (onChangeHandler) handle.off("change", onChangeHandler);
    child?.remove();
  };
}
