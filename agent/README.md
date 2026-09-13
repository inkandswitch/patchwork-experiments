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
  tools, the `web_*` tools, `tool_write`
- `host` — needs the page: `dom_snapshot` (a DOM), `registry_list`
  `plugin_source` `doc_create` (the plugin registry, which is page state, not
  repo state), `tool_install` (the account document)
- `task` — for work that belongs outside the browser; the seam exists, nothing uses it yet

A call the current runner cannot execute **parks** the session rather than
failing it, and resumes when a capable runner appears.

**The transcript is provider-neutral.** No OpenAI- or Anthropic-shaped message
ever enters the document; adapters translate on the way in and out. That is
what makes changing model mid-session work, and it is why the web tools are
ours rather than a provider's hosted search.

**Approvals plus history.** `risk: "read"` runs silently; writes ask once per
session per tool; `tool_install` asks every time regardless of grants, because
it adds code that runs on every future load. Grants live in the document, so
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
| Environment | `registry_list` `plugin_source` `dom_snapshot` | host |
| Web | `web_search` `web_fetch` `web_import` | worker |
| APIs | `secret_list` (host) `http_request` | worker |

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

## Risk lives on the document

`risk: "read"` runs silently and writes ask once per tool per document. On top of
that, some *documents* always ask, whichever tool touches them: the module
settings document decides what code runs on every future load, and the account
document is your identity. Attaching that gate to an "install" tool instead
would only mean the next tool that can write a document routes around it.

## Skills

Guidance the agent needs but should not carry in every prompt: named and
described in the system prompt, read in full on demand. `writing-patchwork-tools`
carries the render contract, `editing-documents` the op vocabulary,
`finding-things` how to orient in an unfamiliar Patchwork.

Built-ins ship with the package so the agent is never knowledge-less, but a
skill in the session's `skillsFolderUrl` shadows a built-in of the same name —
a folder document with a `SKILL.md` in it. That matters because this guidance is
the thing most likely to need correcting in the field: when the agent gets the
render contract wrong, the fix should be editing a document, not redeploying the
harness.

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
  --expect-tools "tool_write,tool_install" --headed --keep-open
```

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
- **Undo.** History makes "revert what the agent just did" possible; nothing
  implements it.
- **Large documents.** Reads truncate at 24k characters with a `shapeOnly`
  mode to orient, but there is no paging or query-within, so a chat with
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
