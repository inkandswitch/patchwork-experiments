#!/usr/bin/env python3
"""
"Meta" {req, code} pairs: widgets that ANSWER Patchwork questions and SCAFFOLD
tools — grounded in the real API (../patchwork-base/patchwork-skill.md, this
repo's CLAUDE.md) and the real tool lists in ../patchwork-base and
../patchwork-tools. Teaches the model to render dev answers / tool boilerplate as
widgets — the "RLM as the way tools are created" direction.

    python gen_meta.py   ->  seeds-meta.jsonl
"""
import json
from pathlib import Path

PAIRS = []


def ack(line):
    return 'dm.print(' + json.dumps(line) + ');\n'


def codebox(req, ackline, title, content):
    """A widget rendering a titled box with a monospace code block."""
    code = (ack(ackline)
            + 'const box = dm.box({ title: ' + json.dumps(title) + ' });\n'
            + 'const pre = document.createElement("pre");\n'
            + 'pre.style.cssText = "white-space:pre-wrap;font-family:monospace;font-size:11px;margin:0;line-height:1.45";\n'
            + 'pre.textContent = ' + json.dumps(content) + ';\n'
            + 'box.body.appendChild(pre);')
    PAIRS.append({"req": req, "code": code})


def gridpair(req, ackline, rows):
    code = ack(ackline) + 'root.appendChild(dm.grid(' + json.dumps(rows) + '));'
    PAIRS.append({"req": req, "code": code})


# ---- scaffolds ------------------------------------------------------------
codebox("scaffold a patchwork counter tool", "ACKNOWLEDGED. SCAFFOLDING A BUNDLELESS COUNTER TOOL.", "counter.js", """export const CounterDatatype = {
  init(doc)        { doc.title = "Counter"; doc.count = 0 },
  getTitle(doc)    { return doc.title || "Counter" },
  setTitle(doc, t) { doc.title = t },
}

function CounterTool(handle, element) {
  const root = document.createElement("div")
  element.append(root)
  function render() {
    const { count } = handle.doc()
    root.innerHTML = `<button>count: ${count}</button>`
    root.firstChild.onclick = () => handle.change(d => { d.count++ })
  }
  render()
  handle.on("change", render)
  return () => { handle.off("change", render); root.remove() }
}

export const plugins = [
  { type: "patchwork:datatype", id: "counter", name: "Counter", icon: "Hash",
    async load() { return CounterDatatype } },
  { type: "patchwork:tool", id: "counter", name: "Counter", icon: "Hash",
    supportedDatatypes: ["counter"], async load() { return CounterTool } },
]""")

codebox("show the boilerplate for a new patchwork tool", "ACKNOWLEDGED. EMITTING THE PATCHWORK TOOL SKELETON.", "my-tool.js", """export const MyDatatype = {
  init(doc)     { doc.title = "My Tool" /* set defaults */ },
  getTitle(doc) { return doc.title || "My Tool" },
  setTitle(doc, t) { doc.title = t },
}

function MyTool(handle, element) {
  const root = document.createElement("div")
  element.append(root)
  function render() {
    const doc = handle.doc(); if (!doc) return
    root.innerHTML = "" // build UI from doc; wire events to handle.change()
  }
  render()
  handle.on("change", render)
  return () => { handle.off("change", render); root.remove() }
}

export const plugins = [
  { type: "patchwork:datatype", id: "my-tool", name: "My Tool", icon: "File",
    async load() { return MyDatatype } },
  { type: "patchwork:tool", id: "my-tool", name: "My Tool", icon: "File",
    supportedDatatypes: ["my-tool"], async load() { return MyTool } },
]""")

codebox("scaffold a patchwork notes tool", "ACKNOWLEDGED. SCAFFOLDING A NOTES TOOL.", "notes.js", """export const NoteDatatype = {
  init(doc)     { doc.title = "Note"; doc.body = "" },
  getTitle(doc) { return doc.title || "Note" },
  setTitle(doc, t) { doc.title = t },
}

function NoteTool(handle, element) {
  const ta = document.createElement("textarea")
  ta.style.cssText = "width:100%;height:100%;border:none;outline:none;font:inherit"
  element.append(ta)
  ta.value = handle.doc().body || ""
  ta.oninput = () => handle.change(d => { d.body = ta.value })
  const onChange = () => { if (ta.value !== handle.doc().body) ta.value = handle.doc().body }
  handle.on("change", onChange)
  return () => { handle.off("change", onChange); ta.remove() }
}

export const plugins = [
  { type: "patchwork:datatype", id: "note", name: "Note", icon: "StickyNote",
    async load() { return NoteDatatype } },
  { type: "patchwork:tool", id: "note", name: "Note", icon: "StickyNote",
    supportedDatatypes: ["note"], async load() { return NoteTool } },
]""")

