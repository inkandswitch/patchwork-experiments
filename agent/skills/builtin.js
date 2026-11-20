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
      "How to write a Patchwork tool that works: the plugin shape, the render contract and its usual mistakes, imports, styling with the theme, building, and changing an installed tool. Read before writing or changing any tool.",
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

## What to write it in

**Plain JavaScript first.** A render function that rebuilds its DOM from the
document on every change (below) is the simplest thing that works, and it
needs no build. Most tools should be exactly that.

**Solid if you need fine-grained reactivity — never React.** When the UI has
enough independent live pieces that rebuilding everything gets painful, use
Solid through \`solid-js/html\` tagged templates. It is in the importmap, so
this needs no build either:

    import { render } from "solid-js/web"
    import html from "solid-js/html"
    import { createSignal } from "solid-js"

    export default function Tool(handle, element) {
      const [doc, setDoc] = createSignal(handle.doc())
      const onChange = () => setDoc(handle.doc())
      handle.on("change", onChange)
      const dispose = render(
        () => html\`<button onClick=\${() => handle.change((d) => { d.count = (d.count ?? 0) + 1 })}>
          count: \${() => doc().count ?? 0}
        </button>\`,
        element,
      )
      return () => { handle.off("change", onChange); dispose() }
    }

Write every dynamic part as a function (\`\${() => doc().count}\`); a bare value
renders once and never updates. Do not use JSX for Solid: Solid's JSX needs its
own compiler, which \`package_build\` does not run, and \`solid-js\` has no JSX
runtime Patchwork can load. \`html\` gives you the same updates.

Put these imports in \`tool.js\`, never in \`index.js\` — see the next section.

## The entry module

\`index.js\` must \`export const plugins = [...]\`. Patchwork evaluates this module
**in a worker with no importmap**, and structured-clones every entry to the main
thread. Two consequences, both of which fail confusingly if you ignore them:

- **Every field except \`load\` must be JSON-ish**: strings, numbers, arrays,
  plain objects. A function anywhere else throws DataCloneError and the whole
  module fails to register. That holds for every plugin type, including ones
  other tools define (\`chat:slash\`, say): behaviour goes behind \`load()\`.

      // WRONG: transform is a top-level function
      { type: "chat:slash", id: "me", cmd: "/me", transform: (arg) => ({ text: arg }) }

      // RIGHT: metadata at the top, the function comes back from load()
      { type: "chat:slash", id: "me", cmd: "/me",
        async load() { return { transform: (arg) => ({ text: arg }) } } }

- **No bare imports in this file's static graph** — not \`solid-js\`, not
  \`@inkandswitch/*\`, not even an unused one, and not one pulled in by a file
  you import. The worker cannot resolve them ("Failed to resolve module
  specifier") and the module fails to load. Keep them inside \`load()\`'s dynamic
  \`import()\`, which runs on the main thread where the importmap exists.

So the entry module is metadata plus one-line \`load()\`s, and the real code
lives in files those import:

    export const plugins = [
      { type: "patchwork:datatype", id: "counter", name: "Counter", icon: "Hash",
        async load() { return (await import("./datatype.js")).default } },
      { type: "patchwork:tool", id: "counter", name: "Counter", icon: "Hash",
        supportedDatatypes: ["counter"],
        async load() { return (await import("./tool.js")).default } },
    ]

That split is also what keeps Patchwork fast: it reads every package's
\`plugins\` just to list names and icons, and a heavy entry module is parsed for
nothing. Have each file \`export default\` what \`load()\` returns.

- \`icon\` is a lucide icon name (\`"Music"\`, \`"Grid3x3"\`, \`"Sparkles"\`).
- A tool's \`id\` and its pin id must match, or the pin resolves to nothing.
- \`supportedDatatypes: ["*"]\` makes a tool that opens any document, like an
  inspector.
- \`unlisted: true\` keeps a datatype out of the "new document" menus.
- One package can register as many plugins as it likes — a datatype and its
  tool, several tools, an \`agent:tool\` (see below). Code two plugins share
  belongs in one package, not copied between two.

## The datatype

    export default {
      init(doc)        { doc.title = "Counter"; doc.count = 0 },
      getTitle(doc)    { return doc.title || "Counter" },
      setTitle(doc, t) { doc.title = t },
      markCopy(doc)    { doc.title = "Copy of " + (doc.title || "Counter") },   // optional
    }

\`init\` runs inside a change on a brand-new document and defines the schema by
example. Keep it flat and JSON-shaped. \`getTitle\` and \`setTitle\` are what give
the document a name anywhere in Patchwork.

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

## Reading and writing the document

    const doc = handle.doc()                 // a snapshot: read it, never mutate it
    handle.change((d) => { d.count = 1 })    // every write goes through change()
    handle.on("change", render)              // local and remote edits alike

- **Read the "automerge" skill before writing code that changes a document.**
  The obvious moves — \`d.items = d.items.filter(…)\`, \`await\` inside
  \`change()\`, writing to \`handle.doc()\` — fail silently or lose data.
- **Automerge cannot hold \`undefined\`.** Use null, or \`delete d.field\` inside a
  change.
- **\`repo.find(url)\` returns a Promise** of a handle that is already ready:
  \`const h = await repo.find(url)\`. There is no \`whenReady()\` to call.
  \`await repo.create2()\` makes a new document (\`repo.create\` is the old API).
- **For text several people edit,** do not assign the whole string on every
  keystroke — concurrent edits overwrite each other. Inside the change, use
  \`updateText(d, ["body"], newValue)\` from \`@automerge/automerge\`, which
  writes only what differs, so edits merge.
- Patchwork puts \`window.repo\` and \`window.accountDocHandle\` on the page. The
  user's name is
  \`(await repo.find(accountDocHandle.doc().contactUrl)).doc().name\`.

## Multiplayer without writing to the document

Presence, cursors, "now playing", typing indicators — state that should reach
the people looking right now and never be stored — go over the handle's
ephemeral channel instead of into the document:

    handle.broadcast({ type: "cursor", x, y })
    const onMessage = ({ message }) => { /* message is what was broadcast */ }
    handle.on("ephemeral-message", onMessage)
    // and in cleanup: handle.off("ephemeral-message", onMessage)

Only peers with the document open receive it, and nothing persists. Anything
that should still be there tomorrow belongs in \`handle.change()\`.

## Talking to Patchwork

    import { openDocument } from "@inkandswitch/patchwork-elements"
    openDocument(element, url, toolId)       // navigate to another document

Under that is a bubbling \`patchwork:open-document\` event with
\`detail: { url, toolId }\`, and \`patchwork:mounted\` fires when an inner
\`<patchwork-view>\` has rendered. Embedding another tool is
\`<patchwork-view tool-id="...">\` — a lookup by id at runtime, which renders
nothing if that tool is not installed rather than breaking yours.

## What you can import

Patchwork's importmap provides these by bare name, in a bundleless tool or a
built one alike:

- \`@automerge/automerge\` (and \`/slim\`), \`@automerge/automerge-repo\`
- \`@inkandswitch/patchwork-elements\`, \`-filesystem\`, \`-plugins\`, \`-providers\`,
  \`-bootloader\`
- \`@codemirror/state\`, \`@codemirror/view\`, \`@codemirror/language\`,
  \`@codemirror/commands\`
- \`solid-js\`, \`solid-js/web\`, \`solid-js/html\`, \`solid-js/store\`, \`solid-js/h\`

Import them by those names, never from esm.sh or unpkg: a second copy of
automerge is a second Repo, and nothing would sync. Anything else needs
\`package_build\` (below).

## Files and assets

    type FolderDoc = { title: string, docs: DocLink[] }
    type DocLink   = { name: string, type: string, url: AutomergeUrl }
    type FileDoc   = { name, extension, mimeType, content: string | Uint8Array }

- \`automergeUrlToServiceWorkerUrl(url)\` from
  \`@inkandswitch/patchwork-filesystem\` turns a file document into a URL you
  can put in \`<img src>\` or \`<audio src>\`.
- In a bundleless tool, load your own files with
  \`new URL("./click.wav", import.meta.url)\`.
- \`(await getRegistry("patchwork:datatype").load(id)).module\` gets an
  installed datatype at runtime (\`getRegistry\` is from
  \`@inkandswitch/patchwork-plugins\`).

## Styling

There is **no shadow DOM**: your tool renders into the same page as everything
else, so unscoped CSS leaks out and other tools' CSS leaks in.

- **Scope everything under one root class**, ideally your tool id:
  \`.counter .label { ... }\`, never a bare \`.label\` or \`button\`.
- **Ship styles inside your JavaScript**: a \`<style>\` element your render
  function appends and your cleanup removes. Do not \`import "./styles.css"\`:
  \`package_build\` writes one file, and the build fails with "Cannot import ...
  into a JavaScript file without an output path configured".
- **No CSS frameworks** — no Tailwind, no DaisyUI. Plain CSS.
- **Size the outermost container** (\`height: 100%\`) and let an inner element
  scroll (\`overflow: auto\`); the host renders tools in a bounded box.

### Colours come from the theme

Never write a hex colour, and never \`white\` or \`black\`. Patchwork's theme
sets CSS variables, and a tool that uses them follows the user's theme,
including dark mode, for free. Map the ones you use to your own names in one
place, inside \`@layer package\`, and use only your names in rules:

    @layer package {
      :root, :host, [theme] {
        --counter-bg: var(--editor-fill, white);
        --counter-fg: var(--editor-line, black);
        --counter-muted: var(--editor-line-offset-50, #999);
        --counter-border: var(--editor-fill-offset-20, #ccc);
        --counter-accent: var(--studio-primary, #35f7ca);
        --counter-accent-ink: var(--studio-primary-line, black);
        --counter-hover: color-mix(in oklch, var(--editor-fill), var(--editor-line) 5%);
        --counter-font: var(--editor-family-sans, system-ui, sans-serif);
      }
    }

    .counter { background: var(--counter-bg); color: var(--counter-fg); font-family: var(--counter-font); }
    .counter button { background: var(--counter-accent); color: var(--counter-accent-ink); }
    .counter .item[data-selected] { background: var(--counter-hover); }

(The fallbacks after the commas are the only place a literal colour belongs.)

- **\`--editor-*\` is the surface a tool paints on**: \`--editor-fill\` and
  \`--editor-line\` (background and ink), \`--editor-fill-offset-10\`…\`-50\` for
  tinted backgrounds, \`--editor-line-offset-10\`…\`-50\` for muted text,
  \`--editor-family-sans\`, \`--editor-family-code\`. \`--studio-*\` fill and line
  are Patchwork's own chrome; a tool should not use them.
- **Accents are \`--studio-primary\`, \`-secondary\`, \`-danger\`, \`-warning\`.** Painting
  a surface in one is \`--studio-primary-fill\`, with \`--studio-primary-line\` for the
  ink on top of it. Accent-coloured text on the normal background is
  \`--editor-primary-text\`.
- **Need another shade? \`color-mix()\`** the theme's colours: toward
  \`--editor-fill\` to lighten, toward \`--editor-line\` to darken, so it inverts
  correctly in a dark theme.
- **Never write \`@media (prefers-color-scheme: dark)\`.** The theme swaps the
  variables; there is nothing for you to do.
- Spacing, radius and transitions may be used directly:
  \`--studio-space-2xs\`…\`-2xl\`, \`--studio-radius-sm\`…\`-xl\`,
  \`--studio-radius-round\`, \`--studio-shadow-sm\`…\`-lg\`,
  \`--studio-transition-fast\`…\`-slow\`.
- **State is a data attribute**: \`.item[data-selected]\`, \`[data-state="editing"]\`,
  not a modifier class.

## Other things that will bite

- **Never \`stopPropagation()\` on \`click\`.** Solid listens for clicks on the
  document, so stopping one kills every \`onClick\` above it. Stop
  \`pointerdown\` instead, if you must stop anything.
- **Use textContent, not innerHTML,** for anything out of a document.
- **Cleanup tears down everything**: listeners, intervals, animation frames,
  audio contexts, workers — not only the DOM.

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

If the build fails, the error names the file and line. Fix it with fs_edit and
build again — that loop is the point of having the compiler here.

## Files that are not source

A package can hold a wasm module, an image, a font. Fetch one with
\`http_request\`, which keeps bytes as bytes, then file what it kept into the
package under the name your code imports:

    http_request { url: "https://.../engine.wasm" }
    source_file  { source: "<the url it was kept at>",
                   folder: "<the package folder url>", name: "engine.wasm" }

Importing it from your source gets you the right thing: \`.wasm\` arrives as a
\`Uint8Array\`, images and fonts as data URLs, so a built bundle is still one
file with nothing to fetch at runtime. Never ask a tool for a binary as text —
decoding bytes as UTF-8 destroys them quietly, and a wasm module that has been
through a decoder still starts with the right four bytes.

Large files sync to every device on the account. Fetch what the tool needs, not
a whole SDK.

## Changing a tool that is already installed

Patchwork runs a package at its folder document's version, not its files'.
Editing a file changes only that file's document, so on its own nothing
reloads. \`fs_write\`, \`fs_edit\` and \`fs_delete\` **by path** move the package's
version for you, and say so ("Package version moved"); after that Patchwork
reloads it and your next call to its tools runs the new code. Writing a file
**by URL** cannot know which package it is in and does not — so for a package
that is installed, always write by path.

Never "touch" some other folder to force a reload: the version that matters is
the package folder's, and nothing else.

## Give your tool an API, not just a UI

A render function is something a *person* operates. An agent asked to "use the
git-clone tool" has no good way in: it can drive your UI through \`view_mount\`
and hope your selectors never change, or reimplement your logic with
\`http_request\` and watch the two drift apart. Both are worse than the thing you
already wrote.

So register the capability alongside the interface. The same package, the same
\`plugins\` array, one more entry:

    // index.js
    export const plugins = [
      { type: "patchwork:datatype", id: "repo", ... },
      { type: "patchwork:tool", id: "git-clone", ...,
        async load() { return (await import("./tool.js")).default } },

      { type: "agent:tool",
        id: "git_clone",                      // snake_case: it is a tool name
        name: "Clone a repository",
        description: "Clone a GitHub repo into a folder document. Pass the " +
                     "owner/name and it fetches the tree and the files.",
        where: "worker",                      // "host" if it needs the DOM
        risk: "external",                     // read | self | write | external
        input_schema: {
          type: "object",
          required: ["repo"],
          properties: {
            repo: { type: "string", description: "owner/name, e.g. adjointlabs/dots" },
            into: { type: "string", description: "Folder to clone into. Omit for a new one." },
          },
        },
        async load() { return (await import("./agent.js")).default },
      },
    ]

    // agent.js
    export default {
      async execute(input, ctx) { /* ctx.repo, ctx.signal, ctx.fetchImpl */
        return "Cloned 41 files into automerge:…"
      },
      summarize(input, output) { return \`cloned \${input.repo}\` },
    }

The metadata is read from the plugin entry and the behaviour comes from
\`load()\`, which is the same split every Patchwork plugin uses and for the same
reason: entries are structured-cloned into a worker, so a function anywhere but
\`load\` throws DataCloneError and the whole module fails to register.

Write \`execute\` and the UI against **one shared module**, so they cannot
disagree about what cloning means. That is the point of doing this rather than
letting an agent reimplement you.

### What the fields do

- **description** is the documentation. It is all the agent ever sees, so say
  what the tool is for, when to reach for it, and what it will not do.
- **input_schema** — describe every parameter. An undescribed one gets guessed
  at.
- **where** — \`worker\` if a repo is all you need, \`host\` if you need the DOM or
  the plugin registry.
- **risk** — \`read\` runs silently; \`write\` and \`external\` ask the user once and
  can then be granted more broadly; \`alwaysAsk: true\` asks every time, for
  anything that carries credentials somewhere.
- **summarize** is the one line shown in the transcript for every call. Say what
  happened, not what was asked — the row already shows the arguments.
- **scoped: true** — only for a \`worker\` tool that works solely through the
  context it is handed: it fetches only with \`ctx.fetchImpl\` (and refuses to
  run without it), writes only through \`ctx.repo\`, and touches no global, no
  platform \`fetch\` and no host module. Research steps then get it too, with
  their confined context: a repo that opens only the workflow's kept sources
  and files what it makes there, and the guarded fetch. It is the package's
  promise, which the agent cannot check, so installing a package that makes
  it extends what research steps can do. Leave it out otherwise; a tool
  without it is for full sessions only. (The Web snapshot package's
  \`web_capture\` is one that makes it.)

### Watch the mime type

The service worker serves a file document's \`mimeType\` verbatim, and \`import()\`
refuses a module served as \`text/plain\` — while a plain \`fetch\` of the same URL
returns 200 and the right bytes, so it looks like the file is fine. \`fs_write\`
maps extensions to types for you. If you create file documents by hand, \`.js\`
must be \`text/javascript\` or nothing will load and the error will not say why.

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

When you need to drive something specific — a particular control, a sequence of
steps, a real document rather than a test one — that is \`view_mount\` and the
tools around it. Read the "driving-a-view" skill first.

Tests and \`tool_check\` answer different questions, and you want both:
\`package_test\` tells you whether the logic is right, \`tool_check\` tells you
whether the tool mounts, renders, and responds.

## Seeing it, and shipping it

\`tool_check\` brings back a picture of what rendered, and a mounted view appears
in the transcript beside your call — so "does it look right" is something
you can both answer rather than something you assert.

When it passes, say so and stop. The user has a panel listing everything the
session made, with Install beside anything installable; they choose between
installing live (which follows your later edits) and pinning this version. Never
hand them a URL to paste into their settings.

## Then

Run \`tool_check\` on the folder. It mounts the tool, clicks its first button, and
tells you whether the screen followed the document. Fix what it reports and check
again before installing anything.`,
  },

  {
    name: "driving-a-view",
    description:
      "How to open a document in a real tool and operate it — click, type, read what rendered — and when that beats reading the document. Read this before using view_mount.",
    body: `# Driving a view

\`view_mount\` opens a document in an installed tool and leaves it running, so
you can click its controls, type into its fields and read what it drew. Two jobs
need it:

- **Checking your own work looks right.** A document with the right fields in it
  can still render as an empty box. Structure is not appearance.
- **Operating a tool that has no document-level API.** A canvas, a text editor,
  a drawing surface — the state you care about is not in a readable shape, and
  clicking the thing is the only way in.

## The loop

    view_mount    { docUrl }          -> mountId, and a picture of what rendered
    view_inspect  { mountId }         -> what is on screen, and the document
    view_interact { mountId, ... }    -> click / type / submit, and what changed
    view_inspect  { mountId }         -> check it
    view_unmount  { mountId }

Mount a real document with \`docUrl\`; mount a package you wrote but have not
installed with \`url\`. Four mounts stay live at once and the oldest is dropped,
so unmount as you go rather than all at the end.

**Inspect before you interact.** Your selector has to match what the tool
actually rendered, not what you expect it rendered. One \`view_inspect\` costs a
call and saves several guesses.

## Reading the result

\`view_interact\` reports two things, and you need both:

- whether the **document** changed — did the click actually write anything
- whether the **screen** changed — did the tool re-render from it

A click that changes the document but not the screen is the most common bug in a
Patchwork tool, and it is invisible if you only look at one of them. A click that
changes neither usually means your selector matched the wrong element.

## What it does and does not simulate

- \`click\` calls \`.click()\`. No pointer moves, so hover and drag are out of reach.
- \`type\` sets the value and fires **both** \`input\` and \`change\`. It does not send
  keystrokes, so a tool listening for \`keydown\` will not notice, and an
  autocomplete that reacts per character will not behave as it would for a
  person.
- \`submit\` fires a submit event on a form.

\`settleMs\` is how long it waits for the tool to react. Raise it for anything that
renders asynchronously — an inspect that runs too early reports a failure that is
only a race.

## The live page is a different thing

\`view_inspect\` reads a mount you opened. \`dom_snapshot\` reads the page the
user is actually looking at right now — their sidebar, their open document,
whatever is on their screen. Use that one when the question is about *their*
Patchwork rather than about something you opened. After \`view_open\`, pass the
document's \`url\` to \`dom_snapshot\` so it looks inside that view; it waits a
moment for the view to render.

\`view_screenshot\` takes a picture of a mount, or of the live page. Mounting and
\`tool_check\` already return one, so reach for it when you want another look
after interacting — whether a menu opened, whether a layout broke.

\`view_open\` navigates the user's Patchwork to a document. When you have made or
found something they should see, open it: handing them a URL in prose is worse
than just showing them.

## Unmounting is part of the test

\`view_unmount\` tears the tool down the way Patchwork will and tells you whether
its cleanup was well-behaved: whether it removed what it added and dropped its
listeners. A tool that leaks on unmount is broken in a way nothing else here will
tell you about, so always finish with it.

## Or just use tool_check

For a tool you have written, \`tool_check\` does all of the above in one call and
looks for problems you would not think to look for. Reach for the \`view_*\` tools
when you need to drive something specific: a particular control, a real
document, a sequence of steps.`,
  },

  {
    name: "automerge",
    description:
      "Read before writing code that changes a document. The automerge mistakes that lose data silently: writing outside change(), await inside it, filter/map on lists, whole-string writes, counters, moving objects.",
    body: `# How automerge behaves

Every Patchwork document is an automerge document, and automerge is not a
plain JSON object. Several of the obvious moves fail, and the worst of them
fail *silently*: the code runs, the screen looks right, and the data is gone
on reload or the next time someone else edits. Each rule here is checked
against the automerge Patchwork ships (\`automerge-facts.test.js\`).

Import what you need from \`@automerge/automerge\` (Patchwork provides it):
\`import { splice, updateText, Counter } from "@automerge/automerge"\`.

## Writes go through change(), synchronously

- **Every write goes inside \`handle.change((d) => { … })\`.** Writing to
  \`handle.doc()\` instead does not throw and even shows the new value — but it
  is never saved or synced, and it is gone on reload.
- **\`change()\` is synchronous.** Anything written after an \`await\` inside the
  callback is silently dropped. Do the async work first, then change:

      const data = await fetchSomething()
      handle.change((d) => { d.data = data })

- Reassigning \`d\` or returning a value from the callback does nothing.
- **What a document can hold:** objects, arrays, strings, numbers, booleans,
  null, Dates and Uint8Arrays. \`undefined\`, functions, Maps and Sets throw —
  use null or \`delete d.field\`, and plain objects for maps. A class
  instance is stored as a plain object and comes back without its class.

## Change the smallest thing

Automerge merges edits by *where* they land. Two people editing different
fields of an object both win; one person replacing the whole object erases the
other's edit. So:

- **Never rebuild a list or object to change part of it.**
  \`d.items = d.items.filter(…)\` or \`.map(…)\` throws for a list of objects
  ("Cannot create a reference to an existing document object"), and the usual
  workaround — deep-copy and reassign — quietly deletes anything someone else
  added meanwhile. Edit in place:

      const i = d.items.findIndex((item) => item.id === id)
      if (i >= 0) d.items.splice(i, 1)         // remove
      d.items[i].done = true                    // change one field
      d.items.push({ id, text: "new" })        // add

- **Removing several:** walk backwards, so indices ahead of you do not shift.
  \`for (let i = d.items.length - 1; i >= 0; i--) if (gone(d.items[i])) d.items.splice(i, 1)\`
- **Text:** \`d.body = newText\` and \`d.body += "x"\` replace the whole string,
  and a collaborator's concurrent typing is lost. Use
  \`updateText(d, ["body"], newText)\` (writes only what differs) or
  \`splice(d, ["body"], index, deleteCount, "inserted")\`.
- **Numbers several people bump** (votes, scores, counts): \`d.n += 1\` from two
  people at once comes out +1, not +2. Store \`new Counter(0)\`, change it with
  \`d.n.increment(1)\`, and read it as \`doc.n.value\`.
- **Two people setting the same key** at once: one value wins everywhere and
  the other is kept as a conflict (\`getConflicts(doc, "key")\`). If both
  matter, they should not be the same key — give each person their own.

## Lists are not arrays

- There is no \`sort\`, \`reverse\`, or \`length = 0\`. Use \`push\`, \`splice\`,
  \`insertAt(i, …)\`, \`deleteAt(i)\`; empty with \`d.items.splice(0, d.items.length)\`.
- **Don't store an order by moving items.** Sorting a list of objects means
  deleting and re-inserting copies, which loses concurrent edits to them. Keep
  the order in the data (a \`position\` or \`createdAt\` field) and sort a copy
  when you render: \`[...doc.items].sort(byPosition)\`.
- Writing past the end throws (\`index 10 is out of bounds\`).
- **Refer to items by an id you store**, not by index — indices shift when
  others insert or delete. Inside \`change()\`, \`d.items[0] === d.items[0]\` is
  false (each read is a new proxy), so compare ids, not objects.

## Moving and copying

An object already in the document cannot be placed somewhere else in it — that
throws. Copy it: \`JSON.parse(JSON.stringify(d.source))\`. \`{ ...d.source }\` only
works when nothing inside it is an object, and \`structuredClone\` throws.

## Versions

A URL with heads (\`automerge:…#…\`, as \`doc_history\` gives) opens the
document as it was then. It is read-only: \`change()\` on it throws "view-only
mode". Write to the plain URL.

## doc_edit does this for you

When *you* edit a document with \`doc_edit\`, setting a value writes only what
differs: send back the whole object you read with one field changed, and only
that field is written; set a string and only the changed characters are; set a
counter to a number and it is incremented. So whole-value sets are safe there.
What it cannot do is guess an id — remove list items with a splice range on
their index, from a fresh read.`,
  },
  {
    name: "keeping-notes",
    description:
      "What to write down so later sessions start knowing it: when to note_write, what makes a note worth keeping, how to keep notes from rotting, and what never goes in one.",
    body: `# Keeping notes

Each session starts with a list of your notes (\`note_read\` opens one). They
live in the user's "Agent notes" folder, where the user reads and edits them
too — so write them for both of you.

## When

Before you finish, ask: did I work something out that the next session would
have to work out again? The best notes come from being wrong first — a write
that failed and why, a datatype that was not shaped the way you assumed, a tool
that behaves differently from its description. Write it then, while you know.

## What

- **Worth keeping:** how a particular datatype or document is actually shaped;
  a mistake and the fix; how something in this workspace behaves; a preference
  the user stated ("they want tests before code").
- **Not worth keeping:** a log of what you did today; anything a skill already
  says; anything you could read straight off a document when you need it.

## How

- One topic per note, named for the topic: \`automerge counters\`, not
  \`session 14 learnings\`.
- Start with \`# Title\` and one line saying what it is. That line is all a
  later session sees in the list, so make it decide whether to read on.
- Say *why*, not only *what* — a rule without its reason gets misapplied.
- Update instead of adding a near-duplicate: \`note_read\`, change it,
  \`note_write\` the whole thing back (only the difference is written).
- A note that turned out wrong is worse than none. Fix it or \`note_delete\` it.

## Never

No credentials, tokens, passwords or keys — notes are synced, and one that
looks like it holds one is refused. Nothing the user told you in confidence
that they would not want sitting in a folder.`,
  },
  {
    name: "running-workflows",
    description:
      "When a job is worth splitting across several agent sessions, how to write steps that stand alone, choosing each step's tier and placement, fanning out on results, and bringing it together.",
    body: `# Running workflows

\`workflow_start\` hands a job to several agent sessions at once — each step its
own session, on its own model, running in parallel where it can and in order
where one step needs another's result. It costs a session per step, so it is
worth it only when the job really divides: many independent pieces (one per
file, per document, per finding), or a pipeline where a cheap model gathers and
a strong one judges. A job you could do in a few tool calls, do yourself.

## Writing a step

- **Its prompt stands alone.** A step sees the goal, its own prompt, and the
  results of the steps in its \`after\` — not this conversation. Name the URLs,
  paths and constraints it needs. Say what its result should contain, because
  that result is all you will get back.
- **Small and checkable.** "Review tools/ops.js for automerge misuse and list
  each problem with its line" beats "review the code".
- **\`after\` is for real dependencies.** Everything not waiting on something
  starts at once, up to the parallel limit.

## Tier and placement

- **deep** (the strongest model): planning, judgement, hard reasoning, and
  checking another step's work. **standard**: most writing and editing.
  **fast**: searching, reading, extracting, mechanical changes. Say why in
  \`why\` — the person sees it beside the step.
- **where: worker** unless the step needs the page: mounting or driving a view,
  screenshots, \`package_test\`, \`doc_create\`, the plugin registry. Worker
  steps run side by side; host steps take turns on the page.
- **access: web** for research — finding sources, reading datasheets and
  standards. The step gets \`web_search\`, \`web_fetch\`,
  \`http_request\` (GET and HEAD), \`source_read\`, \`source_list\`, \`finding_write\` and
  \`session_recall\` — and \`web_capture\` when the Web snapshot package is
  installed and the step runs in a tab (a worker has no plugins) — and nothing
  else, so it can fetch without asking anyone (it can reach none of the
  person's documents to leak). Everything it fetches, every page it captures
  and every finding it writes is kept, shared with the other research steps
  of the workflow, and filed in the workflow's Sources folder, which the news
  gives you; later steps can read it there. Ask for what it found, with
  sources, in its result.

**A research step is never handed what a full step found.** A step with the
person's documents may have read anything of theirs, and a research step may
send anything it holds to any site, so its prompt gets only the results of
other research steps. What it needs from other work, write into its prompt
yourself — and put no document URLs there: a URL is enough to open a
document, and the step could hand it to a site.

**Before you write a step, check that its tools can do it.** A step cannot do
what its toolset does not allow, and it will spend its whole budget finding
that out. A web step cannot edit or file a document or mount a view; a worker
step cannot touch the page. If the work needs both, split it into steps that
each have what they need.

## Fanning out, and finishing

\`workflow_start\` returns at once; you are woken as steps finish, with their
results. When a result calls for more work — a review that found five problems
— \`workflow_add_steps\` with one step per problem, \`after\` the review. A
common shape: gather (fast, many) → judge or verify (deep) → act (standard)
→ check (deep).

When the workflow is over, bring the results together for the person: what was
done, what was found, what failed and why. \`workflow_status\` shows every
step; \`workflow_stop\` cancels steps or the whole thing.

## Budgets

Money is managed in two layers. The workflow has a budget in dollars that only
the person can raise: when the steps have spent it, nothing more starts, you
are told, and they are offered Resume. Each step has a budget of its own within
that — \`budget\` on the step, or its tier's default — so that one step going
round in circles spends its own allowance, not everyone's.

A step that spends its budget stops part-way and you are woken. Look at its
session and decide: \`workflow_budget\` to let it carry on with more if it was
making progress, \`workflow_stop\` if it was not, or \`workflow_add_steps\` to
do the rest differently — a narrower question, a stronger tier. Give a step a
bigger budget up front when it has a lot to do (a long design, many pages to
read), rather than topping it up later.

## Steps that need someone

A step that asks a question wakes you with it. It works for you, so answer it
with \`workflow_answer\` when the answer follows from the goal or from what you
know; when it is the person's call, ask them (\`ask_user\`) and pass their
answer on. A step that needs *permission* for a tool waits for the person — you
cannot grant it — and they see it above your conversation and in the workflow
view.`,
  },
  {
    name: "editing-documents",
    description:
      "How to change any Patchwork document safely with doc_edit's path/range/value ops, and how to change text by anchoring on it (find, fs_edit) rather than counting characters.",
    body: `# Editing documents

\`doc_edit\` takes ops of \`{ path, range, value }\`. One verb covers every edit to
every datatype.

- **path** — keys and indices from the document root. \`[]\` is the root.
- **range** — an array \`[from, to]\` SPLICES: characters if the target is a
  string, items if it is a list. A string or number SETS that key on the map or
  list at \`path\`. Omit \`value\` (or pass null) to delete.
- **find** — for a string, the exact text to replace with \`value\`, instead of a
  range. It must occur exactly once.

## Recipes

    set a title            { path: [], range: "title", value: "New" }
    delete a field         { path: [], range: "draft" }
    append to a list       { path: ["items"], range: [2, 2], value: "milk" }
    replace list items     { path: ["items"], range: [1, 3], value: ["a"] }
    change some text       { path: ["body"], find: "teh cat", value: "the cat" }
    insert text at 10      { path: ["body"], range: [10, 10], value: "hello" }

## Changing text: anchor on it, do not count

You have line numbers (fs_grep, fs_read) and you have the text itself. You do
not have character offsets, and working them out by eye does not end well. So:

- **In a file**, use \`fs_edit\` with the old text and the new. Copy the old text
  exactly from what you read. If it occurs more than once, include a line
  around it.
- **In any other document's string**, use \`doc_edit\` with \`find\`. Same rule.
- **A numeric range** is for lists, and for inserting at the very start or end
  of a string (\`[0, 0]\`, or \`[n, n]\` where n is the length the read reported).
- Rewriting the whole thing with \`fs_write\` is fine too: it changes only the
  characters that differ. It just costs you the tokens to re-emit the file.

Either way the change lands as a splice of just the differing characters, so
it merges with other people's concurrent edits.

## Rules worth following

- **Read before you write.** Documents have no fixed schema, so \`doc_read\` first
  — \`shapeOnly: true\` for anything large — and make your paths real.
- **Anchor text edits on the text** (\`find\`, or \`fs_edit\`), as above. If you do
  give a numeric range, the offsets must come from a read of that exact path —
  a whole-document read summarizes long strings, so its offsets are fictional.
- **All the ops in one call apply together or not at all**, so group an edit
  that must be atomic into a single \`doc_edit\`.
- **Nothing validates against the datatype.** A document you write into a shape
  its tool does not expect will render badly or not at all — check with
  \`view_mount\` afterwards if it matters.

## The other two document tools

- **\`doc_history\`** — how the document changed, edit by edit, with the old
  value of everything that was overwritten or deleted. Reach for it when the
  user says something broke or went missing, asks what you did, or wants
  something put back. Lost data: \`query\` for its text (or \`path\` for where it
  lived) finds the change that removed it, and \`was\` is the data. To see what
  is different between a time and now, use \`from\`/\`to\`. Restore by
  \`doc_edit\`-ing the old value into the live document. Editors are device
  ids, not people.
- **\`doc_create\`** — a new document of an installed datatype. Get the datatype
  id from \`registry_list\` first; it is rarely what you would guess. The new
  document is not filed anywhere, so put it where it belongs if it has a place.`,
  },

  {
    name: "working-with-the-web",
    description:
      "When to search, fetch, capture a page or call an API; how to cite what you read, word for word; how everything fetched is kept and read back cheaply; how approval works and why you should not pre-negotiate it.",
    body: `# Working with the web

These tools reach out, and picking the wrong one wastes a turn.

- **\`web_search\`** — titles, URLs and the engine's excerpt of each: enough to choose what to read, never something to cite.
- **\`web_fetch\`** — read a page or a paper. The default choice.
- **\`web_capture\`** — keep a page as it looks, for good. It comes from the
  Web snapshot package, so it is there only when that package is installed
  (and, in a research step, only when the step runs in a tab).
- **\`http_request\`** — methods, headers, bodies. For APIs and for files, and
  for a page's own source (its script tags, the shell before scripts ran).

## Capturing a page, or fetching it

\`web_fetch\` keeps what a page *says*: the reader's text of it, which is what
you need to read it. \`web_capture\` keeps the page *itself*: its rendered
page, frozen so that nothing in it runs, with the stylesheets, fonts and
images it loads, in a web-snapshot the person can open later and see exactly
as it was, offline. It costs more —
dozens of requests and megabytes — so capture when the page is the evidence:

- a datasheet, a price, a specification, a policy or a statement that may
  change or disappear, and that a claim will rest on;
- the person asks to keep, save or archive a page;
- what matters is how the page looks (a layout, a table, a figure), not only
  what it says.

To read, search or summarise, fetch. A capture's text is read with
\`source_read\` like anything kept, so a page captured is never fetched as
well. A PDF or other file handed to \`web_capture\` is kept as the file it is.

The result counts what was kept and what was not, by reason. From a browser
a site's own CSS and images are often unreachable (CORS): the snapshot shows
the page without them, and says so. That is recorded and left; do not try to
fetch the missing pieces another way. The page's HTML is usually the
reader's rendering of it after its scripts ran — a third party's — and the
snapshot says that too.

A snapshot is an ordinary document, kept with everything else this
conversation fetched. Put it where the work is: file it in the folder of the
task at hand with \`source_file { source: "automerge:...", folder:
"automerge:..." }\` when the person wants the page kept there. A research
step's snapshots are filed in its workflow's Sources folder for you. A
person can capture a page too, without you: a new, empty Web Snapshot in a
folder offers an address and Capture.

Without the Web snapshot package there is no \`web_capture\`: \`web_fetch\`
still keeps a PDF as the PDF itself and a page as the reader's text, and
that is what to cite.

## Citing what you read

Every fact you got from a document is cited where you state it, as a link to
the document whose title is the passage, word for word:

    The pack is rated at 280 Ah [datasheet](automerge:… "Rated capacity: 280Ah at 0.2C").

The document is the kept source (the URL a fetch result or \`source_list\`
gave you), a finding, or one of the person's own documents. The quote is how a
reader finds the place, and it is checked: the transcript looks the words up
in that document and marks the citation as found or not there, and
\`finding_write\` refuses a finding with a quote that is not in its source.
So:

- **Quote, never paraphrase.** Copy the words from a \`source_read\` result.
  Case, spacing, curly quotes and markdown are forgiven; anything else is not.
- **Quote enough to find the place** — a dozen words or so; a figure alone
  ("280 Ah") is too short to check. Join two parts of one passage with "…".
- **Cite the copy you read.** A page captured and fetched is two documents;
  cite the one whose words you quote.
- **No document, no citation.** Something you know but did not read here is
  marked (from memory), so the person knows to check it. Never cite a
  document for something it does not say.
- **A table cites in two columns.** A cell cannot hold a link with a title, so
  give the table a source column (the kept source's \`automerge:\` URL) and a
  quote column (its exact words) — a bill of materials, a comparison.
- **Check before you call it done.** \`citations_check { url }\` looks up every
  citation in a document you wrote, in its text and its tables, and lists the
  ones whose words are not in their source. Fix those, then finish.

## Everything fetched is kept

Every successful \`web_fetch\`, \`http_request\` and \`web_capture\` keeps what
it fetched as a document, and the result says where. Nothing is overwritten: fetching again
makes a new one. A PDF is kept as the PDF itself, with its text beside it,
whenever it can be fetched from here; when it cannot, the result says so and
the reader's text is kept instead.

The result shows only the start. Read the rest from the kept copy, never by
fetching again — it is free, instant, and the offsets never shift:

    source_read { source: "automerge:...", offset: 6000 }     read on
    source_read { source: "automerge:...", find: "battery" }  search it

A search lists each match with its offset and the heading it is under, and the
fetch result ends with an outline of headings and their offsets, so jump
straight to the part you need instead of paging from the top.

**Check before fetching.** \`source_list\` lists what this conversation has
already kept; \`source_list { find: "…" }\` searches all of it at once. A
\`web_fetch\` of a URL already kept answers from the kept copy without going
out; pass \`fresh: true\` when you need what the page says now.

**Filing.** A kept source is not in any folder. When the person wants it kept
somewhere they will find it, or a package needs the file,
\`source_file { source, folder, name }\` puts it there.

**In a research step** (a workflow step that can reach only the web), what is
kept is shared with the workflow's other research steps: \`source_list\` lists
what all of them have kept, and a page another step fetched answers your
\`web_fetch\` without going out. You cannot file anything; the workflow files
what you keep in its Sources folder for the person. What you can do is write
down what you learn as you go, with \`finding_write\`:

    finding_write { title: "Pack cell options", text: "…", cites: ["automerge:..."] }
    finding_write { finding: "automerge:...", text: "one more thing" }   add to it

A finding is kept like a source: you and the other steps read it back with
\`source_read\`, it survives when older results are shortened, and the person
can read it. Cite the kept sources it rests on. A finding someone has edited
since cannot be written over; write a new one.

## Being asked for permission

Reaching outside Patchwork needs a human yes. Just make the call — the session
stops, they answer, and you carry on. Do not ask in prose whether you may fetch
something; that costs a turn and they have to answer twice.

They can hand you a whole site at once, so a research task usually stops once
and then runs. If you know you are about to read several pages from one place,
fetch the first one and say so — the choice they are offered includes that site.

A denial is about that call. Do not immediately try the same URL a different
way; say what you wanted it for, or find another source.

Some places are never fetched, whatever is granted: this machine, private and
local network addresses, and Patchwork's own origin. A refusal that says so is
final.

## When markdown comes back wrong

Prose extraction throws away whatever a script built, so a dynamic page often
returns its chrome and none of its content: a single-page app gives you its
navigation, a code editor gives you its line numbers. That is not a page worth
reading twice — it is the signal to look elsewhere. \`http_request\` gets the
literal source the server sent, which for such a page is mostly its script
tags; the two disagree about exactly these pages, and the disagreement is
usually the answer.

Pass \`fresh\` when the page changes and a cached snapshot would mislead you.

## Older results get shortened

A long result stops travelling in full once newer ones have arrived — it becomes
its summary and a note. The text is not gone, and there are three ways back to
it that mean different things:

- \`source_read\` on the kept source the note names. Right for anything
  fetched: free, and you can read any part of it, not just what was shown.
- \`session_recall\` with the call's id gives you exactly what that call
  returned, for free. Right when the question is what it *said*.
- Making the call again does the work and gives the current state. Right when
  what you need is what is *true now* — a document you have since edited, a page
  that changes.

## Binary stays binary

A wasm module, an image, a font, an archive: \`http_request\` keeps the bytes
and never puts them in this conversation. You never see the contents, which is
correct — you could not use them from here anyway. What you get is the size,
the format read from its magic number, and the document URL.

## Credentials

There is no credential store, and you must not make one. Never write a token,
password or API key into a request, a document, a file or a note — every one of
them is synced, and the transcript is too. If an API needs a login, say it
cannot be reached from here.

## What will not work

In a browser the origin policy still applies, so an API that does not serve
permissive CORS cannot be called — an error mentioning CORS means unreachable,
not misconfigured. The same goes for a PDF's own bytes: when they cannot be had
the reader's text is kept, and the result says the PDF is missing. Pages go
through a reader service, and some sites block it; that is a reason to find
another source, not to retry.`,
  },

  {
    name: "finding-things",
    description:
      "How to locate documents, code and installed plugins in a Patchwork you have not seen before.",
    body: `# Finding things

You start knowing only the document the session is attached to. Everything else
has to be found.

A file that should no longer exist is \`fs_delete\`: it takes the entry out of
its folder, so nothing finds it by path or builds it any more. The document
itself survives, so a mistake is recoverable.

Name the session with \`session_title\` as soon as you know what you are doing —
it is a document in the same list, and an unnamed one is as lost as anything
else here.

- **\`doc_tree\`** once, to see the shape of what the user has.
- **\`doc_search\`** by name — cheap: it reads folder listings only. To search
  inside files, name their folder with \`root\` and add \`content: true\`; it reads
  up to 50 files there, never your whole account.
- **\`fs_grep\`** for code — it is far cheaper than reading files one by one.
  \`include: "\\\\.js$"\` narrows it. Then **\`fs_list\`** to see what is around a
  match, and **\`fs_read\`** for the file itself — with \`offset\` and \`limit\` if
  it is long, rather than pulling thousands of lines into the conversation.
- **\`registry_list\`** for what is installed: datatype ids for \`doc_create\`, tool
  ids for \`view_mount\`.
- **\`plugin_source\`** to read how an existing tool is written before writing one
  like it. This is the best available documentation, because it is the code that
  is actually running.

Pages you fetched earlier are documents too. Every fetch is kept, and
\`source_list\` lists what this conversation has kept, so re-reading part of
one is \`source_read\`, not another fetch — cheaper, and the content cannot
have changed underneath you.

## When the user says "use the X tool"

A Patchwork tool is usually a render function — something a person operates —
so there is a real question about what "use it" means for you. Work down this
list and stop at the first one that applies.

1. **Does the package contribute an agent tool?** \`registry_list { type:
   "agent:tool" }\` shows what packages have exposed on purpose. If the
   capability is there, it is already in your tool list: just call it. This is
   the path the package author built for you and the only one that cannot drift
   out of date.

2. **Can you call its logic?** \`plugin_source { id, list: true }\` lists the
   package's files and \`plugin_source { id, file }\` reads one. If the useful
   part is a module you can import — a parser, a client, a converter — read it
   and use it. A package's own code is better than your reconstruction of it.

3. **Can you drive its interface?** \`view_mount\` opens it and \`view_interact\`
   clicks and types. This genuinely works and is the right answer for a tool
   whose value IS its interaction — a canvas, an editor. Read "driving-a-view"
   first. It is brittle for anything else: you are depending on a layout nobody
   promised you.

4. **Reimplement it only as a last resort,** and say that is what you are
   doing. Two implementations of the same thing disagree eventually, and the
   user asked for the tool because they wanted the tool's behaviour.

If a package has no agent tool and you find yourself about to reimplement it,
that is worth a sentence to the user: the fix is one \`agent:tool\` entry in that
package's plugins array, and they may well want to add it.

When the choice is theirs rather than findable — which of two designs, what to
call something — that is \`ask_user\`, not a search.

When the user refers to something by name — "the budget doc", "my recipes" —
search before asking. When a search finds nothing, say what you searched rather
than guessing.`,
  },
]
