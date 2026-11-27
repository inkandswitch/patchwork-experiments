# Plans

Work that is known about and not being done yet. Each section says what is
known, so it can be picked up without finding it out again.

## Latency and throughput

A task that does nothing, asked by a Node process of a Node host on the same Mac through the sync
server (about 75 ms a round trip), takes about 650 ms from asking to the asker having the result:
median 653–655 ms, worst 726–765 ms (`probes/node-run.mjs --only 1` with its loop at 30 asks, two
runs, 2026-11-27). The browser pool on its stand-in page, asked from that page, takes 11.5–11.6 ms
(worst 17.0–18.3 ms; check 1 with its loop at 40 asks, with and without the network,
2026-11-27). Throughput, many quick tasks at once, has not been measured with the pool.

### Where the time goes

Every step traced on one clock, 20 tasks one at a time on a warm host (median / worst, ms; traced
while the thread still saved before its run was reported):

| Step | ms | What it waits on |
|---|---|---|
| Asker makes the task, saves it, lists it, saves that | 9 / 19 | Local only |
| The listing reaches the pool | 192 / 283 | The asker's sync round (about 1.5 round trips), the server's push, and the pool's forced write of what it received |
| The pool finds the task's document | 138 / 204 | One round trip, and a forced write of what arrived |
| The claim is saved | 53 / 61 | The rule: a run's start is saved before its code is called |
| Hand-over, import, call, return | 4 / 8 | |
| The thread saves what the code wrote | 47 / 56 | One flush of its Repo, the imported task document included |
| The end is saved | 72 / 90 | The rule; it delays the start of the end's sync round |
| The end reaches the asker | 256 / 306 | The end's own round, which starts only once the claim's has finished |
| **Asked to taken / taken to ended / ended to the asker** | **366 / 107 / 258** | |
| **Total** | **717 / 830** | |

The thread no longer saves before its run is reported: 4 ms in the thread, against 53–56 with the
save (30 asks each). The total falls by only about 35 ms (686–690 → 653–655 ms): the end then waits
for the claim's round instead (ended to the asker 233–236 → 249–253 ms).

In the browser the same save, of the imported task document, cost 2.0–2.2 ms a run (worst 3.8;
40 asks traced on the stand-in). The deployed site's no-op ask through its own Repo (about 210 ms
in most sessions, 101–104 ms in others) has not been traced step by step.

### The floor, and what stands above it

The least this design costs with this Repo and server is about **545 ms**: the listing crossing
(160–200 ms), fetching the task's document (85–100), local work (about 20), the claim reaching the
asker (about 160), and the end trailing the claim (85–100), since one document's sync rounds run
one at a time. That is the figure with no forced writes in the pool's Repo (545 / 572 ms); two
bare Repos agree (530–560 ms).

Between today's figure and the floor:

- **Forced writes on the host.** On macOS an fsync is a full flush of the disk (F_FULLFSYNC, about
  3.6 ms, one at a time), and the Repo waits for its storage before a received change reaches the
  handle and before an outgoing change's round starts.
  - Dropping all of them in the pool's Repo gains about 170 ms. A run's start then survives a
    crashed process but not a power cut: a claim lost that way leaves code that may have written
    to the server with no run for `earlier()` to see. That is the lead's call.
  - Dropping only the writes no flush asked for (copies of what the server already holds) keeps
    every rule exactly and gains about 100 ms (615 / 700 ms, measured together with the thread
    saving only what its code changed). The forced writes sit in module-level helpers of the
    NodeFS storage adapter, so doing it here means carrying a copy of the adapter (about 600
    lines) that forces a write only while a `flush` is pending. Such a copy was measured
    (`scratch/skeptic-tasks`) and is not in this package: when a write must reach the disk is the
    Repo's storage adapter's to offer (an option such as `durability: 'flush'`), and a copy would
    fall behind each Repo release. A Repo that applied what it receives before writing it would
    make it unnecessary too.
  - The rest, about 70 ms, is the claim's and the end's own forced writes: the rule itself.
- **Below the floor is the Repo's.**
  - Every change goes to the server as a whole sync round (fingerprints, the server's answer, the
    data, the server's store, and only then its push to subscribers) where a push straight to the
    subscribed server (`addCommit`) would do: about 160 ms, measured in a patched copy
    (`scratch/repolens-overlay`, 697 → 539 ms). It belongs upstream as store, then push without
    waiting for it, with the round kept as the repair; waiting for the push inside the save ties
    every flush to the network.
  - One document's rounds run one at a time, so a run's end waits for its claim's round: about
    75–100 ms.
- **Not explained:** the claim's save takes 53–57 ms where its six or so forced writes take about
  22; the listing's crossing varies between 160 and 210 ms from one session to the next.

### A listing that arrives before its task

A listing can reach the pool before the task's document can be fetched (1 in 20 asks with a 1 MB
input made just before asking; never in 120 do-nothing asks). The refused find has asked the
server, which pushes the document when it has it, and the pool listens to the Repo's query for it
(`findWithProgress`) and takes the task once it arrives. Check 16 of `node-run.mjs`, the
document sent 300 ms after its listing: taken 509–538 ms after the listing (worst 562), 203–230 ms
after the document was sent; looking again only at the next beat took 3.6 s. A Repo without
`findWithProgress` gets the beat.

