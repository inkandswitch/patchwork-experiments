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
   */
  asSource(doc, ext) {
    const format = SOURCE_FORMATS[String(ext ?? "").replace(/^\./, "").toLowerCase()]
    return format ? renderExport(doc?.entries ?? {}, { format, title: doc?.title ?? "" }) : null
  },
}

export default AssumptionsDatatype
