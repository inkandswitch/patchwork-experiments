import { initSession } from "./schema.js"
import { sessionTitle } from "./title.js"

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
    initSession(doc)
  },

  /**
   * What the agent called this work, else what was first asked of it.
   *
   * This used to have the fallback and never reach it: `init` set the title to
   * "Agent", so `doc.title` was always truthy and every session in the list was
   * called the same thing.
   */
  getTitle(doc) {
    return sessionTitle(doc) ?? "Agent"
  },

  setTitle(doc, title) {
    doc.title = title
  },

  markCopy(doc) {
    doc.title = `Copy of ${this.getTitle(doc)}`
    // A copied session must not inherit a lease: the runner named in it is
    // working on the original, and would otherwise look live here too.
    doc.lease = null
  },
}

export default AgentSessionDatatype
