# Agent

An agentic harness that lives inside Patchwork. The session is a document, the
loop is leased so it can be taken over, and the tools read and write automerge
documents — including the documents that are Patchwork's own tools.

It works end-to-end on the real patchwork.inkandswitch.com: it finds documents,
reads them, asks permission, edits them, drives real tools in a real browser,
searches the web and keeps what it reads, calls APIs, and writes, checks
and installs new Patchwork tools. It also runs headless — the same session,
claimed by a node process with no tab open.

## What is here

| | |
|---|---|
| `session/session.js` | the session model — pure functions over plain objects, no automerge |
| `kernel/store.js` | applies that model to a DocHandle (and to a plain object, for tests) |
| `kernel/loop.js` | the agentic loop: stream, dispatch tools, stop for approval, resume |
| `kernel/runner.js` | claims the lease, notices work, drives the loop; decides from the session what its tools may reach |
| `net/network.js` | what an interruption is, and how long to wait before trying again |
| `kernel/scope.js` | research steps: the confined context and repo, the scoped toolset, and the repo that keeps tools off sessions and plans |
| `datatype.js` | the `agent-session` datatype |
| `tool.js` | the view — sidebar panel and full-window pop-out, one render function |
| `runners/tab.js` | runs a session in this tab, with or without a view of it |
| `runners/worker.js`, `runners/worker-client.js` | the SharedWorker runner, and the page's half that hands it what it cannot get itself |
| `runners/worker-plugins.js` | the SharedWorker's plugin tools: the page registry's metadata, loaded in the worker where they can be |
| `kernel/placement.js` | where a tool runs, which tools a session placed on a worker gets, and the check a step's prompt gets before it starts |
| `host/modules.js` | automerge and automerge-repo as the host provides them, imported by every module here instead of by bare specifier |
| `workflow/` | workflows: the plan model, the driver that runs it, its datatype and view |
| `ui/panel.js` | the `context-tool` variant that attaches to whatever you are looking at |
| `ui/ambient.js` | the pop-over at the bottom centre: the session (⌘J), a pill while it works, a peek when it needs you |
| `ui/attention.js` | what across your sessions and their workflows is working, waiting on you, or just finished |
| `ui/notify.js` | opt-in browser notifications for those, while the tab is in the background |
| `runners/node.mjs` | the same runner, outside the browser: durable, no CORS |
| `providers/` | `openrouter.js` (real, with retry; a lost connection is an interruption — `net/network.js`), `mock.js` (scripted, for tests) |
| `tools/` | the tool surface — documents, discovery, folders, environment, web, http, kept sources, authoring, checking |
| `net/guard.js` | where any tool may send a request: the guarded fetch every runner hands its tools |
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
its next write, or mid-stream, and stands down. The same class runs in a tab, a
worker, or node — only `canRun` and `runnerUrl` differ.

**Two browsers, one session, one runner.** Every browser with a session open has
a runner for it, and three rules keep them from running it twice:

- *Liveness is judged on the observer's own clock.* A lease is stale when its
  value has not changed for 15 s of the observer's time (`LeaseWatch`), never by
  comparing its stamp with another machine's clock. Only a lease nobody has been
  seen renewing, stamped over ten minutes ago, counts as dead on sight.
- *A claim is believed only after `CONFIRM_MS`* (2 s, overlapping the run's
  setup). Two claims made at once are both writes to a shared document; the merge
  keeps one, the same one everywhere, and the other runner stands down having
  written nothing but its claim. Safe while sync takes under half of that.
- *Only a runner with a key claims.* A browser without one never writes to the
  session and says another browser is running it.

A tab already running other sessions waits a second per busy session before
taking one more, so a workflow's steps spread over the browsers that have it
open. `coordination.test.js` runs two replicas over every combination of sync
delay, start offset, clock skew (to nine minutes) and keys.

**Tool calls are tiered.** Each tool declares `where`:

- `worker` — needs only a repo: `doc_read` `doc_edit` `doc_history`, the `fs_*`
  tools, the `web_*` tools, `http_request`, the `source_*` tools, `package_build`
- `host` — needs the page: `dom_snapshot` (a DOM), the `view_*` tools,
  `package_test`, `registry_list` `plugin_source` `doc_create` (the plugin
  registry, which is page state, not repo state)
- `task` — for work that belongs outside the browser; the seam exists, nothing uses it yet

A package's `agent:tool` declares `where` the same way, and the declaration is
all that decides who gets a tool: a session placed on a worker — a workflow
step, `tools.where = "worker"` — gets every tool declared `worker`, built-in
or plugin, and none declared `host`, filtered when a runner builds its toolset
(`kernel/placement.js`, `tools/index.js` `buildToolset`).

A call the current runner cannot execute **parks** the session rather than
failing it, and resumes when a capable runner appears. Which tier a call needs
is the page if either the runner that recorded it or the runner about to run
it says so, and a runner that parks a call writes that on it, so the runner
that can run it is the one that sees work in it: the SharedWorker lists a
plugin whose code will not load there, but as host-tier, and a tab runs it.

**Refreshing a page with a working agent in it is safe** (`reload.test.js`).
Whatever the runner in it was doing is settled by the next runner to take the
session — the page reloaded, another tab, a worker:

- **A reply cut off mid-stream is asked for again.** A reply is marked
  `streaming: { runner, generation }` while it is written, and the mark comes
  off when its runner sees the stream end, however it ends. A marked reply
  whose mark is not the live lease is half a reply that nobody will finish:
  it is taken out, as one the network cut off is, and the model is asked again
  from where the conversation was. Nothing is said about it in the transcript.
