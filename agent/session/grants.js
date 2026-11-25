/**
 * Approval: what a call asks of the person, and the grants that answer for
 * later calls.
 *
 * What a call asks is worked out once, when the call is written, from the
 * tool that will run it (`askOf`), and kept on the call block as `ask`.
 * Everything after that — the card a person sees, the scopes it offers, and
 * whether a grant given since covers the call — is read from the block and
 * the session's grants, by whoever has the document. No toolset is needed to
 * decide about a call, so a view, a pop-over and a workflow's driver all
 * decide the same way.
 */

import { documentIdOf } from "../documents/doc-urls.js"

/**
 * Which document is a call about? Each tool says.
 *
 * A tool definition may carry `target`, plain JSON so a plugin can declare it:
 *
 *   target: "none"                                   acts on no document
 *   target: { fields: ["docUrl", "url"] }            the first of these given
 *   target: { fields: ["url"], fallback: "subject" } …else the session's subject
 *
 * With no declaration a call is about `input.url`, else `input.root`, else
 * nothing. Falling back to the subject is right for few tools — doc_read,
 * doc_edit and doc_history, which say so — and wrong for the rest in a way
 * that shows on the card: a web_search "about" the document the session is
 * open on offers "any document", which grants every site.
 *
 * `kind` says what sort of thing the target is, so the card can say "this
 * folder — anything inside it" for a root and "this document" for a file.
 */
const DEFAULT_TARGET = { fields: ["url", "root"] }

export function callScope(input, tool, subject = null) {
  const spec = tool?.target === undefined ? DEFAULT_TARGET : tool.target
  if (spec === "none" || spec === null) return { target: null, kind: null }

  for (const field of spec.fields ?? []) {
    const value = input?.[field]
    if (value != null && value !== "") {
      return { target: normalizeTarget(value), kind: spec.kind ?? (field === "root" || field === "folder" ? "folder" : "document") }
    }
  }
  if (spec.fallback === "subject" && subject) return { target: normalizeTarget(subject), kind: "document" }
  return { target: null, kind: null }
}

/**
 * One spelling per thing, so two grants cannot disagree about the same target.
 *
 * Only web URLs are normalized: case-folding a host is correct, and a fragment
 * never changes what is fetched. An automerge URL is already canonical and is
 * left exactly as it came.
 */
