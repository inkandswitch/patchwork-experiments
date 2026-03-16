import { getRegistry, getSupportedToolsForType } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "../canvas/types.js";
import type { EmbedShape } from "./types.js";
import { patchShape, deleteShapes, createShape, newId, nextZIndex } from "../canvas/commands.js";
import { openMenu } from "./menu.js";

const HEADER_H = 30;

/**
 * canvas-embed — renders the visual content of an embed shape.
 *
 * Layout (position, size, zIndex) is applied by <patchwork-ref-view>. This
 * tool renders the header (title, tool selector, close button) and the
 * embedded <patchwork-view> content area.
 */
export default function CanvasEmbedTool(
  handle: DocHandle<CanvasDoc>,
  element: HTMLElement,
  refUrl: string,
): Disposer {
  const shapeId = decodeURIComponent(refUrl.split("/").pop() ?? "");
  const repo = (element as any).repo ?? null;

  element.style.boxSizing = "border-box";
  element.style.borderRadius = "6px";
  element.style.boxShadow = "0 1px 6px rgba(0,0,0,0.14)";
  element.style.overflow = "hidden";
  element.style.background = "#fafafa";
  element.style.display = "flex";
  element.style.flexDirection = "column";

  const header = buildHeader();
  element.appendChild(header.el);

  const content = buildContent(handle, element, shapeId);
  element.appendChild(content.el);

  let disposeTitle: (() => void) | null = null;

  function render({ doc }: { doc: CanvasDoc }) {
    const shape = doc.shapes[shapeId] as EmbedShape | undefined;
    if (!shape) return;

    const active = effectiveToolId(shape.docType, shape.toolId ?? "");

    // Update tool button label
    const tools = getTools(shape.docType);
    const activeName = tools.find((t) => t.id === active)?.name ?? active;
    header.toolLabel.textContent = activeName || "—";
    header.toolBtn.dataset.embedDocType = shape.docType ?? "";
    header.toolBtn.dataset.embedDocUrl = shape.docUrl ?? "";

    // Title subscription: resubscribe when docUrl changes
    if (content.lastDocUrl !== shape.docUrl) {
      disposeTitle?.();
      disposeTitle = subscribeTitle(repo, shape.docUrl, shape.docType, (title) => {
        header.titleEl.textContent = title;
      });
      content.lastDocUrl = shape.docUrl;
    }

    // Patchwork-view: update when docUrl or toolId changes
    const existing = content.el.querySelector("patchwork-view");
    const curDocUrl = existing?.getAttribute("doc-url") ?? "";
    const curToolId = existing?.getAttribute("tool-id") ?? "";

    if (!shape.docUrl) {
      content.el.innerHTML = `<div style="
        display:flex;align-items:center;justify-content:center;
        height:100%;color:#999;font:13px/1 system-ui,sans-serif;
      ">Creating…</div>`;
      return;
    }

    if (curDocUrl !== shape.docUrl || curToolId !== active) {
      content.el.innerHTML = "";
      const view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", shape.docUrl);
      if (active) view.setAttribute("tool-id", active);
      view.style.cssText = "display:block;width:100%;height:100%;";
      content.el.appendChild(view);
    }
  }

  // Wire header buttons
  header.toolBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const docType = header.toolBtn.dataset.embedDocType ?? "";
    const docUrl = header.toolBtn.dataset.embedDocUrl ?? "";
    const tools = getTools(docType);
    if (tools.length === 0) return;
    openMenu(
      header.toolBtn,
      tools.map((t) => ({
        id: t.id,
        name: t.name,
        icon: (t as any).icon,
        onDragStart: docUrl
          ? (dragEvent: DragEvent) => {
              dragEvent.dataTransfer!.setData(
                "text/x-patchwork-urls",
                JSON.stringify([`${docUrl}&tool=${t.id}`]),
              );
            }
          : undefined,
      })),
      (toolId) => patchShape(handle, shapeId, { toolId }),
    );
  });

  header.closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteShapes(handle, [shapeId]);
  });

  // Open-document relay
  content.el.addEventListener("patchwork:open-document", (e) => {
    e.stopPropagation();
    const { url, toolId } = (e as CustomEvent<{ url: string; toolId?: string }>).detail;
    if (!url) return;
    const doc = handle.doc();
    if (!doc) return;
    const src = doc.shapes[shapeId] as EmbedShape | undefined;
    if (!src) return;
    const newEmbed: EmbedShape = {
      id: newId(),
      type: "embed",
      x: src.x + src.width + 16,
      y: src.y,
      width: src.width,
      height: src.height,
      zIndex: nextZIndex(doc),
      docUrl: url,
      docType: (e as CustomEvent<any>).detail.type ?? "",
      toolId: toolId ?? "",
    };
    createShape(handle, newEmbed);
  });

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
    disposeTitle?.();
    element.innerHTML = "";
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeader() {
  const el = document.createElement("div");
  el.style.cssText = [
    `height:${HEADER_H}px`,
    "flex-shrink:0",
    "display:flex",
    "align-items:center",
    "gap:6px",
    "padding:0 8px",
    "background:rgba(0,0,0,0.04)",
    "border-bottom:1px solid rgba(0,0,0,0.1)",
    "overflow:hidden",
  ].join(";");

  const titleEl = document.createElement("span");
  titleEl.textContent = "Untitled";
  titleEl.style.cssText = [
    "flex:1",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "white-space:nowrap",
    "font:12px/1 system-ui,sans-serif",
    "color:#333",
  ].join(";");
  el.appendChild(titleEl);

  const toolBtn = document.createElement("button");
  toolBtn.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:3px",
    "font:11px/1 system-ui,sans-serif",
    "border:none",
    "border-radius:3px",
    "padding:2px 4px",
    "background:transparent",
    "color:#555",
    "cursor:pointer",
    "max-width:120px",
    "flex-shrink:0",
    "overflow:hidden",
  ].join(";");
  toolBtn.addEventListener("mouseover", () => {
    toolBtn.style.background = "rgba(0,0,0,0.07)";
  });
  toolBtn.addEventListener("mouseout", () => {
    toolBtn.style.background = "transparent";
  });
  toolBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  const toolLabel = document.createElement("span");
  toolLabel.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  toolBtn.appendChild(toolLabel);

  const caret = document.createElement("span");
  caret.textContent = "▾";
  caret.style.cssText = "flex-shrink:0;font-size:9px;opacity:0.6;";
  toolBtn.appendChild(caret);
  el.appendChild(toolBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.title = "Close";
  closeBtn.style.cssText = [
    "flex-shrink:0",
    "width:20px",
    "height:20px",
    "border:none",
    "border-radius:3px",
    "background:transparent",
    "color:#888",
    "font:14px/1 system-ui,sans-serif",
    "cursor:pointer",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:0",
  ].join(";");
  closeBtn.addEventListener("mouseover", () => {
    closeBtn.style.background = "rgba(0,0,0,0.07)";
    closeBtn.style.color = "#333";
  });
  closeBtn.addEventListener("mouseout", () => {
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "#888";
  });
  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.appendChild(closeBtn);

  return { el, titleEl, toolBtn, toolLabel, closeBtn };
}