- **A call cut off mid-run is re-run if it only reads, and closed otherwise.**
  A call is claimed under the lease of the runner executing it; one whose
  claim no longer matches the live lease is orphaned. If its tool's risk is
  `read`, doing it twice changes nothing, so it goes back to run again. Any
  other call gets an error result saying it may or may not have taken effect —
  so the model checks, rather than a write silently happening twice.
- **A page that says it is going gives its sessions up.** On `pagehide` every
  runner in the page drops its lease before it stops (`runners/registry.js`
  `releaseAll`), so the next runner takes over at once instead of after the
  lease goes stale (15 s), the fallback when the page dies without saying so.
  A runner that no longer holds the lease writes nothing as it stops, so a
  reply half-streamed stays marked for the next runner rather than being left
  as an idle session's last word. Stopping a reply on purpose is different:
  the runner still holds the lease, so what was said stays, unmarked.
- **Generations never repeat within a session** (`lastGeneration`). Every
  claim that is not a renewal gets a new one, so a runner that loses a session
  and later takes it up again never mistakes its own dead work for live work.

**The network going away is an interruption, not a failure** (`net/network.js`).
A request that never reached the other end did nothing, so nothing is written
for it: no ⚠ turn, no error result. A turn cut off part-way is taken back whole
(none of its calls were committed) and asked for again; a tool call cut off goes
back to waiting to run, as it was before it was claimed. The session's status
is `reconnecting`, with `reconnecting: { reason, since, attempts }` for the
panel and the workflow board, and a workflow step in that state is still
running — never failed. The runner tries again when the page or worker hears
`online`, or after a backoff from 2 s doubling to a minute; node has no such
event and waits out the backoff. Stop ends the wait: every call put back to
wait is answered as not run, and the session says in one line that it stopped.

What counts is decided only where it is certain. The model's endpoint not
answering, dropping a reply, going two minutes without a byte, ending a reply
with neither a finish reason nor `[DONE]`, or answering 408/429/502/503/504/529
past its retries; the fetch relay (ours, and it reports every site's failure as
`x-relay-error`) not answering; Brave's API not answering; and this machine
saying it has no network — a browser offline, or node's `ENETUNREACH`,
`ENETDOWN`, `EAI_AGAIN`, `ENOTCONN`. A third-party site that will not answer is
not one: it may be down for good, and the model hears that as before. A plain
500 is an error too, since waiting would not change it. A tool throws an
`Interruption` only when its call had no effect, because the call runs again.

**What a session costs** is what OpenRouter charges: each response reports its
cost, which the loop adds to `usage.cost` and the header shows. A provider that
reports none is estimated from the catalogue's list prices, and the total says
it is partly estimated. A workflow adds up its steps.

**Most of that cost is input**, because every request re-sends the conversation:
one measured session sent 1.2M tokens and got back 19k. So requests to Claude
ask for prompt caching (`cache_control`, which Claude needs and other providers
do without), and every request carries a `session_id` — a hash of the session's
URL, never the URL — that keeps a session on one provider so its cache is there
to hit. Cached input is billed at a tenth of the price; the header's tooltip
says how much came from the cache.

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

**Approvals plus history.** `risk: "read"` runs silently, and so does
`risk: "edit"` — writes to automerge documents, which keep their history, so
anything the agent changed can be seen and put back with `doc_history`.
Everything else asks, and the grant it earns can be as narrow as one document
or as broad as a whole site — see *Risk lives on the document*. Grants live in the session document, so
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
| Web | `web_search` `web_fetch` | worker |
| APIs | `http_request` | worker |
| Kept sources | `source_read` `source_list` `source_file` | worker |
| Findings (research steps only) | `finding_write` | worker |
| Ask | `ask_user` | never runs — see below |
| Remember | `session_recall` | worker |
| Name | `session_title` | worker |

Outside content does not stay in the conversation; see *Everything fetched is
kept*, below.

Packages add tools of their own (see *A package can hand the agent a
capability*). The Web snapshot package (`../web-snapshot`) adds `web_capture`,
which keeps a page as it looks; it is there only when that package is
installed — and, because it declares itself scoped, research steps have it
too (*Research steps keep things*).

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

**Edits never take character offsets.** Every value a tool asks for must be
something another tool hands back: text and line numbers are, offsets are not,
and an offset read earlier drifts as soon as the text changes. `doc_edit` takes
ops (`set`, `delete`, `insert`, `append`, `prepend`, `replace`, `test`) whose
`path` names the thing itself, exactly as `doc_read` prints it; text is changed
by quoting it (`replace` an exact `find`, `insert` `before`/`after` an exact
anchor) or at its ends, the way the str_replace tools coding agents use work.
`fs_edit` takes the same text edits for a file. A string, an ImmutableString
and a notebook's list of lines are all text, each written back in its own form,
and only the characters that differ are written, so edits merge. Long text goes
in pieces — `append` creates a missing field, so every piece is the same call —
and `from` copies text that already exists in a document instead of the model
retyping it under its output limit. `documents/ops.js` opens with the design.

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

## Everything fetched is kept

**Originals need a relay in a browser.** Most sites will not let another
site's page read them (CORS), so a tab on its own keeps a reader's text of a
page, and a PDF only when the site allows. With a fetch relay set up in the
agent's settings (`fetch-relay/` in this repo: a Cloudflare Worker or a Node
server), every GET and HEAD a tab makes goes through it (`net/relay.js`),
still behind the guard, and the tab keeps what a node runner keeps — the PDF
or the page as the site sent it, with its text beside it. A search's results
page is kept too, as the record of how a step found what it read, but it is
not filed in a workflow's Sources folder: that folder is for what a reviewer
checks claims against.

