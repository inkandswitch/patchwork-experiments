# Tools

A tool is a plain object. Everything the agent does to anything outside its
own transcript, it does through one.

    {
      id, name, description, input_schema,     what the model is shown
      where, risk,                             who can run it, and whether it asks
      target?, group?, groupCovers?,           what a call is about, for approval
      alwaysAsk?, askWhen?,
      scoped?, needs?,                         which sessions are offered it
      present?,                                how its calls read in the log
      execute(input, ctx),
      summarize?(input, output),
    }

`kernel/tool.js` is the contract as the loop sees it. The built-in tools are
in `tools/`, `knowledge/` and `workflow/tools.js`, and `assembly/builtin.js`
lists them. A package contributes one as a plugin (*A package's tool*).

## What a tool declares

Every field below is data, read by the kernel. No list of tool ids anywhere
decides anything about a tool.

| field | |
|---|---|
| `where` | `"worker"`: a repo is all it needs, so it runs in the burst, wherever that is. `"host"`: it needs a page (a DOM, mounted views); a burst parks it for one (*Where a call runs*) |
| `risk` | `read`, `self`, `edit`, `write` or `external`: whether its calls wait for the person ([SESSION.md](SESSION.md), *Approval*) |
| `target` | which document a call is about: `"none"`, or `{ fields: [...], fallback?: "subject", kind? }`, the first of those input fields that is given. Undeclared, it is `input.url`, else `input.root` |
| `group`, `groupCovers` | the name its grants are shared under with other tools that mean the same decision to a person (`web`, `files`), and what a grant on the whole group allows, in words |
| `alwaysAsk` | `true`, or a function of the input: this call asks every time, whatever is granted |
| `askWhen` | for an `edit` tool, a function of the input naming the calls that write source code, which need a grant |
| `scoped` | `true`: a research step may have it too. `"only"`: a research step alone. Absent: full-access sessions alone |
| `needs` | what it needs of the session, by name (`session/capabilities.js`) |
| `asksHuman` | its call is a question to the person, answered and never approved |
| `present` | `{ verb, detail, body?, format? }`, each a string or a function of the input: how a call reads in the log, and how it opens — `body` names a layout for its input (`files`, `edits`, `question`), `format` says what its result's text is (`markdown`, or a language such as `js`). It is worked out when the call is written and kept on the call, since a view has only the document. A package's tool exports `present` beside `execute` |

### Which sessions are offered a tool

`kernel/toolset.js` decides, from the declarations and the session document:

- A **full-access session** is offered every built-in not marked `scoped:
  "only"`, and every plugin, less what its `tools.enabled` / `tools.disabled`
  leave out.
- A **research step** (`session.scope`) is offered the built-ins that declare
  `scoped`, and the plugins that declare `scoped: true` and `where: "worker"`.
  What the session says about its tools is not consulted.
- A session **placed on a worker** (`tools.where`) is offered only tools
  declared `"worker"`.
- A tool with `needs` is offered only to a session that has all of them:

| need | a session has it when | a built-in is handed |
|---|---|---|
| `workflows` | its Workflows switch is on, and it is not itself a step | `ctx.workflows`: the real repo, how the page asks for a step's work and follows its session (neither in a burst), every tool the run has |
| `step` | it is a step of a plan | nothing: it only decides the offer |
| `session.write` | it is a full-access session | `ctx.session` with `change` |
| `watches` | it is a full-access session | `ctx.watches`: the session's `watches` map, writable |

Only a run's built-ins are handed what a need stands for. A plugin gains
nothing by naming one.

`assembly/toolset.test.js` writes out the lists these declarations add up to,
so a declaration cannot change one unnoticed.

## What a tool is handed

`execute(input, ctx)`. `ctx` is the run's context for the session: a burst's
(`runners/session-task.js`, in a browser's run worker or a Node host's thread)
or a page's for a parked call (`runners/page.js` pageContext). It is
a value: frozen, and the same for every tool of the session. A tool keeps
nothing on it; what a later call must know goes in the result's `facts`, or
in a document.

| | |
|---|---|
| `ctx.repo` | the repo. For a full-access session it refuses to change a session, a plan or a research ledger, or to make a document into one (`kernel/kernel-repo.js`), and records each write as the session's own. Nor does it read, export, clone or merge a session's task (a task under an `agent:` key): its input holds its asker's keys |
| `ctx.subject` | the document the session is about |
| `ctx.session` | `{ url, doc() }`: this conversation, to read |
| `ctx.signal` | aborted when the person stops the run, or its task is cancelled or taken by another run |
| `ctx.events` | how to tell the session something later (*Waking the session*). In a burst it only records: what is opened there delivers nothing |
| `ctx.recall` | earlier results of this session, in full |
| `ctx.hasTool(id)` | whether the session was offered a tool |
| `ctx.fetchImpl` | the only way to the network: a guarded fetch (`net/guard.js`). There is no fallback to the platform's |
| `ctx.search`, `ctx.direct` | web search, with the key from the task's input or the page, and whether fetches reach sites directly (a Node host, or the relay) |
| `ctx.rootFolderUrl`, `ctx.sensitiveDocs` | the account's root folder, and the documents that always ask |
| `ctx.splice`, `ctx.automerge` | automerge's `splice`, everywhere; the host's whole automerge, initialised, in a page only. Take them from here: a worker cannot resolve a bare `@automerge/automerge` |
| `ctx.plugins` | the plugin registry module, in a page only |
| `ctx.packageOf(type, id)` | the package a plugin came from: `{ url, heads, name }`. In a burst, for an agent tool only, from the input's catalogue |
| `ctx.skillsFolderUrl`, `ctx.skillRegistry`, `ctx.notesFolderUrl` | where the person's skills and notes are kept, and the skills packages bring. No host gives `notesFolderUrl`, so notes go in a folder in the account's root |
| `ctx.element`, `ctx.getMount`, `ctx.pageFetch` | in a page only: where a host tool mounts, the views `view_mount` opened, and a fetch of the page's own origin for `plugin_source` |
| `ctx.reader` | the reader service a fetch goes through when it is not direct, where a host replaces the default |
| `ctx.importModule`, `ctx.importMap`, `ctx.packageBaseUrl`, `ctx.workerPreparation`, `ctx.runBundle`, `ctx.runInWorker` | how this host loads and runs a package's code, where it replaces the platform's way (`package_build`, `package_test`, `tool_check`) |
| `ctx.scope` | in a research step only: `{ stepId }` |
| `ctx.workflows`, `ctx.watches` | only for a tool that declares the need (above) |

A burst has no `automerge`, `plugins`, `element` or page; its skills come from the
catalogue, named and read only in a page. A tool reaches nothing global: a
`"worker"` tool that touches `document`, the platform's `fetch` or a bare
import works in a page by accident and nowhere else.

**A research step's tools get a confined context instead**, built from the
session's `scope` and nothing else (`kernel/scope.js` `confine`): `repo`,
`fetchImpl`, `search`, `direct`, `events`, `signal`, `scope`, and per call
`recall` and `hasTool`. Its `repo` is `{ find, create2, sources }` and opens
only what its plan's ledger of kept things holds, at the heads recorded
there; what it makes goes into that ledger ([WORKFLOW.md](WORKFLOW.md),
*Research steps*). It has no subject, no account, no session and no page, so
nothing of the person's can reach what it fetches. Declaring `scoped: true`
is a package's word that its tool works through that context alone.

## What a tool returns

A string, or `{ text, image?, file?, doc?, made?, facts? }`:

| | |
|---|---|
| `text` | what the model reads |
| `image` | a data URL, sent to the model as an image |
| `file` | `{ url, name, mimeType }`: a document the model reads itself (a PDF), loaded for each request |
| `doc` | `{ url, name, kind, ... }`: the document the call made or kept, linked beside the call and recorded in the session's `made` |
| `made` | every document it made, when there are several |
| `facts` | what the call did, as plain data for code to read: a view beside the call, a hook after it, the tool's own summary. Kept on the result block. |

- Throwing is how a tool fails: the model is shown `Error: <message>` and
  goes on. Say what to do instead.
- Throwing an `Interruption` (`net/network.js`) says the network is away: the
  call had no effect, nothing is written, and it runs again when the network
  is back.
- `summarize(input, output, facts)` gives the one line the transcript shows
  for the call. Without one it is `<id> ok`.
- `text` is for the model and nothing parses it. What code needs from a call
  goes in `facts`: `mountId`, `mounted` (the view a call opened), `plugins` (the
  `{ type, id }` of each plugin it used), `listed` (those it only listed),
  `package` (a package folder it worked from). The last three are how a
  call brings its package's usage guide (`knowledge/guides.js`).
- Anything large belongs in a document the result points at, not in the
  result: a result travels with every later turn until it is tapered.

## Waking the session

A call is the agent asking. A tool that watches something tells the agent
later through `ctx.events`: it opens a channel (`ctx.events.open(key, { label
})`) and calls `notify` as often as it likes. `kernel/events.js` decides when
that becomes a wake, since each is a model call over the whole conversation:
notices on a channel fold together, wait for things to settle, and are
rate-limited; and a session that is running, waiting on a person or failed is
not woken. The events are a page's: the page that shows or drives the session
(`runners/page.js` follow) owns them, opens the session's `watches` again
whenever they change, and asks for the work a wake makes. A burst's events
only record: `doc_watch` in a burst writes the watch into `watches`, and the
page listens. A watch
leaves out edits whose change hashes the run reported as its own.

## Where a call runs

- A `"worker"` call runs in the burst's pool run: claimed under the run's id,
  run with the tool's signal tied to the run's, and its move, result and
  `made` written in one change. A batch shares one tool turn.
- A call that waits on a person (approval, a question) ends the burst; the
  answer is a write of work, and asks again.
- A `"host"` call, and every plugin's (a burst imports no plugin code), parks:
  the burst clears `burst` and ends. A page that shows the session, or drives
  its plan, runs it: it writes `burst` to a fresh claim id, waits a beat, and
  only if the claim still stands runs the call with its own context and
  writes its move, result and `made` and clears `burst` in one change; then
  it asks. So page and plugin tools run while the session is shown, or its
  plan is driven, in a page.
- A call naming a `mountId` is taken at once only by the page that has that
  mount; another waits one more beat and answers that there is no such mount.
- A page going away abandons the call it holds, INTERRUPTED. A claim slower
  than a beat may run a call twice; the request sends one result.

## A package's tool

A package registers an `agent:tool` plugin beside its views and datatypes:

    {
      type: "agent:tool",
      id, name, description, input_schema, where, risk,
      target?, group?, groupCovers?, alwaysAsk?, scoped?,
      async load() { return (await import("./agent.js")).default },   // { execute, summarize? }
    }

- The metadata is plain JSON at the top level, because the host clones plugin
  entries into a worker; the code is behind `load()`. `kernel/tool.js`
  `PLUGIN_FIELDS` is what is read.
- It cannot take a built-in's id.
- Its code is looked up again at every call, so a package edited mid-run runs
  as it is now, and one that no longer loads says so.
- A burst is handed every entry's metadata in its input's catalogue
  (`assembly/plugins.js`): it offers the tool as declared, and parks every
  call to it for a page, where the registry loads the code.
- `risk` defaults to `write`, `where` to `"worker"`.
