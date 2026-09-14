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

## Tools that need building

TypeScript, JSX, or an npm dependency like three.js means the package has to be
compiled. That happens **in the browser** — there is no node, no npm install,
and no machine to provision.

    my-tool/
      package.json    { "main": "./dist/index.js" }   ← the BUILT entry
      src/index.ts    exports \`plugins\`
      src/scene.ts    imports "three"
      dist/index.js   written by package_build

1. Write your source under \`src/\` as \`.ts\`.
2. Set \`package.json\`'s \`main\` to \`./dist/index.js\` — Patchwork loads the
   built entry, and so does tool_check.
3. \`package_build\` with \`entry: "src/index.ts"\`. Dependencies you import by
   bare name are fetched as ES modules and bundled in; nothing from them runs,
   esbuild only parses them.
4. \`tool_check\` the package, then install it.

Patchwork's own modules (\`@automerge/*\`, \`@inkandswitch/*\`, \`solid-js\`,
\`@codemirror/*\`) are left external and resolve through the importmap. Do not
try to bundle them: a second copy of automerge is a second Repo, and nothing
would sync.

If the build fails, the error names the file and line. Fix it with fs_write and
build again — that loop is the point of having the compiler here.

## Files that are not source

A package can hold a wasm module, an image, a font. Fetch one straight into the
package with \`http_request\`, which keeps bytes as bytes:

    http_request { url: "https://.../engine.wasm",
                   folder: "<the package folder url>", saveAs: "engine.wasm" }

Importing it from your source gets you the right thing: \`.wasm\` arrives as a
\`Uint8Array\`, images and fonts as data URLs, so a built bundle is still one
file with nothing to fetch at runtime. Never ask a tool for a binary as text —
decoding bytes as UTF-8 destroys them quietly, and a wasm module that has been
through a decoder still starts with the right four bytes.

Large files sync to every device on the account. Fetch what the tool needs, not
a whole SDK.

## Tests

Write tests for logic — anything you could get wrong that is not about
rendering. Put them beside the code as \`*.test.ts\` and run them with
\`package_test\`. They run in the browser; there is no vitest process.

    // src/math.test.ts
    import { describe, it, expect } from "vitest"
    import { add } from "./math"

    describe("add", () => {
      it("adds", () => { expect(add(2, 3)).toBe(5) })
      it("rejects nonsense", () => { expect(() => add(1, "x")).toThrow(/number/) })
    })

The assertions are **real vitest** — \`@vitest/expect\` running on chai, and
\`vi.fn()\`/\`vi.spyOn()\` from \`@vitest/spy\`. Every matcher you know works,
including the asymmetric ones:

    expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }))
    expect([1, 2, 3]).toEqual(expect.arrayContaining([2]))
    expect(spy).toHaveBeenCalledWith(21)

Only vitest's CLI is a node program, so what is missing is \`vi.mock\`,
snapshots and coverage — not the matchers. With no network it falls back to a
smaller built-in set and says which engine it used in the report.

Tests and \`tool_check\` answer different questions, and you want both:
\`package_test\` tells you whether the logic is right, \`tool_check\` tells you
whether the tool mounts, renders, and responds.

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
- **Offsets come from the text you actually read.** A whole-document read
  summarizes long strings, so its offsets are fictional. Read the exact path you
  are editing — \`{ path: ["body"] }\` — and page through anything long with
  \`offset\` and \`limit\` until the result stops saying characters remain.
- **All the ops in one call apply together or not at all**, so group an edit
  that must be atomic into a single \`doc_edit\`.
- **Nothing validates against the datatype.** A document you write into a shape
  its tool does not expect will render badly or not at all — check with
  \`view_mount\` afterwards if it matters.`,
  },

  {
    name: "working-with-the-web",
    description:
      "When to search, fetch, import or call an API; how approval works and why you should not pre-negotiate it; what happens to long pages and to binary files.",
    body: `# Working with the web

Four tools, and picking the wrong one wastes a turn.

- **\`web_search\`** — titles and URLs. It returns links, not answers.
- **\`web_fetch\`** — read a public page as markdown. The default choice.
- **\`web_import\`** — read it AND file it in the user's folders. Use this only
  when they want to keep the material, because it puts a document somewhere they
  will see it.
- **\`http_request\`** — methods, headers, bodies, credentials. For APIs and for
  files, not for reading pages.

## Being asked for permission

Reaching outside Patchwork needs a human yes. Just make the call — the session
stops, they answer, and you carry on. Do not ask in prose whether you may fetch
something; that costs a turn and they have to answer twice.

They can hand you a whole site at once, so a research task usually stops once
and then runs. If you know you are about to read several pages from one place,
fetch the first one and say so — the choice they are offered includes that site.

A denial is about that call. Do not immediately try the same URL a different
way; say what you wanted it for, or find another source.

## Long pages become documents

Anything longer than a couple of paragraphs is saved to its own document, and
the result tells you where and how much of it you were shown. To see more, read
that document — do not fetch the page again:

    doc_read { url: "automerge:...", path: ["content"], offset: 12000 }

It is cheaper, and the text cannot have shifted underneath your offsets.

## Binary stays binary

A wasm module, an image, a font, an archive: \`http_request\` keeps the bytes and
writes them to a document rather than putting them in this conversation. You
never see the contents, which is correct — you could not use them from here
anyway. What you get is the size, the format read from its magic number, and the
document URL.

Pass \`folder\` when you are fetching a file in order to keep it, so it lands in
the package that needs it instead of nowhere in particular.

## What will not work

This runs in a browser. The origin policy still applies, so an API that does not
serve permissive CORS cannot be called from here — an error mentioning CORS
means unreachable, not misconfigured. Pages go through a reader service, and
some sites block it; that is a reason to find another source, not to retry.`,
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

Pages you fetched earlier are documents too. \`web_fetch\` saves anything longer
than a couple of paragraphs and the result gives you the URL, so re-reading part
of one is \`doc_read\`, not another fetch — cheaper, and the content cannot have
changed underneath you.

When the user refers to something by name — "the budget doc", "my recipes" —
search before asking. When a search finds nothing, say what you searched rather
than guessing.`,
  },
]
