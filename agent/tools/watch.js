/**
 * doc_watch — be woken when a document, or one place inside it, changes.
 *
 * The alternative is to read the whole document again every turn to see
 * whether anything happened: slow for a big document (an OpenFOAM run carries
 * its hull and its progress), and blind between turns. A watch listens instead,
 * through a sub-handle (`handle.sub(...path)`), which is told only about
 * changes inside its own part of the document, and with the patches that made
 * them. Each change costs only what it touched (history.js editsOfPatches).
 *
 * What it hears goes to the session through events.js, which decides when a
 * wake is allowed (settled, idle, rate-limited). With `match`, only edits whose
 * new or removed value matches wake the agent — doc_history's `query`, applied
 * as things happen.
 *
 * A watch is written into the session document, through `ctx.watches`: a
 * capability the runner gives this tool alone (runner.js privileges), which
 * writes the session's `watches` map and nothing else in it.
 *
 *   watches: { [id]: { url, path, match, label, heads, at } }
 *
 * `heads` is the version of the watched document up to which every matching
 * edit has been reported. A runner that starts — a reload, another tab, a
 * newer version of this code — opens every watch again (restoreWatches) and
 * first reports what matched between `heads` and now, so nothing that happened
 * while no runner was alive is lost. While no runner is alive, nothing is
 * listening; there is no runner outside the browser.
 *
 * Edits made in this tab while the session is mid-turn are taken to be the
 * agent's own and are not reported: it made them, and a watch that woke the
 * agent about its own edits would be a loop events.js could only slow down.
 * "Made in this tab" is by actor: the repo labels every change event "change",
 * whoever made it, but a change made through this page's handle carries the
 * page's actor id, and one that arrived from the daemon or another peer
 * carries theirs. A change event with any foreign change in it is reported.
 * Someone else editing the same document in the same tab at that moment is
 * missed — the one thing a watch can miss.
 *
 * A runner catching up reports the net edits between two versions (a diff), so
 * a value that went queued → solving → failed while nobody listened is one
 * edit, from queued to failed.
 */

import { hostImport } from "./host.js"
import { preview } from "./format.js"
import { editsBetween, editsOfPatches, matchEdit, touchesPath } from "./history.js"
import { STATUS } from "../session.js"

export const MAX_WATCHES = 8
/** Edits kept for one wake; older ones are counted, not shown. */
export const KEPT_EDITS = 20
/** While nothing matches, how often the watch records how far it has looked. */
export const PERSIST_MS = 5 * 60 * 1000
const EDIT_PREVIEW = { maxString: 200, maxItems: 6, maxDepth: 3 }

/**
 * Did this page make every change between `before` and `after`? By actor: a
 * change made through this page's handle carries the document's own actor id.
 */
export function madeHere(automerge, before, after) {
  if (!before || !after) return false
  const actor = automerge.getActorId(after)
  const changes = automerge.getChanges(before, after)
  return changes.length > 0 && changes.every((c) => automerge.decodeChange(c).actor === actor)
}

/**
 * The watches open in this page, by session and id. On globalThis, as the
 * runners are (runners.js): a newer version of this module, loaded in place,
 * must find and replace the older one's watches, not run beside them.
 */
const open = (globalThis.__patchworkAgentWatches ??= new Map())
const keyOf = (sessionUrl, id) => `${sessionUrl}\u0000${id}`

