import { initSession, STATUS } from "./session.js"

/**
 * The agent session datatype.
 *
 * A session is an ordinary Patchwork document, which is the whole point: it
 * syncs, it has history, it can be shared, forked, and opened in more than one
 * view at once. The sidebar panel and the full-window tool are two views of
 * this one document.
 */
export const AgentSessionDatatype = {
  init(doc) {
    initSession(doc, { title: "Agent" })
  },

  getTitle(doc) {
    if (doc.title) return doc.title

    // An untitled session is named by what was first asked of it — much more
    // useful in a document list than forty things called "Agent".
    const firstUserTurn = (doc.turns ?? []).find((t) => t.role === "user")
    const text = (firstUserTurn?.blocks ?? []).find((b) => b.type === "text")?.text
    if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text

    return "Agent"
  },

  setTitle(doc, title) {
    doc.title = title
  },

  markCopy(doc) {
    doc.title = `Copy of ${this.getTitle(doc)}`
    // A copied session must not inherit a lease: the runner named in it is
    // working on the original, and would otherwise look live here too.
    doc.lease = null
    doc.status = STATUS.idle
  },
}

export default AgentSessionDatatype
