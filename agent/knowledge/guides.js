/**
 * Usage guides: what the agent has learned about using one package's tools.
 *
 * Every session used to learn a package's tools from scratch — one scene step
 * read 168k characters of plugin source to learn how to build a scene. A guide
 * is that knowledge kept: one markdown document per package, in a "Tool guides"
 * folder inside the agent's notes folder, so people open, read and correct it
 * like any note. It is written for a future agent: the package's tools,
 * datatypes and agent tools, their inputs in the agent's words, working
 * recipes, and the pitfalls found.
 *
 * Each guide is PINNED to the package it describes: the package's document and
 * its heads at the time the guide was last reviewed against it. The pin is a
 * snapshot of the whole package tree (the folder's heads, and every file's
 * heads), because a file's edits are in the file's own document and never move
 * the folder's heads. Comparing a pin with the package as it is now gives four
 * states, and only these:
 *
 *   current   the package is exactly as it was when the guide was reviewed
 *   stale     it has changed since; the guide may be wrong
 *   gone      the package cannot be loaded here
 *   unpinned  the guide names a package but was never checked against it
 *
 * A guide that is current is not re-read against the package. A stale one is
 * reviewed against `guide_changes` (which files changed, a bounded diff) and
 * then re-pinned. The pin moves only when the agent says it reviewed (or when
 * the guide is first written or already current), so a pitfall added to a stale
 * guide cannot silently vouch for changes nobody looked at.
 *
 * Layout: `Agent notes/Tool guides/<name>.md`, each with a small frontmatter
 * naming its package, and `pins.json` beside them holding the pins (machine
 * data: whole-tree heads, too long to read). Notes (notes.js) skip folders, so
 * guides never appear among them.
 */

import { AutomergeRepo } from "../host/modules.js"
import { fsWrite, createFolder, contentToText, isFolder, treeNode, treeEntries, treeEnter } from "../tools/folders.js"
import { notesFolder, noteFileName, looksLikeCredential } from "./notes.js"
import { truncate } from "../documents/format.js"

const { parseAutomergeUrl } = AutomergeRepo

export const GUIDES_FOLDER_NAME = "Tool guides"
const PINS_FILE = "pins.json"
const README = "README.md"
const README_TEXT = `# Tool guides

The agent keeps one guide per package here: how to use that package's tools,
with recipes and pitfalls, so no session has to work it out again.

Each guide is pinned to the version of the package it was last checked against.
When the package changes, the agent is told the guide may be out of date and
reviews it against what changed. You can correct a guide like any document;
\`pins.json\` is bookkeeping for the pins and is not meant to be edited.
`

/** How many guides the prompt lists, and how long a guide may be when surfaced. */
const LIST_LIMIT = 40
export const SURFACE_CHARS = 6000
const WALK_MS = 5000
const MAX_FILES = 600
/** Files that are build output or tooling: their changes are listed, never diffed. */
const NO_DIFF = /^(dist|node_modules|\.pushwork)\//
const SKIP_WALK = /^(node_modules|\.pushwork)(\/|$)/

const bare = (url) => String(url ?? "").split("#")[0]

// ---------------------------------------------------------------- packages

/**
 * The package folder an import URL names: `{ url, heads }`, or null for one
 * hosted elsewhere. `heads` is set when the package is installed pinned
 * (`automerge:<id>#<heads>`): that version is the one in use, so it is the one
 * a guide is compared with.
 */
export function packageRef(importUrl) {
  const raw = String(importUrl ?? "")
  if (!raw) return null
  const hash = raw.indexOf("#")
  const headsPart = hash === -1 ? "" : raw.slice(hash + 1).split("?")[0]
  const heads = headsPart ? headsPart.split("|").filter(Boolean) : null
  if (raw.startsWith("automerge:")) return { url: bare(raw).split("?")[0], heads }
  try {
    const first = decodeURIComponent(new URL(raw).pathname.split("/")[1] ?? "")
    return first.startsWith("automerge:") ? { url: bare(first), heads: null } : null
  } catch {
    return null
  }
}

