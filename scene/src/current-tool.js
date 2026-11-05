// What a plain drag does for this viewer: the `tool` convention every part
// that cares reads the same way (STAGE.md, local `tool`). Pure.

/** Old docs' view.defaultMode / defaultGizmo values (and "translate"), as tools. */
const LEGACY = { translate: "move", move: "move", rotate: "rotate", hand: "hand", select: "select" };

/**
 * The tool in effect: this viewer's choice (local.tool), else the doc's
 * suggestion (view.tool, view.defaultMode, the old view.defaultGizmo), else
 * "move". "select" means no gizmo; "<ext>:<name>" is an extension's own.
 * @param {object | null} local  @param {object | null} doc
 */
export function effectiveTool(local, doc) {
  const v = local?.tool ?? doc?.view?.tool ?? doc?.view?.defaultMode ?? doc?.view?.defaultGizmo ?? "move";
  return LEGACY[v] ?? v;
}
