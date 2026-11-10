// A whole scene doc for a test, a probe page or a publish script: exactly
// what the scene datatype's init makes (STAGE.md, "Shared maps": every map
// and list a scene has), under "@patchwork", with `fields` over it. Every
// place that writes a scene doc whole without the shell builds it here, so
// none can go without a field init gains later. No imports beyond the
// datatype: it loads as it is in node and in a probe page.
import { SceneDatatype } from "../datatype.js";

/**
 * @param {object} [fields]  top-level fields over init's. `view` and
 *   "@patchwork" are merged into init's; the rest replace them.
 * @returns {object}
 */
export function emptyScene(fields = {}) {
  const doc = {};
  SceneDatatype.init(doc);
  const { "@patchwork": patchwork = {}, view = {}, ...rest } = fields;
  return { "@patchwork": { type: "scene", ...patchwork }, ...doc, ...rest, view: { ...doc.view, ...view } };
}
