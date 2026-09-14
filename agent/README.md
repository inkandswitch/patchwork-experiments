# Agent

An agentic harness that lives inside Patchwork. The session is a document, the
loop is leased so it can be taken over, and the tools read and write automerge
documents — including the documents that are Patchwork's own tools.

It works end-to-end on the real patchwork.inkandswitch.com: it finds documents,
reads them, asks permission, edits them, drives real tools in a real browser,
searches and imports from the web, calls authenticated APIs, and writes, checks
and installs new Patchwork tools. It also runs headless — the same session,
claimed by a node process with no tab open.

## What is here

| | |
|---|---|
| `session.js` | the session model — pure functions over plain objects, no automerge |
| `store.js` | applies that model to a DocHandle (and to a plain object, for tests) |
| `loop.js` | the agentic loop: stream, dispatch tools, stop for approval, resume |
| `runner.js` | claims the lease, notices work, drives the loop |
| `datatype.js` | the `agent-session` datatype |
| `tool.js` | the view — sidebar panel and full-window pop-out, one render function |
| `panel.js` | the `context-tool` variant that attaches to whatever you are looking at |
| `node-runner.mjs` | the same runner, outside the browser: durable, no CORS |
| `secrets.js` | per-device credentials, addressed by name and never seen by the agent |
| `providers/` | `openrouter.js` (real, with retry), `mock.js` (scripted, for tests) |
| `tools/` | the tool surface — documents, discovery, folders, environment, web, http, ingest, authoring, checking |
| `ui/` | transcript rendering and the provider-subscription protocol |
| `probes/` | browser and node probes that drive the real thing (see Testing) |

## Architecture

**The session is a document.** Not UI state that happens to persist — an
automerge document that the runner and every open view read and write. That
buys resumability, multiplayer steering, forking, and trajectory replay through
document history without any separate machinery.

**The loop is leased.** A runner claims the session by writing
`{runner, at, generation}` and heartbeating. A runner that sees a stale
heartbeat takes over and bumps the generation; the displaced runner notices at
its next write and stands down. The same class runs in a tab, a worker, or node
— only `canRun` and `runnerUrl` differ.

**Tool calls are tiered.** Each tool declares `where`:

- `worker` — needs only a repo: `doc_read` `doc_edit` `doc_history`, the `fs_*`
  tools, the `web_*` tools, `http_request`, `package_build`
- `host` — needs the page: `dom_snapshot` (a DOM), the `view_*` tools,
  `package_test`, `registry_list` `plugin_source` `doc_create` (the plugin
  registry, which is page state, not repo state)
- `task` — for work that belongs outside the browser; the seam exists, nothing uses it yet

A call the current runner cannot execute **parks** the session rather than
failing it, and resumes when a capable runner appears.

**Runners outlive the views that started them.** A runner is registered per
session in a module-level registry; views attach to it and detach from it.
Navigating to another document unmounts the tool, which detaches a view — it
does not stop the work, abort the turn, or drop the lease. The runner owns its
own subscription to the session document for the same reason: when that lived in
the view, a detached runner went deaf and stalled at the first thing it waited
for. Reopening the session, here or in another tab, picks up whatever happened
while you were gone. Closing the last tab is still fatal; durability comes from
a runner outside the browser.

**The transcript is provider-neutral.** No OpenAI- or Anthropic-shaped message
ever enters the document; adapters translate on the way in and out. That is
what makes changing model mid-session work, and it is why the web tools are
ours rather than a provider's hosted search.

**Approvals plus history.** `risk: "read"` runs silently; everything else asks,
and the grant it earns can be as narrow as one document or as broad as a whole
site — see *Risk lives on the document*. Grants live in the session document, so
any participant can approve and every approval is auditable.

## The tool surface

