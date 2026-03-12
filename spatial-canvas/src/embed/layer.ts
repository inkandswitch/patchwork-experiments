import { getRegistry, getSupportedToolsForType } from "@inkandswitch/patchwork-plugins";
import type { CanvasDoc, DocHandle } from "../core/types.js";
import { patchShape, deleteShapes, createShape, newId, nextZIndex } from "../core/commands.js";
import type { EmbedShape } from "./types.js";
import { openMenu } from "./menu.js";

const HEADER_H = 30;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns the tools available for a docType, excluding unlisted ones.
 */
function getTools(docType: string) {
  return getSupportedToolsForType(docType).filter((t) => !(t as any).unlisted);
}

/**
 * Resolves the effective tool id to show/use.
 * When toolId is empty, picks the first tool whose supportedDatatypes is a
 * concrete list (not the '*' wildcard), falling back to the first available.
 */
function effectiveToolId(docType: string, toolId: string): string {
  if (toolId) return toolId;
  const tools = getTools(docType);
  const concrete = tools.find((t) => {
    const sd = (t as any).supportedDatatypes;
    return Array.isArray(sd) && !sd.includes("*");
  });
  return concrete?.id ?? tools[0]?.id ?? "";
}

// ============================================================================
// Live title subscription
// ============================================================================

/**
 * Subscribes to the title of an embedded doc.
 * Calls `onTitle('Untitled')` immediately, then updates reactively whenever
 * the embedded doc changes. Returns a disposer.
 */
