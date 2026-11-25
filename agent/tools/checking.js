/**
 * Running what you just wrote, and looking at what happened.
 *
 * These tools close the loop. Without them the agent writes code, cannot
 * execute it, and reports success on faith — which is exactly what happened the
 * first time it wrote a dice tool: the display never updated and cleanup threw,
 * and it told the user "click the button to roll and see the result!" because
 * it had no way to know otherwise.
 *
 * Two layers, deliberately:
 *
 *   - `tool_check` is the one-shot smoke test. Mount, look, click, unmount, and
 *     report every problem it can recognize. This exists because the failure
 *     mode being fixed is *not knowing what to look for* — an agent that has to
 *     choose its own checks will not check the thing it got wrong.
 *   - `view_mount` / `view_inspect` / `view_interact` / `view_unmount` are the
 *     primitives, and they are not limited to code the agent wrote: they open
 *     ANY document in ANY installed tool. A mount persists between calls, so the
 *     agent can type into a field, click a control, read an element, and check
 *     the document at each step. That is the only way to work with tools whose
 *     state is not a readable document shape, and the only way to tell whether
 *     a change looks right rather than merely being structurally present.
 *
 * Host tier throughout: they need a DOM and a real module import.
 */

import { hostImport } from "../host/import.js"
import { truncate, preview, changesBetween } from "../documents/format.js"
import { rasterize, shrink, canvasWithin, HOLDER_STYLE } from "./screenshot.js"
import { treeNode, treeEntries } from "../documents/tree.js"
import { contentText } from "../documents/values.js"

/**
 * Live mounts, keyed by id.
 *
 * This is the one piece of state the tool layer keeps outside a document, and
 * it is what makes the granular tools possible: `tool_interact` has to act on
 * the *same* mounted instance `tool_mount` created, in a later turn.
 *
 * Bounded, because an agent that forgets to unmount would otherwise accumulate
 * live tools in the page forever.
 */
const mounts = new Map()
const MAX_MOUNTS = 4

function evictOldest() {
  while (mounts.size >= MAX_MOUNTS) {
    const oldest = mounts.keys().next().value
    teardown(oldest, { silent: true })
  }
}

function teardown(mountId, { silent = false } = {}) {
  const mount = mounts.get(mountId)
  if (!mount) return silent ? [] : ["No such mount."]

  const notes = []
  mount.captured.stop()

  if (typeof mount.cleanup !== "function") {
    notes.push(`PROBLEM render() returned ${typeof mount.cleanup}, not a cleanup function. Patchwork requires one.`)
  } else {
    try {
      mount.cleanup()
      notes.push("Cleanup ran without throwing.")
    } catch (err) {
      notes.push(`PROBLEM cleanup threw: ${err?.message ?? err}`)
      notes.push("  handle.on('change', fn) returns nothing — unsubscribe with handle.off('change', fn).")
    }
    if (mount.container.childElementCount > 0) {
      notes.push(`NOTE cleanup left ${mount.container.childElementCount} element(s) behind; it should remove what it added.`)
    }
  }

  mount.container.remove()
  pruneHolder(mount.container.ownerDocument)
  mounts.delete(mountId)
  return notes
}

/**
 * The URL the service worker serves a package file from.
 *
 * Pinned to the package's current heads, which matters more than it looks: the
 * browser caches ES modules by URL, so re-checking after an edit would import
 * the *previous* version and report on code that no longer exists. Pinning to
 * heads gives every revision its own URL.
 */
export function packageFileUrl(packageUrl, heads, file = "index.js") {
  const bare = String(packageUrl).split("#")[0]
  const pinned = heads?.length ? `${bare}#${[...heads].sort().join("|")}` : bare
  return `/${encodeURIComponent(pinned)}/${file}`
}

/** Collect errors the page throws while we are driving the tool. */
function captureErrors(target) {
  const errors = []
  const onError = (event) => {
    errors.push(String(event.error?.stack ?? event.message ?? event.reason ?? event))
  }
  target.addEventListener?.("error", onError)
  target.addEventListener?.("unhandledrejection", onError)
  return {
    errors,
    stop() {
      target.removeEventListener?.("error", onError)
      target.removeEventListener?.("unhandledrejection", onError)
    },
  }
}

const visibleText = (element) => (element?.innerText ?? element?.textContent ?? "").trim()

// ---------------------------------------------------------------- shared

/**
 * Load a package's entry module and validate the shape Patchwork requires.
 * Returns { module, plugins, notes } or throws with a readable explanation.
 */
/**
 * A fingerprint of everything in a package, not just its folder document.
 *
 * Automerge heads are per-document, so editing `tool.js` does not change the
 * heads of the folder that contains it. The folder's heads were what pinned the
 * import URL — which meant that after the first check, every later check
 * imported the module the browser had already cached and reported on code that
 * no longer existed. The agent would say "I made the buttons bigger and it
 * still passes" having checked the version before the edit.
 */
