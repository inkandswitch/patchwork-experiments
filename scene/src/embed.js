// A document embedded in the stage (another tool mounted inside it: an
// inspector section, a doc pane in the drawer) is marked with one attribute.
// Whatever starts inside one (keys, pastes, drops) is that tool's, never the
// stage's or an extension's. The stage defines the marker; whoever embeds
// sets it. And the one way a document is shown: documentView inside a
// documentBox, inline or docked alike. And what an embedded render's build
// controls ask of the stage that builds it, as DOM events up to its root.

/** Asks the stage to rebuild a render now (`detail: { renderUrl }`; the stage cancels it when it is that render's). */
export const REBUILD_EVENT = "scene:rebuild";
/** Asks after a render's object (`detail: { renderUrl, tell? }`): the stage sets `detail.state`, its content state, and `detail.at`, its fixed version, and calls `tell(state, at)` whenever either changes until `detail.stop()`. */
export const CONTEXT_EVENT = "scene:render-context";
/** The attribute that marks an embedded document's container. */
export const EMBED_ATTR = "data-stage-embed";

/**
 * The class every stage-scoped style rule stops at (the scene's and its
 * packages': `:where(:not(.about-embed *), .about-embed .scene-tool *)`), so
 * another tool's DOM inside it keeps its own look.
 */
export const EMBED_CLASS = "about-embed";

/**
 * The box a document is shown in, inline (an inspector section) or docked (a
 * drawer pane): marked for the stage's events (EMBED_ATTR) and its styles
 * (EMBED_CLASS) at once, so a document behaves and looks the same wherever
 * the stage shows it. `className` is the box's own (its place's layout).
 */
export function documentBox(className) {
  const box = document.createElement("div");
  box.className = `${EMBED_CLASS} ${className}`;
  box.setAttribute(EMBED_ATTR, "");
  return box;
}

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
 * inline (an inspector section) or in the drawer (a doc pane), always inside
 * a documentBox.
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
