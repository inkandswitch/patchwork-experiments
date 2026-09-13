/**
 * Built-in skills.
 *
 * Knowledge the agent needs but should not be forced to carry in every prompt:
 * named, described in one line, and read on demand. This is the third layer of
 * the capability model — plugins are what it can *do*, tool documents are what
 * you can teach it to do, skills are what it needs to *know*.
 *
 * These ship with the package so the agent is never knowledge-less, but they
 * are deliberately the fallback: `skill_list` also reads a folder document, and
 * a skill written there wins on name. That matters because this guidance is the
 * thing most likely to need correcting in the field — when the agent gets the
 * render contract wrong, you want to fix it by editing a document, not by
 * redeploying the harness.
 */

export const BUILTIN_SKILLS = [
  {
    name: "writing-patchwork-tools",
    description:
      "How to write a Patchwork tool that actually works: the plugin shape, the render contract, and the four mistakes that get made. Read this before writing any tool.",
    body: `# Writing a Patchwork tool

A tool is a folder of files. There is nothing else to it: write the files with
fs_write, check it with tool_check, and install it by adding its folder URL to
the module settings document. No build step, no bundler, no deploy.

## The files

    my-tool/
      package.json    { "name": "my-tool", "type": "module", "main": "./index.js" }
      index.js        exports \`plugins\` — metadata only
      datatype.js     the document shape
      tool.js         the render function

## The entry module

\`index.js\` must \`export const plugins = [...]\`. Patchwork evaluates this module
**in a worker with no importmap**, and structured-clones every entry to the main
thread. Two consequences, both of which fail confusingly if you ignore them:

- Every field except \`load\` must be JSON-ish. A function anywhere else throws
  DataCloneError and the whole module fails to register.
- No bare imports in this file's static graph. Keep them inside \`load()\`, which
  runs on the main thread where the importmap exists.

    export const plugins = [
      { type: "patchwork:datatype", id: "counter", name: "Counter", icon: "Hash",
        async load() { return (await import("./datatype.js")).default } },
      { type: "patchwork:tool", id: "counter", name: "Counter", icon: "Hash",
        supportedDatatypes: ["counter"],
        async load() { return (await import("./tool.js")).default } },
    ]

\`icon\` is a lucide icon name. A tool's id and its pin id must match.

## The datatype

    export default {
      init(doc)        { doc.title = "Counter"; doc.count = 0 },
      getTitle(doc)    { return doc.title || "Counter" },
      setTitle(doc, t) { doc.title = t },
    }

\`init\` defines the schema by example. Keep it flat and JSON-shaped.

## The render contract

\`(handle, element) => cleanup\`. These four mistakes are the ones actually made:

1. **\`handle.doc()\` is a FUNCTION.** \`handle.doc.count\` is undefined and renders
   nothing, silently.
2. **\`handle.on("change", fn)\` returns nothing.** Unsubscribe with
   \`handle.off("change", fn)\`. Writing \`const un = handle.on(...)\` and calling
   \`un()\` throws on cleanup.
3. **You MUST return a cleanup function** that removes what you added and drops
   your listeners. Patchwork calls it on unmount.
4. **Re-render from the document on every change.** Tracking UI state separately
   means remote edits — other people, other tabs — never appear.

    export default function Tool(handle, element) {
      const root = document.createElement("div")
      element.append(root)

      function render() {
        const doc = handle.doc()                  // a call, not a property
        root.replaceChildren()
        const button = document.createElement("button")
        button.textContent = "count: " + (doc.count ?? 0)
        button.onclick = () => handle.change((d) => { d.count = (d.count ?? 0) + 1 })
        root.append(button)
      }

      render()
      handle.on("change", render)
      return () => { handle.off("change", render); root.remove() }   // mandatory
    }

## Other things that will bite

- **Automerge cannot hold \`undefined\`.** Use null, or \`delete d.field\` inside a
  change.
- **There is no shadow DOM.** Namespace every class under your tool id, or set
  styles inline. Your CSS leaks into the rest of Patchwork otherwise.
- **Use textContent, not innerHTML,** for anything out of a document.
- **Size the outermost container** (\`height: 100%\`) and let an inner element
  scroll; the host renders tools in a bounded box.

## Then

Run \`tool_check\` on the folder. It mounts the tool, clicks its first button, and
tells you whether the screen followed the document. Fix what it reports and check
again before installing anything.`,
  },

  {
    name: "editing-documents",
    description:
      "How to change any Patchwork document safely with doc_edit's path/range/value ops, including text splices that merge with other people's edits.",
    body: `# Editing documents

\`doc_edit\` takes ops of \`{ path, range, value }\`. One verb covers every edit to
every datatype.

- **path** — keys and indices from the document root. \`[]\` is the root.
- **range** — an array \`[from, to]\` SPLICES: characters if the target is a
  string, items if it is a list. A string or number SETS that key on the map or
  list at \`path\`. Omit \`value\` (or pass null) to delete.

## Recipes

    set a title            { path: [], range: "title", value: "New" }
    delete a field         { path: [], range: "draft" }
    append to a list       { path: ["items"], range: [2, 2], value: "milk" }
    replace list items     { path: ["items"], range: [1, 3], value: ["a"] }
    insert text at 10      { path: ["body"], range: [10, 10], value: "hello" }
    replace text 6..11     { path: ["body"], range: [6, 11], value: "there" }

## Rules worth following

- **Read before you write.** Documents have no fixed schema, so \`doc_read\` first
  — \`shapeOnly: true\` for anything large — and make your paths real.
- **Prefer a narrow splice to rewriting a field.** A splice merges with
  concurrent edits from other people; replacing the whole string clobbers them.
- **Offsets come from the text you actually read.** If the read was truncated,
  your offsets are wrong. Read the specific path you are editing.
- **All the ops in one call apply together or not at all**, so group an edit
  that must be atomic into a single \`doc_edit\`.
- **Nothing validates against the datatype.** A document you write into a shape
  its tool does not expect will render badly or not at all — check with
  \`view_mount\` afterwards if it matters.`,
  },

  {
    name: "finding-things",
    description:
      "How to locate documents, code and installed plugins in a Patchwork you have not seen before.",
    body: `# Finding things

You start knowing only the document the session is attached to. Everything else
has to be found.

- **\`doc_tree\`** once, to see the shape of what the user has.
- **\`doc_search\`** by name; add \`content: true\` to search inside file documents
  when the name search finds nothing.
- **\`fs_grep\`** for code — it is far cheaper than reading files one by one.
  \`include: "\\\\.js$"\` narrows it.
- **\`registry_list\`** for what is installed: datatype ids for \`doc_create\`, tool
  ids for \`view_mount\`.
- **\`plugin_source\`** to read how an existing tool is written before writing one
  like it. This is the best available documentation, because it is the code that
  is actually running.

When the user refers to something by name — "the budget doc", "my recipes" —
search before asking. When a search finds nothing, say what you searched rather
than guessing.`,
  },
]
