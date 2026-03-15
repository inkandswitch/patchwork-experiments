import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "./types.js";
import type { SpatialCanvasHost } from "./spatial-canvas-element.js";
import { deleteShapes, duplicateShapes } from "./commands.js";

/**
 * KeyboardPanel — invisible panel that registers keyboard shortcuts and relays
 * KeyboardEvents through all panels via canvas.relayKeyboardEvent().
 *
 * Panels can handle keys by listening for KeyboardEvents and calling
 * stopPropagation() to consume them. After the relay, unhandled keys fall
 * through to the built-in shortcuts below.
 */
const KeyboardPanel = (handle: DocHandle<CanvasDoc>, element: HTMLElement): Disposer => {
  element.style.display = "none";

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e as any)._scRelayed) return;
    const target = e.target as HTMLElement;
    if (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      return;

    const host = element.closest<SpatialCanvasHost>('patchwork-view[tool-id="spatial-canvas"]');
    if (!host?.spatialCanvas) return;

    host.spatialCanvas.relayKeyboardEvent(e);
    if (e.defaultPrevented) return;

    handleBuiltInShortcuts(e, handle);
  };

  document.addEventListener("keydown", onKeyDown);
  return () => {
    document.removeEventListener("keydown", onKeyDown);
  };
};

export default KeyboardPanel;

// ---------------------------------------------------------------------------
// Built-in shortcuts (run only if no panel consumed the event)
// ---------------------------------------------------------------------------

const TOOL_KEYS: Record<string, string> = {
  v: "spatial-canvas-tool-select",
  r: "spatial-canvas-tool-place-rectangle",
  t: "spatial-canvas-tool-text",
  p: "spatial-canvas-tool-pen",
  e: "spatial-canvas-tool-embed",
};

const handleBuiltInShortcuts = (e: KeyboardEvent, handle: DocHandle<CanvasDoc>) => {
  const isMod = e.metaKey || e.ctrlKey;
  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";

  if (e.key === "Backspace" && !isMod) {
    const doc = handle.doc();
    if (!doc) return;
    const ids = Object.keys(doc.stateByUser?.[contactUrl]?.selection ?? {});
    if (ids.length === 0) return;
    e.preventDefault();
    deleteShapes(handle, ids);
    handle.change((d) => {
      if (d.stateByUser?.[contactUrl]) d.stateByUser[contactUrl].selection = {};
    });
    return;
  }

  if (!isMod && e.key in TOOL_KEYS) {
    e.preventDefault();
    handle.change((d) => {
      if (!d.stateByUser) d.stateByUser = {};
      if (!d.stateByUser[contactUrl])
        d.stateByUser[contactUrl] = { selection: {}, color: "#1a1a1a" };
      d.stateByUser[contactUrl].selectedTool = TOOL_KEYS[e.key];
    });
    return;
  }

  if (e.key === "d" && isMod) {
    const doc = handle.doc();
    if (!doc) return;
    const ids = Object.keys(doc.stateByUser?.[contactUrl]?.selection ?? {});
    if (ids.length === 0) return;
    e.preventDefault();
    const shapes = ids.map((id) => doc.shapes[id]).filter(Boolean);
    const hasWidth = shapes.some((s) => "width" in s && (s as any).width > 0);
    const dx = hasWidth ? Math.max(...shapes.map((s) => (s as any).width ?? 0)) + 16 : 10;
    const dy = hasWidth ? 0 : 10;
    const newIds = duplicateShapes(handle, ids, dx, dy);
    handle.change((d) => {
      if (!d.stateByUser) d.stateByUser = {};
      if (!d.stateByUser[contactUrl])
        d.stateByUser[contactUrl] = { selection: {}, color: "#1a1a1a" };
      const sel: Record<string, true> = {};
      for (const id of newIds) sel[id] = true;
      d.stateByUser[contactUrl].selection = sel;
    });
  }
};