export async function packageContentHash(repo, url, depth = 0, seen = new Set()) {
  if (depth > 8 || seen.has(url)) return ""
  seen.add(url)
  const handle = await repo.find(url)
  const parts = [(handle.heads?.() ?? []).join(",")]
  // A directory document's "folders" are prefixes inside it, so they are
  // walked in place; every real link is hashed by what it points at.
  const walk = async (node) => {
    for (const entry of treeEntries(node)) {
      if (entry.node) await walk(entry.node)
      else parts.push(entry.name ?? "", await packageContentHash(repo, entry.url, depth + 1, seen))
    }
  }
  const node = treeNode(handle)
  if (node) await walk(node)
  return parts.join("|")
}

/** A short, stable digest. Not cryptographic — it only has to change. */
export function digest(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

async function loadPackage(input, ctx) {
  const bare = String(input.url ?? "").split("#")[0]
  if (!bare.startsWith("automerge:")) throw new Error("Pass the package's automerge: URL.")

  const packageHandle = await ctx.repo.find(bare)
  const packageTree = treeNode(packageHandle)
  if (!packageTree) {
    throw new Error(`${bare} is not a package folder document.`)
  }

  // Record the content fingerprint on the package itself, so the folder's heads
  // move when anything inside it does and the import URL is therefore new.
  //
  // The service worker will not accept an invented version — a URL with a head
  // it cannot resolve is a 400 — so a cache-busting suffix is not an option and
  // the heads have to genuinely change. Written only when it differs, so
  // re-checking an untouched package stays stable and cheap.
  try {
    const version = digest(await packageContentHash(ctx.repo, bare))
    if (packageHandle.doc()?.contentVersion !== version) {
      packageHandle.change((doc) => {
        doc.contentVersion = version
      })
    }
  } catch {
    // A package we cannot fingerprint still checks; it just risks the stale
    // import this exists to prevent, which is what used to happen always.
  }

  const heads = packageHandle.heads?.() ?? []

  // Respect package.json's `main`. A built package's entry is dist/index.js,
  // and importing index.js instead would check the source that Patchwork will
  // never load — passing or failing for the wrong reasons.
  let entry = "index.js"
  const manifestLink = treeEntries(packageTree).find((d) => d.name === "package.json")
  if (manifestLink) {
    try {
      const manifest = (await ctx.repo.find(manifestLink.url)).doc()
      const main = JSON.parse(contentText(manifest?.content)).main
      if (main) entry = String(main).replace(/^\.\//, "")
    } catch {
      /* fall back to index.js */
    }
  }

  const entryUrl = packageFileUrl(bare, heads, entry)
  const importModule = ctx.importModule ?? ((url) => import(/* @vite-ignore */ url))

  let module
  try {
    module = await importModule(entryUrl)
  } catch (err) {
    const error = new Error(
      `FAILED to import the entry module (${entryUrl}).\n${err?.message ?? err}\n\nThis is a syntax error or a bad import. Nothing else could be checked.`
    )
    error.fatal = true
    throw error
  }

  const plugins = module.plugins
  if (!Array.isArray(plugins) || !plugins.length) {
    const error = new Error("The entry module loaded but exported no `plugins` array. Patchwork reads that array to register the tool.")
    error.fatal = true
    throw error
  }

  const notes = [`Entry module loaded. ${plugins.length} plugin(s): ${plugins.map((p) => `${p.type}:${p.id}`).join(", ")}`]

  // Plugin entries are structured-cloned into a worker by the host, so a
  // top-level function anywhere but `load` breaks registration — and it does so
  // at install time, far from here, with an opaque DataCloneError.
  for (const plugin of plugins) {
    const { load, ...rest } = plugin
    try {
      structuredClone(rest)
    } catch (err) {
      notes.push(`PROBLEM ${plugin.id}: a top-level field is not cloneable (${err?.message ?? err}).`)
      notes.push("  Every function except `load` must live behind `async load()`.")
    }
    if (typeof load !== "function") notes.push(`PROBLEM ${plugin.id}: has no async load().`)
  }

  return { module, plugins, notes }
}

/**
 * Resolve a registered tool from the host registry.
 *
 * This is what turns these primitives from "check the thing I just wrote" into
 * "drive any tool on any document" — the agent can open a real document in its
 * real editor, operate it, and read what is on screen. That is the only way to
 * work with tools whose state does not live in a readable document shape
 * (a canvas, a text editor) and the only way to check that a change *looks*
 * right rather than merely being structurally present.
 */
async function resolveRegisteredTool(input, ctx, notes) {
  const { getRegistry } = await hostImport("plugins")
  const registry = getRegistry("patchwork:tool")

  let toolId = input.toolId
  if (!toolId) {
    // Pick a tool that supports this document's datatype, preferring one that
    // is specific to it over a wildcard inspector.
    const target = (await ctx.repo.find(input.docUrl)).doc()
    const type = target?.["@patchwork"]?.type
    const candidates = registry
      .all()
      .filter((p) => !p.unlisted)
      .filter((p) => {
        const supported = [].concat(p.supportedDatatypes ?? [])
        return supported.includes(type) || supported.includes("*")
      })
      .sort((a, b) => {
        const aWild = [].concat(a.supportedDatatypes ?? []).includes("*") ? 1 : 0
        const bWild = [].concat(b.supportedDatatypes ?? []).includes("*") ? 1 : 0
        return aWild - bWild
      })
    if (!candidates.length) {
      throw new Error(`No installed tool supports datatype '${type ?? "unknown"}'. Use registry_list to see what exists.`)
    }
    toolId = candidates[0].id
    notes.push(`Chose tool '${toolId}' for datatype '${type}'.`)
  }

  const loaded = await registry.load(toolId)
  if (!loaded?.module) throw new Error(`No installed tool '${toolId}'.`)
  return { render: loaded.module, toolId }
}

/** Mount a tool — either from a package document, or a registered one. */
async function mountTool({ plugins, input, ctx, doc, notes }) {
  // Registry path: a real tool on a real document.
  if (!plugins) {
    if (!input.docUrl) throw new Error("Pass `docUrl` (and optionally `toolId`) to mount a registered tool.")
    const { render, toolId } = await resolveRegisteredTool(input, ctx, notes)
    const handle = await ctx.repo.find(input.docUrl)
    return finishMount({ render, handle, toolId, doc, notes, ctx })
  }

  const datatypePlugin = input.datatype
    ? plugins.find((p) => p.type === "patchwork:datatype" && p.id === input.datatype)
    : plugins.find((p) => p.type === "patchwork:datatype")
  const toolPlugin = input.toolId
    ? plugins.find((p) => p.type === "patchwork:tool" && p.id === input.toolId)
    : plugins.find((p) => p.type === "patchwork:tool")

  if (!toolPlugin) throw new Error("No patchwork:tool plugin to mount.")

  let datatype = null
  if (datatypePlugin) {
    try {
      datatype = await datatypePlugin.load()
      notes.push(`Datatype '${datatypePlugin.id}' loaded.`)
    } catch (err) {
      notes.push(`PROBLEM datatype '${datatypePlugin.id}' failed to load: ${err?.message ?? err}`)
    }
  }

  // Use an existing document when asked, so the agent can check against real
  // data rather than only against a freshly initialized one.
  const handle = input.docUrl ? await ctx.repo.find(input.docUrl) : await ctx.repo.create2()
  if (!input.docUrl) {
    try {
      handle.change((draft) => {
        datatype?.init?.(draft)
        draft["@patchwork"] = { type: datatypePlugin?.id ?? "unknown" }
      })
      notes.push(`Test document created: ${truncate(docText(handle), 200)}`)
    } catch (err) {
      notes.push(`PROBLEM datatype init threw: ${err?.message ?? err}`)
    }
  }

  if (datatype?.getTitle) {
    try {
      notes.push(`getTitle() → ${JSON.stringify(datatype.getTitle(handle.doc()))}`)
    } catch (err) {
      notes.push(`PROBLEM getTitle threw: ${err?.message ?? err}`)
    }
  }

  let render
  try {
    render = await toolPlugin.load()
  } catch (err) {
    throw new Error(`The tool plugin failed to load: ${err?.message ?? err}`)
  }
  if (typeof render !== "function") {
    throw new Error(`load() did not return a render function (got ${typeof render}).`)
  }

  return finishMount({ render, handle, toolId: toolPlugin.id, doc, notes, ctx })
}

/**
 * Put a render function on screen and record the mount.
 *
 * On screen where possible, and that is the point. This used to mount ten
 * thousand pixels off to the left, always — so the agent could see what it had
 * built and the person who asked for it could not. Now the transcript adopts
 * the mount into a view beside the call that opened it, and you watch the
 * agent work where it is talked about.
 *
 * Off-screen stays the fallback rather than display:none, because a hidden
 * container reports zero sizes and a tool that measures itself would behave
 * differently there than in front of a person.
 */
/**
 * Where a mount lives when nothing on screen has claimed it.
 *
 * Off-screen rather than `display: none`, because a hidden container reports
 * zero sizes and a tool that measures itself would behave differently there
 * than in front of a person. The transcript adopts a container into the view
 * beside the call that opened it, and parks it back here when that view goes
 * away — the mount itself never stops.
 */
export function mountHolder(doc = globalThis.document) {
  let holder = doc.querySelector(".agent-mount-holder")
  if (!holder) {
    holder = doc.createElement("div")
    holder.className = "agent-mount-holder"
    holder.style.cssText = HOLDER_STYLE
    doc.body.append(holder)
  }
  return holder
}

/** An empty holder is removed, so a page that mounted nothing is left exactly as it was. */
function pruneHolder(doc = globalThis.document) {
  const holder = doc?.querySelector?.(".agent-mount-holder")
  if (holder && !holder.childElementCount) holder.remove()
}

/** Put a mount's container back off-screen. Safe to call on one that is already there or gone. */
export function parkMount(container) {
  if (!container || !container.isConnected) return
  const holder = mountHolder(container.ownerDocument)
  if (container.parentElement !== holder) holder.append(container)
}

/**
 * The fields of the element a tool is mounted into: the repo it finds
 * documents through, the document and tool it was opened as, and the keyhive
 * the agent's own view was given, where there is one.
 */
export function viewElementFields({ ctx, handle, toolId }) {
  const fields = { repo: ctx.repo, docUrl: handle.url ?? null, toolId: toolId ?? null }
  const hive = ctx.element?.hive
  if (hive) fields.hive = hive
  return fields
}

async function finishMount({ render, handle, toolId, doc, notes, ctx }) {
  const container = doc.createElement("div")
  container.className = "agent-mount"
  // What a tool finds on the element Patchwork mounts it in (`<patchwork-view>`,
  // PatchworkViewElementBase in core/elements). Without it the container was a
  // bare div: OpenSCAD's `element.repo.find` threw, so every import bound as
  // `{}`, and the file tool's `useDocHandle(url, element)` refused to run —
  // which the agent recorded as "a harness artefact" and worked around.
  Object.assign(container, viewElementFields({ ctx, handle, toolId }))
  mountHolder(doc).append(container)

  const captured = captureErrors(globalThis)
  let cleanup = null
  let mounted = false
  try {
    // Bound the mount. A render function that returns a promise which never
    // settles — waiting on a device, a context, a network call — would
    // otherwise hang the check forever with no explanation.
    cleanup = await Promise.race([
      render(handle, container),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("render did not finish within 20s")), 20000)
      ),
    ])
    mounted = true
    notes.push("Mounted without throwing.")
  } catch (err) {
    notes.push(`PROBLEM mounting threw: ${err?.message ?? err}`)
    notes.push(`  ${String(err?.stack ?? "").split("\n").slice(1, 3).join("\n  ")}`)
  }

  return { container, handle, cleanup, captured, mounted, toolId }
}

