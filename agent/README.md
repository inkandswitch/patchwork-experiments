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
| Folders and files | `fs_list` `fs_read` `fs_grep` `fs_write` `fs_edit` `fs_delete` | worker |
| Drive the front end | `view_mount` `view_inspect` `view_interact` `view_unmount` | host |
| | `tool_check` | host |
| Environment | `registry_list` `plugin_source` `dom_snapshot` `view_open` | host |
| See | `view_screenshot` | host |
| Build | `package_build` | worker |
| Test | `package_test` | host |
| Web | `web_search` `web_fetch` `web_import` | worker |
| APIs | `secret_list` (host) `http_request` | worker |
| Ask | `ask_user` | never runs — see below |
| Remember | `session_recall` | worker |
| Name | `session_title` | worker |

Outside content does not stay in the conversation. A fetched page longer than a
couple of paragraphs is written to its own document and linked from the
transcript, so it persists, syncs, can be reopened, and can be re-read in ranges
with `doc_read` instead of fetched again — while the model still gets exactly
the excerpt it asked for. Binary responses are kept as bytes and never decoded;
`http_request` takes a `folder`, so a wasm module can be fetched straight into
the package that needs it.

`fs_delete` unlinks a file or folder from its parent. It does not destroy the
document — automerge keeps it, and its history — so a package that has been
restructured stops shipping its abandoned files while a mistake stays
recoverable. Renaming is this plus `fs_write`.

Writing, editing or deleting by path inside a package (any folder with a
`package.json` on the way down) also writes a fresh `contentVersion` to that
package's folder. Patchwork loads a package at its folder document's heads, and
every module in it at those same heads, but a file's content lives in its own
document: editing `agent.js` in place left the folder, and so the package URL,
unchanged. The module watcher saw nothing to reload, and the browser's module
map and the service worker's cache kept serving the first version under that
URL through reloads and new tabs. Plugin tools are also looked up in the
registry at call time rather than kept from when the run built its toolset, so
a tool rewritten mid-run is the one that runs next.

Packages come in two shapes, and the file tools, `package_build`, `tool_check`
and `plugin_source` read and write both through one small tree layer in
`tools/folders.js`. A folder document links to file and folder documents by
name (`docs[]`). A directory document — what pushwork writes — is a single
document keyed by full path (`"src/index.ts": "automerge:…"`), so its folders
are only shared prefixes, and build output is linked pinned to heads. Writing a
file behind a pinned link moves the pin to the new heads, or Patchwork would
keep serving the old build.

