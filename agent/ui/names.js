/**
 * Who people and documents are, by name, for the session view.
 *
 * A document named here is found once and read afresh each time it is asked
 * about, so a name changed since shows at the next render. Until it is found
 * its name is not known (null), and `onChange` is called when it is.
 */

const shortId = (url) => String(url).replace(/^automerge:/, "").slice(0, 8)

export function watchNames({ repo, onChange = () => {} }) {
  const found = new Map() // url -> { handle } | { failed: true } | { pending: true }
  const authors = new Map() // contact url -> name
  let disposed = false

  function find(url) {
    let entry = found.get(url)
    if (entry) return entry
    entry = repo ? { pending: true } : { failed: true }
    found.set(url, entry)
    if (!repo) return entry
    Promise.resolve()
      .then(() => repo.find(url))
      .then(
        (handle) => found.set(url, { handle }),
        () => found.set(url, { failed: true })
      )
      .then(() => !disposed && onChange())
    return entry
  }

  return {
    /** A document's title, else its name, else the start of its id; null until it is found. */
    title(url) {
      if (!url) return null
      const entry = find(url)
      if (entry.pending) return null
      if (entry.failed) return shortId(url)
      const doc = entry.handle?.doc?.()
      return doc?.title ?? doc?.name ?? shortId(url)
    },

    /**
     * Who said each thing, once more than one person has spoken: a turn
     * records its author's contact, and the name is in that contact's
     * document. Returns contact url -> name for those found with one.
     */
    authors(doc) {
      const urls = new Set((doc?.turns ?? []).map((turn) => turn.author).filter(Boolean))
      if (urls.size >= 2) for (const url of urls) find(url)
      for (const [url, entry] of found) {
        const name = entry.handle?.doc?.()?.name
        if (name && (urls.has(url) || authors.has(url))) authors.set(url, String(name))
      }
      return authors
    },

    dispose() {
      disposed = true
    },
  }
}

/** The current user's contact URL, for attributing what they say. */
export async function myContactUrl() {
  try {
    return globalThis.accountDocHandle?.doc()?.contactUrl ?? null
  } catch {
    return null
  }
}
