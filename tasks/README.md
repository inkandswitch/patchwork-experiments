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
worker says how its run ended, returned, threw or stopped, only once every document its code
changed has reached the page that holds its browser's pool, through the local link (see Offline
and partition), or, on a Node host, once the sync server has acknowledged it; half a minute at
most, after which the run's log says how many had not; a Node host's thread with no server to
reach says in the log that what was written stays on that machine), and **what a task is handed
can be found** (its `ctx.repo.find` waits for a
document that has not arrived yet, for about half a minute, instead of rejecting at once).

**Mostly once**: asked of a queue that several of a person's devices serve, a task runs on one of
them, once, unless the device running it dies part way, or two devices cannot hear each other at
the moment it is listed, and then it runs again, as at least once promises. Each pool serving a
queue says, every two seconds and whenever it changes, how many slots it has and how many are busy,
and every pool ranks the pools for a task from those words alone, its own last word included: those
with a free slot, first the one the task's asker is next to, then in the order a hash of the task's
url and each pool's id gives. Each ranks once, when it first sees the task. Each ranked pool has a
turn of a second and a half, the first from that moment, the second from a second and a half later,
and so on, in which it takes the task as soon as it has a free slot; one whose slots stay full
through its turn waits until every ranked pool has had one. So work beyond the first pool's slots
starts that much later. A pool that has served a queue for less than two and a half seconds says it
has no slots there and takes nothing, and one that stops says the same as its last word; neither is
ranked, and a task held back for a pool that says so is ranked anew at once. A pool that has
listened and hears no other with slots never waits. Two crossings can still start a task twice: a
pool's word about its slots (that they have filled, that one has freed, or that it has done
listening), on its way to another pool as that one ranks a task, so that the two rank differently
(a word that a slot has freed or that listening is done can have both take the task at once); and
a run one pool has taken, on its way to another that may take the task by then (its turn has begun,
or every turn is over). The later of the two runs then gives way to the earlier, which goes on. A
task never fails for want of a device: one that needs what no pool serving its queue has waits, and
the queue browser says what it waits for.

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
- `served(repo, queueUrl, onChange)` hears which pools serve the queue now, with what each has
  (one that began serving it less than two and a half seconds ago is not taking yet, and not
  listed); an empty list, or none that has what a task needs, means that task waits.
- `ownQueue(repo, element)` gives a page the url of its person's own queue, served by their
  browsers for any code, making it the first time anything asks, with nothing pressed and nothing
  waited for on the network (see Serving a queue).

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

A secret a task needs (an API key) goes in its input under `keys`, which the queue browser does
not show (it reads `keys: (hidden)`, at any depth of the input). Everyone who can read the queue
can still read it, for good, so ask such work only of queues whose audience may have it.

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
- `settled`: a promise that resolves once the pool has held the run for a beat (two seconds from
  when its taking was saved) and nothing stops it. Code awaits it before doing what cannot be
  undone (a payment, a message sent to someone). An earlier run (one before it in `runs`) makes
  this run yield instead of settling when its record, or its pool's word that it goes on, reaches
  this pool within that beat: an earlier open run counts as heard from first sight, and a pool
  says each of its runs every beat. That is so for an earlier run taken before this one by a pool
  heard within a beat, and for one taken at about the same moment (before its pool had this run's
  record) by a pool whose round trip to this one is under a beat. It resolves at most once, and
  never once `signal` has aborted: then it rejects with "the run stopped before it settled
  (<reason>)". It is not exclusivity: an earlier run heard later than that (its pool cut off for
  longer than the beat, or taken a moment after this one by a pool whose round trip to this one
  is longer than the beat) makes this run yield only after it settled, with what it did already
  done. Code that never awaits it is not held up by it. Work done in the page (see Having work
  done from a page) has no `settled` in its `ctx`.
- `repo`: the worker's own Repo, which already has the task's document. Its `find` waits for a
  document made elsewhere a moment ago (asking again for about half a minute, as `findWhenThere`
  in `task-client.js` does), so an input the asker has just made is found, not refused; a url it
  cannot read, or a `signal` passed to `find` aborting, ends the asking at once. What the
  code writes through it reaches the page that holds the pool (in a browser) or the sync server
  (on a Node host) before the run's ending is said: write, and return (or throw); there is nothing
  to flush or wait for. A stopped run's writes (a run document set to "cancelled" when `signal`
  aborts) are sent the same way, within the five seconds.
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

