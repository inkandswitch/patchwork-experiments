/**
 * The assumptions datatype. The shape is documented in register.js.
 */

import { ASSUMPTIONS } from "./register.js"

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
}

export default AssumptionsDatatype
