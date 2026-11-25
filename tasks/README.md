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
  Web Lock, or a Node process. It serves the queues it is told to.

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

## Asking for work

Everything an asker needs is in `src/task-client.js`, with the rules it applies in
`src/task-rules.js`. Each takes a Repo that can reach the queue: in a page the site's Repo, in
Node one of your own (`dist-node/task-client.mjs` is the same file built for Node).

- `run(repo, queueUrl, { importUrl, input, key })` asks and waits: it resolves to the result, and
  rejects with the error when the task fails or is cancelled. An optional fourth argument hears
  every change on the way.
- `ask(repo, queueUrl, ask)` lists a task and returns `{ key, taskUrl }` without waiting. Asking
  under a key whose task has not ended is asking once; a key whose task has ended is asked afresh.
- `watch(repo, queueUrl, key, onChange)` follows the key and calls `onChange` with its state
  (`waiting`, `running`, `stalled`, `stopping`, `succeeded`, `failed`, `cancelled`), progress,
  log lines, result and error. It returns how to stop watching.
- `cancel(repo, queueUrl, key)` stops the task under the key.
- `served(repo, queueUrl, onChange)` hears which pools serve the queue now; an empty list means
  what is asked of it waits.
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

What must not happen twice guards itself. A run's id is in the task's `runs` before its code is
called, after every earlier run, so code can look there (and write its run's id beside its
effects) to know whether it is the second to try. `earlier(task, runId)` in `task-runs.js` reads
this for a long run kept in a document of its own. `src/tasks/wait.ts` is a small task to copy.

## Having work done from a page

A tool in a page needs three functions from `task-client.js`, each handed the site's Repo, and
never names a queue:

- `doWork(repo, { importUrl, input, key }, { onProgress, signal })` has the work done. When the
  person has a queue of their own and a pool is heard serving it, the work is asked of that queue
  as `run` would; otherwise the same module is imported and called in the page. Either way it
  resolves to what the code returned and rejects with what it threw, `onProgress` hears the same
  views, and aborting `signal` stops it. Only code that can travel is asked of a queue: a file in
  a package kept in automerge, or a `data:` URL; any other url (a dev server's `http://localhost`,
  a `file:` url) is done in the page.
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
`pnpm register`). Its titlebar tool, or the same thing as a system-tray component, starts the
page's pool host; the one tab of the profile that holds the Web Lock `patchwork-tasks-pool` runs
the pool, in a worker that runs tasks in run workers it can end, and the others wait to take over.
Which queues it serves is kept in the account's tool storage for this package
(`account.toolStorage['tasks-next']`, a document Patchwork's frame makes the first time it is
needed). Its root is the list: each served queue is a key of its own, the queue's url, holding
`true` (any code) or `{ packages }`, and `own` names one's own queue. With nothing to make before
writing, changes made at once on devices that have not synced all keep: two joins both stand, two
settings of one queue keep one whole, and two Make my queue presses keep one pointer, to a served
queue. `servedOf`, `ownQueueOf`, `setServed` and `ownQueue` in `src/task-client.js` are the only code that
knows this. To serve a queue, open it in the Task Queue Browser and press Join queue; there you
also choose whose code it runs (any, or named packages) and Leave. With no queue, the titlebar
offers Make my queue.

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
written down. What is deliberately not here yet (holding back for a preferred pool, what a task
needs of a machine, confining code, a worker per run, queues one only asks of) is in `PLANS.md`,
each with what it waits on.

## Tests and probes

`pnpm test` runs the unit tests (rules, client, pool, workers, views). The probes run real
processes and say what they saw, one line per check:

- `probes/node-run.mjs` (after `pnpm build:node`): Node hosts through the real sync server.
  Latency; logs and progress heard; a throw fails once; cancel ends the thread in time and kills
  a child process; SIGTERM and kill -9 lose the run and a restart takes it again; two hosts fail
  over and share four tasks with one final run each; `served()`; a second host on one data
  directory refuses; code a host does not accept is never taken.
- `probes/browser-run.mjs` (after `pnpm build`, in the chrome slot): the built package on a
  stand-in page in a throwaway Chrome profile. One pool per profile across tabs; a closed,
  navigated, frozen or hidden holder tab; a newer build taking over; cancel of spinning code;
  tasks writing through `ctx.repo`, with no server to reach; a pool worker that errors or dies;
  Make my queue and Join.
- `probes/real-run.mjs`: the same in the real Patchwork, from a published copy of the package.
- `probes/solve-task.mjs`: a task that runs a child process, used by `node-run.mjs`.
