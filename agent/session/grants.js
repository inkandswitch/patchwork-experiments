/**
 * Approval: what a call touches, whether it must be asked about, and the
 * grants that answer for later calls.
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
 * nothing. The one rule that used to apply to every tool — url, root, else the
 * subject — was wrong for most of them, and wrong in a way that showed up on
 * the approval card: a web_search was "about" whatever document the session
 * was open on, so its card offered "this document" and "any document", and
 * "any document" wrote `web@*` — every site, for every web tool. fs_write by
 * path was "about" the subject too, though it writes wherever the path says;
 * doc_create, view_interact and the rest likewise. Only doc_read, doc_edit and
 * doc_history really default to the subject, and they say so.
 *
 * `kind` says what sort of thing the target is, so the card can say "this
 * folder — anything inside it" for a root and "this document" for a file.
 */
const DEFAULT_TARGET = { fields: ["url", "root"] }

/** What callers with no tool definition get: the historical rule, kept for them. */
const LEGACY_TARGET = { fields: ["url", "root"], fallback: "subject" }

export function callScope(block, env = null, toolDef = null) {
  const subject = typeof env === "string" ? env : (env?.subject ?? null)
  const input = block?.input ?? {}

  const spec = toolDef ? (toolDef.target === undefined ? DEFAULT_TARGET : toolDef.target) : LEGACY_TARGET
  if (spec === "none" || spec === null) return { target: null, kind: null }

  for (const field of spec.fields ?? []) {
    const value = input[field]
    if (value != null && value !== "") {
      return { target: normalizeTarget(value), kind: spec.kind ?? (field === "root" || field === "folder" ? "folder" : "document") }
    }
  }
  if (spec.fallback === "subject" && subject) return { target: normalizeTarget(subject), kind: "document" }
  return { target: null, kind: null }
}