/**
 * The package behind one registered plugin, as `ctx.packageOf` answers:
 * `{ url, heads, name }`, or null. Each runner looks the plugin up in what it
 * has — the page in its registry (runners/tab.js), the SharedWorker in the
 * index the page sends it (runners/worker-plugins.js) — and both answer through this.
 */
export function packageOfPlugin(plugin) {
  const ref = plugin?.importUrl ? packageRef(plugin.importUrl) : null
  return ref ? { ...ref, name: plugin.name ?? plugin.id } : null
}

const sameSet = (a, b) => {
  const x = [...(a ?? [])].sort().join("|")
  const y = [...(b ?? [])].sort().join("|")
  return x === y
}

const within = (promise, ms, what) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not load in ${ms} ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })

/** Heads of a file entry: the ones its URL pins, else its document's own. */
async function fileHeads(repo, entry, until) {
  const pinned = entry.url && String(entry.url).includes("#") ? parseAutomergeUrl(entry.url).heads : null
  if (pinned?.length) return [...pinned]
  const handle = await within(repo.find(bare(entry.url)), Math.max(200, until - Date.now()), "a file")
  return [...handle.heads()]
}

/**
 * The package as it is: the folder's heads and every file's heads, by path.
 * `{ heads, files: { path: [heads] }, truncated }`; throws when the package
 * itself cannot be loaded (state "gone"). A file that cannot be loaded is
 * recorded as `null`, which equals nothing, so it reads as changed.
 */
export async function packageSnapshot(repo, ref, { timeoutMs = WALK_MS } = {}) {
  const until = Date.now() + timeoutMs
  const handle = await within(repo.find(ref.url), timeoutMs, "the package")
  const rootHandle = ref.heads?.length ? handle.view([...ref.heads]) : handle
  const root = treeNode(rootHandle)
  if (!root) throw new Error(`${ref.url} is not a package folder.`)

  const files = {}
  let truncated = false
  const walk = async (node, prefix, depth) => {
    for (const entry of treeEntries(node)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (SKIP_WALK.test(path)) continue
      if (Object.keys(files).length >= MAX_FILES || Date.now() > until) {
        truncated = true
        return
      }
      if (entry.type === "folder" && depth < 8) {
        const { node: inside } = await treeEnter(repo, entry).catch(() => ({}))
        if (inside) {
          await walk(inside, path, depth + 1)
          continue
        }
      }
      files[path] = await fileHeads(repo, entry, until).catch(() => null)
    }
  }
  await walk(root, "", 0)
  return { heads: [...rootHandle.heads()], files, truncated }
}

/** What differs between a pinned snapshot and one taken now. Empty when they match. */
export function compareSnapshots(pinned, now) {
  const before = pinned.files ?? {}
  const after = now.files ?? {}
  const added = Object.keys(after).filter((p) => !(p in before)).sort()
  const removed = Object.keys(before).filter((p) => !(p in after)).sort()
  const changed = Object.keys(after)
    .filter((p) => p in before && (before[p] == null || after[p] == null || !sameSet(before[p], after[p])))
    .sort()
  const structure = !sameSet(pinned.heads, now.heads)
  return { added, removed, changed, structure, same: !added.length && !removed.length && !changed.length && !structure }
}

// ------------------------------------------------------------------ guides

/** `{ meta, body }` from a guide's text; meta is the frontmatter's `key: value` lines. */
export function parseGuide(text) {
  const match = String(text ?? "").match(/^---\n([\s\S]*?)\n---\n?/)
  const meta = {}
  if (!match) return { meta, body: String(text ?? "") }
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: String(text).slice(match[0].length) }
}

function guideText(meta, body) {
  const head = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join("\n")
  return `---\n${head}\n---\n${String(body).trim()}\n`
}

const firstLineOf = (body) =>
  truncate(String(body).split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "", 140)