| Group | Tools | Tier |
|---|---|---|
| Know | `skill_list` `skill_read` | worker |
| Find | `doc_search` `doc_tree` | worker |
| Documents | `doc_read` `doc_edit` `doc_history` | worker |
| | `doc_create` | host |
| Folders and files | `fs_list` `fs_read` `fs_grep` `fs_write` | worker |
| Drive the front end | `view_mount` `view_inspect` `view_interact` `view_unmount` | host |
| | `tool_check` | host |
| Environment | `registry_list` `plugin_source` `dom_snapshot` `view_open` | host |
| See | `view_screenshot` | host |
| Build | `package_build` | worker |
| Test | `package_test` | host |
| Web | `web_search` `web_fetch` `web_import` | worker |
| APIs | `secret_list` (host) `http_request` | worker |

Outside content does not stay in the conversation. A fetched page longer than a
couple of paragraphs is written to its own document and linked from the
transcript, so it persists, syncs, can be reopened, and can be re-read in ranges
with `doc_read` instead of fetched again — while the model still gets exactly
the excerpt it asked for. Binary responses are kept as bytes and never decoded;
`http_request` takes a `folder`, so a wasm module can be fetched straight into
the package that needs it.

There is deliberately **no tool for writing a tool**. A Patchwork tool is a
folder of files, so writing one is `fs_write`; installing one is `doc_edit` on
the module settings document. Bespoke `tool_write` and `tool_install` verbs
existed briefly and were removed — they were special-casing a folder, and the
only thing they really added was create semantics that `fs_write` was missing
and an approval gate that belongs on the document.

The `view_*` tools are the ones worth understanding. They open **any** document
in **any** installed tool, off-screen, and leave it running across turns — so
the agent can click a control, type into a field, read what rendered, and check
the document at each step. That is the only way to work with tools whose state
is not a readable document shape (a canvas, a text editor), and the only way to
tell whether a change *looks* right rather than merely being structurally
present. `tool_check` is the one-shot version aimed at code the agent just
wrote, and it exists because the failure mode is not knowing what to look for.

Third parties can contribute tools by registering an `agent:tool` plugin —
JSON metadata at the top level, `execute` behind `async load()`.

## Builds happen in the browser

A TypeScript tool, or one with npm dependencies, has to be compiled — and
`package_build` does it with esbuild compiled to wasm, running in the page. It
reads source out of the package document, fetches bare dependencies as ES
modules, and writes one self-contained bundle back as `dist/index.js`.

Two reasons it is not a shell-out to node:

- **Sandbox.** `npm install` runs arbitrary postinstall scripts on a real
  filesystem. Bundling executes nothing from the dependency; esbuild only parses
  it. The browser's sandbox is the boundary everything else here already trusts.
- **Portability.** A build that needs a particular machine is a build most
  people cannot run. This one runs wherever Patchwork runs, including in a
  SharedWorker — it needs no DOM.

Patchwork's own modules stay external and resolve through the importmap;
bundling a second copy of automerge would give the tool a different Repo and
nothing would sync.

Measured: a TypeScript tool importing three.js builds in about one second to a
727 kB self-contained bundle, which registers, mounts, and draws to a live
WebGL canvas.

## Tests run in the browser too — with real vitest

`tool_check` answers "does this mount and respond to a click". It cannot answer
"is this function correct", so an agent that writes tests it cannot run has
written documentation.

`package_test` bundles each `*.test.ts` with the same esbuild machinery,
rewrites its `vitest` import to an injected harness, executes the bundle, and
reports what passed and failed.

**The assertions are the real thing.** "vitest is a node program" is true of the
CLI and false of the parts that matter — measured in a browser with
`probes/vitest-feasibility.mjs`:

| | |
|---|---|
| `@vitest/expect` | loads — it exports chai plugins, which is how vitest itself assembles `expect` |
| `@vitest/spy` | loads — real `vi.fn()` / `vi.spyOn()` with `mock.calls` and `mock.results` |
| `@vitest/runner` | loads — the real collection engine |
| `vitest` (the CLI) | does not load, and never will |

So `expect` is chai with `JestChaiExpect`, `JestExtend` and
`JestAsymmetricMatchers` installed: every matcher, asymmetric matchers
(`expect.objectContaining`, `expect.arrayContaining`, `expect.any`), and chai's
own diffs. What stays hand-written is only the collector — describe/it/hooks and
the run loop — because that part is sixty lines, and owning it is what lets
results be reported into a transcript rather than a terminal.

