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

import { hostImport } from "./host.js"
import { truncate } from "./format.js"
import { contentToText } from "./folders.js"

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
async function loadPackage(input, ctx) {
  const bare = String(input.url ?? "").split("#")[0]
  if (!bare.startsWith("automerge:")) throw new Error("Pass the package's automerge: URL.")

  const packageHandle = await ctx.repo.find(bare)
  if (!Array.isArray(packageHandle.doc()?.docs)) {
    throw new Error(`${bare} is not a package folder document.`)
  }

  const heads = packageHandle.heads?.() ?? []

  // Respect package.json's `main`. A built package's entry is dist/index.js,
  // and importing index.js instead would check the source that Patchwork will
  // never load — passing or failing for the wrong reasons.
  let entry = "index.js"
  const manifestLink = (packageHandle.doc().docs ?? []).find((d) => d.name === "package.json")
  if (manifestLink) {
    try {
      const manifest = (await ctx.repo.find(manifestLink.url)).doc()
      const main = JSON.parse(contentToText(manifest?.content)).main
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
    return finishMount({ render, handle, toolId, doc, notes })
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
      notes.push(`Test document created: ${truncate(JSON.stringify(handle.doc()), 200)}`)
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

  return finishMount({ render, handle, toolId: toolPlugin.id, doc, notes })
}

/** Put a render function on screen in a hidden container and record the mount. */
async function finishMount({ render, handle, toolId, doc, notes }) {
  const container = doc.createElement("div")
  // Off-screen rather than display:none — a hidden container reports zero
  // sizes, and a tool that measures itself would behave differently here than
  // it will in front of a person.
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:600px;height:400px;overflow:auto"
  doc.body.append(container)

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
function diagnoseInteraction({ docBefore, docAfter, textBefore, textAfter, label }) {
  const lines = []
  if (docBefore === docAfter) {
    lines.push(`Interacted with ${label} — the document did NOT change.`)
    lines.push("  If it was supposed to write, check that you call handle.change().")
  } else {
    lines.push(`Interacted with ${label} — document changed: ${truncate(docAfter, 200)}`)
    if (textAfter === textBefore) {
      lines.push("PROBLEM the document changed but the rendering did NOT update.")
      lines.push("  This is the classic one: `handle.doc()` is a function, and you must re-render")
      lines.push("  from it inside a handle.on('change', …) listener.")
    } else {
      lines.push(`Rendering updated: ${JSON.stringify(truncate(textAfter, 200))}`)
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
      `No mount '${mountId}'. It may have been unmounted or evicted (only ${MAX_MOUNTS} stay live). Open it again with view_mount.`
    )
  }
  return mount
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
  name: "Open a document in its tool",
  description: [
    "Open a document in a real Patchwork tool, off-screen, and leave it running. Returns a mountId for view_inspect, view_interact and view_unmount.",
    "",
    "This is how you work with what the user actually sees. Use it to check that a change you made looks right, to read a document whose state does not live in a readable shape (a canvas, a text editor), or to operate a tool that has no document-level API — you can click its buttons and type into its fields.",
    "",
    "Pass `docUrl` to open a real document in an installed tool. Pass `url` instead to mount a package you wrote with fs_write but have not installed. Always view_unmount when you are done.",
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: { type: "object", properties: MOUNT_PROPS },

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
    return notes.join("\n")
  },

  summarize(input, output) {
    const id = String(output ?? "").match(/mountId: (\S+)/)
    return `opened ${input?.toolId ?? "document"} · ${id ? id[1] : "failed"}`
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
      mountId: { type: "string" },
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
        .map((el) => el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : ""))
      throw new Error(`Nothing matches '${input.selector}'. Present: ${[...new Set(available)].join(", ") || "(empty)"}`)
    }

    const lines = input.html
      ? [truncate(target.outerHTML, 4000)]
      : input.selector
        ? [`Text: ${JSON.stringify(truncate(visibleText(target), 600))}`]
        : describeRender(mount.container)

    lines.push(`Document: ${truncate(JSON.stringify(mount.handle.doc()), 500)}`)
    if (mount.captured.errors.length) {
      lines.push(`Page errors so far (${mount.captured.errors.length}): ${truncate(mount.captured.errors[0], 200)}`)
    }
    return lines.join("\n")
  },

  summarize(input) {
    return `inspected ${input?.selector ?? "the tool"}`
  },
}

export const viewInteract = {
  id: "view_interact",
  name: "Drive an open document",
  description: [
    "Click, type into, or submit part of an open document, and report what changed — both in the document and on screen.",
    "Actions: 'click' (a button or any element), 'type' (set an input's value and fire an input event), 'submit' (fire a submit event on a form).",
    "Without a selector, 'click' uses the first button and 'type' the first input.",
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["mountId"],
    properties: {
      mountId: { type: "string" },
      action: { type: "string", description: "click | type | submit. Default 'click'." },
      selector: { type: "string", description: "CSS selector of the element to act on." },
      value: { type: "string", description: "Text to type, for action 'type'." },
      settleMs: { type: "number", description: "How long to wait for the tool to react. Default 200." },
    },
  },

  async execute(input) {
    const mount = requireMount(input.mountId)
    const action = input.action ?? "click"
    const container = mount.container

    const defaultSelector = action === "type" ? "input, textarea" : action === "submit" ? "form" : "button"
    const target = container.querySelector(input.selector ?? defaultSelector)
    if (!target) {
      throw new Error(
        `Nothing matches '${input.selector ?? defaultSelector}' in the open document. Use view_inspect to see what is there.`
      )
    }

    const docBefore = JSON.stringify(mount.handle.doc())
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
      docAfter: JSON.stringify(mount.handle.doc()),
      textBefore,
      textAfter: visibleText(container),
      label,
    })

    if (mount.captured.errors.length) {
      lines.push(`Page errors (${mount.captured.errors.length}): ${truncate(mount.captured.errors.at(-1), 200)}`)
    }
    return lines.join("\n")
  },

  summarize(input, output) {
    const problem = String(output ?? "").includes("PROBLEM")
    return `${input?.action ?? "click"} ${input?.selector ?? ""} · ${problem ? "problem" : "ok"}`.trim()
  },
}