const titleOf = (body, fallback) => {
  const heading = String(body).split("\n").find((l) => l.trim().startsWith("# "))
  return heading ? heading.trim().slice(2).trim() : fallback
}

/** The guides folder inside the notes folder: found by name, made when asked. Null with nowhere to keep notes. */
export async function guidesFolder(ctx, { create = false } = {}) {
  if (ctx.guidesFolderUrl) return ctx.guidesFolderUrl
  const notesUrl = await notesFolder(ctx, { create })
  if (!notesUrl) return null
  const notesHandle = await ctx.repo.find(notesUrl)
  const entry = (notesHandle.doc()?.docs ?? []).find((e) => e.type === "folder" && e.name === GUIDES_FOLDER_NAME)
  let found = entry?.url ?? null
  if (!found && create) {
    const folder = await createFolder(ctx.repo, GUIDES_FOLDER_NAME)
    notesHandle.change((d) => { d.docs.push({ name: GUIDES_FOLDER_NAME, type: "folder", url: folder.url }) })
    found = folder.url
    await fsWrite.execute({ root: found, path: README, content: README_TEXT }, ctx)
  }
  if (found) ctx.guidesFolderUrl = found
  return found
}

async function readPins(ctx, folderUrl) {
  const folder = (await ctx.repo.find(folderUrl)).doc()
  const entry = (folder?.docs ?? []).find((e) => e.name === PINS_FILE)
  if (!entry) return {}
  try {
    return JSON.parse(contentToText((await ctx.repo.find(entry.url)).doc()?.content)) ?? {}
  } catch {
    return {}
  }
}

/**
 * Every guide: `{ file, name, summary, url, package, text, body, pin }`,
 * `package` being the folder URL it describes (null when the guide names
 * none) and `pin` its pin (null when unpinned).
 */
export async function listGuides(ctx) {
  const folderUrl = await guidesFolder(ctx)
  if (!folderUrl) return { folderUrl: null, guides: [] }
  const folder = (await ctx.repo.find(folderUrl)).doc()
  const pins = await readPins(ctx, folderUrl)
  const guides = []
  for (const entry of folder?.docs ?? []) {
    if (entry.type === "folder" || !/\.md$/i.test(entry.name) || entry.name === README) continue
    let text = ""
    try {
      text = contentToText((await ctx.repo.find(entry.url)).doc()?.content)
    } catch {
      /* unreadable: listed by name */
    }
    const { meta, body } = parseGuide(text)
    const pkg = meta.package ? bare(meta.package) : null
    guides.push({
      file: entry.name,
      name: meta.name || titleOf(body, entry.name.replace(/\.md$/i, "")),
      summary: firstLineOf(body),
      url: entry.url,
      package: pkg,
      text,
      body,
      pin: pkg ? pins[pkg] ?? null : null,
    })
  }
  guides.sort((a, b) => a.file.localeCompare(b.file))
  return { folderUrl, guides }
}

/** The guide for a package (by folder URL), or null. */
export async function guideFor(ctx, packageUrl) {
  const wanted = bare(packageUrl)
  return (await listGuides(ctx)).guides.find((g) => g.package === wanted) ?? null
}

/**
 * Where a guide stands against its package, as it is now.
 * `{ state, changes?, snapshot? }`; `heads` is the version in use when the
 * package is installed pinned. Never throws: a package that cannot be read is
 * `gone`.
 */
export async function guideState(ctx, guide, { heads = null } = {}) {
  if (!guide.package) return { state: "unpinned" }
  let snapshot
  try {
    snapshot = await packageSnapshot(ctx.repo, { url: guide.package, heads })
  } catch {
    return { state: "gone" }
  }
  if (!guide.pin) return { state: "unpinned", snapshot }
  const changes = compareSnapshots(guide.pin, snapshot)
  return changes.same ? { state: "current", snapshot } : { state: "stale", changes, snapshot }
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const when = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "an earlier time" : DATE.format(d)
}