export function callTarget(block, env = null, toolDef = null) {
  return callScope(block, env, toolDef).target
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
 * Grants are scoped to a tool AND a document.
 *
 * Scoping to the tool alone is too coarse to be safe: approving `doc_edit` once
 * would let the agent edit every document you own for the rest of the session,
 * including ones you never had in mind. A grant should mean "yes, edit THIS",
 * not "yes, edit anything".
 */
/**
 * Tools that mean the same thing to the person approving them.
 *
 * "May you read adjointlabs.com" is one decision. It was three: a real session
 * ended up holding web_fetch@adjointlabs.com, web_import@adjointlabs.com AND
 * http_request@adjointlabs.com, because every tool carried its own grant and
 * the user was asked once per tool per site. (web_import has since gone.)
 *
 * http_request is in the group only for the calls that are equivalent in power
 * to a fetch — a plain GET. Another method, or a body, still asks every time;
 * see `asksEveryTime`.
 */
const GRANT_GROUPS = {
  web_fetch: "web",
  web_search: "web",
  // Keeping a page is reading it, with its pictures: the same decision.
  // web_capture is a plugin (the Web snapshot package's), and a grouping is by
  // id, so its calls are asked about and granted with the web's all the same
  // — and a research step's standing web grant covers it.
  web_capture: "web",
  http_request: "web",
  // "May you write files" is likewise one decision; before fs_edit existed it
  // was implicitly one tool. Grants written as fs_write@… keep working.
  fs_write: "files",
  fs_edit: "files",
  fs_delete: "files",
  // Filing a kept source into a folder is writing into that folder.
  source_file: "files",
}

/** What a broad grant on this tool's group actually allows, for the button's tooltip. */
function describeGrantScope(toolId) {
  switch (grantGroup(toolId)) {
    case "web":
      return "every web fetch, capture, search and plain GET in this session"
    case "files":
      return "every file write, edit, delete and filing in this session"
    default:
      return `every ${toolId} call in this session`
  }
}

export function grantGroup(toolId) {
  return GRANT_GROUPS[toolId] ?? toolId
}

export function grantKey(toolId, target) {
  // A grant with no target is on the tool, not the group: "always allow
  // searching" must not be stored as a bare `web`, which reads as the whole
  // group and would need a rule saying it means less than it says.
  if (!target) return toolId
  return `${grantGroup(toolId)}@${normalizeTarget(target)}`
}

/**
 * Does this call ask every time, whatever has been granted?
 *
 * `alwaysAsk` may be a boolean or a function of the input, because for some
 * tools the danger is in the arguments rather than the verb: an http_request
 * GET with no credential is a fetch, and the same tool with your API key
 * attached is the most dangerous thing here.
 */
export function asksEveryTime(toolDef, input = {}) {
  const rule = toolDef?.alwaysAsk
  if (typeof rule === "function") {
    try {
      return !!rule(input ?? {})
    } catch {
      return true // a rule that throws is not a rule that grants permission
    }
  }
  return !!rule
}

/** The key that means "this tool, on anything at all". */
const ANY_TARGET = "*"

/**
 * Every grant that would cover this call, narrowest first.
 *
 * Approving each fetch individually is what made the loop unusable — the agent
 * stops on every page of a documentation site and waits for a human to agree
 * that yes, it may read the next one. So a grant can name a subtree: the exact
 * URL, any directory above it, the whole origin, or every target the tool can
 * reach.
 *
 * Matching is by generating the call's own keys and looking each up exactly, so
 * no substring comparison is ever made against a stored grant.
 */
export function grantCandidates(toolId, target) {
  const keys = []
  // The group key first, then the tool's own — so grants written before tools
  // were grouped keep working instead of silently asking again.
  const scopes = [...new Set([grantGroup(toolId), toolId])]

  for (const scope of scopes) {
    if (target == null) {
      keys.push(scope)
    } else {
      keys.push(`${scope}@${normalizeTarget(target)}`)
      for (const prefix of urlPrefixes(target)) keys.push(`${scope}@${prefix}`)
    }
    keys.push(`${scope}@${ANY_TARGET}`)
  }
  return [...new Set(keys)]
}

/**
 * The grants worth *offering* a human for this call, narrowest first.
 *
 * Not the same list as the candidates: every intermediate directory is a valid
 * grant, but a column of six buttons is a worse interface than three. So the
 * offer is the exact target, its immediate directory, the whole site, and
 * anything — the scopes people actually think in.
 */
export function grantOffers(toolId, target, kind = "document") {
  if (target == null) {
    return [{ key: toolId, label: "always", detail: `every ${toolId} call in this session` }]
  }

  const offers = []
  const isWeb = /^https?:\/\//i.test(String(target))

  if (isWeb) {
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
    if (normalizeTarget(target) !== directory) {
      offers.push({ key: grantKey(toolId, target), label: "this page", detail: String(target) })
    }
    if (directory && directory !== origin) {
      offers.push({ key: grantKey(toolId, directory), label: shortPath(directory), detail: `anything under ${directory}` })
    }
    if (origin) offers.push({ key: grantKey(toolId, origin), label: host, detail: `anything on ${host}` })
    offers.push({ key: grantKey(toolId, ANY_TARGET), label: "any site", detail: describeGrantScope(toolId) })
    return offers
  }

  // The tooltip has to say what the broad grant covers, because it is keyed by
  // group: "any document" on an fs_edit is every write, edit and delete.
  if (kind === "folder") {
    return [
      { key: grantKey(toolId, target), label: "this folder", detail: `anything inside ${target}` },
      { key: grantKey(toolId, ANY_TARGET), label: "any folder", detail: describeGrantScope(toolId) },
    ]
  }
  return [
    { key: grantKey(toolId, target), label: "this document", detail: String(target) },
    { key: grantKey(toolId, ANY_TARGET), label: "any document", detail: describeGrantScope(toolId) },
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

/**
 * Does this call still need a human decision?
 *
 *   read      runs silently: it touches nothing.
 *   self      runs silently: it touches only this conversation — its own
 *             document, or a view it opened and is now closing.
 *   edit      runs silently: it writes only automerge documents, which keep
 *             their history, so anything it does can be seen and put back —
 *             doc_history shows every overwritten value. Asking first bought
 *             nothing that history does not, and the prompts were the main
 *             thing slowing the loop down. Two exceptions, below.
 *   write     needs a grant: it does something history cannot undo.
 *   external  needs a grant: it reaches past the user's documents.
 *
 * `edit` has two exceptions, and both are about the one thing history cannot
 * undo — code that has already run:
 *
 *   - Sensitive documents always ask (see below).
 *   - A tool's `askWhen(input)` names the calls that write source code. Code in
 *     a package runs with the user's authority on its next load, and automerge
 *     has no access control, so a package someone else published is as
 *     writable as your own — editing it changes it for everyone who installed
 *     it. Those calls fall back to needing a grant, like `write`.
 *
 * Tools flagged `alwaysAsk` ignore grants entirely.
 */
export function needsApproval(doc, toolDef, block = null, subject = null, sensitive = []) {
  if (!toolDef) return true
  // "self" is a write, but only ever to the session document — the conversation
  // you are already having. Stopping to ask permission to name your own
  // conversation would be an absurd thing to put in front of someone, and
  // calling it "read" to get that behaviour would be a lie in the tool list.
  if (toolDef.risk === "read" || toolDef.risk === "self") return false
  if (asksEveryTime(toolDef, block?.input)) return true

  const target = block ? callTarget(block, subject, toolDef) : null

  // Risk belongs to the document, not only to the verb. Your module settings
  // decide what code runs on every future load, and your account is your
  // identity; a write to either deserves an explicit yes every time, whichever
  // tool is doing it. Attaching this to a bespoke "install" tool instead would
  // just mean the next tool that can write a document routes around it.
  if (target && isSensitive(target, sensitive)) return true

  if (toolDef.risk === "edit" && !writesCode(toolDef, block?.input)) return false

  // Any grant from the exact target up to "anything" answers for this call.
  const grants = doc.grants ?? {}
  return !grantCandidates(toolDef.id, target).some((key) => {
    const held = grants[key]
    return held === "session" || held === "always"
  })
}

/** Does this `edit` call write source code? A rule that throws is taken as yes. */
function writesCode(toolDef, input = {}) {
  const rule = toolDef?.askWhen
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