A task that writes into a document over time first puts a value of its own there, naming its
run (`ctx.run`), in one assignment, and from then on writes only inside that value, checking in
each change that the value there still names its run. Two runs' values put in one place merge to
one of them, whole, the same everywhere, and the other's writes stay in the value that lost; so a
run taken over while cut off from the sync server, which goes on writing, cannot mix its writes
with those of the run that replaced it. No tool in this tree does this yet;
`probes/append-task.js` shows the appends alone.

## Having work done from a page

A tool in a page needs three functions from `task-client.js`, each handed the site's Repo, and
never names a queue:

- `doWork(repo, { importUrl, input, key, needs }, { onProgress, signal })` has the work done.
  For code that can travel it first has `ownQueue` give the person's queue, which makes it if they
  have none, and puts the page in its browser's pool if nothing has (`joinPool`: it appends the
  package's background component, `task-pool-next`, inside the frame's tool-storage provider), so
  that a pool is there to be heard the next time. When a pool heard through the page's Repo
  serving that queue has what the work needs, the work is asked of it as `run` would, near this
  browser's pool (the tab that runs the pool hears it through its Repo with no network, by the
  local link; see Offline and partition); otherwise work that needs nothing a page lacks (no
  needs, or only `browser`) is done in the page, by importing the same module and calling it (the
  first asking in a frame that had started no pool is done so, and so is work asked with no
  network from a tab other than the one running the pool; for such work the list of the person's
  queues is looked for only in what this browser keeps, so a list that has not arrived yet does
  not hold it up); and work that needs more is asked of the queue all the same, where it waits for a
  device that has it. Either way it resolves to what the code returned and rejects with what it
  threw, `onProgress` hears the same views, and aborting `signal` stops it. Only code that can
  travel is asked of a queue: a file in a package kept in automerge, or a `data:` URL; any other
  url (a dev server's `http://localhost`, a `file:` url) is done in the page. Work that needs more
  than a page and cannot be asked of a queue (its code cannot travel, or no queue can be had: no
  account open, nowhere to keep it, or the list of the person's queues not found within about half
a minute) is rejected with a sentence saying what it needs and why.
- `watchWork(repo, key, onChange)` follows the work under the key on the person's queues (own,
  and every spare, see below), so that a page opened later, or another tab, shows work already
  going on instead of offering it again. It follows them as they change, makes nothing, and
  always says something within ten seconds: `missing` means no work under this key is known on a
  queue of theirs (no queue, nothing under the key, or own's document not had yet, which it goes
  on looking for). It returns how to stop following.
- `stopWork(repo, key)` stops the work under the key on own and on every spare this page's Repo
  holds; false when there is none.

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
does not heed `signal` runs on.

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
workers it can end, and the others wait to take over. That tab links the site's Repo to the
pool's worker and to each run worker, by a MessageChannel each (`src/browser/link.ts`, see Offline
and partition). A browser's pool has `browser` and
`pool:<its id>`, so a task that needs anything else is left for a machine that has it. A frame
that mounts no background components takes part once a page in it asks for work: `doWork`
mounts the component itself (`joinPool`), and where the tasks package is not installed that
mounts nothing.
Which queues it serves is kept in the account's tool storage for this package
(`account.toolStorage['tasks-next']`, a document Patchwork's frame makes the first time it is
needed). Its root is the list: each served queue is a key of its own, the queue's url, holding
`true` (any code) or `{ packages }`; `own` names one's own queue; and `own:<queueUrl>`, holding
`true`, marks each queue made to be one's own. With nothing to make before writing, changes made
at once on devices that have not synced all keep: two joins both stand, and two settings of one
queue keep one whole. `servedOf`, `ownQueueOf`, `marksOf`, `sparesOf`, `setServed` and `ownQueue`
in `src/task-client.js` are the only code that knows this. To serve a queue, open it in the Task
Queue Browser and press Join queue; there you also choose whose code it runs (any, or named
packages) and Leave.