/** One state, in words a person (and a model) can read. */
export function describeState({ state, changes }, guide) {
  const on = guide?.pin?.reviewed ? when(guide.pin.reviewed) : null
  switch (state) {
    case "current":
      return `Up to date: the package is unchanged since this guide was checked against it${on ? ` on ${on}` : ""}.`
    case "stale": {
      const n = changes.added.length + changes.removed.length + changes.changed.length
      const what = n ? `${n} file${n === 1 ? "" : "s"} changed` : "its folder changed"
      return `May be out of date: ${what} in the package since this guide was checked${on ? ` on ${on}` : ""}.`
    }
    case "gone":
      return "The package is not available here, so this guide cannot be checked."
    default:
      return "Not checked against the package yet."
  }
}

// ----------------------------------------------------------------- changes

/**
 * A line diff of two texts, bounded: the common head and tail are trimmed, the
 * middle is aligned by longest common subsequence when it is small enough and
 * shown as one replaced block when not, and at most `maxLines` lines are shown.
 */
export function lineDiff(before, after, maxLines = 60) {
  const a = String(before ?? "").split("\n")
  const b = String(after ?? "").split("\n")
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const x = a.slice(head, a.length - tail)
  const y = b.slice(head, b.length - tail)
  const out = []
  if (x.length * y.length <= 160_000) {
    const n = x.length
    const m = y.length
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { i++; j++ }
      else if (j < m && (i === n || table[i][j + 1] >= table[i + 1][j])) out.push({ at: head + j + 1, line: `+ ${y[j++]}` })
      else out.push({ at: head + i + 1, line: `- ${x[i++]}` })
    }
  } else {
    x.forEach((line, i) => out.push({ at: head + i + 1, line: `- ${line}` }))
    y.forEach((line, j) => out.push({ at: head + j + 1, line: `+ ${line}` }))
  }
  const shown = out.slice(0, maxLines).map((e) => e.line)
  return { lines: shown, more: Math.max(0, out.length - shown.length), firstLine: out[0]?.at ?? null }
}

async function textAt(repo, url, heads) {
  const handle = await repo.find(bare(url))
  const doc = heads?.length ? handle.view([...heads]).doc() : handle.doc()
  return contentToText(doc?.content)
}

/**
 * What changed in a package since a guide was pinned: the files, and for text
 * files a bounded diff. Returns words, ready for the model or a person.
 */
export async function describeChanges(ctx, guide, { heads = null, file = null, maxFiles = 8, maxLines = 40 } = {}) {
  const now = await guideState(ctx, guide, { heads })
  if (now.state === "gone") return describeState(now, guide)
  if (now.state === "unpinned") return `${describeState(now, guide)} There is no earlier version to compare with; read the package (plugin_source) and review the guide against it.`
  if (now.state === "current") return describeState(now, guide)

  const { changes, snapshot } = now
  const lines = [describeState(now, guide), ""]
  const list = (label, paths) => paths.length && lines.push(`${label}: ${paths.join(", ")}`)
  list("Added", changes.added)
  list("Removed", changes.removed)
  list("Changed", changes.changed)
  if (!changes.added.length && !changes.removed.length && !changes.changed.length) lines.push("Only the package folder's own structure changed; no file's content differs.")
  if (snapshot.truncated) lines.push("(The package is large; only part of it was compared.)")

  const diffable = (file ? [file] : changes.changed.filter((p) => !NO_DIFF.test(p))).slice(0, file ? 1 : maxFiles)
  for (const path of diffable) {
    if (!(path in snapshot.files) || !(path in (guide.pin.files ?? {}))) continue
    lines.push("", `--- ${path}`)
    try {
      const entryUrl = await fileUrlOf(ctx.repo, guide.package, snapshot.heads, path)
      const before = await textAt(ctx.repo, entryUrl, guide.pin.files[path])
      const after = await textAt(ctx.repo, entryUrl, snapshot.files[path])
      const diff = lineDiff(before, after, file ? maxLines * 10 : maxLines)
      lines.push(...(diff.lines.length ? diff.lines : ["(no text difference)"]))
      if (diff.more) lines.push(`… ${diff.more} more changed lines${file ? "" : `; guide_changes with file: "${path}" shows more`}`)
    } catch {
      lines.push("(the earlier version of this file is not available here)")
    }
  }
  if (!file && changes.changed.filter((p) => !NO_DIFF.test(p)).length > maxFiles) lines.push("", `…and more changed files; pass \`file\` for any one.`)
  return lines.join("\n")
}

