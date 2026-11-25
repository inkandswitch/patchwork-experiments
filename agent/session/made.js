/** What a session made: the documents it created or kept. */

/**
 * What this session made.
 *
 * A document the agent creates is reachable from the tool result that made it
 * and from nowhere else — so as soon as the transcript is longer than a screen,
 * the thing you asked for is lost. Six calls later "where did my tool go" has no
 * answer that does not involve scrolling and reading base58.
 *
 * So every document a tool creates is recorded here, newest first, and the view
 * keeps them one click away for the whole session. It is a list rather than a
 * set because the ORDER is the story: the last thing made is almost always the
 * thing you want.
 */
export const MAX_ARTIFACTS = 40

export function recordArtifact(doc, ref) {
  if (!doc || !ref?.url) return false
  if (!doc.made) doc.made = []

  // Re-writing a file, or answering a fetch from what was already kept,
  // updates the entry in place rather than stacking duplicates — it is the
  // same artifact.
  const existing = doc.made.findIndex((a) => a.url === ref.url)
  if (existing >= 0) {
    doc.made[existing].at = ref.at ?? Date.now()
    if (ref.name) doc.made[existing].name = ref.name
    if (ref.bytes != null) doc.made[existing].bytes = ref.bytes
    return false
  }

  const entry = {
    url: ref.url,
    name: ref.name ?? "document",
    kind: ref.kind ?? "document",
    bytes: ref.bytes ?? null,
    at: ref.at ?? Date.now(),
  }
  // A kept source says what it was fetched from, how, and whether it has text
  // to read, which is what a later fetch of the same URL checks before going
  // to the network.
  if (ref.source) {
    entry.source = ref.source
    entry.engine = ref.engine ?? null
    entry.chars = ref.chars ?? null
    // What it is — a snapshot, say — so a capture of the same page can find it.
    if (ref.what) entry.what = ref.what
  }
  doc.made.unshift(entry)
  // Only what is not a kept source is capped: this list is what a later fetch
  // checks before going to the network, so dropping an old source would send
  // the session out for a page it already has.
  let others = doc.made.filter((a) => !a.source).length
  for (let i = doc.made.length - 1; i >= 0 && others > MAX_ARTIFACTS; i--) {
    if (doc.made[i].source) continue
    doc.made.splice(i, 1)
    others--
  }
  return true
}
