import { getRegistry, getSupportedToolsForType } from "@inkandswitch/patchwork-plugins";
import type { CanvasDoc, DocHandle } from "../core/types.js";
import { patchShape } from "../core/commands.js";
import type { EmbedShape } from "./types.js";

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

    // Tool selector
    const toolSelect = document.createElement("select");
    toolSelect.style.cssText = ["font:11px/1 system-ui,sans-serif", "border:1px solid rgba(0,0,0,0.2)", "border-radius:4px", "padding:2px 4px", "background:#fff", "color:#333", "cursor:pointer", "max-width:110px", "flex-shrink:0"].join(";");
    toolSelect.dataset.embedSelect = embed.id;

    for (const tool of getTools(embed.docType)) {
      const opt = document.createElement("option");
      opt.value = tool.id;
      opt.textContent = tool.name;
      toolSelect.appendChild(opt);
    }

    toolSelect.addEventListener("change", () => {
      patchShape(handle, embed.id, { toolId: toolSelect.value });
    });

    header.appendChild(toolSelect);
    wrapper.appendChild(header);

    // ---- Content area ----
    const content = document.createElement("div");
    content.style.cssText = "flex:1;overflow:hidden;min-height:0;position:relative;";
    content.dataset.embedContent = embed.id;
    // Prevent canvas pointer-capture and scroll-hijacking so embedded
    // buttons, inputs, and scrollable areas work natively.
    // The header above still propagates, keeping drag-to-move on embeds working.
    content.addEventListener('pointerdown', e => e.stopPropagation());
    // Plain scroll stays inside the embed; zoom gestures (ctrlKey = pinch/
    // ctrl+scroll) propagate up to the canvas's non-passive handler so it can
    // call preventDefault (blocking browser zoom) and run its custom zoom logic.
    content.addEventListener('wheel', e => {
      if (!e.ctrlKey) e.stopPropagation()
    }, { passive: true });
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

    // Keep select in sync with the active tool
    const toolSelect = wrapper.querySelector<HTMLSelectElement>(`[data-embed-select="${embed.id}"]`);
    if (toolSelect && toolSelect.value !== active) {
      toolSelect.value = active;
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
    for (const el of mounted.values()) el.remove();
    mounted.clear();
  };
}
