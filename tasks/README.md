# tasks

Work done for you by another machine, or by your own browser in the background, kept in
Automerge documents. There are three things:

- A **task** is a document: where its code is (`importUrl`, anything `import()` takes: a package
  file, a `data:` URL), its `input`, the `key` it was asked under, and `runs`, the list of what has
  happened to it.
- A **queue** is a document listing the tasks asked of it that have not ended, each under its key.
  Whoever can write a queue can ask it for work and stop that work; whoever serves it runs that
  work. Ask only queues whose servers you trust with the input.
- A **pool** is the one set of workers a machine has: the tab of a browser profile that holds a
  Web Lock, or a Node process. It serves the queues it is told to, and has labels saying what
  kind of machine it is (`browser`, `node`, what a Node host was told it has, and `pool:<its
  id>`); it takes only a task whose `needs` it has every one of.

Only records are written: an asker lists a task under a key, or appends a stop to its `runs`; a
pool takes a task by appending a run, and later completes that run with how it went. Everything
else (who holds a task, whether it has ended, how) is read from that list and from what is heard
on the task's channel, where a pool says every two seconds that each of its runs is going on.
The promise: **at least once** (a pool that falls silent for ten seconds has its task taken
again), **a throw is final** (the task fails, once, and is not run again for it), and **a stop is
hard** (five seconds after code is told to stop, its worker is ended whatever it is doing).
Two more about documents: **what a run wrote can be found once its ending is read** (a run
worker says how its run ended, returned, threw or stopped, only once the sync server has
acknowledged every document its code changed, half a minute at most, after which the run's log
says how many had not reached it; with no server to reach, the log says what was written stays on
that machine), and **what a task is handed can be found** (its `ctx.repo.find` waits for a
document that has not arrived yet, for about half a minute, instead of rejecting at once).

**Mostly once**: asked of a queue that several of a person's devices serve, a task runs on one of
them, once, unless the device running it dies part way, or two devices cannot hear each other at
the moment it is listed (a device that started serving in the last two and a half seconds may not
have heard the others yet), and then it runs again, as at least once promises. The pools serving
a queue hear each other and agree on one to prefer for each task, among those with a free slot
(the one its asker is next to, or else the one a hash of the task's url and the pool's id picks).
Each decides this once, when it first sees the task: the one preferred takes it at once, and the
rest wait a second and a half from then before they may, so work beyond the preferred pool's
slots starts that much later. A pool that has served a queue for less than two and a half
seconds holds back for everything there, and one that stops says so, and is not waited for. A
task never fails for want of a device: one that needs what no pool serving its queue has waits,
and the queue browser says what it waits for.

## Asking for work

Everything an asker needs is in `src/task-client.js`, with the rules it applies in
`src/task-rules.js`. Each takes a Repo that can reach the queue: in a page the site's Repo, in
Node one of your own (`dist-node/task-client.mjs` is the same file built for Node).

- `run(repo, queueUrl, { importUrl, input, key, needs, near })` asks and waits: it resolves to
  the result, and rejects with the error when the task fails or is cancelled. An optional fourth
  argument hears every change on the way.
- `ask(repo, queueUrl, ask)` lists a task and returns `{ key, taskUrl }` without waiting. Asking
  under a key whose task has not ended is asking once; a key whose task has ended is asked afresh.
  `needs` is a list of plain labels a pool must have every one of to take the task (`['unix']`,
  `['ollama']`, `['pool:<id>']` for one machine in particular, such as the one that ran an
  earlier task and holds what it left on its disk); until a pool that has them serves the queue,
  the task waits. `near` is the id of a pool the asker would rather it ran on (its own browser's,
  or the one that ran a predecessor): that pool takes it at once when it can, and the others hold
  back for it. Both are copied onto the queue's entry.
- `watch(repo, queueUrl, key, onChange)` follows the key and calls `onChange` with its state
  (`waiting`, `running`, `stalled`, `stopping`, `succeeded`, `failed`, `cancelled`), progress,
  log lines, result and error. It returns how to stop watching.
- `cancel(repo, queueUrl, key)` stops the task under the key.
- `served(repo, queueUrl, onChange)` hears which pools serve the queue now, with what each has;
  an empty list, or none that has what a task needs, means that task waits.
