# Agent

An agentic harness that lives inside Patchwork. A session is a document, its
work runs as tasks on the person's own queue, and its tools read and write
automerge documents — including the documents that are Patchwork's own tools.

## Where it runs

One task is one burst of one session (`kernel/burst.js`): from "there is work"
until the session waits on a person, has nothing to do, is stopped, or has a
call only a page can run. Whoever writes work asks for it (`runners/ask.js`
askWork, through `runners/page.js` askFor) under the key `agent:<session>` on
their own queue, from any tab, and a pool takes it: that browser's pool, in
the run worker of whichever tab holds it, or another of the person's machines
serving the queue (a browser, or a Node host's thread). No burst runs in the
page that asks. `runners/session-task.js` is the task's entry.

- With no network it is the same: the queue and the session are written in
  this browser, its pool takes the task, and the burst runs up to its model
  request, which waits for the network (SESSION.md, `reconnecting`).
- Where the tasks package is not installed in the browser, the work is still
  asked of the person's queue and waits there for another of their machines;
  the line under the composer says so.
- Asking under a key whose task has not ended is asking once, so any number of
  views and writers may ask; a re-ask needs heads no ended task saw.
- An ask that fails (no account open, nowhere to keep the queues, the list of
  queues not on this device in time, a task that threw) is said under the
  composer, in words without urls, and asked again on the next change or when
  the network is back, within the same rule.
- The session holds no lease. A run writes only once the task system says it
  holds the task, only while its signal stands, never under a stop; it marks
  the session `burst: { run }` (SESSION.md, *The burst mark*).
- A call that needs a page parks; a page that shows the session, or drives its
  plan, runs it and asks again (TOOLS.md, *Where a call runs*).
- Stop is a notice written into the session from any page or device, then the
  task stopped on the stopper's queue. A run hears the notice and stops.
- Closing a page does not stop a burst: the pool's run carries on, and another
  pool takes the task again if its own goes.

The model key, the search key and the fetch relay travel in the task's input,
readable by everyone who can read the person's queue (the person), and a burst
holds them only in its locals. They never enter the session.

## The contract

Four pages say what the code promises. Each describes the code as it is.

| | |
|---|---|
| [SESSION.md](SESSION.md) | the session document: its fields, turns and blocks, a call's life, status, stops, the burst mark, approval |
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
| `host/` | Patchwork's modules and context, wherever this is running: a page, a run worker, Node; the task system's client and rules (kit copies, `scripts/check-kit.mjs` at the repo root) |
| `net/` | where a request may go (`guard.js`), the fetch relay, and what an interruption is |
| `documents/` | what documents hold, read and written with no session in sight: URLs, values, edits, history, files, images, PDFs, citations |
| `session/` | the session document as plain data: its shape, blocks, calls, status, stops, debris, approval, the request sent to a model |
| `kernel/` | running a session: the store, the loop, a burst, tools as the loop sees them, which tools a session is offered, research confinement |
| `providers/` | model providers, which turn the kernel's request into theirs |
| `tools/` | tool definitions |
| `knowledge/` | notes, usage guides and skills: tools, and what they add to the prompt |
| `workflow/` | plans, and the driver, in every page that has a plan open, that asks for their steps as sessions |
| `assembly/` | the agent put together: the built-in tools, plugin loading, the prompt's sections |
| `runners/` | the session's task entry, asking for its work, and what a page does for a session it shows or drives |
| `ui/` | views: the session, the workflow, the pop-over, the panel |

`index.js` at the root registers the plugins and is above them all.
`fixtures/` holds what tests share; `probes/` drives the real thing in a
browser or in node; `scripts/` vendors the two bundled engines.

## Running it

```sh
pnpm install
pnpm test                                    # every unit and mount test, no network
npx vitest run kernel/                       # one layer and what is under it
node probes/session-task-node.mjs            # bursts on two Node hosts, a stand-in model (tasks/ built)
node probes/session-task-browser.mjs         # a burst in a browser pool's run worker (tasks/ built)
node probes/session-task-second-tab.mjs      # askWork from a tab not holding the pool, no network (tasks/ built)
node probes/session-view.mjs                 # the session view in headless Chrome: clicks, typing, redraws
OPENROUTER_KEY_FILE=… node probes/patchwork-e2e.mjs    # the whole thing, in real Patchwork
```

Tests run on Node 24. The probes that open a browser use the Chrome installed
on the machine and take one at a time.

Without a browser open, a Node host serving the person's queue runs their
bursts (the tasks package's README):

```sh
node tasks/dist-node/host.mjs --queue <own queue> --accept <agent package> --workers 4
```

It gives a burst `nodeFetch` (every name resolved and checked, redirects
followed by hand, the sync servers refused) and Brave search with the input's
key. It runs no page or plugin tools: those calls park until a page takes them.

## Installing

```sh
pushwork sync        # publishes the package; prints its automerge: URL
pushwork url
```

Add that URL to your account's module settings (the Packages tool, or
`pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"`).

A model key is kept in the account's settings (or the browser's storage) and
put in each task's input by the page that asks; it never enters a session.
Work is asked of the person's own queue, which the tasks package makes on
first need, and runs in that browser's pool or on another of their machines
serving it. `web_search` needs a Brave Search
API key and, in a browser, the fetch relay (`fetch-relay/` beside this
package).
