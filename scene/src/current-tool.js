// What a plain drag does for this viewer: the `tool` convention every part
// that cares reads the same way (STAGE.md, local `tool`). Pure.

/**
 * The tool in effect: this viewer's choice (local.tool), else the doc's
 * suggestion (view.tool), else "move". "select" means no gizmo;
 * "<ext>:<name>" is an extension's own.
 * @param {object | null} local  @param {object | null} doc
 */
export function effectiveTool(local, doc) {
  return local?.tool ?? doc?.view?.tool ?? "move";
}