**One's own queue.** A person always has one: whatever first needs it makes it (a page asking for
work, the background component as it mounts, the badge as it mounts), and nobody presses
anything. Making writes, in one change and only where it sees no `own`, the pointer, the new
queue's mark and its url key, serving it for any code; nothing deletes or rewrites `own` or a
mark. So every write of `own` is concurrent with every other, and the one that stands is
Automerge's winner among them, the same on every replica with the same changes. Making waits on
nothing: it writes in the page's Repo and is done, with no network too. Several copies of the
client in one page (a package's kit copy beside this one) on one Repo make one: a making's change
reads `own` again before it writes. A page whose Repo sees a pointer to a queue whose document it
does not have yet (made on another device, not yet arrived) makes a queue of its own instead,
with its mark and url key and no pointer, and uses it until own's document comes; a document
this browser keeps but is still reading from its storage (a cold start) is waited for, up to
half a minute, and makes nothing. Every marked
queue that is not own is a **spare**: it stays served, so what it lists runs whether or not it has
been moved, and passes **fold** it into own (FOLDING in `src/task-rules.js`): an entry is listed
in own, or, when own's key names another task that is still wanted, the spare's key comes to name
that one too, so the spare's task yields to it and its asker follows the key; the entry of a task
that has ended, or of a document that is no task, leaves the spare. A pass starts with every `ownQueue` call, and the page whose pool host
follows the account runs one whenever the account or the storage changes and there is a spare.
Spares are kept for good (see PLANS.md). The frame's provider can also make the storage document
twice (two devices that both found none); the account then keeps one link, and the pool host
moves what the losing document lists into the winner (`mergeStorages` in `src/helpers.ts`: its
marks, its `own` if the winner has none, and its served queues), after which the loser's own is a
spare like any other. The tool storage comes from the frame's tool-storage provider
(`patchwork-tool-storage-provider`, which threepane and the tiling frame mount), asked from the
element that asks, or else from the first such provider in the page: where none answers within
five seconds, the badge says "This page has nowhere to keep your task queues, so nothing was
changed." and nothing is written.

What a person sees of it, each read from what is (this page's pool host, the storage document,
the queue's document, what is heard on the queue's channel), and never starting anything:

- **The badge** (a title bar tool, and the same as a `system-tray` component) shows, for each
  served queue, how many tasks it lists and what this browser's pool is doing: running here
  (with how many runs), served by another tab, finishing up (handing over to a newer build, or
  let go), or not running here, with why in its tooltip (nothing on the page has started it;
  this browser serves none of the person's queues; this browser cannot keep its tabs to one pool;
  the pool could not start, with what it said and when it tries again). It opens the queue
  browser. As it mounts it asks for own, saying "Making your queue…" until that is done (at once,
  unless the frame's provider has to make the storage); a person who left their own queue is
  offered it to open and join again.
- **The queue browser** (the Task Queue Browser tool) shows the pools heard serving the queue
  (name, slots, busy, what each has; this browser's marked), a line saying what this browser's
  pool is doing in this page and why, whether this person's browsers serve the queue, whether it
  is their own ("your queue": made for them, served by their browsers) or a spare ("folded": what
  it lists moves to their queue), and each
  listed task: its state (waiting, with what it needs when no pool heard has it; stalled, with
  since when this view has seen it so), its records (which pool took it, when, how it went; a
  stop as a stop), its log, its input (with `keys` hidden), and a Stop while it has not ended.
  Opened, a task also says where its code is (which file of which package, or that it is written
  into the task as a `data:` URL), links to the file when a browser can open it, and has Show
  code, which loads the source (a `data:` URL decoded where it stands, anything else with
  `fetch`, which the site's service worker answers for a package's files) and shows up to about
  200 KB of it. Nothing is loaded until a person asks, and once per opening.

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

## Offline and partition

A browser's pool and its run workers start with nothing fetched from the network. Their code, and
es-module-shims, through which they resolve a task's bare imports by the page's import map, are
files of this package (the shim is a dependency, built in beside the workers); the Repo's modules
and wasm they load are the ones the page's import map names and its origin serves, the same files
the page itself loads. A sync server that cannot be reached holds nothing up: the Repos go on
trying, and work from what this browser keeps.

**The local link** (`src/browser/link.ts`). The tab that runs the pool joins the site's Repo to
the pool's worker, and to each run worker, by a MessageChannel each: its end is added to the
site's Repo as a network adapter (the MessageChannel adapter of the site's import map, as
Patchwork's core adds its public reader), and the other is the worker Repo's one network adapter.
A run worker's link is made by the pool's worker as the run worker starts, and taken out of the
site's Repo when that run worker ends; every link of a pool is taken out when its worker ends
(stopped, failed, silent, handing over, or the page left or frozen; a page only hidden behind
another tab keeps its pool and links). Run workers keep storage of their own,
and no worker holds the person's keys. A linked worker has no socket of its own to the sync
server: the site's Repo is its way to everything, the server included. (A Repo asks its link for a
document only once its Subduction source has given up, and one whose server cannot be reached
does not give up, so a worker with a socket of its own would never ask the page with no network.)
The site's Repo gives a worker no more than the sync server gives a Repo of no one's: only
documents keyhive leaves unprotected, and of those only the ones the worker has named first, by a
`request` or a `sync` of its own for that document; it neither offers a worker the documents it has
open nor answers it about any other (the header of `link.ts` says which of the Repo's messages
pass). Before the Repo's messages, the gate reads what arrives on the page's port, the adapter's
own handshake (`arrive`, `welcome`, `leave`) included. The page names each link's one peer: for
every link it makes or is handed it chooses a fresh random peer id, and the worker at the other end
makes its Repo with exactly that id (the pool's worker from `start`, a run worker from its
settings, both set by the task system's own code before any task's code is loaded). The page's
end admits only that id, and from it, in this order: its first word (an `arrive` addressed to no
one or a `welcome` addressed to the page), once; then messages addressed to the page; then at most
one `leave` addressed to no one, after which nothing. Everything else is dropped before the adapter
sees it. That holds whatever order things happen in: a run worker imports its task's code before
its Repo has announced itself, and code that speaks first, in any peer's name, is heard by nothing.
A task's code can speak on its link only as its own worker, and the page takes that worker for a
new peer once (each arrive or welcome a Repo hears makes it offer the peer every document it has
open); a worker that leaves and arrives again only cuts itself off. A message the gate would pass
whose data the page's Repo could not read (a sync message, or an ephemeral message's CBOR, decoded
by the gate first) ends the link from the page's side, as a leave would, and is said once in the
page's console; so malformed messages cost the page one line, not one each. A message that reads
but that the Repo still rejects (a change that decodes but cannot be applied) is logged by the page
each time (PLANS, "What the local link still lacks"). (A Repo sends its messages for a peer
through the adapter that last announced that peer, and forgets a peer whose adapter says it left,
so a link that admitted another peer's name would let code that knew the pool's id, which the
ephemeral messages the page relays carry, take the page's messages for the pool or cut the pool
off; `link-check.test.ts`, "the handshake".)

Kept before reported. A linked run worker says how a run ended once the page's Repo has what the
run wrote, and names those documents. Before the pool reports the run, its worker asks the page to
save them, and the page saves, in the site's Repo, those that run's link carried. The pool waits
for that at most 10 s (`KEEP_LIMIT_MS` in `src/browser/executor.ts`), and a save that failed or did
not come in time is said in the run's log; the run is then reported all the same. An error that
escapes the run worker after it said the run ended ends the worker at once, and is heard behind
the ending, so the run is recorded as it ended, not as lost. So a page
reloaded the moment a run is reported has what it wrote, with no network too (browser-run
`--lifetimes` check 39).

What a run worker's code can reach besides its own link. Message ports cross only by transfer:
the pool's worker's end of its link never leaves the pool's worker, and each run worker's end goes
to that run worker alone, so a run worker's code has no way to another worker's port. Its realm
is the site's origin, though, and that gives it ways round the link that no gate here sees: every
BroadcastChannel of the origin (the task system's `patchwork-tasks-heads`,
`patchwork-tasks-messages` and `patchwork-tasks-build` among them), every IndexedDB database of the
origin (the tasks database, other run workers', the site's own), the origin's Web Locks, and
fetches to the origin. These are not closed here; closing them needs task code in a worker of an
opaque origin (PLANS, "A new worker for every run"). A worker with no page
above it (a Node host's thread) has no link.

| On one device with no network | |
|---|---|
| Making your own queue; the pool starting | works: making writes in the page's Repo and waits on nothing, and the pool starts and serves it |
| A task asked in this browser, run by this browser's pool, its progress and result | works: asked through the task system's own Repo (`tasks-repo.ts`, as the queue browser asks), or by a page tool through the site's Repo in the tab that runs the pool, which reaches the pool by the local link, so `doWork` hears the pool through that Repo and asks it; from another tab, whose site Repo hears the pool only by way of the sync server, `doWork` hears none and does the work in the page |
| What a pool-run task writes into a document the page has open | reaches the site's Repo in the tab that runs the pool, through the link, and is saved there, before the run is reported; a tab reloaded the moment `doWork` resolves has it (browser-run `--lifetimes` check 39); the site's other tabs have it as they have that tab's own changes; the site's Repo sends it to the sync server once there is one |
| Work that needs another machine (`needs: ['node']`) | waits in the queue, and the queue browser says what it waits for; where this browser does not have the list of the person's queues (the account names a storage document that has not arrived), `doWork` looks for it as `findWhenThere` does, about half a minute, and then rejects with "This work needs a device with node, and it could not be asked of your task queue: The list of your task queues could not be found, so nothing was changed." |
| Stopping work | works for work in this browser: work done in the page by its signal, and work the pool runs by a stop written through the task system's own Repo (the queue browser's Stop) |

| When a partition heals | |
|---|---|
| Two devices each made a queue | one becomes own everywhere (Automerge's winner among the pointer writes); the other is a spare, folded into it by the next pass; both stay served; no task is lost |
| A task was listed on both for a while | one list of runs; a second run yields when it hears the first |
| A run finished while cut off | its record and what it wrote arrive; if another machine took the task meanwhile, its run, still going, gives way once it has the finished run's record, whichever of the two is first in the list, and what it wrote meanwhile is the task code's to guard (as before) |
| Two devices each had the storage document made | the account keeps one; the pool host moves what the other lists into it, and its own becomes a spare |

A task's code imports by bare name with no network as it does online. `probes/browser-run.mjs
--no-network` shows this with every host name unresolvable: a fresh profile gets its own queue, a
pool and a finished task (check 18), tasks run, and its check 25 shows, from every request DevTools
sees each page and each worker make, that none leaves the machine but the Repos' sockets to the
sync server. Its checks 26 to 30 show the link with a site Repo that shares no storage with the
task system's: a tool's `doWork` through it is run by the pool, what the task writes is in that
Repo when `doWork` resolves, liveness and progress arrive, a run worker ended in the middle of
writing leaves that Repo working, and the pool handed over to another tab links that tab's Repo.
The unit tests show the rest: the link's gate for every kind of message both ways and for what
arrives on the page's port, and Repos of
both kinds joined by a gated link (documents named cross both ways, others do not, a protected one
never, a run's report waits for the page; `link.test.ts`); what a worker's code posts on its port
by hand gets it no protected document by any other field or spelling, and an announcement, a
`leave` or a message in the pool's name, or one addressed to another peer, before the worker's
Repo announces itself or after, neither cuts the page off from the pool nor throws in the page, a
worker's Repo made with another id than the one the page chose is not heard, its own arrive said
again and again is taken once and a malformed message ends its link alone, the page saves of
the documents a run names only those its link carried, no offer the gate drops
carries a change, ten links write at once and each run is reported once the page has its writes,
and a 5 MB document crosses, also after a link taken out in the middle of it
(`link-check.test.ts`); a linked run worker's Repo has the peer id its settings carry, and its
ending names what the code wrote (`run-worker.test.ts`); its settings wait until the page has
named its link's peer, and its ending is heard once the page has saved what it names, or at the
bound with the log saying why not, and an error after it waits behind it (`executor.test.ts`); the page names a fresh peer for each link,
answers each save, and says why one failed (`pool-host.test.ts`); two replicas that each made a queue
apart agree on own when they meet, lose no task and run none twice; a replica that sees a pointer
to a queue it does not have asks a queue of its own and folds it into own once own arrives;
folding with one replica cut off part way, then healed, converges; a run that finished while its
pool was cut off arrives with what it wrote, and a run another pool took meanwhile gives way to
it. What none of them shows yet is said at the end of Tests and probes.

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

`pnpm test` runs the unit tests (rules, client, pool, workers, views), and `pnpm typecheck` checks
the types of everything in `src/`, the JavaScript kit files included (`tsc`, as `tsconfig.json`
says). The probes run real
processes and say what they saw, one line per check or measurement:

- `probes/node-run.mjs` (after `pnpm build:node`; `--only 1,16` runs only the checks named):
  Node hosts through the real sync server, 21 checks. 1, latency of ten do-nothing tasks on a
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
  otherwise a hold later); 21, a task awaiting `ctx.settled` has it resolve no sooner than a beat
  after its run was recorded, and one stopped within the beat has it reject, `cancelled`. Checks
  9, 17 and 19 print when each run started, too.
- `probes/write-path.mjs` (after `pnpm build:node`): measures, and checks nothing, how a
  document travels between a task on a Node host and its asker through the sync server, per
  size: written by the task (`out`), made by the asker for the task (`in`), twenty at once
  (`many`), with the task waiting for the server (`ack`), and from a host stopped the moment
  the asker reads succeeded (`term`). `probes/write-path/browser.mjs` (after `pnpm build`, in
  the chrome slot) measures `out`, `in` and `ack` for a browser's run worker.
- `probes/browser-run.mjs` (after `pnpm build`, in the chrome slot): the built package on a
  stand-in page in a throwaway Chrome profile, with no sync server but for checks 24, 22 and 26
  to 30, 30 checks. The page mounts
  what a frame does: the components the package tags `background`, found by tag in its plugin
  list (the page has no registry), and the titlebar tool. One pool per profile across tabs; a
  closed, navigated, frozen or hidden holder tab; a newer build taking over; cancel of spinning
  code, also code that read and wrote through `ctx.repo`; two run workers at once; a run that
  wrote with no server to reach says so; a pool worker that errors or dies; `served()` and the
  queue browser; (15, 19) what a task writes reaches the page's Repo through the link; (18) on a fresh account, the badge and the background component make own as
  they mount, with nothing pressed, it is served, the pool starts, and a task asked of it runs,
  then Join; with only the badge mounted no pool runs and the badge and queue browser say why; the
  background component mounted later starts it, and let go lets the lock go; and (22) a run
  worker runs `probes/append-task.js` unchanged, through the page's import map and the real
  sync server (`--sync`, `PATCHWORK_SYNC`, or Ink & Switch's), and the page sees the text it
  appends to grow piece by piece; (23) `ctx.settled` in a run worker resolves no sooner than a
  beat after the run was recorded, and rejects, `cancelled`, for a run stopped within the beat;
  and (24) in a context whose Repos name the real sync server, the pool starts, a do-nothing task
  runs, and `probes/append-task.js` runs unchanged on a text its run worker made, needing no sync
  server; and (25) of every request a page or a worker made, as DevTools saw it (each worker held
  at its start until its requests are watched), none left the machine, failed or not, but the
  Repos' sockets to the sync server they are given; and (26 to 30) on pages whose site Repo has a
  database of its own (`?site`), so that only the link joins it to the pool, a tool's `doWork`
  through it is run by the pool, which is heard through it; a task's change to a document the page
  made, and a document it made, are in that Repo when `doWork` resolves; progress and the pool's
  progress messages reach it; a run worker ended while it writes a document of the page's takes
  its link out and leaves the page and the next task working; and closing the tab that runs the
  pool, the next tab's pool is linked to its own site Repo and runs its work. With `--no-network` Chrome resolves no host
  but the probe's own 127.0.0.1, and every check runs but 22, which needs the sync server and is
  skipped, saying so. With `--lifetimes` (about ten minutes more) it runs checks 31 to 39 too, on
  the same `?site` pages, each counting the holder's links after (one for the pool and one per
  live run worker): two minutes of a change every 3 s each way through the link, none slower
  than 2 s (31); a 5 MB document a task makes is in the site's Repo when `doWork` resolves (32);
  the holder hidden behind another tab keeps its pool and links, and nothing stalls (33); the
  holder frozen, the other tab's pool is linked to its own site Repo and runs its work, and the
  frozen tab resumed has no link left and has that work's writes (34; it fails when the tab was
  frozen holding the database the two tabs' site Repos share: the other tab's site Repo then saves
  nothing until the frozen tab resumes, and its `doWork` waits too, since asking saves the task
  before listing it: so in four runs with `--no-network` and one of three with the network);
  the holder navigated away,
  the waiting tab takes the pool, linked (35); the page reloaded takes the pool again, linked,
  with what a run wrote 2 s before (36), and with what a run wrote the moment before the reload,
  which the page saved before the run was reported (39); and, with
  the network only, a page cut off by DevTools' network emulation has what a task wrote reach
  the sync server once it is mended, the task run once (37), and a page of another context, given
  the account, hears this browser's pool serving through the server alone (38).
- `probes/real-run.mjs <automerge:package url>` (in the chrome slot): a published copy of the
  package (a staging package will do) in the real Patchwork, https://patchwork.inkandswitch.com/,
  in a throwaway profile, 20 checks, the last two that neither the page nor the task system's
  workers logged an error of the task system's. It installs the package through the profile's
  module settings and records what the site's frame does with it; mounts a
  `patchwork-tool-storage-provider` of its own on the account and, inside it, the background
  component and the badge, as a frame mounts them (it does not rely on the site's frame to), and
  sees that under the site's provider own exists within 30 s, its url key is `true`, and the
  pool serves it (whether or not the site's frame made it first).
  Then: the pool worker and the run workers load from the package through the site's service
  worker; ten do-nothing tasks are asked through this tab's tasks Repo and ten through the
  site's own (keyhive) Repo; the package's own task module, a throw, a spin cancelled and its
  run worker gone, serving only named packages, `served()`, and the queue browser's and badge's
  lines; documents tasks write reach the site's Repo, their run workers (one started for its
  run) having waited until it had them; `doWork`, `watchWork` and `stopWork` from the page.
- `probes/append-run.mjs` (after `pnpm build:node`): a Node host, through the real sync server,
  runs `probes/append-task.js` as a `--local` file and as a `data:` URL; the asker sees the text
  grow piece by piece, and its history is one append at the end per piece.
  `probes/append-check.js` is how this probe and browser-run's check 22 read the text.
- `probes/solve-task.mjs`: a task that runs a child process, used by `node-run.mjs`
  (`probes/solve-task-lib.mjs`, a neighbour it imports, shows that a task's code can be more
  than one file).
- `probes/cdp.mjs` and `probes/chrome-guard.mjs`: how the browser probes start, drive and always
  close a throwaway Chrome.

Not shown yet, of Offline and partition:

- The link on the deployed site, whose Repo is keyhive's. `browser-run.mjs` shows it on a stand-in
  page whose site Repo is a plain one with a database of its own, and `link.test.ts` with Repos of
  the two kinds this package has; `real-run.mjs` does not check it yet. Nor is it shown that the
  sync server accepts a document a worker made with no network once the keyhive page takes it
  in and the network returns.
- A partition healed through a real sync server. Every "When a partition heals" row is shown by
  unit tests that merge the documents by hand (`task-client.test.ts`, `offline-check.test.ts`,
  `rules-fold.test.ts`, `merge-storages.test.ts`, and `pool.test.ts` for a run finished while cut
  off). One probe cuts one browser page off and lets it back (`browser-run.mjs --lifetimes`, check
  37); none does so to a Node host, or to two devices that each wrote while apart.
- A cold start whose storage is slow. `own-load.test.ts` shows own waited for while this browser's
  storage reads it, on both Repo kinds, with a storage adapter of the test's own; no probe times a
  real IndexedDB.