- `ownQueue(repo, element)` gives a page the url of its person's own queue, served by their
  browsers for any code, making it the first time (see below).

```js
import { run, inSamePackage } from './task-client.js';

const sum = await run(repo, queueUrl, {
  importUrl: inSamePackage(import.meta.url, 'dist/sum-task.js'),
  input: { numbers: [1, 2, 3] },
  key: `sum:${docUrl}`,
});
```

```js
const stop = watch(repo, queueUrl, key, (view) => {
  show(view.state, view.progress, view.logs.at(-1)?.message);
});
```

A secret a task needs (an API key) goes in its input. Everyone who can read the queue can read it,
for good, so ask such work only of queues whose audience may have it.

## Writing a task

A task's code is a module whose default export is `async (input, ctx) => result` (`ctx` is also
`this`). The result is anything JSON can carry, up to 1 MB; more belongs in a document whose url
the task returns. `ctx` holds:

- `log(...)`: a line for the run's log, heard at once by watchers; the last 200 are kept.
- `progress(value)`: how far along it is, heard by watchers, not kept.
- `signal`: aborted when the run must stop, with `signal.reason` `'cancelled'` (someone stopped
  the task), `'yielded'` (another run has the task, or has ended it) or `'stopping'` (the
  machine's pool is shutting down, and the task will be taken again). Code holding something
  outside its worker (a child process, a file lock) lets go of it here.
- `repo`: the worker's own Repo, which already has the task's document. Its `find` waits for a
  document made elsewhere a moment ago (asking again for about half a minute, as `findWhenThere`
  in `task-client.js` does), so an input the asker has just made is found, not refused; a url it
  cannot read, or a `signal` passed to `find` aborting, ends the asking at once. What the
  code writes through it reaches the sync server before the run's ending is said: write, and
  return (or throw); there is nothing to flush or wait for. A stopped run's writes (a run document
  set to "cancelled" when `signal` aborts) are sent the same way, within the five seconds.
- `taskUrl`, `key`, and `run`, this run's id.

What a task's code may import depends on where it runs:

- On a Node host: relative and absolute paths (its own neighbours), Node's built-in modules
  (`node:fs`, `fs`), and by bare name only `@automerge/automerge`, `@automerge/automerge/slim`,
  `@automerge/automerge-repo` and `@automerge/automerge-repo/slim`, which are the host's own
  copies, the same module instances as `ctx.repo`'s. Any other bare name fails with an error
  naming what it may import. Code of a package given with `--local` also imports the other
  dependencies in its own `node_modules`.