### Rejected

- **Listing only once the server has the task.** About 143 ms more on every task, to prevent a
  refusal the pool recovers from in about 250 ms.
- **Asking again on a short timer after a refusal** (50, 100, 200 ms…). About 95 ms slower at the
  median than listening for the document, and a review per timer.
- **Sending the ask or the result as a message ahead of the document** (the lead, 2026-11-25): a
  worker would act on something not yet saved, a way round the system and not a faster system.
- **Starting threads ahead of time, or handing the job over while the claim is saved.** A run's end
  waits for its claim's sync round, which hides most of what happens between taking a task and
  ending it; a fresh host's first task, with its thread's start (65–98 ms), measured the same as a
  warm one only with the pool's forced writes gone. The second loosens "saved before its code is
  called" for under 2 ms.
- **The Repo's save throttle.** Not on the path: the pool flushes its claim and its end, and
  nothing waits for the thread's saves.

### Measuring it again

`pnpm build:node`, then `node probes/node-run.mjs --only 1,16`: check 1 prints the total and its
three parts (asked to taken, taken to ended with the time in the thread, ended to the asker),
check 16 the late listing. `probes/browser-run.mjs` prints the browser pool's figure as its first
check. Step-by-step tracing is in scratch copies under `/Users/pvh/dev/pwx-one/scratch/`
(`skeptic-tasks`: trace points written to `$TASKS_TRACE` on the machine's clock, `probes/bb/lat.mjs`
and its drivers `arms.sh` and `late.sh`, `analyze.mjs`; `repolens-overlay`: the patched Repo).
They are not part of this package, switch experiments by environment variables, and may be gone.

## Deferred, with what each waits on

Each of these was met while building the pool and left out on purpose. None is needed for a queue
that one machine serves.

- **What is left of the preferred pool and of needs.** A pool asks an entry's package and needs
  before the task's, but still follows (fetches) every task its queues list, so a browser on a
  queue full of work for other machines fetches each of those tasks. Following only what it might
  take would save that, at the cost of its own runs of such tasks, after a restart with fewer
  labels, waiting out the lapse instead of being recorded lost. The hold (HOLD_MS, 1.5 s) is two
  crossings as measured on one Mac through the sync server; between devices on slower links a
  crossing may take longer, and a hold too short costs one yielded run, as before. A task listed
  again by its asker after a lapse keeps its needs, which its document holds, but not the first
  asking's `near`, which only the entry did. Two crossings still start a task twice, and no advice
  closes them: a pool's word about its slots (filled, freed, or done listening), still on its way
  as another ranks a task (freed or done listening, both rank themselves first and take at once),
  and a run still on its way to a pool that may take the task by then. The second is widest where
  nobody is ranked (every pool heard full, or the only free one still listening): each then takes
  the task the moment a slot frees past the hold, in no order. Ranking full pools after free ones
  would narrow it to the time after every turn. Each waits on a case that needs it.
- **Left to the Repo.** Three things the task system does not do, because they are a Repo's:
  - *Sending what was stored but not sent.* A Repo sends a document only while it has it open,
    and loads a stored one only when something asks for it. So what a page or a host wrote but
    had not sent before a reload or a restart (with no network) is not sent until something opens
    it. A design bug is being logged with Subduction.
  - *Holding a run's ending until others have its writes.* A run is reported when its code
    returns; its worker's Repo saves and sends what it wrote in its own time (each throttled, by
    default to at most 100 ms after a change). A worker kept for the next run keeps its Repo and
    sends it on. One ended right after its report loses what its host's Repo did not have yet over
    the pipe: a stopping run that returns is ended at once, idle workers are ended when the pool
    stops, and the pool's worker with its page. With no network, a page reloaded the instant a run
    ends may also lack the run's writes. Saving before a worker ends is the Repo's to hold.
  - *Deciding what a worker may be given.* The pipe carries what the site's Repo shares with a
    peer; what a worker may have is the Repo's and keyhive's to decide.
