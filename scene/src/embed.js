// A document embedded in the stage (another tool mounted inside it: an
// inspector section, a doc pane in the drawer) is marked with one attribute.
// Whatever starts inside one (keys, pastes, drops) is that tool's, never the
// stage's or an extension's. The stage defines the marker; whoever embeds
// sets it. And documentView, the one element a document is shown in.

/** The attribute that marks an embedded document's container. */
export const EMBED_ATTR = "data-stage-embed";

/** Did this DOM event start inside an embedded document within `root`? */
export function fromEmbed(e, root) {
  const path = e.composedPath?.() ?? [];
  for (const n of path.length ? path : [e.target]) {
    if (n === root) return false;
    if (n?.hasAttribute?.(EMBED_ATTR)) return true;
  }
  return !!e.target?.closest?.(`[${EMBED_ATTR}]`);
}

/**
 * A document as the host shows it: its <patchwork-view doc-url tool-id> (no
 * tool-id: its type's default), or, where the host has none (a local probe, a
 * test), a placeholder naming it. The one way the stage shows a document,
 * inline (an inspector section) or in the drawer (a doc pane); whoever puts
 * it in the page puts it inside an EMBED_ATTR container.
 * @param {{ url: string, toolId?: string | null, label?: string }} doc
 */
export function documentView({ url, toolId = null, label = "" }) {
  if (globalThis.customElements?.get?.("patchwork-view")) {
    const v = document.createElement("patchwork-view");
    v.setAttribute("doc-url", url);
    if (toolId) v.setAttribute("tool-id", toolId);
    return v;
  }
  const p = document.createElement("p");
  p.className = "hint doc-placeholder";
  p.textContent = `${label || "Document"}: ${url}`;
  return p;
}
