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
in the workbench beside the conversation — so "does it look right" is something
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
Patchwork rather than about something you opened.

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
  \`view_mount\` afterwards if it matters.

## The other two document tools

- **\`doc_history\`** — what changed, when, and by whom. Reach for it when the
  user says something broke, or asks what you did, or wants something undone:
  it is how you find out what the document looked like before.
- **\`doc_create\`** — a new document of an installed datatype. Get the datatype
  id from \`registry_list\` first; it is rarely what you would guess. The new
  document is not filed anywhere, so put it where it belongs if it has a place.`,
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

## When markdown comes back wrong

Prose extraction throws away whatever a script built, so a dynamic page often
returns its chrome and none of its content: a single-page app gives you its
navigation, a code editor gives you its line numbers. That is not a page worth
reading twice — it is the signal to ask for something else.

    web_fetch { url, format: "html" }    the DOM after the page's scripts ran

That is what you want for inspecting: what a widget rendered, which classes and
data attributes are on an element, what is actually there.

It is the rendered DOM, not the bytes the server sent. When you need the literal
source — the script tags, the pre-hydration shell, what the bundle is called —
that is \`http_request\`, which fetches directly and renders nothing. The two
disagree about exactly the pages you are asking about, and the disagreement is
usually the answer.

Pass \`fresh\` when the page changes and a cached snapshot would mislead you.

## Older results get shortened

A long result stops travelling in full once newer ones have arrived — it becomes
its summary and a note. The text is not gone, it is just not being re-sent, and
there are two ways back to it that mean different things:

- \`session_recall\` with the call's id gives you exactly what that call
  returned, for free. Right when the question is what it *said*.
- Making the call again does the work and gives the current state. Right when
  what you need is what is *true now* — a document you have since edited, a page
  that changes.

Reach for recall by default; it costs nothing. Re-run when freshness is the
point.

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

## Credentials

You never see a credential's value. \`secret_list\` gives you the NAMES of what
is stored on this device; pass one as \`useSecret\` and \`http_request\` attaches
it for you at the moment of the request. It appears in no input, no result and
no document. If the one you need is not listed, ask the user to add it in the
agent's settings — you cannot.

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

A file that should no longer exist is \`fs_delete\`: it takes the entry out of
its folder, so nothing finds it by path or builds it any more. The document
itself survives, so a mistake is recoverable.

Name the session with \`session_title\` as soon as you know what you are doing —
it is a document in the same list, and an unnamed one is as lost as anything
else here.

- **\`doc_tree\`** once, to see the shape of what the user has.
- **\`doc_search\`** by name; add \`content: true\` to search inside file documents
  when the name search finds nothing.
- **\`fs_grep\`** for code — it is far cheaper than reading files one by one.
  \`include: "\\\\.js$"\` narrows it. Then **\`fs_list\`** to see what is around a
  match, and **\`fs_read\`** for the file itself — with \`offset\` and \`limit\` if
  it is long, rather than pulling thousands of lines into the conversation.
- **\`registry_list\`** for what is installed: datatype ids for \`doc_create\`, tool
  ids for \`view_mount\`.
- **\`plugin_source\`** to read how an existing tool is written before writing one
  like it. This is the best available documentation, because it is the code that
  is actually running.

Pages you fetched earlier are documents too. \`web_fetch\` saves anything longer
than a couple of paragraphs and the result gives you the URL, so re-reading part
of one is \`doc_read\`, not another fetch — cheaper, and the content cannot have
changed underneath you.

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
