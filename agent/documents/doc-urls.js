/**
 * Document URLs as a model writes them, mended where that is safe.
 *
 * A document id is a long base58 string with a checksum built in, and a model
 * copying one gets it wrong often enough to matter: a character dropped or
 * changed, or a word run onto the end ("…CjVqJvf" written as "…CjVqJvfcan").
 * Automerge rejects every such URL as "Invalid AutomergeUrl", which tells the
 * model nothing about what it meant.
 *
 * The checksum that rejects a mistyped id is also what makes mending it safe:
 * a wrong id passes it by chance about once in four billion. So:
 *
 *   1. a valid URL is used as it is;
 *   2. surrounding quotes, backticks, brackets and trailing punctuation are
 *      stripped;
 *   3. a prefix of the id that passes the checksum is the id (a run-on);
 *   4. otherwise the one id seen in this conversation within a few edits of
 *      the input is the id (a dropped or changed character);
 *   5. otherwise the call fails, saying the checksum failed and naming the
 *      nearest ids this conversation has seen.
 *
 * Mending never invents a document: every repair is either checksum-valid by
 * construction from what was written, or an id the conversation already
 * holds.
 */

import { AutomergeRepo } from "../host/modules.js"

const { isValidAutomergeUrl, interpretAsDocumentId } = AutomergeRepo

/** Does automerge itself take this as naming a document — a URL, a bare id, a legacy UUID? */
function accepted(input) {
  try {
    interpretAsDocumentId(input)
    return true
  } catch {
    return false
  }
}

const PREFIX = "automerge:"
const BASE58 = /[1-9A-HJ-NP-Za-km-z]/
const ID_RUN = /automerge:[1-9A-HJ-NP-Za-km-z]{16,64}(?:#[1-9A-HJ-NP-Za-km-z|]+)?/g

/** Shortest a document id can be; anything shorter is not worth trying. */
const MIN_ID = 20

/** How many edits apart a known id may be and still be taken as meant. */
export const MAX_EDITS = 3

/** Edit distance (insertions, deletions, substitutions) between two short strings. */
export function editDistance(a, b) {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/** Every valid document URL in some text, once each, in order of appearance. */
export function urlsIn(text) {
  const out = []
  for (const match of String(text ?? "").matchAll(ID_RUN)) {
    const url = match[0]
    if (isValidAutomergeUrl(url) && !out.includes(url)) out.push(url)
  }
  return out
}

/** The id part of a URL, without heads. */
const idOf = (url) => String(url).slice(PREFIX.length).split("#")[0]

/** Strip what commonly wraps a URL in prose: quotes, backticks, brackets, trailing punctuation. */
function unwrap(input) {
  return String(input ?? "")
    .trim()
    .replace(/^[`'"<([{]+/, "")
    .replace(/[`'">)\]}.,;:!?]+$/, "")
}

/**
 * What `input` names, mended where safe: `{ url, repaired }`. Throws a
 * `MistypedUrl` with suggestions when it cannot be mended.
 *
 *   known   valid document URLs this conversation has seen (or a function
 *           giving them, called only when the input is not valid); used for
 *           suggestions and for mending a changed or dropped character.
 */
export function repairDocUrl(input, known = []) {
  if (typeof input !== "string") return { url: input, repaired: false }
  // Anything automerge accepts is used as it is: a URL, a bare id, a UUID.
  if (isValidAutomergeUrl(input) || accepted(input)) return { url: input, repaired: false }

  const plain = unwrap(input)
  if (isValidAutomergeUrl(plain) || accepted(plain)) return { url: plain, repaired: plain !== input }
  const prefixed = plain.startsWith(PREFIX) ? plain : BASE58.test(plain[0] ?? "") ? PREFIX + plain : null
  if (!prefixed) return { url: input, repaired: false } // not a document URL at all: let the repo say so
  if (isValidAutomergeUrl(prefixed)) return { url: prefixed, repaired: true }

  const [written, heads] = prefixed.slice(PREFIX.length).split("#")
  // The id is the leading run of id characters; a word run on after a space
  // or a slash is not part of it. Too short a run is not an id at all (a web
  // address, an empty URL): the caller says what it does not name.
  const idPart = written.match(/^[1-9A-HJ-NP-Za-km-z]*/)[0]
  if (idPart.length < MIN_ID) return { url: input, repaired: false }
  // The id is fine and nothing ran on: what is wrong is elsewhere (its
  // heads), and not for this to guess at.
  if (idPart === written && isValidAutomergeUrl(PREFIX + idPart)) return { url: input, repaired: false }
  if (idPart !== written && isValidAutomergeUrl(PREFIX + idPart)) return { url: `${PREFIX}${idPart}${heads ? `#${heads}` : ""}`, repaired: true }
  const withHeads = (id) => `${PREFIX}${id}${heads ? `#${heads}` : ""}`
  // Asked for only now: finding what a conversation has seen means reading it.
  const seen = typeof known === "function" ? known() ?? [] : known
  const knownIds = [...new Set(seen.filter((url) => isValidAutomergeUrl(url)).map(idOf))]

  // A run-on: some prefix of what was written passes the checksum.
  const prefixes = []
  for (let n = idPart.length - 1; n >= MIN_ID; n--) {
    if (isValidAutomergeUrl(PREFIX + idPart.slice(0, n))) prefixes.push(idPart.slice(0, n))
  }
  const knownPrefix = prefixes.find((id) => knownIds.includes(id))
  if (knownPrefix) return { url: withHeads(knownPrefix), repaired: true }
  if (prefixes.length === 1) return { url: withHeads(prefixes[0]), repaired: true }

  // A changed, dropped or extra character: the one known id close enough.
  const near = knownIds.map((id) => ({ id, distance: editDistance(idPart, id) })).sort((a, b) => a.distance - b.distance)
  const close = near.filter((n) => n.distance <= MAX_EDITS)
  if (close.length === 1 || (close.length > 1 && close[0].distance < close[1].distance)) {
    return { url: withHeads(close[0].id), repaired: true }
  }
  throw new MistypedUrl(input, near.filter((n) => n.distance <= 10).slice(0, 3).map((n) => PREFIX + n.id))
}

/** A document URL that fails its checksum and could not be mended. */
export class MistypedUrl extends Error {
  constructor(input, suggestions = []) {
    super(
      `'${input}' is not a valid document URL: an automerge: URL carries a checksum, and this one fails it, so a character is wrong or missing. ` +
        "Copy URLs exactly as a tool result or the workspace note gave them." +
        (suggestions.length ? ` The nearest this conversation has seen: ${suggestions.join(", ")}.` : "")
    )
    this.name = "MistypedUrl"
    this.suggestions = suggestions
  }
}

/**
 * The document a reference names, in canonical form, or null when it names
 * none.
 *
 * `automerge:X`, `automerge:X#heads`, `automerge:X/a/b`, the bare id `X` and
 * the legacy UUID spelling of the same bytes are all one document, and the
 * repo will open any of them. So this asks the repo's own parser
 * (`interpretAsDocumentId`, which `repo.find` uses) rather than comparing
 * strings, which let every spelling but the first past a check.
 *
 * Surrounding whitespace is dropped first, because the tools that open a
 * reference trim it before they do; a check that did not would judge a
 * different string from the one that gets opened.
 */
export function documentIdOf(url) {
  const raw = String(url ?? "").trim()
  if (!raw) return null
  try {
    return interpretAsDocumentId(raw)
  } catch {
    return null
  }
}