/**
 * A document as the agent reads it: bytes summarized and long things cut, so a
 * 3dm file is `<9437184 bytes>`. Stringifying the document itself turned each
 * byte into a key of its own, and a large file threw "Invalid string length"
 * before a word of it could be truncated.
 */
function docText(handle) {
  return JSON.stringify(preview(handle.doc())) ?? "null"
}

/**
 * What differs when the document does: its heads, where the handle has them,
 * and everything but the bytes, which are summarized by length.
 */
function docStamp(handle) {
  const heads = typeof handle.heads === "function" ? handle.heads() : null
  return `${JSON.stringify(heads)} ${JSON.stringify(docPlain(handle))}`
}

/** The whole document as plain values, bytes summarized: what changes are found in. */
function docPlain(handle) {
  return preview(handle.doc(), { maxString: Infinity, maxItems: Infinity, maxDepth: 64 })
}

/**
 * What an interaction changed in the document, one line per place: its path,
 * what was there and what is there now. Showing the document's first 200
 * characters instead told the agent the notebook's title after every run, and
 * it read the document again to find out what had happened.
 */
export function changeLines(before, after, url = null) {
  const { count, changes } = changesBetween(before, after)
  const show = (value, path) => {
    if (value === undefined) return "(none)"
    if (typeof value === "string" && value.length > 160) {
      const read = url ? `; doc_read {url:"${url}", path:${JSON.stringify(path)}} for all of it` : ""
      return `${JSON.stringify(value.slice(0, 160))}… (${value.length} chars${read})`
    }
    return truncate(JSON.stringify(preview(value, { maxString: 160, maxItems: 5, maxDepth: 4 })), 240)
  }
  const lines = changes.map(({ path, before: was, after: now }) => `  /${path.join("/")}: ${show(was, path)} → ${show(now, path)}`)
  if (count > changes.length) lines.push(`  …and ${count - changes.length} more`)
  return { count, lines }
}