What is genuinely missing is what the CLI provides: `vi.mock`, snapshots,
coverage, watch.

The built-in matchers remain as a **fallback**, not the product: with no network
the run still happens and the report says `assertions: built-in matchers`
instead of pretending.

Measured: eight TypeScript tests — a relative import, `toThrow`, an async case,
asymmetric matchers, `vi.fn` spies and a deep property path — run in 625ms, with
a deliberate failure reported as chai's `expected 5 to be 6 // Object.is
equality`.

## Risk lives on the document

`risk: "read"` runs silently. Everything else asks, and the answer can be
narrow or broad: this call only, this document, this page, this directory, this
whole site, or anything the tool can reach. Approving each fetch individually is
what made the loop unusable — the agent stops on every page of a documentation
site and waits for a human to agree it may read the next one.

Breadth never becomes sloppiness, because matching generates the *call's* own
keys and looks each up exactly. A grant on `https://example.com/` is one entry
in a map; `https://example.com.attacker.net/x` produces a different set of keys
and matches none of them. No substring comparison is ever made against a stored
grant, so a look-alike host cannot get near one, and neither can `http://` when
the grant was `https://`.

Grants live on the session document, so they are per-conversation, auditable in
its history, and any participant can approve.

On top of that, some *documents* always ask, whichever tool touches them and
however broad the grant: the module settings document decides what code runs on
every future load, and the account document is your identity. Attaching that
gate to an "install" tool instead would only mean the next tool that can write a
document routes around it. `http_request` also asks every time, because a
request that can carry your credentials to an arbitrary URL is the one thing a
standing grant is the wrong level of consent for.

## Skills

Guidance the agent needs but should not carry in every prompt: named and
described in the system prompt, read in full on demand. `writing-patchwork-tools`
carries the render contract, `editing-documents` the op vocabulary,
`working-with-the-web` which of the four outside-world tools to reach for,
`finding-things` how to orient in an unfamiliar Patchwork.

Built-ins ship with the package so the agent is never knowledge-less, but a
skill in the session's `skillsFolderUrl` shadows a built-in of the same name —
a folder document with a `SKILL.md` in it. That matters because this guidance is
the thing most likely to need correcting in the field: when the agent gets the
render contract wrong, the fix should be editing a document, not redeploying the
harness.

## It can see what it is working on

`view_screenshot` captures what a view is actually drawing. Reading the DOM and
reading the document tell it what is *there*; only a picture tells it what it
*looks like*.

Two paths, because they fail differently: a `<canvas>` is read directly with
`toDataURL` (exact), and anything else is rasterized through an SVG
`foreignObject`. That rasterizer is implemented here rather than pulled from a
CDN — `modern-screenshot` returned a byte-identical blank rectangle in headless
Chrome while a minimal foreignObject rasterized the same content correctly. Ours
also swaps each canvas for an image of its pixels, which `cloneNode` drops, so a
chart beside its controls comes out whole.

Images are downscaled and re-encoded as JPEG, and only the **two most recent**
travel in a request — an image costs context on every subsequent turn, not just
the one that took it. Older ones keep their text and say the picture was dropped.

They show up in the transcript too, beside the call that took them rather than
inside its disclosure, so you can see what the agent saw without clicking. The
rest of the log renders as markdown, built with DOM calls: there is no
`innerHTML` anywhere in the renderer and no HTML parsing at all, which also
rules out a library, since every markdown library worth using emits an HTML
string. A script tag in model output is six words.

Measured: a DOM view captured at 400×218 with 66 distinct colours, and a live
three.js WebGL canvas at 600×356 with 118 — the WebGL case being the one that
silently comes back blank when a drawing buffer is not preserved.

## Credentials

Secrets live in `localStorage`, are addressed **by name**, and the agent never
sees a value: it passes `useSecret: "github"` to `http_request` and the executor
substitutes the token at the moment of the request. Responses are scanned and
redacted before they are returned, because a server can echo an Authorization
header back in an error and everything returned lands in the document and then
in the next prompt. `http_request` asks for approval every single time,
regardless of grants — a request that can carry your credentials to an arbitrary
URL is the most dangerous thing in the toolset.