codebox("scaffold a solid patchwork tool with solid-js/html", "ACKNOWLEDGED. SCAFFOLDING A SOLID (NO-JSX) TOOL.", "counter-solid.js", """import { render } from "solid-js/web"
import html from "solid-js/html"
import { createSignal } from "solid-js"

function CounterTool(handle, element) {
  const [doc, setDoc] = createSignal(handle.doc())
  const onChange = () => setDoc(handle.doc())
  handle.on("change", onChange)
  const dispose = render(
    () => html`<button onClick=${() => handle.change(d => { d.count++ })}>
      count: ${() => doc().count}
    </button>`,
    element,
  )
  return () => { handle.off("change", onChange); dispose() }
}""")

# ---- concept explainers ---------------------------------------------------
codebox("explain the patchwork plugin registration shape", "ACKNOWLEDGED. THE PLUGIN REGISTRATION SHAPE.", "export const plugins", """// every tool module exports a `plugins` array.
export const plugins = [
  {
    type: "patchwork:datatype",   // describes a document shape
    id: "my-id", name: "My Thing", icon: "File",   // icon = a lucide name
    async load() { return MyDatatype },            // load() is async + lazy
  },
  {
    type: "patchwork:tool",       // a view/editor for a datatype
    id: "my-id", name: "My Thing", icon: "File",
    supportedDatatypes: ["my-id"],  // or ["*"] for any doc
    async load() { return MyToolRenderFn },
  },
]
// pin id MUST equal the tool id. A package can register many plugins.""")

codebox("what is the patchwork tool render contract", "ACKNOWLEDGED. THE (handle, element) => cleanup CONTRACT.", "render contract", """// A tool's load() resolves to a render function:
function Tool(handle, element) {
  // handle  — the document DocHandle (handle.doc(), handle.change(...))
  // element — the host DOM element to render into (light DOM, no shadow)
  const root = document.createElement("div")
  element.append(root)

  function render() { /* build DOM from handle.doc() */ }
  render()
  handle.on("change", render)        // re-render on local + remote edits

  return () => {                     // cleanup is MANDATORY
    handle.off("change", render)
    root.remove()
  }
}""")

codebox("what is a patchwork datatype", "ACKNOWLEDGED. THE DATATYPE CONTRACT.", "datatype", """export const MyDatatype = {
  init(doc)        { doc.title = "Title"; /* seed the schema */ },
  getTitle(doc)    { return doc.title || "Untitled" },
  setTitle(doc, t) { doc.title = t },
  markCopy(doc)    { doc.title = "Copy of " + this.getTitle(doc) }, // optional
}
// init defines your document schema by example. Keep it JSON-shaped
// (plain objects / arrays / strings / numbers).""")

codebox("show how to read and write an automerge document", "ACKNOWLEDGED. READING + WRITING AN AUTOMERGE DOC.", "automerge", """const doc = handle.doc()              // sync snapshot of current state
handle.change(d => { d.foo = 1 })     // ALL writes go through change()
handle.on("change", render)           // fires on local + remote edits
handle.off("change", render)

// gotchas:
// - cannot assign undefined — use `delete d.x` (in change) or `d.x = null`
// - never mutate handle.doc() directly; always inside change()
// - for collaborative text, prefer splice() from @automerge/automerge""")

codebox("how do I get the current user's name in patchwork", "ACKNOWLEDGED. RESOLVING THE CURRENT USER.", "current user", """// window.accountDocHandle is the current user's account doc.
const accountDoc = window.accountDocHandle.doc()
const contact = await repo.find(accountDoc.contactUrl)
const name = contact.doc().name
// repo is on window. repo.find(url) returns a Promise<DocHandle>
// that is already ready (no whenReady needed).""")

codebox("how do I create and find documents with the repo", "ACKNOWLEDGED. CREATING + FINDING DOCUMENTS.", "repo", """// repo is a global (window.repo).
const handle = await repo.find("automerge:XXXX")   // Promise<DocHandle>, ready
const fresh  = await repo.create2({ title: "New" }) // repo.create is deprecated
fresh.change(d => { d.body = "hello" })
// the returned handles are ready — do NOT call whenReady().""")