/** What changed on screen: lines that appeared and lines that went, not the screen's first 200 characters. */
export function renderingChange(before, after) {
  const lines = (text) => String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
  const was = new Set(lines(before))
  const now = new Set(lines(after))
  const added = [...now].filter((l) => !was.has(l))
  const removed = [...was].filter((l) => !now.has(l))
  if (!added.length && !removed.length) return "Rendering updated (the same lines, rearranged)."
  const shown = [...added.slice(0, 6).map((l) => `+${JSON.stringify(truncate(l, 80))}`), ...removed.slice(0, 4).map((l) => `-${JSON.stringify(truncate(l, 80))}`)]
  const more = added.length + removed.length - shown.length
  return `Rendering updated: ${shown.join(", ")}${more > 0 ? `, and ${more} more lines` : ""}`
}

/** Describe what is on screen right now. */
function describeRender(container) {
  const text = visibleText(container)
  const buttons = [...container.querySelectorAll("button")]
  const inputs = [...container.querySelectorAll("input, textarea, select")]
  const lines = [
    `Rendered text: ${JSON.stringify(truncate(text, 300))}`,
    `${container.querySelectorAll("*").length} elements, ${buttons.length} button(s), ${inputs.length} input(s).`,
  ]
  if (buttons.length) {
    lines.push(`Buttons: ${buttons.map((b) => JSON.stringify(truncate(visibleText(b), 30))).join(", ")}`)
  }
  if (!text && !buttons.length && !inputs.length) {
    lines.push("PROBLEM nothing rendered. Check that you appended to `element` and that render() runs on mount.")
  }
  return lines
}

