/**
 * The web-snapshot datatype: a page kept as it looked, made by web_capture.
 *
 * A snapshot is written once, in one change, and never changed after:
 * capturing the page again makes a new one. So there is no setTitle — a
 * record of what a page was should not be quietly retitled — and a new one
 * made by hand is empty until something captures into it (the view says so).
 *
 * The shape (see tools/capture.js and the README, "Keeping web pages"):
 *
 *   title, source, capture        what, from where, when and how
 *   html                          the page's bytes as received (a Uint8Array:
 *                                 a string would be a text CRDT, ~155 bytes a
 *                                 character)
 *   charset, base                 how to read them, and what links resolve against
 *   resources                     every URL found, each with one outcome
 *   blobs                         kept bytes by sha256, each once
 *   budget, tally, complete       the limits used, the counts, whether it finished
 *   text, textVia, marks          readable text and headings, for source_read
 */
export const WebSnapshotDatatype = {
  init(doc) {
    doc["@patchwork"] = { type: "web-snapshot" }
    doc.title = null
    doc.source = null
  },
  getTitle(doc) {
    return doc.title || doc.source || "Web snapshot"
  },
}

export default WebSnapshotDatatype