The honest limit: per-device means they do not follow you to another device, and
clearing site data loses them. Syncing secrets across devices in a local-first
system is key management, not plumbing, and this does not pretend to solve it.

## Running it without a browser

```sh
OPENROUTER_API_KEY=… pnpm runner automerge:<sessionUrl>
OPENROUTER_API_KEY=… pnpm runner --watch automerge:<folderUrl>
```

Because the session is a document and the lease is in it, this needs no new
protocol: it claims sessions exactly the way a tab does, and a browser can take
one back mid-flight. Two things change outside the browser — there is no origin
policy, so the web tools fetch directly instead of through a third-party reader;
and there is no DOM or plugin registry, so host-tier calls park until a tab
picks them up.

## Keys

The API key lives in `localStorage`, per device, and **never** in the session
document. A session document syncs to every peer it is shared with and to the
sync server; a key in one would be handed to everyone who can open it. Model
and parameter choice *do* live in the document — they are part of the session's
meaning and should travel with it.

Paste a key into the panel's settings (the button showing the model name).

The model picker lists **every model OpenRouter offers** — 445 at the time of
writing, 377 of which support tool use — with context size and price per
million, filtered as you type. The catalogue is cached per device for a day and
refreshable by hand, and free text still works, so a model released this morning
is usable before the catalogue catches up.

## Testing

Three tiers, cheapest first.

```sh
pnpm test                                  # 228 unit + mount tests, no network
OPENROUTER_KEY_FILE=… node probes/live-openrouter.mjs      # the adapter vs the live API
OPENROUTER_KEY_FILE=… node probes/patchwork-e2e.mjs        # the whole thing, in real Patchwork
```

`probes/patchwork-e2e.mjs` drives headless Chrome over CDP: it installs this
package into a fresh Patchwork account, creates a document, mounts the tool,
types a prompt, clicks through the approvals, and reports the status
trajectory, every tool call, and the document afterwards.

```
node probes/patchwork-e2e.mjs --prompt "…" --model anthropic/claude-opus-4.1 \
  --expect-tools "web_fetch,doc_edit" --headed --keep-open
```

It also asserts on things a unit test cannot reach:

| flag | what it checks |
|---|---|
| `--grant site` | takes the whole-site grant instead of the narrowest one |
| `--expect-approvals-at-most N` | one grant really did cover many calls (`0` asserts it never had to ask) |
| `--expect-markdown` | prose rendered as structure, and no markup escaped |
| `--expect-saved-doc` | fetched content became a document, and the log links it |
| `--expect-image` | a captured picture is visible, and is not an empty `src` |
| `--unmount-after MS` | the view is torn down mid-turn and the work still finishes |
| `--shot FILE` | writes a picture of the finished transcript |

`--shot` is not a nicety. Two bugs shipped past a green suite because the
assertions asked whether an element existed rather than whether anyone could see
it; both were obvious in the first capture.

Other probes:

- `probes/verify-authored-tool.mjs --package automerge:… --datatype dice`
  installs a tool the agent wrote, reloads, creates a document of its datatype,
  mounts it, clicks its button, and checks the document changed. Use it on
  anything the agent claims to have built.
- `probes/node-session.mjs` — creates a session from node, runs it to
  completion, and prints the trajectory. The proof that a session does not need
  a tab.
- `probes/reload-control.mjs` — the control experiment below.
- `probes/can-read-module.mjs` — can a fresh profile read a published package.
- `probes/esbuild-twice.mjs` — loads esbuild from two copies of `build.js`,
  which is the shape that broke `package_test`.
- `probes/binary-fetch.mjs` — pulls a real 11 MB wasm module through
  `http_request` and compares every byte against an independent fetch.

**The key does not live in this package.** `pushwork sync` publishes the whole
directory and honours only `.pushwork`, `.git`, and `node_modules` — *not*
`.gitignore`. Keep credentials outside the folder and pass
`OPENROUTER_KEY_FILE`.