/**
 * The diagnosis worth having: the document changed but the screen did not.
 * This is the bug a person notices instantly and an agent never thinks to check.
 */
function diagnoseInteraction({ docBefore, docAfter, plainBefore, plainAfter, url = null, textBefore, textAfter, label, authoring = true }) {
  const lines = []
  if (docBefore === docAfter) {
    lines.push(`Interacted with ${label} — the document did NOT change.`)
    // Advice for the tool's author; driving someone else's tool, it is only
    // a possibility.
    lines.push(
      authoring
        ? "  If it was supposed to write, check that you call handle.change()."
        : "  If you wrote this tool and the action should write, check that it calls handle.change()."
    )
  } else {
    const { count, lines: where } = changeLines(plainBefore, plainAfter, url)
    lines.push(
      count
        ? `Interacted with ${label} — document changed in ${count} place${count === 1 ? "" : "s"}:`
        : `Interacted with ${label} — document changed (new history, the same values).`,
      ...where
    )
    if (textAfter === textBefore) {
      lines.push("PROBLEM the document changed but the rendering did NOT update.")
      lines.push("  This is the classic one: `handle.doc()` is a function, and you must re-render")
      lines.push("  from it inside a handle.on('change', …) listener.")
    } else {
      lines.push(renderingChange(textBefore, textAfter))
    }
  }
  return lines
}

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

function requireDom(ctx) {
  const doc = ctx.element?.ownerDocument ?? globalThis.document
  if (!doc) throw new Error("This needs a page to mount into.")
  return doc
}

function requireMount(mountId) {
  const mount = mounts.get(mountId)
  if (!mount) {
    throw new Error(
      `No mount '${mountId}'. It was unmounted, evicted (only ${MAX_MOUNTS} stay live), or the page has been reloaded since it was opened, which closes every view. If you still need it, open it again with view_mount.`
    )
  }
  return mount
}

/**
 * A picture of what was just mounted, attached to the result.
 *
 * Mounting used to report in prose — "12 elements, 2 button(s)" — which tells
 * the agent almost nothing about whether the thing looks right and tells the
 * person watching nothing at all. A thumbnail costs a few kilobytes and answers
 * both. Best effort: a capture that fails must not fail the mount.
 */
async function captureMount(container, doc) {
  try {
    const width = container.clientWidth || container.offsetWidth || 0
    const height = container.clientHeight || container.offsetHeight || 0
    if (!width || !height) return null

    const canvas = canvasWithin(container)
    const raw = canvas ? canvas.toDataURL("image/png") : await rasterize(container, { width, height, doc })
    if (!raw || raw.length < 200) return null
    return await shrink(raw, { maxWidth: 520, doc })
  } catch {
    return null
  }
}

const MOUNT_PROPS = {
  docUrl: {
    type: "string",
    description: "Document to open. With no `url`, this opens it in an INSTALLED tool — the normal way to drive the front end.",
  },
  toolId: {
    type: "string",
    description: "Which tool to open it in. Defaults to the best installed tool for the document's datatype.",
  },
  url: {
    type: "string",
    description: "Package folder URL, to mount a tool you wrote that is not installed yet.",
  },
  datatype: { type: "string", description: "With `url`: which datatype plugin to instantiate." },
}

// ---------------------------------------------------------------- granular

