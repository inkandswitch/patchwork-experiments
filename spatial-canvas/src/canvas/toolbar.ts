import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "./types.js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

/**
 * ToolbarPanel — renders one <patchwork-view> per spatial-canvas-tool plugin.
 *
 * Writes the selected tool directly to the doc's stateByUser. The
 * <spatial-canvas> element reacts to the doc change and updates its own state.
 */
const ToolbarPanel = (handle: DocHandle<CanvasDoc>, element: PatchworkViewElement): Disposer => {
  const registry = getRegistry("patchwork:tool");
  const toolDescs = registry.filter(
    (p) => !!(p.tags as string[] | undefined)?.includes("spatial-canvas-tool"),
  );

  element.style.cssText = "display:flex;gap:4px;";

  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";
  const views: HTMLElement[] = [];

  for (const desc of toolDescs) {
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", handle.url);
    view.setAttribute("tool-id", desc.id);
    view.className = "sc-tool-btn";
    view.title = desc.name;

    view.addEventListener("click", () => {
      handle.change((d) => {
        if (!d.stateByUser) d.stateByUser = {};
        if (!d.stateByUser[contactUrl])
          d.stateByUser[contactUrl] = { selection: {}, color: "#1a1a1a" };
        d.stateByUser[contactUrl].selectedTool = desc.id;
      });
    });

    element.appendChild(view);
    views.push(view);
  }

  const applyActiveTool = (toolId: string | undefined) => {
    for (const view of views) {
      view.classList.toggle("active", view.getAttribute("tool-id") === toolId);
    }
  };

  applyActiveTool(handle.doc()?.stateByUser?.[contactUrl]?.selectedTool);

  const onDocChange = ({ doc }: { doc: CanvasDoc }) => {
    applyActiveTool(doc.stateByUser?.[contactUrl]?.selectedTool);
  };
  handle.on("change", onDocChange);

  return () => {
    handle.off("change", onDocChange);
  };
};

export default ToolbarPanel;
