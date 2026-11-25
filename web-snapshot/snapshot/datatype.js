/**
 * The web-snapshot datatype: a page kept as it looked, frozen.
 *
 * A snapshot is made empty, the Patchwork way, in whatever folder the work
 * at hand lives in, and filled once by a capture (web-capture.js): by a
 * person, from its own view, or by the agent's web_capture, which makes one
 * and fills it in the same change. After that it is never changed: a record
 * of what a page was should not be quietly redone, so capturing the page
 * again means a new snapshot. There is no setTitle for the same reason.
 *
 * What a capture cannot prevent is a second one into the same empty
 * snapshot from another peer, before the two have synced: each finds it
 * empty, and the merge mixes their fields. The view recognises that by the
 * conflict both leave on `capture` (view.js capturedTwice) and shows
 * neither.
 *
 * The shape (the README has it in full):
 *
 *   title, source, capture        what, from where, when and how; `capture`
 *                                 is null until something is captured
 *   html                          the frozen page, UTF-8 bytes (a Uint8Array:
 *                                 a string would be a text CRDT, ~155 bytes a
 *                                 character); every asset it shows is an
 *                                 `ni:` URI naming one of `blobs`
 *   base                          what the page's links were resolved against
 *   resources                     every URL found, each with one outcome
 *   blobs                         what the page shows, by sha256, each once
 *   budget, tally, complete       the limits used, the counts, whether it finished
 *   text, textVia, marks          readable text and headings, for source_read
 */

export const WEB_SNAPSHOT = "web-snapshot"

/** Does this snapshot hold a capture? Until it does, it is empty and may be captured into. */
export function isCaptured(doc) {
  return doc?.capture != null || doc?.html != null
}

export const WebSnapshotDatatype = {
  /** An empty snapshot: every field, nothing captured. */
  init(doc) {
    doc["@patchwork"] = { type: WEB_SNAPSHOT }
    doc.title = null
    doc.source = null
    doc.capture = null
    doc.html = null
    doc.base = null
    doc.resources = {}
    doc.blobs = {}
    doc.budget = null
    doc.tally = null
    doc.complete = false
    doc.text = null
    doc.textVia = null
    doc.marks = []
    doc.pages = null
    doc.missing = null
  },
  getTitle(doc) {
    return doc.title || doc.source || "Web snapshot"
  },
}

export default WebSnapshotDatatype