/** The URL of one file in the package tree, by path. */
async function fileUrlOf(repo, packageUrl, _heads, path) {
  let node = treeNode(await repo.find(packageUrl))
  const parts = path.split("/")
  for (let i = 0; i < parts.length; i++) {
    const entry = treeEntries(node).find((e) => e.name === parts[i])
    if (!entry) throw new Error("gone")
    if (i === parts.length - 1) return entry.url
    node = (await treeEnter(repo, entry)).node
  }
  throw new Error("gone")
}

// ----------------------------------------------------------------- surfacing

/** Who asked, for a plain-words line: the package's name as the registry has it, else the guide's, else its id. */
const labelOf = (ref, guide, name) => guide?.name ?? ref.name ?? name ?? ref.url

/**
 * The notice to put after a tool result when a session first uses a package:
 * its guide (with where it stands) or, with none, the nudge to write one.
 * Once per package per session — `ctx.guidesShown` remembers. Null when there
 * is nothing to say. Never throws.
 */
export async function guideNotice(ctx, ref, { name = null, body = true } = {}) {
  if (!ref?.url || !ctx?.repo) return null
  const shown = (ctx.guidesShown ??= new Set())
  if (shown.has(ref.url)) return null
  shown.add(ref.url)
  try {
    const guide = await guideFor(ctx, ref.url)
    if (!guide) {
      if (!body) return null
      return `No usage guide for ${labelOf(ref, null, name)} yet (package ${ref.url}). Once you have worked out how to use it, write one with guide_write so the next session does not start from scratch.`
    }
    const now = await guideState(ctx, guide, { heads: ref.heads })
    const header = `Usage guide for ${labelOf(ref, guide, name)} (guide_read opens it again). ${describeState(now, guide)}`
    if (!body) return `${header}`
    const hint =
      now.state === "stale" || now.state === "unpinned"
        ? `\nSee guide_changes for what changed. After you have checked the guide against it, guide_write with reviewed: true (or guide_pin) to record that.`
        : ""
    return `${header}${hint}\n\n${truncate(guide.body.trim(), SURFACE_CHARS)}`
  } catch {
    return null
  }
}

/**
 * The packages a finished call is about. Each is `{ ref, name, body }`: `body`
 * false where a mention is only a lookup (a registry listing).
 */
export async function packagesOfCall(ctx, call, tool, output) {
  const found = []
  const add = (ref, name, body = true) => ref && found.push({ ref, name, body })
  const input = call.input ?? {}
  const lookup = async (type, id) => {
    try {
      return (await ctx.packageOf?.(type, id)) ?? null
    } catch {
      return null
    }
  }

  // A plugin's own tool: the package that provided it.
  if (tool?.source) add(packageRef(tool.source), tool.name ?? null)

  switch (call.tool) {
    case "view_mount": {
      if (input.url) add(packageRef(input.url), null)
      else if (input.toolId) add(await lookup("patchwork:tool", input.toolId), input.toolId)
      else if (input.docUrl && ctx.repo) {
        const type = await datatypeOf(ctx, input.docUrl)
        if (type) add(await lookup("patchwork:datatype", type), type)
      }
      break
    }
    case "doc_create":
      if (input.datatype) add(await lookup("patchwork:datatype", input.datatype), input.datatype)
      break
    case "plugin_source":
      if (input.id) add(await lookup(input.type ?? "patchwork:tool", input.id), input.id)
      break
    case "registry_list": {
      // A listing names many plugins: say which have guides, without their text.
      let type = null
      for (const line of String(output ?? "").split("\n")) {
        const heading = line.match(/^(\S+) \(\d+\)$/)
        if (heading) type = heading[1]
        else if (type && /^ {2}\S/.test(line)) {
          const id = line.trim().split(/\s/)[0]
          const ref = await lookup(type, id)
          if (ref && !found.some((f) => f.ref.url === ref.url)) add(ref, id, false)
        }
      }
      break
    }
  }
  return found
}