- **What the pipe still lacks.**
  - *Workers reach documents only through their pipe.* Every worker's Repo has no storage and no
    socket, and its one network adapter is the pipe to its host's Repo (`src/pipe.ts`). A Repo
    asks its classic peers for a document only once its Subduction source has given up, and one
    whose server cannot be reached keeps trying, so a worker with a socket beside its pipe would
    never ask its host with no network. A Repo that asked its classic peers beside Subduction (or
    a Subduction transport over the port) would let a worker keep its own socket. Waits on the Repo.
  - *Another tab than the pool's.* Its site Repo shares a database and a heads channel with the
    holder's, so its `doWork` is run by the pool, with or without the network (browser-run checks
    41 and 42). The site's Repos do not carry the pool's ephemeral messages between tabs: those
    reach another tab only on the task system's own BroadcastChannel, so what listens there with
    `local: false` hears no pool. Waits on something that needs them.
  - *A frozen holder that held the site's database.* On the stand-in page, when the holder tab is
    frozen holding the database the two tabs' site Repos share, the other tab's site Repo saves
    nothing until it resumes, and its `doWork` waits with it (`ask` saves the task before listing
    it; browser-run `--lifetimes` check 34). DevTools' freeze may hold a transaction a browser's
    own freezing would not. Waits on the lead's call.
  - *Not shown on the deployed site* (keyhive's Repo) with no network by a probe: only on a
    stand-in page and in unit tests.
  - *A Node host has none.* Its threads' Repos have directories of their own and reach the asker
    by the sync server. A MessageChannel between the host's Repo and each thread would carry it
    directly; without one, a run's code on a host with no network cannot open a document the host
    has and its thread does not, so a solver host restarted offline with a waiting run does not
    run it until the network returns, which the no-network law does not allow.
- **A new worker for every run.** A worker is reused after a run that ended by itself, so code one
  task leaves running shares a thread with the next. Confining task code (an opaque-origin worker in
  a browser) requires fresh workers, and so does treating tasks as strangers to each other. This
  waits on confinement, on the first of "Left to the Repo", and on what a fresh worker costs: its
  start, and on a Node host its Repo's first connection to the server (not measured on their own).
- **Finding queues.** A page with no document that names a queue asks its person's own queue
  (`ownQueue`). Queues one only asks of, and does not serve, have no place to be kept: the task
  storage could keep them as root keys of their own whose setting serves nothing, and tools pick
  from those. Waits on the first tool that asks a queue it does not serve.
- **Forgetting spares.** A spare (a queue made as one's own that another making's pointer beat,
  or one made where own's document had not arrived) is kept marked and served for good, and each
  costs one served queue: the pool follows it, and every folding pass reads it. Forgetting one
  (deleting its mark and its url key) is safe only once no replica can still ask it, which nothing
  can know yet: a device cut off for a month may come back and ask the spare it made. Waits on a
  way to know that every replica has folded, or on spares growing enough to matter.
- **Node hosts following own.** A host serves the queues it was given (`--queue`). Own changes
  only while concurrent makings meet, but a host given what became a spare keeps serving it, and
  work needing `node` or `unix` asked through `doWork` waits until the host is given own. Waits on
  a host that reads account storage.
- **Two pool ids made at once.** Where no pool has ever started in a profile, two tabs asking at
  the same moment for code that cannot travel can each find no pool id and make one; the later
  write is kept, and the task asked under the other id waits for a pool that will never be. It
  concerns only code served from a dev server. Making the id under a Web Lock would close it.
  Waits on a case that needs it.
- **The base provider's storage map made twice.** Patchwork's tool-storage provider writes
  `toolStorage = {}` when its copy of the account has none, so two devices doing so apart keep one
  map, and every other tool's storage linked in the other is lost from the account. The task
  system recovers its own (`mergeStorages`); the rest is base's to fix, and was reported.
- **What the pool's registry exposes, for the isolation work.** A pool's workers have the
  plugin registry (README, "A pool has the plugin registry"). So plugin code of every installed
  package can be loaded by any task's code in a pool: in a browser, in a run worker of the site's
  origin, beside the run's input and keys; on a Node host, in a thread with its user's privileges
  (their files, environment, processes and network), and a host's main thread imports every
  listed package's entry to describe it. A lookup by id is not pinned to a package or a version:
  whichever installed package last registered that id answers, in the version installed. A pool
  runs whatever code its served queues' tasks name, with no per-package choice; on a Node host
  that is its user's privileges. These are the isolation work's to answer, with trust as a whole.
- **What package management will own.** Two devices with different versions of a package
  installed run different code for the same task. A plugin whose package imports another
  package's files by automerge url loads only where that package is on the device. Packages the
  site serves over http (its own list, beside the account's) are not in a pool's registry: the
  snapshot carries only packages kept in automerge, and a Node host cannot import https at all;
  what a headless host's equivalent of the site's list is has not been decided. A host imports
  each new version of a package and never unloads the old one, so a long-lived host grows with
  every update. A Node host materialises only the entry's top-level directory, so a plugin whose
  code reaches above it (`dist/` importing `../src/`) fails there. A Node host finds a package's
  plugins by importing its entry as carried code, so a package whose entry imports by bare name
  anything but the shared names, or one that lists its plugins in its `package.json` (core's
  manifest, which a page reads without importing), is missing from a host's registry, and an http
  url in the host's settings document is fetched and then left out. A package that needs the
  tasks package (its client, `tasks-next`) and does not find it in a browser's registry says so
  and waits for it; nothing else is done about it. Each is package management's to answer.
- **Slots count threads, not kinds of work.** A run waiting on the network holds a slot a build
  could use. Waits on the first long-waiting work moving here.