## Findings worth keeping

Measured, not assumed. Each cost an hour or would have.

**A Web Worker does not bypass CORS.** A `fetch` from a worker is subject to
exactly the same origin policy as one from the main thread. Moving web tools
off the main thread buys nothing for reachability; only a runner outside the
browser does. The web tools therefore go through a reader endpoint that serves
permissive CORS, and the `task` tier exists for what that cannot reach.

**Never hard-reload Patchwork in a probe.** `Page.reload({ignoreCache: true})`
evicts the service worker's cached wasm and boot then fails with
`patchwork.setup: boot did not finish within 30000ms`. This looks exactly like
"the module I just installed broke the app". Measured with
`probes/reload-control.mjs`:

```
1. first load:                              booted in 3030ms
2. reload (no module, ignoreCache=false):   booted in 1006ms
3. reload (module installed):               booted in  502ms
   reload (no module, ignoreCache=true):    FAILED after 31212ms
```

**Serving a manifest off localhost does not work against the deployed shell.**
`?system-package-list=http://localhost:…/modules.json` returns 503 — Patchwork's
own service worker intercepts the cross-origin request. Install via the
account's module-settings document instead, which is the real path anyway.

**A fixed CDP debugging port will adopt somebody else's browser.** The probes
pick a random port; a fixed one silently connected to an unrelated Chrome and
reported its state.

**A worker can import automerge without an importmap and without a CDN.** The
page reads its own `<script type="importmap">`, resolves each specifier against
`location`, and hands the table to the worker, which then imports by absolute
URL. `tasks/` solves the same problem by loading es-module-shims from
`ga.jspm.io`, which puts a third-party origin in the boot path of a local-first
system. The subduction wasm loader additionally reaches for `document`
(`getElementsByTagName` among others); a six-property shim is enough.

**Telling the agent the render contract measurably fixes the tools it writes.**
Asked to build a dice tool, the first attempt wrote `handle.doc.value` (a
property, not a call — so the display never updated) and treated
`handle.on("change", …)` as returning an unsubscribe (so cleanup threw). Both
are documented in `patchwork-skill.md`, which the agent cannot see. Putting the
four rules into `tool_write`'s own description fixed both on the next attempt:

```
before   renderedAfter: "🎲 Dice Roller\n?\nRoll the Dice!"   cleanupError: "unsubscribe is not a function"
after    renderedAfter: "🎲 3\nRoll the die!\nLast roll: 3"    (no cleanup error)
```

The lesson generalizes: a tool's description is where environment-specific API
contracts belong, because it is the only documentation the model reliably reads.

**One esbuild per realm, not per copy of the module that loads it.**
`esbuild.initialize()` may be called once per esbuild module, and the browser
keys modules by absolute URL. `tools/build.js` gets imported at more than one
URL in ordinary use — a heads-pinned import and an unpinned one are different
modules, and after a sync a tab holds both — so a module-level "have we
initialized yet" flag meant two guards in front of one esbuild. The second copy
was refused and `package_test` failed with `Cannot call "initialize" more than
once`, which reads like a fault in the package under test. The flag now lives on
`globalThis` under a `Symbol.for` key, which is the scope esbuild's own state
has. `probes/esbuild-twice.mjs`:

```
before   ok / FAIL Cannot call "initialize" more than once / ok
after    ok / ok / ok
```

Catching that error is not enough by itself: `esbuild.build()` does **not** await
initialization, and while one is in flight every call throws `You need to wait
for the promise returned from "initialize" to be resolved`. There is no flag to
read, so the loader tries a trivial transform and reads the error.

**`response.text()` destroys binaries silently.** It decodes as UTF-8 *with
replacement*, so every invalid sequence becomes U+FFFD and the result still
looks like a successful download. For the esbuild wasm module that is 3,473,386
bytes of damage in an 11 MB file. `http_request` now reads the body once as
bytes and classifies afterwards. The same decoder sat in `materialize()`, so a
binary file inside a package was corrupted on its way to esbuild as well.

