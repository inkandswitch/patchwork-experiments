/**
 * Marking the citations in a rendered transcript as checked or not.
 *
 * markdown.js renders a citation as a link with its quote on it; this looks
 * each one up in its document (documents/citations.js) and says what it found, on the
 * link itself: `data-check` is found, missing, short or unreadable, and the
 * hover text says what that means. A citation is checked once per page and
 * the answer remembered, so re-rendering on every change costs nothing.
 */

import { checkCitation } from "../documents/citations.js"

/** url \u0000 quote -> Promise<{ status, … }> */
const checked = new Map()

/** How long to wait for a document before calling it unreadable. */
export const CHECK_TIMEOUT_MS = 10_000

const SAYS = {
  found: "in the document",
  missing: "NOT found in that document",
  short: "too short to check — quote more of the passage",
  unreadable: "could not open the document to check",
}

/** What a check found, for the hover text. */
export function describeCheck(quote, result) {
  const where = result.status === "found" && Number.isFinite(result.at) ? ` (at character ${result.at})` : ""
  return `“${quote}” — ${SAYS[result.status] ?? result.status}${where}`
}

/**
 * Check every citation under `container` not yet marked.
 *
 * `find` loads a document's contents: (url) => Promise<doc | null>.
 */
export function markCitations(container, find) {
  for (const link of container.querySelectorAll(".agent-cite:not([data-check])")) {
    const url = link.dataset.docUrl
    const quote = link.dataset.quote ?? ""
    link.dataset.check = "pending"
    const key = `${url}\u0000${quote}`
    if (!checked.has(key)) checked.set(key, checkCitation({ url, quote }, withTimeout(find)))
    checked.get(key).then((result) => {
      link.dataset.check = result.status
      link.title = describeCheck(quote, result)
    })
  }
}

function withTimeout(find) {
  return (url) =>
    Promise.race([
      Promise.resolve().then(() => find(url)),
      new Promise((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS)),
    ])
}

/** Tests only. */
export function _forgetChecks() {
  checked.clear()
}
