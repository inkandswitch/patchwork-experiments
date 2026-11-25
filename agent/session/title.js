/** A session's title: the one it was given, or one derived from its first message. */

/** The longest a session title should be: it lives in a document list. */
export const MAX_TITLE = 60

/**
 * Name a session after the work it is doing.
 *
 * Trimmed, collapsed and capped, because this ends up in a sidebar row — and a
 * model asked for a title will sometimes hand back a sentence, or a sentence
 * with quotes around it.
 */
export function cleanTitle(text) {
  const once = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
  if (!once) return null
  return once.length > MAX_TITLE ? `${once.slice(0, MAX_TITLE - 1).trimEnd()}…` : once
}

/**
 * What to call a session that has not named itself.
 *
 * The first thing asked of it, which is nearly always a better name than
 * anything generic — and is available from the moment there is anything to
 * name at all.
 */
export function derivedTitle(doc) {
  const firstUserTurn = (doc?.turns ?? []).find((t) => t.role === "user")
  const text = (firstUserTurn?.blocks ?? []).find((b) => b.type === "text")?.text
  return cleanTitle(text)
}

/** The session's title: what it called itself, what it was asked, or nothing. */
export function sessionTitle(doc) {
  return cleanTitle(doc?.title) ?? derivedTitle(doc) ?? null
}