Checking the magic number would not have caught it — UTF-8 replacement leaves
the first four bytes alone. `probes/binary-fetch.mjs` compares every byte
against an independent fetch and then compiles the result as WebAssembly.

**A fake that cannot do what the real thing does hides the bug it was written
for.** The `http_request` doubles were `{ok, text: async () => body}` — no
headers, no `arrayBuffer` — so no test could exercise the decision between text
and bytes, and none did. This is the same failure the `testing-patchwork-tools`
skill warns about, met from the other direction: not a fake that models the
world wrongly, but one too thin to model it at all.

**A probe that asserts with `querySelector` is not looking at the screen.** The
approval card rendered *inside* the call's `<details>`, which is closed for a
pending call. Every e2e run passed — hidden nodes are still in the DOM — while a
person saw a stuck session and no buttons. Found by adding `--shot` to the e2e
probe and looking at the picture; the same capture showed `display: flex` on a
list breaking marker hanging, which no assertion would ever have caught.

## What is not built yet

- **The SharedWorker runner is opt-in, not default.** Turn it on with
  `localStorage["patchwork-agent:worker"] = "on"`. The hard part is measured
  working (`probes/worker-repo.mjs`, 8/8): the page hands the worker its
  resolved importmap, the worker imports automerge with **no CDN shim**,
  initializes the subduction wasm behind a six-property `document` shim, builds
  a Repo over a donated MessagePort, and reads and writes the page's documents.
  What is not proven is ongoing sync — the worker takes the lease and runs the
  first turn, then misses the approval the page writes and stalls. The likely
  cause is that `window.repo` is itself a client of Patchwork's own automerge
  worker, so attaching a second network adapter may not relay changes;
  `worker-port`'s `donatePort`/`makePortProvider` look purpose-built for this
  and are the first thing to try. Note that a SharedWorker dies with its last
  client anyway: durability comes from `node-runner.mjs`, not from it.
- **The `task` tier is declared and routed but nothing claims it.** The node
  runner accepts task-tier work; no tool currently asks for it, because direct
  fetch covers what the reader could not.
- **Tool documents** — user-authored tools stored as documents, the middle layer
  of the three-layer capability model. The seam is `loadToolDocs` in
  `tools/index.js`.
- **Datatype-aware validation.** `doc_edit` is schema-agnostic, which is its
  power and its hazard: it will write a structurally-invalid document and
  nothing stops it. The datatypes are in the registry and could be checked
  against.
- **Undo, and knowing which edits were the agent's.** History makes "revert what
  the agent just did" possible; nothing implements it, and there is currently no
  way to tell its changes from yours.

  An attempt at this was cut. Two findings worth keeping so they are not
  rediscovered: Patchwork attributes changes by mapping automerge *actor id* to a
  contact, and the browser agent shares the user's repo — so registering its
  actor would relabel the user's own edits as the agent's, which is worse than no
  attribution at all. Stamping each change with a message instead avoids that but
  is unsatisfying: the marker lives in metadata nobody else reads, and it is
  advisory rather than structural.

  Doing this properly probably means the agent writing through its own Repo, so
  it has a genuine actor id of its own and the existing attribution machinery
  applies unchanged. The node runner already has one; the browser does not.

- **Presence.** The agent does not appear in a document while it works. An
  implementation against automerge-repo's `Presence` was cut because it did not
  actually show up — unresolved, and worth checking whether presence needs a peer
  connection the agent's context does not have.
- **Large collections.** A long *string* can be paged with `doc_read`'s
  `offset`/`limit`, which is what makes a fetched page re-readable. A large
  *collection* cannot: reads still truncate at 24k characters with a `shapeOnly`
  mode to orient, and there is no paging or query-within, so a chat with
  thousands of messages or a big canvas still reads as noise.
- **Evaluation.** Prompt and tool-description changes are measured by hand, one
  before/after at a time. There is no harness that says whether a change helped.

## Installing

```sh
pushwork sync        # publishes the package; prints its automerge: URL
pushwork url
```

Then add that URL to your account's module settings (the Packages tool, or
`pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"`), and reload.
