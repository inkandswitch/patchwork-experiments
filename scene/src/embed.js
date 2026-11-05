// A document embedded in the stage (another tool mounted inside it, such as
// the inspector's About) is marked with one attribute. Whatever starts inside
// one (keys, pastes, drops) is that tool's, never the stage's or an
// extension's. The stage defines the marker; whoever embeds sets it. Pure.

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
