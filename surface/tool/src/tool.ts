import { findRef } from "./ref";
import { registerRefView } from "./ref-view";
import { createFilesystem } from "./filesystem";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { RefViewHostElement } from "./ref-view";
import type { PaperDoc } from "./index";

const DEFAULT_SOURCE_FOLDER = "automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m" as AutomergeUrl;
const BOOTSTRAP_TOOL_URL = "/automerge:4FwenFcEMbsmjGxvYAuT5U8mLi8m/bootstrap.js";

const repo = (globalThis as any).repo;
registerRefView(repo, createFilesystem(repo, DEFAULT_SOURCE_FOLDER));

export function PaperTool(
  handle: DocHandle<PaperDoc>,
  element: RefViewHostElement & { repo?: Repo },
): () => void {
  const repo = element.repo ?? (globalThis as any).repo;
  if (!repo) {
    const pre = document.createElement("pre");
    pre.textContent = "paper: no repo (set element.repo or window.repo)";
    element.appendChild(pre);
    return () => pre.remove();
  }
  let child: HTMLElement | null = null;
  let disposed = false;

  void (async () => {
    try {
      if (typeof handle.whenReady === "function") await handle.whenReady();
      if (disposed) return;

      const { frameDocUrl } = handle.doc();

      window.__PAPER_LLM_API_KEY__ =
        import.meta.env.VITE_OPENROUTER_API_KEY ?? import.meta.env.VITE_OPENAI_API_KEY ?? "";

      const frameRef = await findRef(repo, frameDocUrl);
      const rv = document.createElement("ref-view") as RefViewHostElement;
      rv.setAttribute("tool-url", BOOTSTRAP_TOOL_URL);
      rv.setAttribute("ref-url", frameRef.url);
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