export const viewMount = {
  id: "view_mount",
  // About the document opened, or the package mounted; never the subject.
  target: { fields: ["docUrl", "url"] },
  name: "Open a document in its tool",
  description: [
    "Open a document in a real Patchwork tool and leave it running. Returns a mountId for view_inspect, view_interact and view_unmount.",
    "",
    "It renders in the transcript, beside this call, so the user can watch you work — and keeps running off-screen when nobody is looking. A picture of what rendered comes back with the result.",
    "",
    "This is how you work with what the user actually sees. Use it to check that a change you made looks right, to read a document whose state does not live in a readable shape (a canvas, a text editor), or to operate a tool that has no document-level API — you can click its buttons and type into its fields.",
    "",
    "Pass `docUrl` to open a real document in an installed tool. Pass `url` instead to mount a package you wrote with fs_write but have not installed. Always view_unmount when you are done.",
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    properties: {
      ...MOUNT_PROPS,
      screenshot: { type: "boolean", description: "Attach a picture of what rendered. Default true." },
    },
  },

  async execute(input, ctx) {
    const doc = requireDom(ctx)
    if (!input.url && !input.docUrl) throw new Error("Pass `docUrl` to open a document, or `url` to mount a package.")

    // Two sources: a package the agent wrote, or a tool already installed.
    let plugins = null
    let notes = []
    if (input.url) {
      const loaded = await loadPackage(input, ctx)
      plugins = loaded.plugins
      notes = loaded.notes
    }

    evictOldest()
    const mount = await mountTool({ plugins, input, ctx, doc, notes })
    const mountId = `mount_${Math.random().toString(36).slice(2, 8)}`
    mounts.set(mountId, mount)

    if (mount.mounted) notes.push(...describeRender(mount.container))
    notes.push("")
    notes.push(`mountId: ${mountId} — use view_interact / view_inspect with it, then view_unmount.`)

    const image = mount.mounted && input.screenshot !== false ? await captureMount(mount.container, doc) : null
    return image ? { text: notes.join("\n"), image } : notes.join("\n")
  },

  summarize(input, output) {
    const text = String(output ?? "")
    if (!/mountId:/.test(text)) return "could not mount"
    const elements = text.match(/(\d+) elements/)
    const buttons = text.match(/(\d+) button/)
    // What it looks like, not which random id it was given: the row already
    // says what was mounted, and the mountId means nothing to a person.
    return elements ? `${elements[1]} elements, ${buttons?.[1] ?? 0} buttons` : "mounted"
  },
}

export const viewInspect = {
  id: "view_inspect",
  name: "Look at an open document",
  description:
    "Read what an open document is currently showing: its rendered text, its elements, and the document behind it. Pass a selector to look at one part of it.",
  where: "host",
  risk: "read",
  input_schema: {
    type: "object",
    required: ["mountId"],
    properties: {
      mountId: { type: "string", description: "The mount to act on, as returned by view_mount." },
      selector: { type: "string", description: "CSS selector to inspect. Defaults to the whole tool." },
      html: { type: "boolean", description: "Return markup instead of text." },
    },
  },

  async execute(input) {
    const mount = requireMount(input.mountId)
    const target = input.selector ? mount.container.querySelector(input.selector) : mount.container
    if (!target) {
      const available = [...mount.container.querySelectorAll("*")]
        .slice(0, 20)
        // The class attribute, not className: an SVG element's className is
        // an object, and listed as `svg.[object`.
        .map((el) => el.tagName.toLowerCase() + (el.getAttribute("class") ? `.${el.getAttribute("class").trim().split(/\s+/)[0]}` : ""))
      throw new Error(`Nothing matches '${input.selector}'. Present: ${[...new Set(available)].join(", ") || "(empty)"}`)
    }

    const lines = input.html
      ? [truncate(target.outerHTML, 4000)]
      : input.selector
        ? [`Text: ${JSON.stringify(truncate(visibleText(target), 600))}`]
        : describeRender(mount.container)

    lines.push(`Document: ${truncate(docText(mount.handle), 500)}`)
    if (mount.captured.errors.length) {
      lines.push(`Page errors so far (${mount.captured.errors.length}): ${truncate(mount.captured.errors[0], 200)}`)
    }
    return lines.join("\n")
  },

  summarize(input) {
    return `inspected ${input?.selector ?? "the tool"}`
  },
}

/** The longest view_interact waits for a tool to react; slower work is waited on with doc_watch. */
export const MAX_SETTLE_MS = 30000