/** Case-insensitive regex, or the text itself when it is not a valid one. */
export function patternOf(match) {
  if (match == null || match === "") return null
  try {
    return new RegExp(match, "i")
  } catch {
    return new RegExp(String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  }
}

/**
 * A document URL and a path. A path may be written into the URL, as a
 * sub-handle's own URL has it (`automerge:<id>/runs/3`), or given separately;
 * both are joined. Digits are list indices. A URL with heads names a version
 * that will never change, so it cannot be watched.
 */
export function splitTarget(url, path = []) {
  const text = String(url)
  if (text.includes("#")) {
    throw new Error(`${text} names a fixed version (the part after #), which never changes. Watch the document itself: ${text.split("#")[0].split("/")[0]}`)
  }
  const [doc, ...inUrl] = text.split("/")
  const segment = (s) => (typeof s === "string" && /^\d+$/.test(s) ? Number(s) : s)
  return { doc, path: [...inUrl.filter(Boolean).map(segment), ...(path ?? []).map(segment)] }
}

const pathText = (path) => (path.length ? `/${path.join("/")}` : "the whole document")

function valueAt(root, path) {
  let node = root
  for (const key of path) {
    if (node == null) return undefined
    node = node[key]
  }
  return node
}

/** Keep the edits at or under the watched path that match, each with its snippet. */
export function selectEdits(edits, path, pattern) {
  const kept = []
  for (const edit of edits) {
    if (path.length && !touchesPath(edit, path)) continue
    if (!pattern) {
      kept.push(edit)
      continue
    }
    const match = matchEdit(edit, pattern, { shown: EDIT_PREVIEW.maxString })
    if (match !== null) kept.push(match ? { ...edit, match } : edit)
  }
  return kept
}

/**
 * The edits one change event made inside the watched part, with absolute
 * paths. A sub-handle's patches are relative to its scope; `before` is the
 * whole document, so they are put back under the scope's path to replay them.
 * A change that replaced the scope wholesale is one edit of the whole of it.
 */
export function editsOfChange(payload, path) {
  const before = payload.patchInfo?.before
  if (payload.scopeReplaced) {
    const was = valueAt(before, path)
    return payload.doc === undefined
      ? [{ op: "delete", path, was }]
      : [{ op: "set", path, value: payload.doc, ...(was !== undefined ? { was } : {}) }]
  }
  const patches = (payload.patches ?? []).map((p) => ({ ...p, path: [...path, ...p.path] }))
  return editsOfPatches(patches, before ?? {})
}

/** One edit as a line the agent can act on. */
export function editLine(edit) {
  const shown = (v) => JSON.stringify(preview(v, EDIT_PREVIEW))
  const where = `/${edit.path.join("/")}`
  const parts = [`${edit.op} ${where}`]
  if ("value" in edit) parts.push(`= ${shown(edit.value)}`)
  if ("by" in edit) parts.push(`by ${edit.by}`)
  if (edit.was !== undefined) parts.push(`(was ${shown(edit.was)})`)
  if (edit.match) parts.push(`— ${edit.match}`)
  return `- ${parts.join(" ")}`
}

function describeWatch(id, spec) {
  const what = spec.match ? `, edits matching /${spec.match}/i` : ""
  return `${id}: ${spec.url} ${pathText(spec.path)}${what}${spec.label ? ` — ${spec.label}` : ""}`
}

/** The session's watches as a list the agent can read. */
export function listWatches(doc) {
  const entries = Object.entries(doc?.watches ?? {})
  if (!entries.length) return "No watches."
  return `Watching:\n${entries.map(([id, spec]) => `- ${describeWatch(id, spec)}`).join("\n")}`
}

/**
 * Listen to one watch: its document, through a sub-handle at its path, on this
 * runner's events. Replaces whatever this page already had open under the same
 * session and id. `catchUp`: report what matched since the watch's recorded
 * heads first (a runner starting); a watch just made has nothing to catch up on.
 */
export async function openWatch({ id, spec, repo, events, watches, catchUp = false, now = () => Date.now() }) {
  const key = keyOf(watches.url, id)
  open.get(key)?.close()

  const root = await repo.find(spec.url)
  const watched = spec.path.length ? root.sub(...spec.path) : root
  const pattern = patternOf(spec.match)
  const automerge = await hostImport("automerge")
  const repoModule = catchUp ? await hostImport("repo") : null

  const watch = {
    id,
    pending: [], // edits not yet reported, oldest first, at most KEPT_EDITS
    dropped: 0, // edits not kept, beyond KEPT_EDITS
    since: null, // when the oldest unreported edit arrived
    seenHeads: root.heads(), // every edit up to here was reported or did not match
    persistedAt: now(),
    alive: true,
    close: () => channel.close(),
  }

  const stillWanted = () => !!watches.doc()?.watches?.[id]

  const persist = () => {
    const heads = [...(watch.seenHeads ?? [])]
    watch.persistedAt = now()
    watches.change((all) => {
      const entry = all[id]
      if (entry) {
        entry.heads = heads
        entry.at = watch.persistedAt
      }
    })
  }

  const render = () => {
    if (!watch.alive) return ""
    if (!stillWanted()) {
      watch.close()
      return ""
    }
    if (!watch.pending.length) return ""
    const total = watch.pending.length + watch.dropped
    const lines = [
      `${spec.url} ${pathText(spec.path)}: ${total} edit${total === 1 ? "" : "s"}${spec.match ? ` matching /${spec.match}/i` : ""} since ${new Date(watch.since).toISOString()}`,
      ...(watch.dropped ? [`(${watch.dropped} earlier edit${watch.dropped === 1 ? "" : "s"} not shown; doc_history has them all)`] : []),
      ...watch.pending.map(editLine),
      `Still watching (${id}). Stop with doc_watch {stop: "${id}"} when you no longer need it.`,
    ]
    watch.pending = []
    watch.dropped = 0
    watch.since = null
    persist()
    return lines.join("\n")
  }

  const take = (edits) => {
    const kept = selectEdits(edits, spec.path, pattern)
    if (!kept.length) return false
    if (watch.since == null) watch.since = now()
    watch.pending.push(...kept)
    const over = watch.pending.length - KEPT_EDITS
    if (over > 0) {
      watch.pending.splice(0, over)
      watch.dropped += over
    }
    return true
  }

  const channel = events.open(id, {
    label: spec.label ?? `${pathText(spec.path)} of ${spec.url}`,
    onClose: () => {
      watch.alive = false
      watched.off("change", onChange)
      if (open.get(key) === watch) open.delete(key)
    },
  })

  function onChange(payload) {
    if (!watch.alive) return
    if (!stillWanted()) return watch.close()
    watch.seenHeads = root.heads()
    const mine = watches.doc()?.status === STATUS.running && madeHere(automerge, payload.patchInfo?.before, payload.patchInfo?.after)
    if (!mine && take(editsOfChange(payload, spec.path))) {
      channel.notify(render)
    } else if (!watch.pending.length && now() - watch.persistedAt >= PERSIST_MS) {
      persist()
    }
  }

  watched.on("change", onChange)
  open.set(key, watch)

  if (catchUp && spec.heads?.length) {
    const doc = root.doc()
    const from = repoModule.decodeHeads([...spec.heads])
    const to = automerge.getHeads(doc)
    if (take(editsBetween(automerge, doc, from, to))) channel.notify(render)
  }
  return watch
}

/**
 * Open every watch a session has, on a runner that is starting. Each reports
 * first what matched while nobody was listening. A watch whose document cannot
 * be found now is left in place for the next runner, and said so.
 */
export async function restoreWatches({ repo, events, store }) {
  const watches = watchesWriter(store)
  const entries = Object.entries(store.doc()?.watches ?? {})
  if (!entries.length || !events) return []
  const results = []
  for (const [id, raw] of entries) {
    const spec = { url: raw.url, path: [...(raw.path ?? [])], match: raw.match ?? null, label: raw.label ?? null, heads: raw.heads ? [...raw.heads] : null }
    try {
      await openWatch({ id, spec, repo, events: events.forTool("doc_watch"), watches, catchUp: true })
      results.push({ id, ok: true })
    } catch (err) {
      results.push({ id, ok: false, error: err?.message ?? String(err) })
    }
  }
  return results
}

/**
 * The session's watches, writable, and nothing else in it: what the runner
 * hands doc_watch (runner.js privileges) and what a starting runner restores
 * with. `doc()` reads the whole session, which every tool may.
 */
export function watchesWriter(store) {
  return {
    url: store.url,
    doc: () => store.doc(),
    change: (fn) =>
      store.change((d) => {
        if (!d.watches) d.watches = {}
        fn(d.watches)
      }),
  }
}

const newId = () => `w${Math.random().toString(36).slice(2, 6)}`

export const docWatch = {
  id: "doc_watch",
  name: "Watch a document",
  target: { fields: ["url"], fallback: "subject" },
  description: [
    "Be woken when a document — or one place inside it — changes, instead of reading it again every turn to see. Give `path` to watch only part of it (e.g. ['status'], or ['log']), and `match` (case-insensitive text or regex) to be woken only by edits whose new or removed value matches it — e.g. watch a simulation run's ['status'] with match 'failed|done', or its log with match 'error|fatal'.",
    "",
    "When something matching happens you get an event (not a message from the person) listing the edits, each with its path, new value and the value it replaced. Wakes wait for things to settle and are rate-limited (at most one every 30 s, 12 an hour), so many edits arrive together. Your own edits made while you are working are not reported.",
    "",
    "A watch lasts until you stop it: doc_watch {stop: id}, or {stop: 'all'}. It survives reloads, and what changed while no tab had this session open is reported when one opens it. Every call answers with the watches open now. Stop a watch once its job is done — a finished run, a question answered.",
  ].join("\n"),
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Document to watch. Defaults to the session's document. May carry a path (automerge:<id>/runs/0)." },
      path: {
        type: "array",
        items: { type: ["string", "number"] },
        description: "Only changes at or under this path, e.g. ['status'] or ['runs', 0]. Default: the whole document.",
      },
      match: { type: "string", description: "Only wake for edits whose new or removed value matches this (case-insensitive text or regex)." },
      label: { type: "string", description: "What this watch is for, in a few words. Shown with every wake." },
      stop: { type: "string", description: "Stop the watch with this id, or 'all'. Nothing else is needed with it." },
    },
  },
  async execute(input, ctx) {
    const session = ctx.watches
    if (!session?.change || !ctx.events) {
      throw new Error("This session cannot be woken (it has no events, or no place to keep watches), so it cannot watch. Read the document when you need it instead.")
    }

    if (input.stop) {
      const watches = session.doc()?.watches ?? {}
      const ids = input.stop === "all" ? Object.keys(watches) : [input.stop]
      const unknown = ids.filter((id) => !watches[id])
      if (unknown.length && input.stop !== "all") {
        throw new Error(`No watch ${input.stop}. ${listWatches(session.doc())}`)
      }
      session.change((all) => {
        for (const id of ids) if (all[id]) delete all[id]
      })
      for (const id of ids) open.get(keyOf(session.url, id))?.close()
      const stopped = ids.length ? `Stopped ${ids.join(", ")}.` : "There were no watches to stop."
      return `${stopped}\n${listWatches(session.doc())}`
    }

    const url = input.url ?? ctx.subject
    if (!url) throw new Error("No document specified and this session is not attached to one. Pass `url`.")
    const target = splitTarget(url, input.path ?? [])
    if (input.match != null && String(input.match).trim() === "") throw new Error("`match` is empty. Leave it out to hear every edit.")

    // Resolved through the session's own repo, so a document it may not read
    // is refused here as doc_read would refuse it.
    const handle = await ctx.repo.find(target.doc)
    const doc = handle.doc()
    if (!doc) throw new Error(`Document ${target.doc} could not be loaded.`)
    const docUrl = handle.url.split("#")[0]

    const existing = Object.entries(session.doc()?.watches ?? {})
    const same = existing.find(
      ([, w]) => w.url === docUrl && JSON.stringify([...(w.path ?? [])]) === JSON.stringify(target.path) && (w.match ?? null) === (input.match ?? null)
    )
    if (!same && existing.length >= MAX_WATCHES) {
      throw new Error(`This session already has ${MAX_WATCHES} watches; stop one first.\n${listWatches(session.doc())}`)
    }

    const id = same?.[0] ?? newId()
    const spec = { url: docUrl, path: target.path, match: input.match ?? null, label: input.label ?? null }
    session.change((all) => {
      all[id] = { ...spec, path: [...spec.path], heads: [...handle.heads()], at: Date.now() }
    })
    await openWatch({ id, spec, repo: ctx.repo, events: ctx.events, watches: session })

    const now = valueAt(doc, target.path)
    const there = now === undefined ? "Nothing is there yet; you will hear when something is." : `Now: ${JSON.stringify(preview(now, EDIT_PREVIEW))}`
    return [
      `${same ? "Already watching; updated" : "Watching"} ${docUrl} ${pathText(target.path)}${spec.match ? ` for edits matching /${spec.match}/i` : ""}, as ${id}.`,
      there,
      listWatches(session.doc()),
    ].join("\n")
  },
  summarize(input) {
    if (input?.stop) return input.stop === "all" ? "stopped all watches" : `stopped watch ${input.stop}`
    const where = input?.path?.length ? `/${input.path.join("/")}` : "document"
    return `watching ${where}${input?.match ? ` for “${input.match}”` : ""}`
  },
}

export default [docWatch]