codebox("how do I do ephemeral presence messaging in patchwork", "ACKNOWLEDGED. EPHEMERAL (NON-PERSISTED) MESSAGING.", "ephemeral", """// DocHandle has a built-in broadcast channel for non-persisted
// peer-to-peer messages (presence, cursors, typing, now-playing).
handle.broadcast({ type: "play", playing: true })
handle.on("ephemeral-message", (payload) => {
  const msg = payload.message   // whatever was broadcast
})
handle.off("ephemeral-message", handler)
// delivered only to currently-connected peers; never stored.""")

codebox("how do I open another document from a patchwork tool", "ACKNOWLEDGED. NAVIGATING TO ANOTHER DOCUMENT.", "open-document", """import { openDocument } from "@inkandswitch/patchwork-elements"
openDocument(element, url, toolId)

// or dispatch the custom event manually (it bubbles + is composed):
element.dispatchEvent(new CustomEvent("patchwork:open-document", {
  detail: { url, toolId },
  bubbles: true, composed: true,
}))""")

# ---- reference grids ------------------------------------------------------
gridpair("what's in the patchwork importmap", "ACKNOWLEDGED. LISTING THE IMPORTMAP PACKAGES.", [
    ["PACKAGE", "USE"],
    ["@automerge/automerge", "CRDT core (splice, etc.)"],
    ["@automerge/automerge-repo", "the Repo / DocHandle"],
    ["solid-js (+ /web /html /store)", "reactive UI, no JSX"],
    ["@codemirror/state /view /language", "code/text editing"],
    ["@inkandswitch/patchwork-elements", "openDocument, events"],
    ["@inkandswitch/patchwork-filesystem", "folders, files, SW urls"],
    ["@inkandswitch/patchwork-plugins", "plugin/registry types"],
])

gridpair("bundleless vs bundled patchwork tools", "ACKNOWLEDGED. COMPARING TOOL BUILD FLAVORS.", [
    ["", "BUNDLELESS", "BUNDLED (vite)"],
    ["use when", "vanilla / solid-html", "JSX, many files, React"],
    ["source", "one .js file", "src/ -> dist/index.js"],
    ["build", "none", "pnpm build"],
    ["sync", "pushwork sync", "build then sync"],
    ["main", "the .js", "./dist/index.js"],
])

gridpair("list the automerge gotchas", "ACKNOWLEDGED. AUTOMERGE GOTCHAS.", [
    ["GOTCHA", "DO"],
    ["no undefined", "delete d.x, or d.x = null"],
    ["no direct mutation", "always in handle.change()"],
    ["repo.find is async", "await it; no whenReady()"],
    ["repo.create deprecated", "use repo.create2()"],
    ["collaborative text", "splice(), not string replace"],
    ["pin id", "must equal the tool id"],
])

gridpair("list the core tools in patchwork-base", "ACKNOWLEDGED. CORE TOOLS IN patchwork-base.", [
    ["TOOL", "ROLE"],
    ["file / folder", "files + directories"],
    ["contact / account-picker", "identity"],
    ["doc-title", "title bar editing"],
    ["comments-view / history-view", "annotations + history"],
    ["codemirror-base / -markdown", "text editing"],
    ["sideboard / context-sidebar", "layout chrome"],
    ["tldraw4 / patchwork-frame", "canvas + framing"],
])

gridpair("list some tools in patchwork-tools", "ACKNOWLEDGED. A SAMPLE OF patchwork-tools.", [
    ["TOOL", "WHAT"],
    ["glomper", "this widget engine"],
    ["chat", "irc-style chat"],
    ["bento / sound", "audio + web components"],
    ["embeddings-map", "2D doc map"],
    ["tic-tac-toe / boardgame", "games"],
    ["catclock / sparkles", "toys"],
    ["llm / llm-canvas", "in-browser models"],
])

gridpair("which lucide icons do patchwork tools use", "ACKNOWLEDGED. EXAMPLE LUCIDE ICON NAMES.", [
    ["ICON", "FITS"],
    ["File / Folder", "documents"],
    ["Hash", "counters / numbers"],
    ["Cpu", "compute / models"],
    ["MessageSquare", "chat / comments"],
    ["Grid3x3", "games / grids"],
    ["Music / Cat / Rabbit", "toys"],
])


out = Path(__file__).parent / "seeds-meta.jsonl"
with open(out, "w") as f:
    for p in PAIRS:
        f.write(json.dumps(p) + "\n")
print(f"wrote {len(PAIRS)} meta pairs -> {out}")