export const viewInteract = {
  id: "view_interact",
  // Acts on a mount, which view_mount was approved for. No document of its own.
  target: "none",
  name: "Drive an open document",
  description: [
    "Click, type into, or submit part of an open document, and report what changed — both in the document and on screen.",
    "Actions: 'click' (a button or any element), 'type' (set an input's value and fire both input and change events), 'submit' (fire a submit event on a form).",
    "Without a selector, 'click' uses the first button and 'type' the first input.",
    `To wait for something slow (a run, a render), click with a short settleMs (at most ${MAX_SETTLE_MS} ms) and then doc_watch the document field that changes: it wakes you when it does. A longer settleMs is refused.`,
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["mountId"],
    properties: {
      mountId: { type: "string", description: "The mount to act on, as returned by view_mount." },
      action: { type: "string", description: "click | type | submit. Default 'click'." },
      selector: { type: "string", description: "CSS selector of the element to act on." },
      value: { type: "string", description: "Text to type, for action 'type'." },
      settleMs: { type: "number", description: `How long to wait for the tool to react. Default 200, at most ${MAX_SETTLE_MS}; for anything slower, use doc_watch.` },
    },
  },

  async execute(input) {
    const mount = requireMount(input.mountId)
    if (Number(input.settleMs) > MAX_SETTLE_MS) {
      const url = mount.handle?.url ?? "the document's url"
      throw new Error(
        `Not clicked: settleMs ${input.settleMs} is more than ${MAX_SETTLE_MS} ms. Waiting that long inside a call holds the session open and pays for nothing. Click with a short settleMs, then watch the field that changes: doc_watch { url: "${url}", path: ["status"], match: "done|failed" } (use the path that changes in this document — read it with doc_read — and a match for the value you are waiting for), and end your turn: you are woken when it does.`
      )
    }
    const action = input.action ?? "click"
    const container = mount.container

    const defaultSelector = action === "type" ? "input, textarea" : action === "submit" ? "form" : "button"
    const target = container.querySelector(input.selector ?? defaultSelector)
    if (!target) {
      throw new Error(
        `Nothing matches '${input.selector ?? defaultSelector}' in the open document. Use view_inspect to see what is there.`
      )
    }

    const docBefore = docStamp(mount.handle)
    const plainBefore = docPlain(mount.handle)
    const textBefore = visibleText(container)
    const label = `${action} on ${input.selector ?? defaultSelector} (${JSON.stringify(truncate(visibleText(target) || target.tagName, 30))})`

    try {
      if (action === "click") {
        target.click()
      } else if (action === "type") {
        target.value = input.value ?? ""
        target.dispatchEvent(new Event("input", { bubbles: true }))
        target.dispatchEvent(new Event("change", { bubbles: true }))
      } else if (action === "submit") {
        target.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      } else {
        throw new Error(`Unknown action '${action}'. Use click, type or submit.`)
      }
    } catch (err) {
      return `PROBLEM ${label} threw: ${err?.message ?? err}`
    }

    await settle(input.settleMs ?? 200)

    const lines = diagnoseInteraction({
      docBefore,
      docAfter: docStamp(mount.handle),
      plainBefore,
      plainAfter: docPlain(mount.handle),
      url: mount.handle.url ?? null,
      textBefore,
      textAfter: visibleText(container),
      label,
      authoring: false,
    })

    if (mount.captured.errors.length) {
      lines.push(`Page errors (${mount.captured.errors.length}): ${truncate(mount.captured.errors.at(-1), 200)}`)
    }
    return lines.join("\n")
  },

  summarize(input, output) {
    const text = String(output ?? "")
    if (text.includes("PROBLEM")) return "problem"
    // The interesting part of an interaction is whether anything changed.
    if (/document did NOT change/i.test(text)) return "no change"
    if (/document changed/i.test(text)) return /Rendering updated/i.test(text) ? "changed, screen followed" : "changed"
    return "ok"
  },
}

export const viewUnmount = {
  id: "view_unmount",
  target: "none",
  name: "Close an open document",
  description:
    "Close an open document, tearing the tool down the way Patchwork will, and report whether its cleanup is well-behaved. Always finish a view_mount with this.",
  where: "host",
  // Closing what this conversation opened. Mounting it already needed a yes,
  // and its cleanup can do nothing its mount could not; asking again to put
  // it away was a prompt with nothing behind it.
  risk: "self",
  input_schema: {
    type: "object",
    required: ["mountId"],
    properties: { mountId: { type: "string", description: "The mount to act on, as returned by view_mount." } },
  },

  async execute(input) {
    // Closing something already closed is not a failure. Mounts live in the
    // page, so a reload closes every one of them — and an error here sent the
    // agent off to mount the view again (asking permission) only to close it.
    if (!mounts.has(input.mountId)) {
      return `Nothing to close: '${input.mountId}' is not open. It was already closed, or the page has been reloaded since it was opened, which closes every view.`
    }
    const notes = teardown(input.mountId)
    return notes.join("\n")
  },

  summarize(input, output) {
    const text = String(output ?? "")
    if (text.startsWith("Nothing to close")) return "already closed"
    return text.includes("PROBLEM") ? "unmounted · problem" : "unmounted · clean"
  },
}

// ---------------------------------------------------------------- one-shot

