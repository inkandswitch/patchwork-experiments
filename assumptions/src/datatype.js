/**
 * The assumptions datatype. The shape is documented in register.js.
 */

import { renderExport } from "./export.js"
import { ASSUMPTIONS } from "./register.js"

const SOURCE_FORMATS = { py: "python", scad: "scad", json: "json" }

export const AssumptionsDatatype = {
  init(doc) {
    doc["@patchwork"] = { type: ASSUMPTIONS }
    doc.title = "Assumptions"
    doc.scope = null
    doc.entries = {}
    doc.scan = null
  },
  getTitle(doc) {
    return doc.title || "Assumptions"
  },
  setTitle(doc, title) {
    doc.title = title
  },
  /**
   * The register as source another tool reads it as, by file extension:
   * "py", "scad" or "json" give the export (export.js: `id = value` with
   * id_min / id_max; JSON a flat id → value object), anything else null.
   * A notebook importing the register, or an OpenSCAD model, asks for this
   * through the datatype registry, so it always reads the register as it
   * is, not a pasted copy.
   *
   * `options.for`: the URL of the document asking. The results that document
   * computes itself (model entries whose model is it) are left out: a model
   * reads its inputs from the register, not its own outputs, and in
   * OpenSCAD an included `id = value` would take the place of the model's own
   * assignment and leave it undef.
   */
  asSource(doc, ext, options = {}) {
    const format = SOURCE_FORMATS[String(ext ?? "").replace(/^\./, "").toLowerCase()]
    if (!format) return null
    const asking = options?.for ? String(options.for).split("#")[0] : null
    const own = (entry) => entry?.basis === "model" && (String(entry.model?.url ?? "").split("#")[0] === asking || Object.keys(entry.model?.ran ?? {}).includes(asking))
    const entries = Object.fromEntries(Object.entries(doc?.entries ?? {}).filter(([, entry]) => !asking || !own(entry)))
    return renderExport(entries, { format, title: doc?.title ?? "" })
  },
}

export default AssumptionsDatatype