function buildContent(handle: DocHandle<CanvasDoc>, boundary: HTMLElement, shapeId: string) {
  const el = document.createElement("div");
  el.style.cssText = "flex:1;overflow:hidden;min-height:0;position:relative;";

  el.addEventListener("pointerdown", (e) => e.stopPropagation());

  let gestureAbsorb: boolean | null = null;
  let gestureEndTimer: ReturnType<typeof setTimeout> | null = null;

  function resetGesture() {
    gestureAbsorb = null;
    if (gestureEndTimer) {
      clearTimeout(gestureEndTimer);
      gestureEndTimer = null;
    }
  }

  el.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return;
      if (gestureAbsorb === null) {
        gestureAbsorb = isInsideScrollable(e.target as Element, el);
      }
      if (gestureAbsorb) e.stopPropagation();
      if (gestureEndTimer) clearTimeout(gestureEndTimer);
      gestureEndTimer = setTimeout(resetGesture, 150);
    },
    { passive: true },
  );

  el.addEventListener("pointermove", resetGesture, { passive: true });

  return { el, lastDocUrl: "" };
}

function getTools(docType: string) {
  return getSupportedToolsForType(docType).filter((t) => !(t as any).unlisted);
}

function effectiveToolId(docType: string, toolId: string): string {
  if (toolId) return toolId;
  const tools = getTools(docType);
  const concrete = tools.find((t) => {
    const sd = (t as any).supportedDatatypes;
    return Array.isArray(sd) && !sd.includes("*");
  });
  return concrete?.id ?? tools[0]?.id ?? "";
}

function subscribeTitle(
  repo: any,
  docUrl: string,
  docType: string,
  onTitle: (title: string) => void,
): () => void {
  onTitle("Untitled");
  if (!repo || !docUrl) return () => {};

  let cancelled = false;
  let offChange: (() => void) | null = null;

  (async () => {
    try {
      const loaded = await getRegistry("patchwork:datatype").load(docType);
      if (cancelled) return;
      const docHandle = repo.find(docUrl);
      await docHandle.whenReady?.();
      if (cancelled) return;

      function onDocChange({ doc }: { doc: any }) {
        if (cancelled) return;
        onTitle(loaded?.module?.getTitle?.(doc) || "Untitled");
      }
      onDocChange({ doc: docHandle.doc() });
      docHandle.on("change", onDocChange);
      offChange = () => docHandle.off("change", onDocChange);
    } catch {
      // keep showing 'Untitled'
    }
  })();

  return () => {
    cancelled = true;
    offChange?.();
  };
}

function isInsideScrollable(el: Element | null, boundary: Element): boolean {
  while (el && el !== boundary) {
    const { overflowY, overflowX } = getComputedStyle(el);
    const scrollableY =
      (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    const scrollableX =
      (overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
    if (scrollableY || scrollableX) return true;
    el = el.parentElement;
  }
  return false;
}