async function datatypeOf(ctx, docUrl) {
  try {
    const doc = (await within(ctx.repo.find(bare(docUrl)), 2000, "the document")).doc()
    return doc?.["@patchwork"]?.type ?? null
  } catch {
    return null
  }
}

/** Everything to append to a call's result, or null. */
export async function surfaceGuides(ctx, call, tool, output) {
  if (!ctx?.repo || !ctx.rootFolderUrl) return null
  try {
    const packages = await packagesOfCall(ctx, call, tool, output)
    const notices = []
    for (const { ref, name, body } of packages) {
      const notice = await guideNotice(ctx, ref, { name, body })
      if (notice) notices.push(notice)
    }
    return notices.length ? notices.join("\n\n") : null
  } catch {
    return null
  }
}

// -------------------------------------------------------------- system prompt

/** The prompt's list of guides, one line each. Reads no packages: state is checked when a guide is used. */
export async function guidesSection(ctx) {
  if (!ctx.rootFolderUrl) return null
  const { guides } = await listGuides(ctx)
  const lines = [
    "## Package usage guides",
    "",
    `You keep one usage guide per package whose tools you have worked out how to use, in "${GUIDES_FOLDER_NAME}" inside your notes folder. Each is pinned to the version of the package it was checked against.`,
  ]
  if (guides.length) {
    lines.push("", "Guides you have:")
    for (const g of guides.slice(0, LIST_LIMIT)) lines.push(`- ${g.name}${g.summary ? ` — ${g.summary}` : ""}`)
    if (guides.length > LIST_LIMIT) lines.push(`- …and ${guides.length - LIST_LIMIT} more; guide_read with no package lists them all.`)
    lines.push("", "The first time you use a package's tool, datatype or view, its guide arrives with the result, marked if the package has changed since. Read it instead of the package's source.")
  } else {
    lines.push("", "You have none yet.")
  }
  lines.push(
    "How a package works is kept in its guide, not in a loose note: after you first work out how to use a package, guide_write one; when you find a pitfall or workaround in a package that has a guide, update that guide. Notes are for everything else."
  )
  return lines.join("\n")
}

// --------------------------------------------------------------- for people

/** Each guide with where it stands, in words: what a person sees. */
export async function guidesOverview(ctx) {
  const { guides } = await listGuides(ctx)
  const rows = []
  for (const guide of guides) {
    const now = await guideState(ctx, guide)
    rows.push({ name: guide.name, url: guide.url, summary: guide.summary, state: now.state, words: describeState(now, guide) })
  }
  return rows
}

// --------------------------------------------------------------------- tools

/** A package named by folder URL or, where the page has a registry, plugin id. */
async function resolvePackage(ctx, input) {
  const named = String(input.package ?? "").trim()
  if (!named) throw new Error("Name the package: its folder URL (the automerge: URL a guide notice or plugin_source gives) or a plugin id.")
  const direct = packageRef(named)
  if (direct) return { ref: direct, name: null }
  const type = input.type ?? "patchwork:tool"
  const found = await ctx.packageOf?.(type, named)
  if (found) return { ref: found, name: found.name ?? named }
  const guide = (await listGuides(ctx)).guides.find((g) => g.name.toLowerCase() === named.toLowerCase() || g.file.replace(/\.md$/i, "") === named.toLowerCase())
  if (guide?.package) return { ref: { url: guide.package, heads: null }, name: guide.name }
  throw new Error(`Could not find the package '${named}'. Pass its folder URL (plugin_source's list shows it).`)
}