export const viewUnmount = {
  id: "view_unmount",
  name: "Close an open document",
  description:
    "Close an open document, tearing the tool down the way Patchwork will, and report whether its cleanup is well-behaved. Always finish a view_mount with this.",
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["mountId"],
    properties: { mountId: { type: "string" } },
  },

  async execute(input) {
    requireMount(input.mountId)
    const notes = teardown(input.mountId)
    return notes.join("\n")
  },

  summarize(input, output) {
    return String(output ?? "").includes("PROBLEM") ? "unmounted · problem" : "unmounted · clean"
  },
}

// ---------------------------------------------------------------- one-shot

export const toolCheck = {
  id: "tool_check",
  name: "Check a tool you wrote",
  description: [
    "Run a tool you wrote end to end and report every problem found. Do this after writing its files with fs_write and before installing it — code you have not executed is a guess.",
    "",
    "It imports the package from its document (no install needed), creates a document with its datatype, mounts the tool, clicks the first button, checks that the screen followed the document, and tears it down the way Patchwork will.",
    "",
    "This is the check to reach for by default, because it looks for problems you would not think to look for. When you need to drive something specific — type into a field, click a particular control, check against an existing document — use view_mount with view_interact and view_inspect instead.",
  ].join("\n"),
  where: "host",
  risk: "write",
  input_schema: {
    type: "object",
    required: ["url"],
    properties: {
      ...MOUNT_PROPS,
      interact: { type: "boolean", description: "Click the first button and check the result. Default true." },
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

    try {
      if (mount.mounted) {
        await settle(150)
        notes.push(...describeRender(mount.container))

        const buttons = [...mount.container.querySelectorAll("button")]
        if (input.interact !== false && buttons.length) {
          const docBefore = JSON.stringify(mount.handle.doc())
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
              docAfter: JSON.stringify(mount.handle.doc()),
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
    return notes.join("\n")
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

/** Tests only: forget every live mount. */
export function _resetMounts() {
  for (const id of [...mounts.keys()]) teardown(id, { silent: true })
}

export default [toolCheck, viewMount, viewInspect, viewInteract, viewUnmount]