- In a browser's pool: relative paths and URLs, and every name in the page's import map. On the
  site that includes `@automerge/automerge`, `@automerge/automerge-repo` and their `/slim` builds
  (all mapped to the slim builds, the same modules the run worker's Repo uses), and Patchwork's
  other externals.

So code that imports Automerge by bare name (to append to a text with `splice`, say) runs
unchanged on either; `probes/append-task.js` is such a task.

What must not happen twice guards itself. A run's id is in the task's `runs` before its code is
called, after every earlier run, so code can look there (and write its run's id beside its
effects) to know whether it is the second to try. `earlier(task, runId)` in `task-runs.js` reads
this for a long run kept in a document of its own. `src/tasks/wait.ts` is a small task to copy.

## Having work done from a page

A tool in a page needs three functions from `task-client.js`, each handed the site's Repo, and
never names a queue:

- `doWork(repo, { importUrl, input, key, needs }, { onProgress, signal })` has the work done.
  When the person has a queue of their own and a pool heard serving it has what the work needs,
  the work is asked of that queue as `run` would, near this browser's pool; otherwise work that
  needs nothing a page lacks (no needs, or only `browser`) is done in the page, by importing the
  same module and calling it; and work that needs more is asked of their queue all the same,
  where it waits for a device that has it (with no queue of their own, it rejects with a
  sentence naming what it needs). Either way it resolves to what the code returned and rejects
  with what it threw, `onProgress` hears the same views, and aborting `signal` stops it. Only
  code that can travel is asked of a queue: a file in a package kept in automerge, or a `data:`
  URL; any other url (a dev server's `http://localhost`, a `file:` url) is done in the page.
- `watchWork(repo, key, onChange)` follows the work under the key on the person's own queue, so
  that a page opened later, or another tab, shows work already going on instead of offering it
  again. It follows the person's queue as it changes (made, or lost, while the tool is open), and
  always says something within ten seconds: `missing` means no work under this key is known on a
  queue of theirs (no queue, nothing under the key, or a queue that cannot be had now, which it
  goes on looking for). It returns how to stop following.
- `stopWork(repo, key)` stops the work under the key on the person's own queue; false when there
  is none.

```js
import { doWork, watchWork, stopWork, inSamePackage } from './task-client.js';

const key = `fetch:${docUrl}`;
const unfollow = watchWork(repo, key, (view) => show(view.state, view.progress));

const stop = new AbortController();
const tiles = await doWork(
  repo,
  { importUrl: inSamePackage(import.meta.url, 'dist/fetch-task.js'), input: { area }, key },
  { onProgress: (view) => show(view.state, view.progress), signal: stop.signal },
);

// Cancel: this page's own work by its signal, work seen on the queue by its key
stop.abort();
await stopWork(repo, key);
```

Where it runs decides what the person gets, and what is known where. Asked of their queue, it
goes on when the page closes, is done once however many pages ask under one key, a stop ends it
for good, and every page of theirs sees it (`watchWork`) and can stop it (`stopWork`). Done in
the page, it is that page's alone: only the `onProgress` of the `doWork` call that started it
hears of it, another tab neither sees it nor can stop it, it ends with the page, and code that
does not heed `signal` runs on. `doWork` makes nothing: a person has a queue of their own only
once they have made one (Make my queue).

## Serving a queue

**In a browser.** Install the package through module settings (`pnpm build`, then `pnpm push` and
`pnpm register`). A page takes part in its browser's pool through the package's component
`task-pool-next` (`src/pool-starter.ts`), which draws nothing and is tagged `background`. A frame
mounts every `patchwork:component` tagged `background` once, inside its providers (so such a
component can ask for tool storage), with no chrome, for as long as the frame lives: the tiling
frame and threepane both do, and name no package to do it. Mounted, the component starts the
page's pool host (one per page, however many mount it); let go, the last one lets the pool go
(it takes nothing new, its runs end, and the lock passes on). Of the tabs taking part, the one
that holds the Web Lock `patchwork-tasks-pool` runs the pool, in a worker that runs tasks in run
workers it can end, and the others wait to take over. A browser's pool has `browser` and
`pool:<its id>`, so a task that needs anything else is left for a machine that has it. A frame
that mounts no background components takes no part: its pages run nothing, whatever they show.
Which queues it serves is kept in the account's tool storage for this package
(`account.toolStorage['tasks-next']`, a document Patchwork's frame makes the first time it is
needed). Its root is the list: each served queue is a key of its own, the queue's url, holding
`true` (any code) or `{ packages }`, and `own` names one's own queue. With nothing to make before
writing, changes made at once on devices that have not synced all keep: two joins both stand, two
settings of one queue keep one whole, and two Make my queue presses keep one pointer, to a served
queue. `servedOf`, `ownQueueOf`, `setServed` and `ownQueue` in `src/task-client.js` are the only code that
knows this. To serve a queue, open it in the Task Queue Browser and press Join queue; there you
also choose whose code it runs (any, or named packages) and Leave. With no queue, the titlebar
offers Make my queue. The tool storage comes from the frame's tool-storage provider
(`patchwork-tool-storage-provider`, which threepane and the tiling frame mount), asked from the
badge: where none is above it, the press waits five seconds for an answer ("Making your
queue…"), then says "This page has nowhere to keep your task queues, so nothing was changed."
and offers it again, having written nothing.

What a person sees of it, each read from what is (this page's pool host, the storage document,
the queue's document, what is heard on the queue's channel), and never starting anything:

- **The badge** (a title bar tool, and the same as a `system-tray` component) shows, for each
  served queue, how many tasks it lists and what this browser's pool is doing: running here
  (with how many runs), served by another tab, finishing up (handing over to a newer build, or
  let go), or not running here, with why in its tooltip (nothing in this frame has started it;
  this browser cannot keep its tabs to one pool; the pool could not start, with what it said and
  when it tries again). It opens the queue browser.
- **The queue browser** (the Task Queue Browser tool) shows the pools heard serving the queue
  (name, slots, busy, what each has; this browser's marked), a line saying what this browser's
  pool is doing in this page and why, whether this person's browsers serve the queue, and each
  listed task: its state (waiting, with what it needs when no pool heard has it; stalled, with
  since when this view has seen it so), its records (which pool took it, when, how it went; a
  stop as a stop), its log, and a Stop while it has not ended.

**On a machine.** `pnpm build:node`, then `node dist-node/host.mjs` with:

- `--queue automerge:…` a queue to serve; repeat for more.
- `--accept automerge:<package>` run code in that package, at any version; repeat for more.
- `--accept-any` run whatever a queue's tasks bring, `data:` URLs included.
- `--new-queue "title"` make a queue, print its url, and serve it.
- `--local automerge:<package>=<dir>` run that package's code from this directory instead of
  fetching it from automerge, whichever version a task names; it also accepts the package. For a
  machine with the package checked out and installed beside the programs its code drives (a
  solver).
- `--workers 1` how many tasks run at once, each in a worker thread.
- `--max-heap-mb 4096` the most each thread's heap may grow to; a task that needs more loses its
  run, not the host.
- `--data-dir ~/.patchwork-tasks` where everything is kept: the pool's documents (`pool/`),
  each thread's (`slots/<n>/`), fetched code (`code/`), the pool's id (`pool-id`) and the pid
  (`host.pid`). The id is what lets a restarted host record the runs it lost; one host to a
  directory.
- `--code-dir <dir>` where fetched code goes, if not under the data directory.
- `--name <name>` what views call this pool (the machine's hostname).
- `--has unix,ollama` what this machine has, as plain labels: a task that needs a label runs only
  on a pool that has it. Repeat it, or separate labels with commas. A host always has `node` and
  `pool:<its id>`, and prints what it has as it starts.
- `--sync wss://…` the sync server (`PATCHWORK_SYNC`, or Ink & Switch's).
- `--verbose` say more.

A host needs at least one `--queue` or `--new-queue`, and says whose code it runs: `--accept` or
`--local` packages, or else `--accept-any`, never both. SIGINT or SIGTERM stops it: its runs are
told `stopping`, their threads ended at most five seconds later, and each run recorded lost, to be
taken again. What a run that has ended wrote is on the sync server already, so a host stopped
the moment a run reads succeeded loses none of it, unless that run's log says some of it had not
reached the server in half a minute, or that it stayed on the machine (its thread was not
connected to the server as the run ended).

## Using it from another package

A package never imports this one. It carries copies of the kit files in its own `src/`:
`task-rules.js` and `task-client.js` to ask for work, and `task-runs.js` too for a long run kept in
a document of its own (openfoam and fea do). Each says `[kit: <name> v<N>]` in its header. The
canonical copies are here; `node scripts/check-kit.mjs` at the repository root fails when a copy
differs, and `--fix` copies the canonical ones over. Change a canonical file, bump its version,
and commit the copies with it.

## The rules, and what is not here

The header of `src/task-rules.js` is the contract: what is written, what is read, when a pool
takes, stops or gives way, and what ends a task. Its functions are the only place those rules are
written down. What is deliberately not here yet (confining code, a worker per run, queues one
only asks of) is in `PLANS.md`, each with what it waits on.

## Tests and probes

`pnpm test` runs the unit tests (rules, client, pool, workers, views). The probes run real
processes and say what they saw, one line per check or measurement:

- `probes/node-run.mjs` (after `pnpm build:node`; `--only 1,16` runs only the checks named):
  Node hosts through the real sync server, 20 checks. 1, latency of ten do-nothing tasks on a
  host alone that has served the queue for two and a half seconds, none taken as late as the
  hold (and how long the first task, asked as the host started, waited); 2,
  logs and progress heard while running and kept; 3, a throw fails once; 4, a spin cancelled,
  its thread ended within the grace; 5, a child process gone on cancel; 6, SIGTERM records the
  run lost and exits in time, a restart runs it again, and a guarded task fails rather than run
  twice; 7, kill -9 and a restart take it again; 8, two hosts fail over; 9, two hosts share four
  tasks listed at once, one run each and none yielded; 10, `served()` lists a host, and drops it
  within a second of its stopping, on its last word that it has no slots; 11, a second host on one data directory refuses; 12, code a host does not accept
  is never taken; 13 to 15, 1 MB written by a task is found at the asker's first find, also from
  a host stopped the moment its run reads succeeded; 16, a task whose document reaches the
  server after its listing is taken within 1.5 s; 17, ten tasks needing a label only one of two
  hosts has all run there, once each; 18, a task needing a label no host has stays listed,
  untaken, until a third host with it starts and runs it; 19, a task asked `near` a host runs on
  that host; 20, four tasks asked at once near a host with two slots run two there and two on
  the other host, each once and none yielded (when each run started is printed, not checked:
  the other host takes its two at once if it heard the first full before it saw them, and
  otherwise a hold later). Checks 9, 17 and 19 print when each run started, too.
- `probes/write-path.mjs` (after `pnpm build:node`): measures, and checks nothing, how a
  document travels between a task on a Node host and its asker through the sync server, per
  size: written by the task (`out`), made by the asker for the task (`in`), twenty at once
  (`many`), with the task waiting for the server (`ack`), and from a host stopped the moment
  the asker reads succeeded (`term`). `probes/write-path/browser.mjs` (after `pnpm build`, in
  the chrome slot) measures `out`, `in` and `ack` for a browser's run worker.
- `probes/browser-run.mjs` (after `pnpm build`, in the chrome slot): the built package on a
  stand-in page in a throwaway Chrome profile, with no sync server but for check 22, 22 checks. The page mounts
  what a frame does: the components the package tags `background`, found by tag in its plugin
  list (the page has no registry), and the titlebar tool. One pool per profile across tabs; a
  closed, navigated, frozen or hidden holder tab; a newer build taking over; cancel of spinning
  code, also code that read and wrote through `ctx.repo`; two run workers at once; a run that
  wrote with no server to reach says so; a pool worker that errors or dies; `served()` and the
  queue browser; Make my queue and Join, on an account that serves nothing and so starts no
  pool; with only the badge mounted no pool runs and the badge and queue browser say why; the
  background component mounted later starts it, and let go lets the lock go; and (22) a run
  worker runs `probes/append-task.js` unchanged, through the page's import map and the real
  sync server (`--sync`, `PATCHWORK_SYNC`, or Ink & Switch's), and the page sees the text it
  appends to grow piece by piece.
- `probes/real-run.mjs <automerge:package url>` (in the chrome slot): a published copy of the
  package (a staging package will do) in the real Patchwork, https://patchwork.inkandswitch.com/,
  in a throwaway profile, 22 checks, the last two that neither the page nor the task system's
  workers logged an error of the task system's. It installs the package through the profile's module
  settings and records what the site's frame does with it; presses Make my queue on a badge with
  no tool-storage provider above it; mounts a `patchwork-tool-storage-provider` of its own on the
  account and, inside it, the background component and the badge, as a frame mounts them (it
  does not rely on the site's frame to), sees that serving nothing it starts no pool worker, and
  makes the profile's queue with that badge.
  Then: the pool worker and the run workers load from the package through the site's service
  worker; ten do-nothing tasks are asked through this tab's tasks Repo and ten through the
  site's own (keyhive) Repo; the package's own task module, a throw, a spin cancelled and its
  run worker gone, serving only named packages, `served()`, and the queue browser's and badge's
  lines; documents tasks write reach the site's Repo, their run workers (one started for its
  run) having waited for the server's acknowledgement; `doWork`, `watchWork` and `stopWork` from
  the page.
- `probes/append-run.mjs` (after `pnpm build:node`): a Node host, through the real sync server,
  runs `probes/append-task.js` as a `--local` file and as a `data:` URL; the asker sees the text
  grow piece by piece, and its history is one append at the end per piece.
  `probes/append-check.js` is how this probe and browser-run's check 22 read the text.
- `probes/solve-task.mjs`: a task that runs a child process, used by `node-run.mjs`
  (`probes/solve-task-lib.mjs`, a neighbour it imports, shows that a task's code can be more
  than one file).
- `probes/cdp.mjs` and `probes/chrome-guard.mjs`: how the browser probes start, drive and always
  close a throwaway Chrome.