function normalizeTarget(target) {
  if (target == null) return null
  const raw = String(target)
  if (!/^https?:\/\//i.test(raw)) return raw
  try {
    const url = new URL(raw)
    url.hash = ""
    return url.href
  } catch {
    return raw
  }
}

/**
 * The directory URLs that contain this one, innermost first, ending at the origin.
 *
 *   https://docs.python.org/3/library/os.html
 *     -> https://docs.python.org/3/library/
 *        https://docs.python.org/3/
 *        https://docs.python.org/
 *
 * Prefixes are built by walking path *segments*, never by comparing strings.
 * That is the whole security argument: a grant on `https://example.com/` can
 * never be matched by `https://example.com.attacker.net/`, because the attacker
 * URL simply generates a different set of keys.
 */
export function urlPrefixes(target) {
  let url
  try {
    url = new URL(String(target ?? ""))
  } catch {
    return []
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return []

  // The directory part: everything up to and including the last slash. A page
  // is contained by its directory, not by itself.
  const directory = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) || "/"
  const segments = directory.split("/").filter(Boolean)

  const prefixes = []
  for (let depth = segments.length; depth >= 0; depth--) {
    prefixes.push(`${url.origin}/${segments.slice(0, depth).map((s) => `${s}/`).join("")}`)
  }
  return [...new Set(prefixes)]
}

/**
 * Does this call ask every time, whatever has been granted?
 *
 * `alwaysAsk` may be a boolean or a function of the input, because for some
 * tools the danger is in the arguments rather than the verb: an http_request
 * GET with no credential is a fetch, and the same tool with your API key
 * attached is the most dangerous thing here.
 */
function asksEveryTime(tool, input = {}) {
  const rule = tool?.alwaysAsk
  if (typeof rule === "function") {
    try {
      return !!rule(input ?? {})
    } catch {
      return true // a rule that throws is not a rule that grants permission
    }
  }
  return !!rule
}

/** Does this `edit` call write source code? A rule that throws is taken as yes. */
function writesCode(tool, input = {}) {
  const rule = tool?.askWhen
  if (typeof rule !== "function") return false
  try {
    return !!rule(input ?? {})
  } catch {
    return true
  }
}

/**
 * Is `target` one of the sensitive documents, however it is spelled?
 *
 * An `automerge:` reference the parser rejects counts as sensitive. Whether
 * it reaches a document then depends on what each tool does to it before
 * opening it, and the answer to "can this touch your account" must not.
 * When nothing is sensitive, nothing is.
 */
export function isSensitive(target, sensitive = []) {
  if (!sensitive.length) return false
  const id = documentIdOf(target)
  if (id) return sensitive.some((url) => documentIdOf(url) === id)
  return /^automerge:/i.test(String(target ?? "").trim())
}

/**
 * What a call asks of the person: plain data, kept on the call block.
 *
 *   scope    the name its grants on a target are kept under. A tool's own id,
 *            unless it declares a `group`: tools that mean the same thing to
 *            the person approving them share one, so "may you read
 *            adjointlabs.com" is one decision and not one per tool. A grant
 *            on the scope covers every tool in it.
 *   covers   what a grant on any target of the scope allows, in words, for
 *            the widest button's tooltip
 *   target   what the call is about, or null
 *   kind     "document" | "folder" | null
 *   always   it asks every time, whatever has been granted: the tool says so
 *            for this input (`alwaysAsk`), or the target is a sensitive
 *            document. Risk belongs to the document as well as the verb:
 *            your module settings decide what code runs on every future
 *            load, and your account is your identity, so a write to either
 *            deserves an explicit yes whichever tool is doing it.
 */
export function askOf(tool, input, { subject = null, sensitive = [] } = {}) {
  const { target, kind } = callScope(input, tool, subject)
  const scope = tool.group ?? tool.id
  return {
    scope,
    covers: tool.groupCovers ?? `every ${scope} call in this session`,
    target,
    kind,
    always: asksEveryTime(tool, input) || (!!target && isSensitive(target, sensitive)),
  }
}

/**
 * Does a call to this tool need a human decision?
 *
 *   read      runs silently: it touches nothing.
 *   self      runs silently: it touches only this conversation — its own
 *             document, or a view it opened and is now closing. It is a
 *             write, so calling it "read" would be a lie in the tool list.
 *   edit      runs silently: it writes only automerge documents, which keep
 *             their history, so anything it does can be seen and put back —
 *             doc_history shows every overwritten value. Two exceptions, below.
 *   write     needs a grant: it does something history cannot undo.
 *   external  needs a grant: it reaches past the user's documents.
 *
 * `edit` has two exceptions, and both are about the one thing history cannot
 * undo — code that has already run:
 *
 *   - Sensitive documents always ask (`askOf`).
 *   - A tool's `askWhen(input)` names the calls that write source code. Code in
 *     a package runs with the user's authority on its next load, and automerge
 *     has no access control, so a package someone else published is as
 *     writable as your own — editing it changes it for everyone who installed
 *     it. Those calls fall back to needing a grant, like `write`.
 *
 * `ask` is what `askOf` gave for the call. A call to no known tool needs one.
 */
export function needsApproval(doc, tool, input, ask) {
  if (!tool) return true
  if (tool.risk === "read" || tool.risk === "self") return false
  if (ask.always) return true
  if (tool.risk === "edit" && !writesCode(tool, input)) return false
  return !covered(doc, { tool: tool.id, ask })
}

/** The key that means "this scope, on anything at all". */
const ANY_TARGET = "*"

/**
 * The key a grant is kept under. A grant with no target is on the tool, not
 * the scope: "always allow searching" must not be stored as a bare `web`,
 * which reads as the whole group.
 */
function grantKey(call, target = call.ask.target) {
  return target ? `${call.ask.scope}@${normalizeTarget(target)}` : call.tool
}

/** The key of a grant on exactly what this call is about: what "yes, and from now on" means. */
export const ownGrant = (call) => grantKey(call)

/**
 * Every grant that would cover this call, narrowest first.
 *
 * Approving each fetch individually is what makes a loop unusable — the agent
 * stops on every page of a documentation site and waits for a human to agree
 * that yes, it may read the next one. So a grant can name a subtree: the exact
 * URL, any directory above it, the whole origin, or every target the scope
 * can reach.
 *
 * Matching is by generating the call's own keys and looking each up exactly, so
 * no substring comparison is ever made against a stored grant.
 */
export function grantCandidates(call) {
  const { scope, target } = call.ask
  if (target == null) return [call.tool, `${scope}@${ANY_TARGET}`]
  return [...new Set([`${scope}@${normalizeTarget(target)}`, ...urlPrefixes(target).map((prefix) => `${scope}@${prefix}`), `${scope}@${ANY_TARGET}`])]
}

/**
 * Do the session's grants answer for this call? Never for one that asks
 * every time, nor for one that does not say what it asks (a call to a tool
 * the runner that wrote it did not know).
 */
export function covered(doc, call) {
  if (!call?.ask || call.ask.always) return false
  const grants = doc?.grants ?? {}
  return grantCandidates(call).some((key) => !!grants[key])
}

/**
 * The grants worth *offering* a human for this call, narrowest first; none
 * for a call that asks every time.
 *
 * Not the same list as the candidates: every intermediate directory is a valid
 * grant, but a column of six buttons is a worse interface than three. So the
 * offer is the exact target, its immediate directory, the whole site, and
 * anything — the scopes people actually think in.
 */
export function grantOffers(call) {
  const ask = call?.ask
  if (!ask || ask.always) return []
  const { target, kind } = ask
  if (target == null) return [{ key: call.tool, label: "always", detail: `every ${call.tool} call in this session` }]

  if (/^https?:\/\//i.test(String(target))) {
    const offers = []
    const prefixes = urlPrefixes(target)
    const origin = prefixes[prefixes.length - 1]
    const directory = prefixes[0]
    let host = target
    try {
      host = new URL(target).host
    } catch {
      /* keep the raw string */
    }

    // Only offer the exact URL when it is not already the directory, otherwise
    // two buttons would mean the same thing.
    if (normalizeTarget(target) !== directory) offers.push({ key: grantKey(call, target), label: "this page", detail: String(target) })
    if (directory && directory !== origin) offers.push({ key: grantKey(call, directory), label: shortPath(directory), detail: `anything under ${directory}` })
    if (origin) offers.push({ key: grantKey(call, origin), label: host, detail: `anything on ${host}` })
    offers.push({ key: grantKey(call, ANY_TARGET), label: "any site", detail: ask.covers })
    return offers
  }

  // The tooltip says what the broad grant covers, because it is keyed by
  // scope: "any document" on an fs_edit is every write, edit and delete.
  const noun = kind === "folder" ? "folder" : "document"
  return [
    { key: grantKey(call, target), label: `this ${noun}`, detail: kind === "folder" ? `anything inside ${target}` : String(target) },
    { key: grantKey(call, ANY_TARGET), label: `any ${noun}`, detail: ask.covers },
  ]
}

/** `https://docs.python.org/3/library/` -> `/3/library/`, for a button label. */
function shortPath(url) {
  try {
    const path = new URL(url).pathname
    return path.length > 28 ? `…${path.slice(-27)}` : path
  } catch {
    return String(url)
  }
}