**Search is Brave's Search API.** An index of its own, with an API meant for
programs: scraping DuckDuckGo's results page got its bot check, which read as
"no results", and the agent went on to guess URLs that were not there. It
needs a key (the agent's settings, under *Web search*, kept with the API keys;
`BRAVE_SEARCH_API_KEY` for the node runner) and, in a browser, the relay —
Brave's API answers no page directly. The relay passes that one header,
`x-subscription-token`, to Brave's API host and to nothing else. Without
either, `web_search` says what is missing rather than returning nothing. Its
answer is kept as it came, JSON, with the run.

**An error page is not a source.** The reader answers 200 even when the site
did not, noting `Warning: Target URL returned error 404` above a rendering of
the error page. `web_fetch` reads that as the site's failure and keeps
nothing.

A fetched page used to exist only as a paragraph in a tool result. It cost
context on every later turn, a person could not open it, and a PDF arrived as a
third party's markdown of it. One measured workflow re-read pages it had
already fetched 147 times: the saved page's footer said to page through it with
`doc_read`, which a web-only step did not have, so it fetched again.

Now every successful `web_fetch` and `http_request` leaves exactly one new
document, an ordinary `file` the File tool shows (and the Web snapshot
package's `web_capture` one `web-snapshot`, below), and nothing overwrites one:

| what was fetched | `content` | `role` | readable text |
|---|---|---|---|
| a PDF whose bytes could be had | the PDF, byte for byte | primary | the reader's text, in `text` |
| a PDF whose bytes could not (CORS, not a PDF, over 30 MB) | the reader's markdown | extract | `content`; `missing` says why |
| a page read through the reader | the reader's markdown or text | extract | `content` |
| a page read directly (node) or with `http_request` | the HTML as sent, decoded by its charset | primary | its text, in `text` |
| JSON, CSV, plain text | the body, decoded | primary | `content` |
| an image, wasm, a font | the bytes | primary | none |

Every one carries the same provenance: `source` (the URL asked for) and
`capture` — when, the final URL, `via` the reader or directly, the `engine`,
status, content type, and the SHA-256 and size of what is kept. The readable
text is an `ImmutableString` written once, so a character offset names the
same characters forever, and headings are recorded as `marks`.

That makes reading back a pure function of text and offset. `source_read`
pages through a kept source and says which heading each slice starts under, or
searches it (`find`) and lists every match with its offset and heading.
`source_list` shows what this conversation has kept and searches all of it at
once. A fetch result shows only the first 6000 characters, then an outline of
headings with their offsets and the `source_read` call to read on; a result
shortened later in the conversation names the same call. Fetching a URL this
conversation already kept answers from the kept copy without a request, unless
`fresh` is passed.

A kept source is not in any folder. `source_file` puts one there, pinned to the
version that was fetched — which is also how a wasm module gets into the
package that needs it: fetch it with `http_request`, then file it under the
name the code imports. `web_import` and `http_request`'s `folder`/`saveAs` did
these jobs before, each its own way, and are gone.

## Keeping web pages

`web_fetch` keeps what a page *says*. Keeping the page *itself*, as it looked,
is the Web snapshot package's job (`../web-snapshot`, its own package and
README): a `web-snapshot` document holding the page's rendered DOM frozen at
capture — no script, handler, refresh or live frame left in what is stored —
with every stylesheet, font and image it loads stored once by hash, which
opens later offline with nothing run. It registers the `web-snapshot`
datatype and view (an empty snapshot is where a person captures a page by
hand) and one `agent:tool` plugin:

- `web_capture` — the capture. It works only through the context it is
  handed: it fetches only through `ctx.fetchImpl`, the guarded fetch below,
  and refuses to run without one, and writes only through
  `ctx.repo.create2()`. Its metadata declares that (`scoped: true`), which is
  what lets a research step have it. `GRANT_GROUPS` puts it with the web, so
  it is asked about and granted like `web_fetch`, and a research step's
  standing web grant covers it; `ui/calls.js` presents it. A snapshot it
  returns is recorded in the session's `made` (or a research step's ledger)
  with `what: "web-snapshot"`, so capturing the same page again answers from
  it.

A snapshot is an ordinary document, filed where the work is: `source_file`
puts one in a folder as a `web-snapshot` (so it opens in its own view), and a
research step's snapshots are filed in its workflow's Sources folder like
everything else it keeps. A snapshot's text is read with
`source_read` like any kept source: it keeps the source contract above, with
`html`, the frozen page, as its primary. Whether a 20 MB snapshot and a 30 MB
PDF, each one document written in one change, fit through the sync server is
`probes/sync-size.mjs` (P7); it stays here because the PDF cap is this
package's. It is written and not yet run.

## Every fact says where it came from

A fact the agent read is cited where it is stated, as a markdown link to the
document it read, titled with the passage word for word:
`[datasheet](automerge:… "Rated capacity: 280Ah at 0.2C")`. A fact it has
no document for is marked `(from memory)`. The system prompt asks for both,
and every fetch result ends with the form to use.

The quote is checked, not trusted (`documents/citations.js`). Case, whitespace,
typographic quotes and dashes, and markdown emphasis and link syntax are set
aside on both sides; anything else must match, and a quote must be at least
12 characters so it names a place rather than a figure. The
transcript marks each citation found (✓) or not in its source (✗), and
`finding_write` refuses a finding whose quote is not in its source, or whose
source is not the workflow's. `citations.test.js` checks every window of
words of a markdown-heavy fixture is found where it is, and no window with a
word changed is found at all.

## Where a tool may fetch