async function writePin(ctx, folderUrl, packageUrl, snapshot, name) {
  const pins = await readPins(ctx, folderUrl)
  pins[packageUrl] = {
    name: name ?? pins[packageUrl]?.name ?? null,
    reviewed: new Date().toISOString(),
    heads: snapshot.heads,
    files: snapshot.files,
  }
  await fsWrite.execute({ root: folderUrl, path: PINS_FILE, content: JSON.stringify(pins, null, 1) + "\n" }, ctx)
}

const PACKAGE_PROP = {
  type: "string",
  description: "The package: its folder's automerge: URL (a guide notice, plugin_source's list, or registry_list with urls: true gives it) or a plugin id of an installed package.",
}

export const guideRead = {
  id: "guide_read",
  name: "Read a usage guide",
  description:
    "Read the usage guide for a package, with whether the package has changed since the guide was last checked. With no `package`, list every guide and where it stands. A guide also arrives by itself the first time you use a package.",
  where: "worker",
  risk: "read",
  input_schema: { type: "object", properties: { package: PACKAGE_PROP } },
  async execute(input, ctx) {
    const { folderUrl, guides } = await listGuides(ctx)
    if (!folderUrl) return "You have no guides yet."
    if (!String(input.package ?? "").trim()) {
      if (!guides.length) return "You have no guides yet."
      const lines = []
      for (const g of guides) {
        const now = await guideState(ctx, g)
        lines.push(`- ${g.name}${g.summary ? ` — ${g.summary}` : ""}\n  ${describeState(now, g)} (package ${g.package ?? "unknown"})`)
      }
      return lines.join("\n")
    }
    const { ref } = await resolvePackage(ctx, input)
    const guide = guides.find((g) => g.package === ref.url)
    if (!guide) return `No guide for ${ref.url} yet. Write one with guide_write once you have worked out how to use it.`
    const now = await guideState(ctx, guide, { heads: ref.heads })
    const hint = now.state === "stale" || now.state === "unpinned" ? "\nguide_changes shows what changed." : ""
    return `${describeState(now, guide)}${hint}\n\n${guide.body.trim()}`
  },
  summarize(input, output) {
    return input?.package ? `read guide ${input.package}` : `listed guides · ${String(output ?? "").split("\n").filter((l) => l.startsWith("- ")).length}`
  },
}

export const guideChanges = {
  id: "guide_changes",
  name: "See what changed since a guide was checked",
  description:
    "For a guide that may be out of date: which of the package's files were added, removed or changed since the guide was last checked, and a bounded diff of each changed text file. Review the guide against this, fix what is wrong, then record it with guide_write (reviewed: true) or guide_pin. Pass `file` for the full diff of one file.",
  where: "worker",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["package"],
    properties: { package: PACKAGE_PROP, file: { type: "string", description: "A path from the list of changed files, for more of that file's diff." } },
  },
  async execute(input, ctx) {
    const { ref } = await resolvePackage(ctx, input)
    const guide = await guideFor(ctx, ref.url)
    if (!guide) return `No guide for ${ref.url}.`
    return describeChanges(ctx, guide, { heads: ref.heads, file: input.file ?? null })
  },
  summarize(input) {
    return `changes since guide · ${input?.package ?? ""}`
  },
}