export const toolCheck = {
  id: "tool_check",
  target: { fields: ["docUrl", "url"] },
  name: "Check a tool you wrote",
  description: [
    "Run a tool you wrote end to end and report every problem found. Do this after writing its files with fs_write and before installing it — code you have not executed is a guess.",
    "",
    "It imports the package from its document (no install needed), creates a document with its datatype, mounts the tool, clicks the first button, checks that the screen followed the document, and tears it down the way Patchwork will.",
    "",
    "This is the check to reach for by default, because it looks for problems you would not think to look for. When you need to drive something specific — type into a field, click a particular control, check against an existing document — use view_mount with view_interact and view_inspect instead. Read the 'driving-a-view' skill before you do.",
    "",
    "A picture of what rendered comes back with the result, so you can see whether it LOOKS right rather than only whether it mounted. When it passes, say so and stop — the user installs it with a button, so do not hand them a URL to paste.",
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      ...MOUNT_PROPS,
      interact: { type: "boolean", description: "Click the first button and check the result. Default true." },
      screenshot: { type: "boolean", description: "Attach a picture of what rendered. Default true." },
    },
  },

  async execute(input, ctx) {
    const doc = requireDom(ctx)

    let loaded
    try {
      loaded = await loadPackage(input, ctx)
    } catch (err) {
      if (err.fatal) return err.message
      throw err
    }

    const notes = loaded.notes
    let mount
    try {
      mount = await mountTool({ plugins: loaded.plugins, input, ctx, doc, notes })
    } catch (err) {
      return `${notes.join("\n")}\n\nPROBLEM ${err.message}`
    }

    const mountId = `mount_check_${Math.random().toString(36).slice(2, 8)}`
    mounts.set(mountId, mount)

    // Captured BEFORE the interaction, so the picture is the tool as it first
    // renders rather than mid-click. Taken here because teardown below removes
    // the container, and a check that reports a problem is exactly when you
    // most want to see what it looked like.
    let image = null

    try {
      if (mount.mounted) {
        await settle(150)
        notes.push(...describeRender(mount.container))
        if (input.screenshot !== false) image = await captureMount(mount.container, doc)

        const buttons = [...mount.container.querySelectorAll("button")]
        if (input.interact !== false && buttons.length) {
          const docBefore = docStamp(mount.handle)
          const plainBefore = docPlain(mount.handle)
          const textBefore = visibleText(mount.container)
          try {
            buttons[0].click()
          } catch (err) {
            notes.push(`PROBLEM clicking the first button threw: ${err?.message ?? err}`)
          }
          await settle(250)
          notes.push(
            ...diagnoseInteraction({
              docBefore,
              docAfter: docStamp(mount.handle),
              plainBefore,
              plainAfter: docPlain(mount.handle),
              url: mount.handle.url ?? null,
              textBefore,
              textAfter: visibleText(mount.container),
              label: `'${truncate(visibleText(buttons[0]), 40)}'`,
            })
          )
        }
      }

      const errors = mount.captured.errors
      notes.push(...teardown(mountId))

      if (errors.length) {
        notes.push(`Page errors during the check (${errors.length}):`)
        for (const error of errors.slice(0, 5)) notes.push(`  ${truncate(error, 300)}`)
      }
    } finally {
      // Never leave a mount behind, whatever went wrong above.
      if (mounts.has(mountId)) teardown(mountId, { silent: true })
    }

    const problems = notes.filter((line) => line.startsWith("PROBLEM")).length
    notes.push("")
    notes.push(problems ? `${problems} problem(s) found — fix the files with fs_write and check again.` : "No problems found.")
    return image ? { text: notes.join("\n"), image } : notes.join("\n")
  },

  summarize(input, output) {
    const problems = (String(output ?? "").match(/^PROBLEM/gm) ?? []).length
    return problems ? `checked · ${problems} problem${problems === 1 ? "" : "s"}` : "checked · ok"
  },
}

/** Look up a live mount, so other tools (screenshots) can act on one. */
export function getMount(mountId) {
  return mounts.get(mountId) ?? null
}

/** The mountId a view_mount result named, if any. */
export function mountIdIn(output) {
  return String(output ?? "").match(/mountId: (mount_[a-z0-9]+)/)?.[1] ?? null
}

/**
 * Mount for a person, not the agent: the "Show" button on a document or
 * package in the transcript.
 *
 * Same loader and same mount code as view_mount, so a package renders here
 * exactly as it would for the agent, installed or not. Not registered in
 * `mounts`: a person's view must not be evicted to make room for the agent's
 * fourth, and the agent's view_* tools have no business driving it. Returns
 * the container plus a cleanup that tears the tool down the way Patchwork will.
 */
export async function mountForPerson(input, ctx) {
  const doc = requireDom(ctx)
  let plugins = null
  let notes = []
  if (input.url) {
    const loaded = await loadPackage(input, ctx)
    plugins = loaded.plugins
    notes = loaded.notes
  }
  const mount = await mountTool({ plugins, input, ctx, doc, notes })
  if (!mount.mounted) {
    mount.captured.stop()
    mount.container.remove()
    throw new Error(notes.filter((n) => /PROBLEM/.test(n)).join("\n") || "Could not mount.")
  }
  return {
    container: mount.container,
    handle: mount.handle,
    toolId: mount.toolId,
    cleanup() {
      mount.captured.stop()
      try {
        mount.cleanup?.()
      } catch {
        /* the tool's problem, reported to the agent when it checks */
      }
      mount.container.remove()
      pruneHolder(mount.container.ownerDocument)
    },
  }
}

/** Tests only: forget every live mount. */
export function _resetMounts() {
  for (const id of [...mounts.keys()]) teardown(id, { silent: true })
}

export default [toolCheck, viewMount, viewInspect, viewInteract, viewUnmount]