Every runner gives its tools `ctx.fetchImpl`, a guarded fetch
(`net/guard.js`), and the tools have no other: there is no fallback to the
global `fetch`, so a runner that forgot to wire one fails loudly. It refuses
anything but http and https; `localhost` and every private, loopback and
link-local address in any spelling (`2130706433`, `127.1`, `0x7f.1`,
`[::ffff:127.0.0.1]`, NAT64 and 6to4 forms of a private IPv4 address);
Patchwork's own origin and its sync servers (with or without a trailing dot on
the host), because the page's origin hands the person's documents to anyone
asking by URL; and any path that names an automerge document, however many
times it is percent-encoded. A redirect's destination is checked before its
body is read. In node every address a name resolves to must be public, and a
name that resolves to nothing is refused; the node runner and probe both build
that fetch with `nodeFetch` (`net/node-fetch.mjs`). A reader URL hides its target
in its path, so the web tools check the target before building one.
`plugin_source` reads a package the page serves from its document, and
fetches any other through the guard.

## Research steps keep things

A workflow's research step (`access: "web"`) may fetch any site without
asking. That is safe only if nothing of the person's can reach what it sends,
and it used to be safe by having nothing at all: no documents, so nothing it
fetched could be kept or read back, and everything it learned had to survive
in one closing message. Now it keeps everything — every page and PDF it
fetches, and *findings*, short markdown notes it writes as it goes with
`finding_write` — and it still cannot read or write anything else of the
person's. That is not a request in its prompt. A page it reads can ask it for
anything; what it is able to do is decided by what its tools are handed.

**One field decides it.** The driver writes `session.scope = { kind: "web",
ledgerUrl: <the plan>, stepId }` in the same change that creates the step's
session. Every runner — tab, worker, node — reads it in one place
(`kernel/runner.js` `prepare`) and nowhere else:

- **The toolset** is exactly `web_search`, `web_fetch`,
  `http_request` (GET and HEAD, no body), `source_read`, `source_list`, `finding_write` and
  `session_recall` — the built-ins themselves — then the plugins of this
  runner's registry that declare `scoped: true` (below); frozen, decided per
  run, and whatever the session says about its tools ignored. `finding_write`
  exists nowhere else; `source_file`, which writes into a folder, is never
  here.
- **The context** is built field by field from an allowlist (`confine`): the
  signal, events, the guarded fetch, the reader, the search (its key closed
  over, so no tool can read it), and a repo. There is no
  subject, no root, notes or skills folder, no account, no session URL, no
  page, no way to start a workflow — so the person's notes and skills are not
  in its prompt either, with no special case. The workspace note a view
  attaches to a message is not sent to it.
- **The repo opens only the ledger.** `plan.sources` lists every document the
  workflow's research steps have made, with the heads each was last written
  at. `find` canonicalises whatever it is given, looks it up there, and
  refuses before the repo is even asked — so a document URL lifted from a
  page, in any spelling, does not so much as cause a sync request. A source is
  read at its recorded heads and cannot be changed; a finding can be added to,
  but only while nobody else has edited it since (a person's edit is theirs:
  the step writes a new finding rather than build on text it cannot see).
  `create2` enters the new document in the ledger before anything is written
  into it. There is no delete and no list of handles.

So a research step can keep and re-read everything it found, and so can its
sibling steps — a page one step fetched answers another's `web_fetch` without
a request — while holding only what came from the web and what the
orchestrator chose to write into research prompts. It is never handed the
result of a step that had the person's documents: its prompt says such a step
ran, not what it found, and names no session.