export const guidePin = {
  id: "guide_pin",
  name: "Record that a guide was reviewed",
  description:
    "Record that you checked a guide against the package as it is now and it is right (or you have just corrected it), so it is no longer flagged. Do this only after reading guide_changes: it says you reviewed.",
  where: "worker",
  risk: "edit",
  input_schema: { type: "object", required: ["package"], properties: { package: PACKAGE_PROP } },
  async execute(input, ctx) {
    const { ref, name } = await resolvePackage(ctx, input)
    const guide = await guideFor(ctx, ref.url)
    if (!guide) throw new Error(`No guide for ${ref.url} to pin. Write one with guide_write.`)
    const snapshot = await packageSnapshot(ctx.repo, ref)
    await writePin(ctx, await guidesFolder(ctx, { create: true }), ref.url, snapshot, name ?? guide.name)
    return `Pinned the ${guide.name} guide to the package as it is now (${Object.keys(snapshot.files).length} files).`
  },
  summarize(input) {
    return `pinned guide · ${input?.package ?? ""}`
  },
}

export const guideWrite = {
  id: "guide_write",
  name: "Write a usage guide",
  description: [
    "Write or update the usage guide for one package, so no later session has to learn its tools from scratch. One guide per package; writing again replaces it, so guide_read it first and write the whole guide back.",
    "",
    "Write it for a future agent who has not seen the package, and for a person who may open it: start with `# Title` and one line saying what the package is for, then",
    "- the package's tools, datatypes and agent tools, and what each is for;",
    "- their inputs, in your own words (what you pass, where the values come from);",
    "- working recipes: the exact steps that worked, in order;",
    "- pitfalls, and the workaround you found for each.",
    "Say why, not only what. Leave out anything you could read straight off the tool's description. Never write a credential.",
    "",
    "When you discover a pitfall or workaround for a package that has a guide, add it here, not in a note.",
    "",
    "The guide is pinned to the package as it is now. If the guide was flagged as possibly out of date, it stays flagged unless you pass `reviewed: true`, which says you read guide_changes and the guide is right for the current package.",
  ].join("\n"),
  where: "worker",
  risk: "edit",
  input_schema: {
    type: "object",
    required: ["package", "content"],
    properties: {
      package: PACKAGE_PROP,
      name: { type: "string", description: "What the package is called, e.g. 'OpenFOAM'. Defaults to the title." },
      content: { type: "string", description: "The whole guide, in markdown, starting with '# Title' and a one-line summary." },
      reviewed: { type: "boolean", description: "Only for a guide that was flagged out of date: you checked it against what changed, and it is right now." },
    },
  },
  async execute(input, ctx) {
    if (looksLikeCredential(input.content) || looksLikeCredential(input.name)) {
      throw new Error("That looks like it contains a credential. Guides are synced, so credentials never go in them — leave it out and write the rest.")
    }
    const { ref, name: given } = await resolvePackage(ctx, input)
    const folderUrl = await guidesFolder(ctx, { create: true })
    if (!folderUrl) throw new Error("This account has no root folder, so there is nowhere to keep guides.")

    const existing = await guideFor(ctx, ref.url)
    const title = titleOf(input.content, null)
    const name = input.name?.trim() || given || title || existing?.name
    if (!name) throw new Error("Give the guide a name, or start it with '# Title'.")
    const file = existing?.file ?? noteFileName(name)

    // The pin moves when it is first made, when the package is unchanged since
    // it, or when the agent says it reviewed. Otherwise the old pin stays, so
    // the guide keeps saying it may be out of date.
    const snapshot = await packageSnapshot(ctx.repo, ref)
    let move = true
    if (existing?.pin && !input.reviewed) {
      move = compareSnapshots(existing.pin, snapshot).same
    }
    await fsWrite.execute({ root: folderUrl, path: file, content: guideText({ package: ref.url, name }, input.content) }, ctx)
    if (move) await writePin(ctx, folderUrl, ref.url, snapshot, name)
    return move
      ? `Saved the ${name} guide (${file}) and pinned it to the package as it is now.`
      : `Saved the ${name} guide (${file}). The package has changed since the guide was last checked, so it stays flagged as possibly out of date; once you have reviewed it against guide_changes, guide_pin (or guide_write with reviewed: true) records that.`
  },
  summarize(input) {
    return `guide · ${input?.name ?? input?.package ?? ""}`
  },
}

export default [guideRead, guideChanges, guidePin, guideWrite]
