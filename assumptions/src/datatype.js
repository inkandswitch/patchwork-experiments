/**
 * The assumptions datatype. The shape is documented in model.js.
 */

import { ASSUMPTIONS } from "./model.js"

export const AssumptionsDatatype = {
  init(doc) {
    doc["@patchwork"] = { type: ASSUMPTIONS }
    doc.title = "Assumptions"
    doc.scope = null
    doc.entries = {}
    doc.variants = {}
  },
  getTitle(doc) {
    return doc.title || "Assumptions"
  },
  setTitle(doc, title) {
    doc.title = title
  },
}

export default AssumptionsDatatype
