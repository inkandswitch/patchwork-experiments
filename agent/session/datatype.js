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
   * What the agent called this work, else what was first asked of it. A new
   * session's title is null, not a placeholder, so that this fallback is
   * reached and the sessions in a list are not all called the same thing.
   */
  getTitle(doc) {
    return sessionTitle(doc) ?? "Agent"
  },

  setTitle(doc, title) {
    doc.title = title
  },

  markCopy(doc) {
    doc.title = `Copy of ${this.getTitle(doc)}`
    // A copied session must not inherit the burst mark: the run named in it
    // works on the original. Its marks are debris for the copy's first burst.
    if (doc.burst != null) doc.burst = null
  },
}

export default AgentSessionDatatype