function subscribeTitle(repo: any, docUrl: string, docType: string, onTitle: (title: string) => void): () => void {
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

      // Read title directly from the doc passed in each change event so
      // we always have the latest version without an extra doc() call.
      function onDocChange({ doc }: { doc: any }) {
        if (cancelled) return;
        const title = loaded?.module?.getTitle?.(doc);
        onTitle(title || "Untitled");
      }

      // Seed with current value
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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if `el` or any ancestor up to (but not including) `boundary`
 * is a scrollable element (overflow:auto/scroll with actual overflow content).
 */
function isInsideScrollable(el: Element | null, boundary: Element): boolean {
  while (el && el !== boundary) {
    const { overflowY, overflowX } = getComputedStyle(el)
    const scrollableY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
    const scrollableX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth  > el.clientWidth  + 1
    if (scrollableY || scrollableX) return true
    el = el.parentElement
  }
  return false
}

// ============================================================================
// Layer
// ============================================================================

export default function EmbedLayer(handle: DocHandle<CanvasDoc>, element: HTMLElement): () => void {
  const repo = (element.closest(".sc-container") as any)?.repo;
  element.style.cssText = "position:absolute;inset:0;";

  const mounted = new Map<string, HTMLElement>();
  const titleDisposers = new Map<string, () => void>();

  function render({ doc }: { doc: CanvasDoc }) {
    const currentIds = new Set<string>();
    for (const shape of Object.values(doc.shapes)) {
      if (shape.type === "embed") currentIds.add(shape.id);
    }

    for (const [id, el] of mounted) {
      if (!currentIds.has(id)) {
        el.remove();
        mounted.delete(id);
        titleDisposers.get(id)?.();
        titleDisposers.delete(id);
      }
    }

    for (const shape of Object.values(doc.shapes)) {
      if (shape.type !== "embed") continue;
      const embed = shape as EmbedShape;

      let wrapper = mounted.get(embed.id);
      if (!wrapper) {
        wrapper = buildWrapper(embed);
        element.appendChild(wrapper);
        mounted.set(embed.id, wrapper);
      }

      updateWrapper(wrapper, embed);
    }
  }

  function buildWrapper(embed: EmbedShape): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.dataset.shapeId = embed.id;
    wrapper.style.cssText = ["position:absolute", "top:0", "left:0", "box-sizing:border-box", "border-radius:6px", "box-shadow:0 1px 6px rgba(0,0,0,0.14)", "overflow:hidden", "background:#fafafa", "display:flex", "flex-direction:column"].join(";");

    // ---- Header ----
    const header = document.createElement("div");
    header.style.cssText = [`height:${HEADER_H}px`, "flex-shrink:0", "display:flex", "align-items:center", "gap:6px", "padding:0 8px", "background:rgba(0,0,0,0.04)", "border-bottom:1px solid rgba(0,0,0,0.1)", "overflow:hidden"].join(";");

    // Title
    const titleEl = document.createElement("span");
    titleEl.style.cssText = ["flex:1", "overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap", "font:12px/1 system-ui,sans-serif", "color:#333"].join(";");
    titleEl.dataset.embedTitle = embed.id;
    header.appendChild(titleEl);

    // Tool selector button — subtle: inherits header bg, small caret
    const toolBtn = document.createElement("button");
    toolBtn.dataset.embedToolBtn = embed.id;
    // data-embed-doc-type and data-embed-doc-url are kept current by updateWrapper
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

    const toolLabel = document.createElement("span");
    toolLabel.dataset.embedToolLabel = embed.id;
    toolLabel.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    toolBtn.appendChild(toolLabel);

    const caret = document.createElement("span");
    caret.textContent = "▾";
    caret.style.cssText = "flex-shrink:0;font-size:9px;opacity:0.6;";
    toolBtn.appendChild(caret);

    toolBtn.addEventListener("mouseover", () => { toolBtn.style.background = "rgba(0,0,0,0.07)"; });
    toolBtn.addEventListener("mouseout",  () => { toolBtn.style.background = "transparent"; });

    // Stop pointerdown so the canvas tool layer doesn't preventDefault and kill the click
    toolBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); });

    toolBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Read current values from data attrs set by updateWrapper (not stale closure)
      const docType = toolBtn.dataset.embedDocType ?? "";
      const docUrl  = toolBtn.dataset.embedDocUrl  ?? "";
      const tools = getTools(docType);
      if (tools.length === 0) return;
      openMenu(
        toolBtn,
        tools.map(t => ({
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
        (toolId) => patchShape(handle, embed.id, { toolId }),
      );
    });

    header.appendChild(toolBtn);

    // ---- Close button ----
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
    closeBtn.addEventListener("mouseover", () => { closeBtn.style.background = "rgba(0,0,0,0.07)"; closeBtn.style.color = "#333"; });
    closeBtn.addEventListener("mouseout",  () => { closeBtn.style.background = "transparent"; closeBtn.style.color = "#888"; });
    closeBtn.addEventListener("pointerdown", e => e.stopPropagation());
    closeBtn.addEventListener("click", e => {
      e.stopPropagation();
      deleteShapes(handle, [embed.id]);
    });
    header.appendChild(closeBtn);
    wrapper.appendChild(header);

    // ---- Content area ----
    const content = document.createElement("div");
    content.style.cssText = "flex:1;overflow:hidden;min-height:0;position:relative;";
    content.dataset.embedContent = embed.id;
    // Prevent canvas pointer-capture and scroll-hijacking so embedded
    // buttons, inputs, and scrollable areas work natively.
    // The header above still propagates, keeping drag-to-move on embeds working.
    content.addEventListener('pointerdown', e => e.stopPropagation());
    // Zoom gestures (ctrlKey = pinch/ctrl+scroll) always propagate to the
    // canvas's non-passive handler so it can preventDefault browser zoom and
    // run its custom zoom logic.
    // For plain scroll, decide once at gesture-start whether we're inside a
    // scrollable element and hold that decision for the whole gesture (even
    // when hitting the top/bottom limit) to avoid unintended canvas panning.
    let gestureAbsorb: boolean | null = null
    let gestureEndTimer: ReturnType<typeof setTimeout> | null = null

    function resetGesture() {
      gestureAbsorb = null
      if (gestureEndTimer) { clearTimeout(gestureEndTimer); gestureEndTimer = null }
    }

    content.addEventListener('wheel', e => {
      if (e.ctrlKey) return
      if (gestureAbsorb === null) {
        gestureAbsorb = isInsideScrollable(e.target as Element, content)
      }
      if (gestureAbsorb) e.stopPropagation()
      // Debounce reset — pointermove resets immediately, this catches
      // the case where the user stops moving before the next scroll.
      if (gestureEndTimer) clearTimeout(gestureEndTimer)
      gestureEndTimer = setTimeout(resetGesture, 150)
    }, { passive: true })

    // Pointer move resets immediately so the next scroll gesture re-evaluates
    // from the new cursor position without waiting for the debounce.
    content.addEventListener('pointermove', resetGesture, { passive: true });

    // Open a new embed beside this one when a tool inside requests navigation.
    content.addEventListener('patchwork:open-document', e => {
      console.log('[embed] patchwork:open-document caught on content div', { embedId: embed.id, detail: (e as CustomEvent).detail, composedPath: e.composedPath() });
      e.stopPropagation();
      const { url, toolId } = (e as CustomEvent<{ url: string; toolId?: string }>).detail;
      if (!url) return;
      const doc = handle.doc();
      if (!doc) return;
      const src = doc.shapes[embed.id] as EmbedShape | undefined;
      if (!src) return;
      const newEmbed: EmbedShape = {
        id: newId(),
        type: 'embed',
        x: src.x + src.width + 16,
        y: src.y,
        width: src.width,
        height: src.height,
        zIndex: nextZIndex(doc),
        docUrl: url,
        docType: (e as CustomEvent<any>).detail.type ?? '',
        toolId: toolId ?? '',
      }
      console.log('[embed] creating new embed', newEmbed);
      createShape(handle, newEmbed);
    });

    wrapper.addEventListener('patchwork:open-document', e => {
      console.log('[embed] patchwork:open-document reached WRAPPER (should have been stopped by content)', { embedId: embed.id, detail: (e as CustomEvent).detail });
    });

    // Catch-all at document level to see if the event escapes entirely
    const docListener = (e: Event) => {
      console.log('[embed] patchwork:open-document ESCAPED to document (stopPropagation failed?)', { embedId: embed.id, detail: (e as CustomEvent).detail });
    };
    document.addEventListener('patchwork:open-document', docListener);
    // Store for cleanup (attach to wrapper element for reference)
    (wrapper as any)._openDocListener = docListener;

    wrapper.appendChild(content);

    // Title subscription (empty docUrl at creation — re-subscribed in updateWrapper)
    const disposeTitle = subscribeTitle(repo, embed.docUrl, embed.docType, (title) => {
      const el = wrapper!.querySelector<HTMLElement>(`[data-embed-title="${embed.id}"]`);
      if (el) el.textContent = title;
    });
    titleDisposers.set(embed.id, disposeTitle);

    return wrapper;
  }

  function updateWrapper(wrapper: HTMLElement, embed: EmbedShape) {
    wrapper.style.transform = `translate(${embed.x}px,${embed.y}px)`;
    wrapper.style.width = `${embed.width}px`;
    wrapper.style.height = `${embed.height}px`;
    wrapper.style.zIndex = String(embed.zIndex);

    const active = effectiveToolId(embed.docType, embed.toolId ?? "");

    // Keep tool button in sync with current embed state
    const toolBtn = wrapper.querySelector<HTMLButtonElement>(`[data-embed-tool-btn="${embed.id}"]`);
    if (toolBtn) {
      // Keep data attrs current so the click handler always reads fresh values
      toolBtn.dataset.embedDocType = embed.docType ?? "";
      toolBtn.dataset.embedDocUrl  = embed.docUrl  ?? "";
      const tools = getTools(embed.docType);
      const activeName = tools.find(t => t.id === active)?.name ?? active;
      const labelEl = toolBtn.querySelector<HTMLElement>(`[data-embed-tool-label="${embed.id}"]`);
      if (labelEl) labelEl.textContent = activeName || "—";
    }

    const content = wrapper.querySelector<HTMLElement>(`[data-embed-content="${embed.id}"]`);
    if (!content) return;

    if (!embed.docUrl) {
      content.innerHTML = `<div style="
        display:flex;align-items:center;justify-content:center;
        height:100%;color:#999;font:13px/1 system-ui,sans-serif;
      ">Creating…</div>`;
      return;
    }

    const existing = content.querySelector("patchwork-view");
    const currentDocUrl = existing?.getAttribute("doc-url") ?? "";
    const currentToolId = existing?.getAttribute("tool-id") ?? "";

    // Re-subscribe to title when docUrl first becomes available
    if (currentDocUrl !== embed.docUrl) {
      titleDisposers.get(embed.id)?.();
      titleDisposers.set(
        embed.id,
        subscribeTitle(repo, embed.docUrl, embed.docType, (title) => {
          const el = wrapper.querySelector<HTMLElement>(`[data-embed-title="${embed.id}"]`);
          if (el) el.textContent = title;
        }),
      );
    }

    if (currentDocUrl !== embed.docUrl || currentToolId !== active) {
      content.innerHTML = "";
      const view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", embed.docUrl);
      if (active) view.setAttribute("tool-id", active);
      view.style.cssText = "display:block;width:100%;height:100%;";
      content.appendChild(view);
    }
  }

  handle.on("change", render);
  const initial = handle.doc();
  if (initial) render({ doc: initial });

  return () => {
    handle.off("change", render);
    for (const d of titleDisposers.values()) d();
    titleDisposers.clear();
    for (const el of mounted.values()) {
      const listener = (el as any)._openDocListener;
      if (listener) document.removeEventListener('patchwork:open-document', listener);
      el.remove();
    }
    mounted.clear();
  };
}
