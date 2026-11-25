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
| `where` | `"worker"`: a repo is all it needs, so it runs wherever the session does. `"host"`: it needs the page (a DOM, mounted views). A runner that cannot run a call leaves it for one that can |
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
| `workflows` | its Workflows switch is on, and it is not itself a step | `ctx.workflows`: the real repo, the step starter, every tool the runner has |
| `step` | it is a step of a plan | nothing: it only decides the offer |
| `session.write` | it is a full-access session | `ctx.session` with `change` |
| `watches` | it is a full-access session | `ctx.watches`: the session's `watches` map, writable |

Only a runner's built-ins are handed what a need stands for. A plugin gains
nothing by naming one.

`assembly/toolset.test.js` writes out the lists these declarations add up to,
so a declaration cannot change one unnoticed.

## What a tool is handed

`execute(input, ctx)`. `ctx` is the runner's context for the session. It is
a value: frozen, and the same for every tool of the session. A tool keeps
nothing on it; what a later call must know goes in the result's `facts`, or
in a document.

| | |
|---|---|
| `ctx.repo` | the repo. For a full-access session it refuses to change a session or a plan, or to make a document into one (`kernel/kernel-repo.js`), and records each write as the session's own |
| `ctx.subject` | the document the session is about |
| `ctx.session` | `{ url, doc() }`: this conversation, to read |
| `ctx.signal` | aborted when the person stops the run |
| `ctx.events` | how to tell the session something later (*Waking the session*) |
| `ctx.recall` | earlier results of this session, in full |
| `ctx.hasTool(id)` | whether the session was offered a tool |
| `ctx.fetchImpl` | the only way to the network: a guarded fetch (`net/guard.js`). There is no fallback to the platform's |
| `ctx.search`, `ctx.direct` | web search, and whether fetches reach sites directly (node, or a tab with the relay) |
| `ctx.rootFolderUrl`, `ctx.sensitiveDocs` | the account's root folder, and the documents that always ask |
| `ctx.automerge`, `ctx.splice` | the host's automerge, initialised. Take it from here: a worker cannot resolve a bare `@automerge/automerge` |
| `ctx.plugins` | the plugin registry module. In the SharedWorker, a mirror of the page's |
| `ctx.packageOf(type, id)` | the package a plugin came from: `{ url, heads, name }` |
| `ctx.skillsFolderUrl`, `ctx.skillRegistry`, `ctx.notesFolderUrl` | where the person's skills and notes are kept, and the skills packages bring |
| `ctx.element`, `ctx.getMount`, `ctx.pageFetch` | in a tab only: where a host tool mounts, the views `view_mount` opened, and a fetch of the page's own origin for `plugin_source` |
| `ctx.reader` | the reader service a fetch goes through when it is not direct, where a host replaces the default |
| `ctx.importModule`, `ctx.importMap`, `ctx.packageBaseUrl`, `ctx.workerPreparation`, `ctx.runBundle`, `ctx.runInWorker` | how this host loads and runs a package's code, where it replaces the platform's way (`package_build`, `package_test`, `tool_check`) |
| `ctx.scope` | in a research step only: `{ stepId }` |
| `ctx.workflows`, `ctx.watches` | only for a tool that declares the need (above) |

A node runner has no `plugins`, `automerge` module or page. A tool reaches
nothing global: a `"worker"` tool that touches `document`, the platform's
`fetch` or a bare import works in a tab by accident and nowhere else.

**A research step's tools get a confined context instead**, built from the
session's `scope` and nothing else (`kernel/scope.js` `confine`): `repo`,
`fetchImpl`, `search`, `direct`, `events`, `signal`, `scope`, and per call
`recall` and `hasTool`. Its `repo` is `{ find, create2, sources }` and opens
only what the plan's ledger of kept things holds, at the heads recorded
there. It has no subject, no account, no session and no page, so nothing of
the person's can reach what it fetches. Declaring `scoped: true` is a
package's word that its tool works through that context alone.

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
not woken.

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
- A `"worker"` tool runs in the SharedWorker too: the page sends the worker
  each entry's metadata and the worker loads the code itself. Code that
  cannot load there keeps its declaration and has its calls run by a tab.
- `risk` defaults to `write`, `where` to `"worker"`.