**Nothing in the agent can undo it.** Every other session's tools get a repo
(`kernelRepo`) whose handles refuse to change a session or a plan, however the
document is named and whichever handle — a view, a sub-path — is used, so no
`doc_edit`, `fs_write` or plugin can drop a step's scope, give it tools, or add
a document to the ledger. The two modules that do write them are handed
explicit capabilities, for their own calls only: `workflow/tools.js` gets
`ctx.workflows` (the runner's repo and its step starter), and `session_title`
writes its own session through `ctx.session`; no other tool, and no plugin, is
handed either, and a test holds each to its one module. Nor can a tool make a
session or a plan: a write that would turn a document into one is refused, so
no tool can forge a plan whose ledger lists the person's documents. The runner refuses a step
its plan calls web-only whose session is not scoped exactly so, and the
driver cancels it ("its research scope was removed").

**A package's tool joins only by saying so.** A plugin is someone else's code,
and a research step fetches without asking, so none is there by default. A
plugin whose metadata says `scoped: true` at its top level — the Web snapshot
package's `web_capture` is one — is admitted (`kernel/scope.js` `admitScoped`) when
it is a worker tool whose id is no built-in's, the first plugin with that id,
from the registry of the runner running the step. It is handed what the
step's built-ins are handed, the confined context, and nothing more. So
everything the agent controls still holds for it: it gets no field of the
person's, its repo opens only the ledger and its new documents go into it,
and its every request goes through the guard. A tab admits from its own
registry and the SharedWorker from the metadata the page hands it
(`runners/worker-plugins.js`), by what each plugin declared, so a step gets the same
plugins in either; one that will not load in the worker runs in a tab, with
the confined context that tab builds. The node runner has no registry, so a
step running there gets the built-ins alone.

**The trust this asks for, plainly:** a package declaring `scoped: true`
vouches that its tool works only through the context it is given — no
global, no platform `fetch`, no host module, nothing it brought along to
reach past that context. The agent cannot check that; it can only hand the
tool nothing more. Installing such a package extends what research steps can
do. An undeclared plugin, or one claiming a built-in's name, is never
admitted.

**For the person**, the driver files the ledger into the plan's Sources folder
as it grows — sources pinned to the version fetched, as their own datatype (a
web snapshot opens as one), findings live — and the
news and the workflow view say what each research step kept. The folder is a
view, not an authority: linking a document into it grants research steps
nothing. Research steps take no part in sharing grants, either way.

What this does not cover: a person editing a session or plan by hand; a DNS
answer that changes between the check and the fetch in node; and the reader
service seeing every URL fetched through it, which was already true.

`scope.test.js` holds the claim from the outside: a repo full of documents
marked with a sentinel, and every research tool called with every way of
naming something — every spelling of every document of the person's, the
plan, the step's own and a sibling's session, a page full of document ids, an
address on this machine, a site that redirects to Patchwork's origin — and
after each call it checks that only ledger documents were opened, only what
the call made or a finding changed, every request passed the guard, and no
sentinel got out. `toolset.test.js` holds the admission rule over every kind
of plugin a registry can hold, and runs an admitted one to see it handed the
confined context exactly; the Web snapshot package runs the same matrix over
the real `web_capture`, with a confined context built as `confine` builds it.

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

`where: "worker"` (the default) says a repo is all the tool needs, and it runs
wherever the session does, the SharedWorker included: the page hands the
worker every entry's metadata, again whenever the registry changes, and the
worker loads the code from the entry's `importUrl` the way the page does
(`runners/worker-plugins.js`). Code that cannot load in a worker — it imports a bare
specifier, or touches the DOM as it loads — still works: its calls go to a
tab. A tool that genuinely needs the page says `where: "host"`; a workflow
step placed on a worker does not get it, and one whose prompt names it is
moved to the page.

`execute(input, ctx)` gets the runner's context. In a tab and in the
SharedWorker alike it holds `ctx.repo`, `ctx.subject`, `ctx.fetchImpl` and:

- **`ctx.automerge`** — the host's automerge module, initialised, the one that
  owns the documents. Take it from here rather than importing
  `@automerge/automerge`, which a worker cannot resolve.
- **`ctx.plugins`** — the `@inkandswitch/patchwork-plugins` module: the
  registry (`getRegistry(type)`). In a tab it is the page's. In the
  SharedWorker it is the worker's own copy, holding every view and datatype
  the page has registered, each loaded from its `importUrl` on first use
  (`runners/worker-plugins.js` `createRegistryMirror`), so a datatype's hooks are found
  through it there too.

Neither is in a research step's confined context, and the node runner has
neither.

A tool that works only through the context it is handed — `ctx.fetchImpl`
for the network, `ctx.repo` for documents, nothing global — can say so with
`scoped: true` beside its `where` and `risk`. Research steps then get it too,
with their confined context (*Research steps keep things*); without the
declaration a plugin is for full sessions only. It is a promise the package
makes and the agent cannot check, so installing a package that makes it is a
decision about what research steps may do.

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

Whether and when that wakes the agent is decided here, in `kernel/events.js`, not by
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

## Tests run in a page or a worker — on vitest's own engine

`tool_check` answers "does this mount and respond to a click". It cannot answer
"is this function correct", so an agent that writes tests it cannot run has
written documentation.

`package_test` bundles each `*.test.ts` with the same esbuild machinery,
rewrites its `vitest` import to a bridge to the runtime, and imports the bundle
while vitest's runner collects it.

**The engine is vitest's, at the version the package's own `vitest run` uses.**
"vitest is a node program" is true of the CLI and false of the parts that
decide what a test means: `@vitest/runner` (collection, hooks, `each`, `only`,
`skip`, `todo`, timeouts), `@vitest/expect` (chai with vitest's plugins, so
every matcher and asymmetric matcher, with vitest's diffs) and `@vitest/spy`.
None of them need Node. `scripts/vendor-vitest.mjs` bundles them into
`tools/vendor/vitest-engine.js` (`pnpm vendor:vitest`; a test fails when it
drifts from the installed vitest), so a run needs no network, and a page, a
worker and this package's own tests all import the same file.
`tools/vitest-runtime.js` is the only code of ours in the path: it assembles
`expect` the way vitest does, imports the file, and flattens the result into
the report.

**Two hosts.** `in: "page"` (the default) has the real DOM. `in: "worker"` runs
each file in a fresh module worker (`tools/test-worker.js`), which has none, for
code meant to run in one. A worker has no importmap, so the tab resolves
Patchwork's importmap to absolute URLs and the build writes them into the
bundle, the same table `runners/worker-client.js` hands the shared runner. A file that
declares `// @vitest-environment happy-dom` (or jsdom) is skipped in a worker,
with that reason. A worker that does not finish a file in 60 s is terminated.

**Package files are read by URL.** The bundle runs from a `blob:` URL, so the
build sets each package module's `import.meta.url` to its file's
service-worker URL (`/automerge%3A<folder>/<path>`, Patchwork's
`getImportableUrlFromAutomergeUrl`). `fetch(new URL("./data.json",
import.meta.url))` then reads the package in a page and a worker; under
`vitest run`, a setup file lets Node's `fetch` read `file:` URLs.

**The report.** Failures with vitest's diff, errors nothing caught while a file
ran (Chrome delivers `unhandledrejection` after the next task, so each file gets
100 ms to settle), and up to 60 lines of what the file logged.

What needs the CLI is not here: `vi.mock` (vite rewrites the file to hoist it),
fake timers, snapshots, coverage, watch. `vi.mock` says so when called.

Measured in headless Chrome, on the assumptions package: 300 of 300 tests in a
page in about 2 s; in a worker, 116 of 116, with its two DOM files skipped.
The same files pass under `vitest run`.

## Risk lives on the document

`risk: "read"` runs silently. So does `risk: "edit"`: `doc_edit`, `doc_create`
and the file tools only write automerge documents, and automerge keeps every
version, so an approval prompt bought nothing that `doc_history` does not —
while stopping the loop on every write. What history cannot undo is code that
has already run, so `edit` has two exceptions. Sensitive documents (below)
always ask. And a tool's `askWhen(input)` marks calls that write source code
(`isCodePath`: `.js`, `.ts`, `.json`, `.css`, …), which need a grant as before:
a package runs with the user's authority on its next load, and with no access
control in automerge, a package someone else published is as writable as your
own. `doc_edit` cannot tell code from data until it has loaded the document,
so it refuses source files and packages there and points at the file tools.

Everything else asks, and the answer can be
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
user was asked once per tool per site. The web tools share one `web` group.
Grants written before the grouping are still honoured, so nothing has to be
re-approved.

`alwaysAsk` may be a function of the input, because for some tools the danger is
in the arguments rather than the verb. `http_request` used to ask every single
time; that same session made eleven of them, all plain GETs with no credential,
and the user granted `http_request@*` plus three per-site grants that did
nothing at all — `alwaysAsk` is checked *before* grants are. A GET is a
fetch and is granted like one; any other method, or anything with a body, still
asks every time.

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
however broad the grant — matched by document id, so a URL with heads or a
path in it is still the same document: the module settings document decides what code runs on
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
right before the stand-in, so repeating it needs no extra information. When the
call kept a source, the stand-in names it and the `source_read` call first:
that reads any part of it, not only what the call showed.

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

`session_title` has `risk: "self"` — it writes, but only ever to the session
document, so it is never asked about. Marking it `read` would
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
| `editing-documents` | `doc_edit`'s ops, why text edits anchor on text rather than offsets, and writing long text in pieces |
| `working-with-the-web` | which outside-world tool to reach for, and reading back what was kept |
| `finding-things` | how to orient in a Patchwork you have not seen |

A test holds the parts that rot: every skill must name only tools that exist,
and every tool must document every parameter it accepts. A parameter with no
description is one the model has to guess at, which is not hypothetical — it is
how `root: "automerge:"` got sent and cost a turn.

Installed packages contribute skills too: a `patchwork:skill` plugin (name,
description, and `load()` returning `{ documentation }`). They are listed by
`skill_list` from their metadata, read on demand, and — unlike the built-ins,
which the prompt already names — named in a "Skills from installed packages"
section of the system prompt, since a skill the agent never hears of is one it
never reads. That is how a package steers the agent toward working its way
(`assumptions` does this for engineering tasks). The tab runner hands the
host's registry in as `ctx.skillRegistry`; a worker has none. A package skill
cannot take a built-in's name.

Built-ins ship with the package so the agent is never knowledge-less, but a
skill in the session's `skillsFolderUrl` shadows a built-in of the same name —
a folder document with a `SKILL.md` in it. That matters because this guidance is
the thing most likely to need correcting in the field: when the agent gets the
render contract wrong, the fix should be editing a document, not redeploying the
harness.

## Package usage guides

Notes hold what the agent learns in general; a **usage guide** holds what it has
learned about using one package's tools, so no session reads plugin source to
learn them again. There is one guide per package, a markdown document in a
`Tool guides` folder inside the "Agent notes" folder (notes skip folders, so
guides are never among them). A guide is written for a future agent and a
person alike: the package's tools, datatypes and agent tools, their inputs, working
recipes, and pitfalls with their workarounds. Tools: `guide_read` (one guide, or
the list), `guide_write`, `guide_changes`, `guide_pin` (`knowledge/guides.js`).

**Pin.** A guide records the package it describes and a pin in `pins.json`
beside it: the package folder's heads and every file's heads when the guide was
last reviewed against the package. (A file's edits live in its own document and
never move the folder's heads, so the whole tree is pinned.) Against the package
as it is now, a guide is `current`, `stale`, `gone` (the package will not load)
or `unpinned` (never checked). The pin moves only when the guide is first
written, when the package is unchanged, or when the agent says it reviewed
(`guide_write` with `reviewed: true`, or `guide_pin`) — so adding a pitfall to a
stale guide leaves it flagged. For a package installed pinned
(`automerge:<id>#<heads>`), the version in use is the one compared.

**Surfacing.** The system prompt lists each guide in a line (no packages are
read to do so). The first time a session uses a package — a plugin tool call,
`view_mount` of its tool or package folder, `doc_create` of its datatype,
`plugin_source` of its plugin — the guide is appended to that result, with
where it stands; a package with no guide gets a one-line prompt to write one.
`registry_list` appends only a pointer for the plugins it lists. Finding a
plugin's package is `ctx.packageOf`: the tab runner reads the page's registry,
and the SharedWorker runner reads the index of every tool, view and datatype
the page sends it with its plugins (`runners/worker-plugins.js` `packageIndex`), so
worker steps surface guides on the same triggers. The node runner has no
registry and no plugins, so it surfaces nothing; its guide tools take a
package's folder URL. A stale guide says to read `guide_changes`: the files added, removed and
changed since the pin and a bounded line diff of each, `file` for more of one.

**Habit.** Package knowledge goes in the guide, not a note: write one after first
working out a package, update it on finding a pitfall (the `keeping-notes` skill
and the notes section of the prompt say so).

**People.** Guides are ordinary documents. The agent header's "Guides" button
lists them with their state in words ("May be out of date: 3 files changed in
the package since this guide was checked on 22 Nov") and opens one on click.

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

There are none. An earlier version kept per-device secrets for `http_request`;
it was removed, because the agent has no business holding credentials and every
place it could put one is synced. An API that needs a login cannot be reached
from here.

## Running it without a browser

```sh
OPENROUTER_API_KEY=… pnpm runner automerge:<sessionUrl>
OPENROUTER_API_KEY=… pnpm runner --watch automerge:<folderUrl>
```

Because the session is a document and the lease is in it, this needs no new
protocol: it claims sessions exactly the way a tab does, and a browser can take
one back mid-flight. Two things change outside the browser — there is no origin
policy, so the web tools fetch pages directly instead of through a third-party
reader, and a PDF's bytes always arrive; and there is no DOM or plugin
registry, so host-tier calls park until a tab picks them up. With no origin
policy the guard is the only thing between a tool and this machine's network,
so here it also follows redirects by hand, one checked hop at a time, and
checks every address a name resolves to.

## Keys

The API key **never** lives in the session document. A session document syncs
to every peer it is shared with and to the sync server; a key in one would be
handed to everyone who can open it. Model and parameter choice *do* live in the
document — they are part of the session's meaning and should travel with it.

The key lives in the account's LLM settings instead: the document the `llm`
library's model picker writes, found through `patchwork:tool-storage` under the
id `llm`, at `openrouter.apiKey`. It is private to the account and follows it
across devices, and one key serves every LLM tool. Until that document answers,
and outside Patchwork, the key falls back to this device's `localStorage`; a key
found there is moved into the account the first time it does. The worker runner
cannot reach the account, so the view hands it each key as it changes; the node
runner still takes `OPENROUTER_API_KEY`.

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
pnpm test                                  # 2500 unit + mount tests, no network
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
  `http_request`, files it into a package with `source_file`, and compares
  every byte against an independent fetch.
- `probes/agent-tool-plugin.mjs` — a package that contributes an `agent:tool`,
  installed and called for real.
- `probes/worker-plugin-tool.mjs [--plugin ../assumptions]` — the SharedWorker
  runner, served from this folder with no importmap in the worker, runs a
  worker step that calls a package's agent tools (the assumptions register's,
  by default), with a scripted model and a local stand-in for Patchwork's
  importmap and registry. No network.
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

## Workflows

A session with **Workflows** switched on in its settings can hand a large job to
several agent sessions at once. `workflow_start` writes a **plan document** — an
`agent-workflow` — of steps, each with a prompt, the steps it waits for, where it
runs and which model tier it needs, and the reason for that choice. The plan is a
document, not a script, so it can be watched, resumed after a reload, and
extended while it runs: `workflow_add_steps` adds one step per finding when a
result calls for it.

- **Each step is a session** (`workflow/driver.js`): a full transcript you can
  open, steer and approve in. It is started on its tier's model — deep,
  standard and fast default to the latest Opus, Sonnet and Haiku, and the
  mapping is a setting — with the goal, its prompt and the results of the
  steps it waits for. A full step inherits the orchestrator's grants, never
  gets the workflow tools (no nesting), and a `worker` step gets every tool
  that runs without the page, the tools of installed packages included
  (`kernel/placement.js`). A research step is confined instead (see *Research steps
  keep things*). A step's optional `subject` is its main document: its
  session is attached to it, so tools that take a url default to it; without
  one, a step calling them with no url is told to pass one.
- **A step that cannot work as written is told so at start, not left to find
  out.** Before a step begins, the driver checks the tools it lists in its
  optional `tools` against everything installed — one no package provides
  fails it at once, "Not installed: …" — and then those and its prompt for
  the names of tools this page knows that the step would not get. A worker step naming
  one that needs the page — `view_mount`, a package's `host` tool — is moved
  to the page and starts when the page is free, its card and
  `workflow_status` saying why. A research step naming a tool it cannot have,
  or any step naming the orchestrator's tools, fails at once with the reason.
  Only names of tools this page knows count: `cell_capacity` in a prompt is
  not a tool because it looks like one. A step that finds a tool missing
  anyway is told to say so in its result and stop that part, not search for
  it.
- **The plan decides; the driver acts.** `workflow/plan.js` is pure: five
  stored step states, the rest (ready, waiting, blocked, needs-you, out of date) derived, and
  `toStart` choosing what may run. Its rules — only ready steps start, never more
  than `parallel` at once nor `hostParallel` on the page, blocked exactly when
  something it needs failed — are checked over every plan of up to three steps
  and every four-step graph (`workflow-plan.test.js`).
- **One driver per plan**, by the same lease a runner holds on a session — judged
  and confirmed the same way — so two browsers with the plan open cannot both
  start a step. The others still start runners for its running steps, and each
  step's own lease decides which browser runs it. Close every tab and the plan
  pauses; open its view anywhere and it resumes from what the document says.
- **The orchestrator is woken** through `ctx.events` as steps finish, with their
  results, and once more when the plan is over.
- **A step that needs someone is not left waiting unseen.** A question it asks
  wakes the orchestrator, which can answer it (`workflow_answer`) or ask the
  person and pass the answer on. A permission it needs does not wake anyone —
  only the person can grant it — but it appears above the orchestrator's
  transcript and on the step's card in the workflow view, with Allow once /
  Deny (and option buttons or a box for questions) right there.
- **The view** lays the steps out in stages by dependency depth: each step's
  state, frontend or worker, tier and model, why, live activity, result or
  error, and a link to its session — "Answer in its session" when a step is
  waiting on you.

- **One job, one set of permissions.** A grant given in any of a workflow's
  full-access sessions reaches all of them, and releases every waiting call it
  now covers; so does a grant given from the peek or the strip ("Allow
  dnv.com", "Allow any site"). A **research step** (`access: "web"`) fetches
  without asking and keeps what it finds, and can reach none of your
  documents; it neither gives grants nor receives them.
- **News is told once**, recorded in the plan: a reload or another tab's driver
  does not repeat a step's result, and the end of a plan is one wake, not one
  per tick. Cancelling takes the step session's lease, so a runner in another
  tab stands down too, and marks the session `halted`, so no runner takes it up
  again — not even when a call that finished after the stop leaves it looking
  like work. Speaking to it, or reopening its step, lifts that.

**The graph changes as the work goes.** Nothing closed is final:

- `workflow_reopen` takes a step that finished, failed or was cancelled back to
  work. It continues in its own session, from where it was, told the note and
  handed what it depends on as that now stands; its old outcome is kept in
  `previous`, and its new result replaces the old. A stopped or finished
  workflow runs again. The person can Resume a failed or cancelled step from
  its card.
- **Out of date is exact.** Each step records the versions of what it was built
  on (`inputs`), and each finish bumps a step's `version`, so a done step is
  `stale` exactly when a dependency is not done or has finished again since:
  no clocks. Nothing starts on a stale input — what waits on one is blocked.
- **Cascade is chosen per reopen.** With it, everything built on the step that
  is done or running is reopened too (a running one halted first), all the way
  down, and revises in order. Without, those go out of date; the orchestrator
  is told and reopens or keeps (`workflow_keep`) each.
- `workflow_edit_steps` changes a step that has not started — most often its
  `after`, to wait on a step added since — checked for cycles over the whole
  graph. A step may depend on one that failed or was cancelled; it is blocked
  until that is reopened.
- **Steps ask; the orchestrator decides.** A step's `workflow_request` (add
  steps, reopen steps, why) writes nothing: the call in its own session is the
  request, which the driver copies into the plan's `requests` and the
  orchestrator is woken with. `workflow_decide` accepts — doing exactly what was
  asked, checked against the plan as it is then — or declines. A research step
  has the tool too: what a page talks it into reaches only the orchestrator's
  judgement. A plan does not finish while a request is open.

The scheduling rules, staleness included, are checked over every plan of up to
three steps at every combination of versions, as well as the earlier spaces
(`workflow-plan.test.js`); reopening, cascade, keeping, editing and requests
run end to end with real sessions in `workflow-reopen.test.js`.

**A step's session says where its step stands**, under its header and live
with the plan: running, waiting for another step, done (and who uses its
result), out of date (and what changed), failed, cancelled, and what the whole
workflow is doing when it is paused, stopped or finished. The session that
started a workflow shows it at a glance. A message to a step goes straight in
only while the step is running. To any other step it waits for a choice:

- **a question, in a side thread** — a copy of the step's session
  (`repo.clone`) that is no longer a step (`workflow/aside.js`). It keeps the
  step's model, tools, permissions and, for a research step, its confinement;
  it loses the step's budget and the tool for asking the orchestrator for
  work. The driver never reads it, so nothing said there is the step's result,
  and the step never sees it if it is reopened later. Further questions
  continue the same side thread until the step moves on.
- **reopening the step with it**, alone or with the steps built on it —
  exactly `workflow_reopen` done by the person, with the message as the note.

What a message to a step does is checked over every state of three chained
steps in `workflow-standing.test.js`, and in the panel in
`tool-standing.test.js`.

Workflows are on by default. Limits are per session: steps at once (3), steps
in all (24), and a budget in dollars ($20) for what the steps and the orchestrator's own turns spend together, as OpenRouter reports it: spent with work still to start, the plan pauses, the orchestrator is told, and the person is offered Resume (the strip, the pop-over, the workflow view). Each step has a budget of its own, set by the orchestrator or its tier's default (fast $0.50, standard $2, deep $5); a step that spends it stops part-way and wakes the orchestrator, not the person: it extends the step out of the plan's remainder with `workflow_budget { step, add, why }` (the reason is kept on the step), or stops it, or adds steps. Asking for more than the remainder extends nothing and puts the request to the person; so does a step stopped when the cap is already reached. Resume then tells the orchestrator again about steps stopped part-way. A step is done only when its whole session is quiet: no unanswered call, no reply streaming, no live runner; an empty last message takes the last words the session said. Steps wait with `doc_watch`, and `view_interact` refuses a `settleMs` over 30 s. Every step runs in a tab today, because the SharedWorker runner is still
opt-in (below). `where` decides only which tools a step gets and how many
steps share the page (`hostParallel`, one), so a `worker` step runs the same in
the SharedWorker; in the node runner, which has no plugin registry, it would
have the built-ins alone.

## What is not built yet

- **The SharedWorker runner is opt-in, not default.** Turn it on with
  `localStorage["patchwork-agent:worker"] = "on"`. The page hands the worker its
  resolved importmap, which it imports automerge by with **no CDN shim** —
  this package's own modules included, through `host/modules.js`, since a
  worker cannot resolve a bare specifier — initializes automerge's slim build
  from the wasm the page loaded and the subduction wasm behind a six-property
  `document` shim, builds a Repo over a donated MessagePort, and gets the page
  registry's plugin tools. `probes/worker-repo.mjs` measured the repo part on
  the deployed shell (8/8); `probes/worker-plugin-tool.mjs` runs the whole
  runner in headless Chrome against a stand-in for Patchwork's importmap and
  registry: a worker step offered a package's tools, calling two of them in
  the worker, and parking one that cannot load there for a tab. What is not
  proven is ongoing sync with real Patchwork — the worker took the lease and
  ran the first turn, then missed the approval the page wrote and stalled. The likely
  cause is that `window.repo` is itself a client of Patchwork's own automerge
  worker, so attaching a second network adapter may not relay changes;
  `worker-port`'s `donatePort`/`makePortProvider` look purpose-built for this
  and are the first thing to try. Note that a SharedWorker dies with its last
  client anyway: durability comes from `runners/node.mjs`, not from it.
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
  `offset`/`limit`, and a kept source with `source_read`. A large
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
