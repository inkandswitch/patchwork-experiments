# Agent

An agentic harness that lives inside Patchwork. A session is a document, the
loop that runs it is leased so another runner can take it over, and its tools
read and write automerge documents — including the documents that are
Patchwork's own tools.

It runs in a tab, in a SharedWorker shared by every tab, and in node with no
browser open. The same session can move between them mid-flight.

## The contract

Four pages say what the code promises. Each describes the code as it is.

| | |
|---|---|
| [SESSION.md](SESSION.md) | the session document: its fields, turns and blocks, a call's life, status, stops, the lease, approval |
| [TOOLS.md](TOOLS.md) | a tool: what it declares, what it is handed, what it returns, and how a package contributes one |
| [WORKFLOW.md](WORKFLOW.md) | the plan document: steps, their states and transitions, what the orchestrator is told, the driver, money, research steps |
| [HISTORY.md](HISTORY.md) | how it came to be this way. Append-only; nothing in it is a promise |

## Layers are directories

A module imports from its own directory and the directories below it, and from
nowhere else. `boundary.test.js` holds the order and fails on anything that
breaks it, tests included: a test lives in the lowest layer that holds what it
imports, so `vitest run kernel/` needs the kernel and what is under it.

Lowest first:

| | |
|---|---|
| `host/` | Patchwork's modules and context, wherever this is running: a page, a worker with no importmap, node |
| `net/` | where a request may go (`guard.js`), the fetch relay, and what an interruption is |
| `documents/` | what documents hold, read and written with no session in sight: URLs, values, edits, history, files, images, PDFs, citations |
| `session/` | the session document as plain data: its shape, blocks, calls, status, approval, the request sent to a model, the lease |
| `kernel/` | running a session: the store, the loop, the runner, tools as the loop sees them, which tools a session is offered, research confinement |
| `providers/` | model providers, which turn the kernel's request into theirs |
| `tools/` | tool definitions |
| `knowledge/` | notes, usage guides and skills: tools, and what they add to the prompt |
| `workflow/` | plans, and the driver that runs their steps as sessions |
| `assembly/` | the agent put together: the built-in tools, plugin loading, the prompt's sections |
| `runners/` | a tab, the SharedWorker and its page-side client, node |
| `ui/` | views: the session, the workflow, the pop-over, the panel |

`index.js` at the root registers the plugins and is above them all.
`fixtures/` holds what tests share; `probes/` drives the real thing in a
browser or in node; `scripts/` vendors the two bundled engines.

## Running it

```sh
pnpm install
pnpm test                                    # every unit and mount test, no network
npx vitest run kernel/                       # one layer and what is under it
node probes/worker-plugin-tool.mjs           # the SharedWorker runner in headless Chrome, served from disk
node probes/session-view.mjs                 # the session view in headless Chrome: clicks, typing, redraws
OPENROUTER_KEY_FILE=… node probes/patchwork-e2e.mjs    # the whole thing, in real Patchwork
```

Tests run on Node 24. The probes that open a browser use the Chrome installed
on the machine and take one at a time.

Without a browser:

```sh
OPENROUTER_API_KEY=… pnpm runner automerge:<sessionUrl>
OPENROUTER_API_KEY=… pnpm runner --watch automerge:<folderUrl>
```

A node runner claims sessions the way a tab does, and a browser can take one
back. It has no origin policy, so web tools fetch directly and the guard is all
that stands between a tool and the machine's network; and it has no DOM or
plugin registry, so a call that needs the page parks until a tab takes it.

## Installing

```sh
pushwork sync        # publishes the package; prints its automerge: URL
pushwork url
```

Add that URL to your account's module settings (the Packages tool, or
`pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"`).

A model key is kept in the browser's storage and handed to a runner; it never
enters a document. `web_search` needs a Brave Search API key and, in a
browser, the fetch relay (`fetch-relay/` beside this package).