`fs_edit` exists because of a session that did not end. The model had found a
one-line bug in a 500-line file, and `fs_write`'s description told it that for
a small edit it should prefer `doc_edit` with a splice range — which takes
character offsets. Nothing in the toolset produces a character offset:
`fs_grep` gives line numbers, `fs_read` gives numbered lines, `doc_read` pages
by character but leaves the counting to the reader. The model saw that the
recommended path was impossible and the workable one discouraged, and spent
sixty seconds and seven thousand characters of reasoning oscillating between
them until someone pressed Stop. The rule that came out of it: **every value a
tool asks for must be something another tool hands back.** Text and line
numbers are; offsets are not. So `fs_edit` (and `doc_edit`'s `find`) take the
old text and the new, and compute the splice themselves — the merge-friendly
edit the recommendation was reaching for, without the arithmetic. `fs_write`
over an existing file now splices only the characters that differ, so the
fallback is fine too.

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

## A package can hand the agent a capability

Third parties contribute tools by registering an `agent:tool` plugin — JSON
metadata at the top level, `execute` behind `async load()`, exactly the split
every Patchwork plugin uses and for the same reason.

This matters more than it sounds. A Patchwork tool is a render function:
something a *person* operates. An agent asked to "use the git-clone tool" has
only bad options — drive the UI through `view_mount` and hope the selectors
hold, or reimplement the logic with `http_request` and watch the two drift
apart. Watched happen in a real session, at length, before it picked one:

> The git-clone tool is a UI tool… but I can't easily drive it as an agent.
> Actually I could use view_mount… But actually, the simpler approach: the
> git-clone tool's underlying logic uses GitHub API + raw.githubusercontent.com.
> I can do the same thing directly with http_request.

An `agent:tool` entry answers that: the package declares the capability beside
the interface, both built on one shared module so they cannot disagree about
what cloning means. `registry_list { type: "agent:tool" }` is where an agent
finds what has been exposed, and `writing-patchwork-tools` tells an author how
to expose it.

The wiring had existed since the first commit and had never been run against a
real Patchwork. `probes/agent-tool-plugin.mjs` now writes such a package,
installs it, and checks the toolset picks it up, carries its description and
schema, reaches the model's tool list, executes, and uses the package's own
`summarize`.

Every tool has an entry in `ui/calls.js` saying how its calls read in the log: a
verb a person would use, and a detail drawn from the field that says what the
call was *about*. Presentation cannot live on the tool definitions — those are in
another realm, and the view has the session document and nothing else — so it is
a pure function of `(input, result)`, and a test fails if a tool has no entry.
Without it the log reads as `view_interact  #btn-3`: a dump of the arguments
rather than a description of what happened. Compare:

```
read   shape        read document · 84 B
read                read document · 69 B
ask    Which type of section would you like to add?   answered: Recipe step
edit   /items[2…2]  edited document · 1 op
```

## A tool can wake the agent

A tool call is pull: the agent asks, the tool answers. A tool that watches
something — a document, a running world — sees the interesting part when
nobody is asking. `ctx.events.open(key, { label })` gives it a channel, and
`channel.notify(render)` says something happened; `channel.close()` stops it.

Whether and when that wakes the agent is decided here, in `events.js`, not by
each tool, because every wake is a model call over the whole conversation:
notices on a channel fold together and wait for a quiet moment; nothing is
delivered while a turn is running (the agent will hear it from the tool
directly) or waiting on a person; wakes are spaced and capped per hour, which
also stops an agent that acts on a wake from waking itself forever. `render` is
called at delivery, so the news describes things as they are then, and a tool
that already reported it returns `""` and the wake dissolves.

A delivered wake is a user turn of `event` blocks — a user turn because that is
what starts a runner and what providers accept, but the model is told it is not
the user speaking, and the transcript shows it as news from the tool. An open
channel keeps an unwatched tab runner from being reaped. Nothing outlives the
realm the tool runs in: close the last tab and the watching stops with it.

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

Grants are keyed by a **group**, not by a tool. "May you read adjointlabs.com"
is one decision, and it used to be three: a real session ended up holding
`web_fetch@adjointlabs.com`, `web_import@adjointlabs.com` and
`http_request@adjointlabs.com` because every tool carried its own grant and the
user was asked once per tool per site. The four web tools share one `web` group.
Grants written before the grouping are still honoured, so nothing has to be
re-approved.

`alwaysAsk` may be a function of the input, because for some tools the danger is
in the arguments rather than the verb. `http_request` used to ask every single
time; that same session made eleven of them, all plain GETs with no credential,
and the user granted `http_request@*` plus three per-site grants that did
nothing at all — `alwaysAsk` is checked *before* grants are. A GET with no
secret is a fetch and is granted like one; anything carrying a credential, any
other method, anything with a body still asks every time.

And the approval card no longer offers standing grants for a call that will
ignore them. Offering a button that does nothing is worse than offering none.

**What a call is about is the tool's to say.** One rule used to decide the
document a grant was scoped to, for every tool: `input.url`, else `input.root`,
else the session's subject. It was wrong for most tools, and wrong on the card.
A `web_search` has no url, so it was "about" whatever document the session was
open on; its card offered "this document" and "any document", and "any
document" — chosen by someone who thought they were answering a question about
a search — wrote `web@*`, which is every site for every web tool. `fs_write` by
path was "about" the subject too, though it writes wherever the path says, and
`doc_create`, `view_interact` and others likewise. Now each tool declares
`target` (plain JSON, so a plugin can too): the fields that name what it acts
on, in order, and whether it falls back to the subject. Only `doc_read`,
`doc_edit` and `doc_history` do, because their `url` really does default to it.
A tool that declares nothing is about its `url` or `root` and otherwise about
nothing, which yields an honest "always" rather than a misattributed "this
document". A root is offered as "this folder — anything inside it", and the
broad button's tooltip says what the group grant actually covers. The file
tools (`fs_write`, `fs_edit`, `fs_delete`) share a `files` group the way the web
tools share `web`; grants written under the old per-tool keys still match.

Grants live on the session document, so they are per-conversation, auditable in
its history, and any participant can approve.

On top of that, some *documents* always ask, whichever tool touches them and
however broad the grant: the module settings document decides what code runs on
every future load, and the account document is your identity. Attaching that
gate to an "install" tool instead would only mean the next tool that can write a
document routes around it.

## Old results stop travelling

A transcript is almost entirely tool results. Measured on a real session: 133k
characters of them against 4k of the agent's own words — **97% of the weight** —
and every one re-sent on every later turn, so twenty-seven turns cost 1.2M input
tokens. An 880-line file read at turn 40 was still being sent at turn 64, by
which point it was noise.

So results taper. The newest keep their full text; older large ones become their
own one-line summary and a note. Small ones are never touched — dropping them
saves nothing and costs context that can actually be used. Replaying that
session through the new code:

```
one request     45k → 21k tokens     52% smaller
whole session  1205k → 659k tokens   45% less
results        50 total, 42 whole, 8 tapered
```

(The 1205k "before" is within 0.5% of the 1,210,403 the session actually
reported, which is the check that the model of it is right.)

This is the treatment screenshots already had, generalised, and it is only
possible because every tool has a `summarize` — which the documentation audit
turned from a convention into a test.

Nothing is deleted; it stops being *sent*. `session_recall` gives back exactly
what a call returned, for free, and says plainly that it is history. Re-running
the call is the other option and means something different: what is true now. A
document the agent has since edited must not answer with what it said an hour
ago, so the two are never conflated. The call's own arguments sit in the message
right before the stand-in, so repeating it needs no extra information.

## Being refused

A denial is recorded as the call's **result**, exactly like any other outcome,
and that is load-bearing twice over.

It used to only flip the call's status. The session then stopped dead: no call
was pending, none was runnable, the last turn was the assistant's, so no runner
saw work and the model never learned it had been refused. The only way forward
was to type something.

And what the model was told, when it was finally told, was a synthetic user
message appended **after the entire conversation** — one per denial, re-sent on
every turn, ending in "ask what they would like instead". So the last thing it
read before writing was an instruction to raise the refusal, N times over. It
did. That is the whole of the "it keeps reporting a decline" bug: a session that
could only be unstuck by nudging it, and a prompt that rewarded the nudge with
another announcement.

Now it is stated once, in order, attached to the call it belongs to. The policy
— do not retry, carry on with what does not depend on it — is in the system
prompt, where it is said once rather than once per refusal per turn.

Measured over four turns, denying a `doc_edit`:

```
[1] I'll help you set the title and add 'salt' to the items…
[2] Now I'll update the title to 'Autumn Soup' and add 'salt'…
[3] The edit was declined. The document remains with its current title…
[4] Based on the document I just read: - There are 2 items…
```

Acknowledged once, then dropped. `--expect-moves-on` asserts exactly that: it
finds where the refusal was first mentioned and requires silence afterwards.

## Naming the work

A session is an ordinary document, so it sits in the user's list beside
everything else they own. The agent calls `session_title` once it knows what the
work actually is — naming the *work*, not the request, and renaming it later if
the work turns into something else. Until it does, the session is named after the
first thing asked of it.

That fallback existed before and never ran: `init` set the title to `"Agent"`, so
`doc.title` was always truthy, the code below it was unreachable, and every
session in the list was called the same thing. A fresh session now has no title
at all, which is the honest state and the one every fallback is written for.

`session_title` is the only tool with `risk: "self"` — it writes, but only ever
to the session document, so it is never asked about. Marking it `read` would
have produced the same behaviour by lying in the tool list to whoever audits it.

## Asking the user

`ask_user` is the one tool that never executes. The call is written into the
transcript with status `asking`, the runner parks, and the person's answer is
recorded as that call's **result**. To the model it is an ordinary tool result,
so no adapter, prompt shape or provider knows a human was involved — and because
it is in the document like everything else, a question survives a reload, a
navigation, or a runner handing over.

It is deliberately not an approval. An approval is "may I", answered yes or no
by whoever is present; a question is "which", and its answer is content that
goes to the model. Sharing one mechanism would mean a question could be answered
by someone clicking *allow*. A question also outranks a pending approval: being
asked to permit work that the answer might make pointless wastes the attention
the question was spending.

The card renders the options as buttons **and** a text box, always. The options
are the agent's guess at what the answers are; being made to pick one of three
wrong ones is worse than having been asked in prose.

## Skills

Guidance the agent needs but should not carry in every prompt: named and
described in the system prompt, read in full on demand.

| skill | what it carries |
|---|---|
| `writing-patchwork-tools` | the plugin shape, the render contract, and the four mistakes actually made |
| `driving-a-view` | mount → interact → inspect → unmount, and what it does not simulate |
| `editing-documents` | `doc_edit`'s op vocabulary, and why text edits anchor on text (`find`, `fs_edit`) rather than offsets |
| `working-with-the-web` | which of the four outside-world tools to reach for |
| `finding-things` | how to orient in a Patchwork you have not seen |

A test holds the parts that rot: every skill must name only tools that exist,
and every tool must document every parameter it accepts. A parameter with no
description is one the model has to guess at, which is not hypothetical — it is
how `root: "automerge:"` got sent and cost a turn.

Built-ins ship with the package so the agent is never knowledge-less, but a
skill in the session's `skillsFolderUrl` shadows a built-in of the same name —
a folder document with a `SKILL.md` in it. That matters because this guidance is
the thing most likely to need correcting in the field: when the agent gets the
render contract wrong, the fix should be editing a document, not redeploying the
harness.

## What a session makes, and installing it

Every document a call makes or opens appears **in the transcript, beside that
call**: a document with a Show button that opens it in its tool right there, a
package with Try it and its install controls, and the agent's own `view_mount`
adopted live so watching the agent work is reading the transcript. A person's
mount goes through the same loader as the agent's, so a package renders
installed or not.

Two things went away for this. A strip under the header listed "things made
here", and a workbench pane between the transcript and the composer showed what
the agent had mounted. Both were somewhere other than where the thing was
talked about, and both had to be found. What a call produced now sits under the
call, and scrolls with it.

One thing does not happen: a package the agent just wrote is not run until a
person clicks. The agent's mounts were granted; a person's are asked for by the
button. The view is persistent across re-renders — the transcript rebuilds on
every change, and a running tool must not be torn down because someone typed —
so the header is redrawn and the body is moved. Collapsing a view keeps it
running; the agent can still drive and screenshot it.

Installing offers two things, because a tool under development and a tool you
are happy with want different ones:

| | entry | behaviour |
|---|---|---|
| **Install** | `automerge:<id>` | live — follows the agent's next edit |
| **Pin this version** | `automerge:<id>#<heads>` | frozen at exactly this version |

Pinning is how you promote one version: keep using it while the agent goes on
experimenting, and a later edit cannot change what you installed. The header says
which is in force and warns when a pin has fallen **behind** what the package has
since become — the question a pin creates and nothing else answers, whose only
other symptom is edits that appear to do nothing. Heads are compared as a set,
and sorted when written, because two peers at one version can list them in
different orders.

This is a button and not a tool, deliberately. The module settings document is
on the always-ask list because installing adds code that runs on every future
load; a person clicking IS that consent, directly. An `install` verb would route
around the gate rather than satisfy it — and the agent is told not to hand out
URLs to paste, because before the button existed, every tool-building session
ended with one.

## Reading a tool call

Each call is one line until you open it, and what you get when you open it is
built for the tool. The generic case puts short scalars in a field list and long
or multi-line strings in their own labelled block; `fs_write` shows each file
under its path, `doc_edit` reads as one line per change, a fetched page renders
as prose, and an error stays monospace because it carries stacks and positions.

The bar this had to clear was low and the failure was total: the body used to be
`JSON.stringify(input, null, 2)`, which escapes every newline — so the single
most common thing the agent does, writing a file, rendered as one endless line of
literal `\n`.

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

`tool_check` and `view_mount` attach one automatically, so "does it look right"
is answered without the agent having to think to ask.

A mounted view also renders in the transcript beside the call that opened it,
so you watch the agent work rather than take its word for it. Mounting used to
happen ten thousand pixels off to the left, always: the agent could see the
tool and the person who asked for it could not. Off-screen is still where a
mount lives when no view has adopted it — off-screen rather than `display: none`
because a hidden container reports zero sizes, and a tool that measures itself
would behave differently there than in front of a person.

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

**No sampling parameters are hardcoded.** `DEFAULT_CONFIG` used to set
`temperature: 0` for every model. That is a preference from one model family,
and for open-weight reasoning models it is the textbook cause of verbatim
thinking loops — Xiaomi's own guidance for MiMo is temperature 1.0, top_p 0.95
and a repetition penalty. Now a knob the session does not set is not sent, so
each model runs at the values its authors recommend and the provider applies.
The catalogue carries what OpenRouter publishes per model (`default_parameters`,
`supported_parameters`, `top_provider.max_completion_tokens`), and the runner
hands the loop that entry: a knob set in `config.params` that the model does
not take is dropped rather than sent, `maxTokens` is capped at what the model
can produce (the truncation recovery respects the same ceiling), and the
settings panel shows the defaults in effect and what the session overrides.
Anything set in `config.params` remains an explicit override that travels with
the session.

**A model that repeats itself is stopped.** The truncation recovery assumes a
turn that ran out of budget needed more of it. A model stuck in a thinking loop
needs the opposite, and it would otherwise run to the limit and then be told to
continue. So `streamTurn` watches the turn's own prose, and when the last 240
characters have already appeared verbatim earlier in the turn (with a
vocabulary check so a table's padding does not count) it abandons the stream,
keeps what was said, and tells the model once to take the simplest option and
call a tool. A second loop ends the run with an error that names the knobs to
change. Provider-agnostic on purpose: it is the same signal whichever model or
sampling produced it. `repeatWindow: 0` turns it off.

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
| `--expect-question` | the agent asked, the card rendered, and the answer resumed it |
| `--deny-tools a,b` | refuses these instead of granting them |
| `--then "a\|b"` | follow-up messages, to see behaviour across turns |
| `--expect-moves-on` | it acknowledged a refusal once and then dropped it |
| `--expect-made` | it recorded what it built, including a package |
| `--expect-named` | the agent named the session after the work, and the header shows it |
| `--install-after "Pin this version"` | clicks that button on the package's inline view and checks the module list |
| `--max-answers 0` | leave a question unanswered, to look at the card |
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
- `probes/agent-tool-plugin.mjs` — a package that contributes an `agent:tool`,
  installed and called for real.
- `probes/revise-loop.mjs` — writes a tool, checks it, edits it, checks again.
  No model, so it runs in seconds; it exists because a stale import made every
  check after the first one a lie.

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

**Automerge heads are per-document, so a folder's heads say nothing about its
contents.** `tool_check` pinned its import URL to the package folder's heads, to
give every revision its own URL and defeat the browser's module cache. But
editing `tool.js` does not change the folder that contains it — so after the
first check, every later check imported the module the browser had already
cached and reported on code that no longer existed. The agent would say "I made
the buttons bigger and it still passes" having checked the version before the
edit. The whole revise loop was dishonest, silently, and a passing check was the
symptom.

A cache-busting suffix is not available: the service worker returns 400 for a
head it cannot resolve, so the heads have to genuinely move. `loadPackage` now
fingerprints every document in the package and records it on the package itself,
which makes the folder's heads reflect its contents.

`probes/revise-loop.mjs` writes a tool, checks it, edits it, and checks again —
no model involved, so it is fast and deterministic:

```
before   v1 saw VERSION-ONE / v2 saw VERSION-ONE / v3 saw neither
after    v1 saw VERSION-ONE / v2 saw VERSION-TWO / v3 saw VERSION-THREE
```

**A file document's mime type decides whether it can be a module.** The service
worker serves it verbatim, and `import()` refuses a module served as
`text/plain` with "Failed to fetch dynamically imported module" — while a plain
`fetch` of the same URL returns 200 with the right bytes, so the file looks
perfectly fine. `fs_write` maps extensions to types, which is why packages the
agent writes work; the first version of `probes/agent-tool-plugin.mjs`
hand-rolled file documents as `text/plain` and spent a while looking like the
plugin mechanism was broken. The failure surfaces as `ReferenceError: window is
not defined` from Vite's preload error handler, which is not a clue about
anything.

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
