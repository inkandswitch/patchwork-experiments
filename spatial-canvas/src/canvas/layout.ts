import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer, FloatingPanel, Bar } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
export default function CanvasLayout(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  const container = document.createElement("div");
  container.className = "sc-container";

  const columnWrapper = document.createElement("div");
  columnWrapper.className = "sc-column-wrapper";

  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "sc-canvas-wrapper";

  const canvasViewEl = document.createElement("patchwork-view");
  canvasViewEl.setAttribute("doc-url", handle.url);
  canvasViewEl.setAttribute("tool-id", "spatial-canvas-view");
  canvasViewEl.className = "sc-canvas-view";

  canvasWrapper.appendChild(canvasViewEl);
  columnWrapper.appendChild(canvasWrapper);
  container.appendChild(columnWrapper);
  element.appendChild(container);

  mountLayout(handle, container, columnWrapper, canvasWrapper);

  // ---------------------------------------------------------------------------
  // Active tool tracking — needed by the relay to find the tool's button
  // ---------------------------------------------------------------------------

  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";
  let activeTool =
    handle.doc()?.stateByUser?.[contactUrl]?.selectedTool ?? "spatial-canvas-tool-select";

  const onDocChange = ({ doc }: { doc: CanvasDoc }) => {
    const tool = doc.stateByUser?.[contactUrl]?.selectedTool;
    if (tool) activeTool = tool;
  };
  handle.on("change", onDocChange);

  // ---------------------------------------------------------------------------
  // Pointer event relay
  // ---------------------------------------------------------------------------

  const relayPointerEvent = (type: string, e: PointerEvent) => {
    const makeClone = () => {
      const clone = new PointerEvent(type, {
        bubbles: true,
        cancelable: e.cancelable,
        clientX: e.clientX,
        clientY: e.clientY,
        movementX: e.movementX,
        movementY: e.movementY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        pressure: e.pressure,
        button: e.button,
        buttons: e.buttons,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
      });
      return clone;
    };

    const activeBtn = container.querySelector<HTMLElement>(
      `patchwork-view[tool-id="${activeTool}"]`,
    );
    if (activeBtn) activeBtn.dispatchEvent(makeClone());

    for (const panel of orderedPanels(container)) {
      const clone = makeClone();

      let stopped = false;
      const origStop = clone.stopPropagation.bind(clone);
      clone.stopPropagation = () => {
        stopped = true;
        origStop();
      };
      const origStopImmediate = clone.stopImmediatePropagation.bind(clone);
      clone.stopImmediatePropagation = () => {
        stopped = true;
        origStopImmediate();
      };

      panel.dispatchEvent(clone);
      if (stopped) break;
    }
  };

  // ---------------------------------------------------------------------------
  // Pointer event listeners on the canvas view element
  // ---------------------------------------------------------------------------

  let activePointerId: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest(".sc-panel, .sc-bar")) return;
    activePointerId = e.pointerId;
    relayPointerEvent("pointerdown", e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (activePointerId !== null) relayPointerEvent("pointermove", e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    relayPointerEvent("pointerup", e);
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    relayPointerEvent("pointercancel", e);
  };

  canvasViewEl.addEventListener("pointerdown", onPointerDown);
  canvasViewEl.addEventListener("pointermove", onPointerMove);
  canvasViewEl.addEventListener("pointerup", onPointerUp);
  canvasViewEl.addEventListener("pointercancel", onPointerCancel);

  return () => {
    handle.off("change", onDocChange);
    canvasViewEl.removeEventListener("pointerdown", onPointerDown);
    canvasViewEl.removeEventListener("pointermove", onPointerMove);
    canvasViewEl.removeEventListener("pointerup", onPointerUp);
    canvasViewEl.removeEventListener("pointercancel", onPointerCancel);
    container.remove();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orderedPanels(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".sc-panel, .sc-bar"));
}

function mountLayout(
  handle: DocHandle<CanvasDoc>,
  container: HTMLElement,
  columnWrapper: HTMLElement,
  canvasWrapper: HTMLElement,
) {
  const doc = handle.doc();
  if (!doc?.layout) return;

  const panelEntries = Object.entries(doc.layout).filter(([, e]) => e.kind === "panel") as [
    string,
    FloatingPanel,
  ][];

  if (panelEntries.length > 0) {
    const overlay = document.createElement("div");
    overlay.className = "sc-panel-overlay";
    canvasWrapper.appendChild(overlay);

    type Side = "top" | "bottom" | "left" | "right";
    type Align = "start" | "center" | "end";
    const grouped = new Map<Side, Map<Align, string[]>>();

    for (const [toolId, entry] of panelEntries) {
      const [side, align] = entry.position;
      const normAlign = toAlignClass(align);
      if (!grouped.has(side)) grouped.set(side, new Map());
      const sideMap = grouped.get(side)!;
      if (!sideMap.has(normAlign)) sideMap.set(normAlign, []);
      sideMap.get(normAlign)!.push(toolId);
    }

    for (const [side, alignMap] of grouped) {
      const sideEl = document.createElement("div");
      sideEl.className = `sc-side sc-side--${side}`;
      overlay.appendChild(sideEl);

      for (const [align, toolIds] of alignMap) {
        const groupEl = document.createElement("div");
        groupEl.className = `sc-side-group sc-side-group--${align}`;
        sideEl.appendChild(groupEl);

        for (const toolId of toolIds) {
          const view = document.createElement("patchwork-view");
          view.setAttribute("doc-url", handle.url);
          view.setAttribute("tool-id", toolId);
          view.className = "sc-panel";
          groupEl.appendChild(view);
        }
      }
    }
  }

  const barEntries = Object.entries(doc.layout).filter(([, e]) => e.kind === "bar") as [
    string,
    Bar,
  ][];

  for (const [toolId, entry] of barEntries) {
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", handle.url);
    view.setAttribute("tool-id", toolId);
    view.className = `sc-bar sc-bar--${entry.side}`;

    if (entry.side === "left") {
      container.insertBefore(view, columnWrapper);
    } else if (entry.side === "right") {
      container.appendChild(view);
    } else if (entry.side === "top") {
      columnWrapper.insertBefore(view, canvasWrapper);
    } else {
      columnWrapper.appendChild(view);
    }
  }
}

function toAlignClass(align: string): "start" | "center" | "end" {
  if (align === "right" || align === "bottom") return "end";
  if (align === "center") return "center";
  return "start";
}
