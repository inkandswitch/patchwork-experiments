# Plans

Work that is known about and not being done yet. Each section says what is
known, so it can be picked up without finding it out again.

## Latency and throughput

A task that does nothing, asked by a Node process of a Node host on the same Mac through the sync
server (about 75 ms a round trip), takes about 750 ms from asking to the asker having the result:
median 747–758 ms, worst 813–835 ms (`probes/node-run.mjs --only 1,16`, 2026-11-25); in two runs
of the whole probe on a machine shared with other work, 798 / 978 and 893 / 1574. The browser pool
on its stand-in page, asked from that page, takes 10.6 ms (worst 17.7 ms). Throughput, many quick
tasks at once, has not been measured with the pool.

### Where the time goes

Every step traced on one clock, 20 tasks one at a time on a warm host (median / worst, ms):

| Step | ms | What it waits on |
|---|---|---|
| Asker makes the task, saves it, lists it, saves that | 9 / 19 | Local only |
| The listing reaches the pool | 192 / 283 | The asker's sync round (about 1.5 round trips), the server's push, and the pool's forced write of what it received |
| The pool finds the task's document | 138 / 204 | One round trip, and a forced write of what arrived |
| The claim is saved | 53 / 61 | The rule: a run's start is saved before its code is called |
| Hand-over, import, call, return | 4 / 8 | |
| The thread saves what the code wrote | 47 / 56 | Measured with the thread saving the imported task document too; the thread saves nothing for code that writes nothing |
| The end is saved | 72 / 90 | The rule; it delays the start of the end's sync round |
| The end reaches the asker | 256 / 306 | The end's own round, which starts only once the claim's has finished |
| **Asked to taken / taken to ended / ended to the asker** | **366 / 107 / 258** | |
| **Total** | **717 / 830** | |

A thread that saves nothing (check 1: 3–5 ms in the thread, against 54–56) does not shorten the
total: the end then waits for the claim's round instead.

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
- **The Repo's save throttle.** Not on the path: every step flushes.

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
- **What the local link still lacks.** In a browser, the tab that runs the pool links the site's
  Repo to the pool's worker and each run worker (`src/browser/link.ts`, README "Offline and
  partition"). What is left:
  - *Linked workers have no socket of their own.* The site's Repo asks its classic peers for a
    document only once its Subduction source has given up, and one whose server cannot be reached
    keeps trying (`link.test.ts` shows it), so a worker with both would never ask the page with
    no network. So a linked worker reaches the sync server only through the page, which gives it
    only unprotected documents it named. A Repo that asked its classic peers beside Subduction (or
    a Subduction transport over the port, which needs core to build the site's Repo with
    `subductionAdapters`) would let a worker keep its own socket. Waits on the Repo.
  - *Another tab than the pool's.* Its site Repo shares a database and a heads channel with the
    holder's, so its `doWork` is run by the pool, with or without the network, and has what the
    task wrote when it resolves (browser-run checks 41 and 42). On the deployed site, with the
    holder hidden behind it, each such ask took about a second (the hidden tab's timers are
    throttled), against 0.15 to 0.25 s with the holder visible. The site's Repos do not carry the
    pool's ephemeral messages between tabs: those reach another tab only on the task system's own
    BroadcastChannel, so what listens there with `local: false` hears no pool. A BroadcastChannel
    adapter on the site's Repo (measured as D1 in notes/LINK.md) would carry them, with every Repo
    on the channel hearing all its traffic. Waits on something that needs them.
  - *A frozen holder that held the site's database.* On the stand-in page, when the holder tab
    is frozen the other tab takes the pool and links it, but if the frozen tab held the database
    the two tabs' site Repos share, the other tab's site Repo saves nothing until the frozen one
    resumes, and its `doWork` waits with it (`ask` saves the task before listing it): 47 s, and
    over a minute, in the runs where it happened (browser-run `--lifetimes` check 34: every run
    with `--no-network`, one of three with the network). This is the site's database and the
    client's save, not the link, and DevTools' freeze may hold a transaction a browser's own
    freezing would not. A linked pool needs no save before the listing (it has the task from the
    page's memory), but a pool elsewhere does. Waits on the lead's call.
  - *Task code reaches the origin beside its link.* A run worker's code can speak on its link only
    as its own worker, and reaches no other worker's port, but its realm is the site's origin: it
    can use every BroadcastChannel and IndexedDB database of the origin, the origin's Web Locks,
    and fetches to it (README, "Offline and partition"). Waits on confinement (below, "A new
    worker for every run"). On the stand-in page, a run worker's code read a document the page
    made and never gave it straight from the site's database (a third checker's scratch probe).
  - *What task code costs the page in its own name.* The page takes a link's worker for a new
    peer once, and the first message whose data the page could not read ends its link. A message
    that reads but that the page's Repo still rejects (a change that decodes but cannot be
    applied, made by hand) is logged by the page each time, without bound; nothing is thrown and
    nothing stalls. Closing it needs the Repo to say which messages it rejected, or the gate to
    apply what it passes itself.
  - *Not shown on the deployed site* (keyhive's Repo): only on a stand-in page and in unit tests.
    Nor is it shown that the sync server accepts a document a plain worker made offline once the
    keyhive page takes it in and the network returns, nor hours of use. On the stand-in page,
    `browser-run.mjs --lifetimes` shows two minutes (check 31), a 5 MB document (32), a hidden,
    frozen, navigated and reloaded holder (33 to 36, 39), a write made cut off reaching the server
    once mended (37), and another context hearing the pool through the server (38); ten links at
    once only `link-check.test.ts` shows (a browser's pool has at most eight run workers). Waits
    on a staging package for `real-run.mjs`. Nor is the list of `src/browser/unsent.ts` shown
    there: what a run wrote with no network, the browser restarted before the network came back,
    reaching the sync server once it does. browser-run check 40 shows it on the stand-in page
    (whose site Repo is 2.6.0-rabbit.1, which says when it is connected and reports the server's
    heads); on keyhive's build, where the members it uses may be missing, the list falls back to
    `navigator.onLine` (which stays true when only DNS fails) to try, counts no time on that, and
    is bounded only by its cap of 200.
  - *What the page writes itself with no network.* The list holds only what runs wrote. A
    document the page makes or changes with no network, and closes before the network returns,
    is not sent when it does either, until something opens it (check 40's control shows it on the
    stand-in page). That is the site's Repo's to answer (it loads a stored document only when
    asked for it), not the task system's; reported here, not fixed.
  - *Rule 2 is the conservative one.* The page gives a worker only documents keyhive leaves
    unprotected; sharing a protected document a person may read with a task they run is the
    lead's call.
  - *A Node host has none.* Its threads' Repos have directories of their own and reach the asker
    by the sync server, and a run's ending waits for the server's acknowledgement. Measured on
    2026-11-25 (FACTS.md, "What a task writes"), that costs a run from about 0.2 s (10 KB) to
    0.5 s (5 MB) and 1.1–1.8 s (20 MB). A MessageChannel link between the host's Repo and each
    thread would carry it directly. Waits on a case that needs it.
- **A new worker for every run.** A worker is reused after a run that ended by itself, so code one
  task leaves running shares a thread with the next. Confining task code (an opaque-origin worker in
  a browser) requires fresh workers, and so does treating tasks as strangers to each other. Ending
  a worker once its run has ended loses nothing it wrote (in a browser the ending waits until the
  page's Repo has it, through the link; on a Node host, for the sync server), so this waits only on
  confinement and on what a fresh worker costs: its start, and on a Node host its Repo's first
  connection to the server (not measured on their own).
- **What a stopped worker leaves behind.** In a browser, what a run worker writes crosses its link
  to the page's Repo as it writes (in milliseconds), so a worker ended mid-run (a stopped run not
  done within five seconds) leaves behind at most what it wrote in its last moments; the page's
  Repo keeps the rest and sends it on (browser-run check 29). A run that is reported has had the
  page save what it wrote (browser-run `--lifetimes` check 39), unless its log says the page could
  not; but a tab that dies while a run goes on takes the page's Repo with it, and what that Repo
  had not yet saved or sent stays only in the run worker's storage, and the page cannot ask a run
  worker for it, since the gate answers the page's request for a document the worker has not named
  as unavailable. On a
  Node host, a thread ended before the server acknowledged what its run wrote (a stopped run, a
  process that died, a run written offline) leaves it in that thread's storage. Either way the next
  worker on the same storage does not send it: the Repo loads a stored document only when something
  asks for it. Sending what a slot's storage holds when a worker starts there would close this.
  Waits on a case that needs it; the solver packages write their run documents as they go, so a
  lost tail is what is at risk.
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
- **Acknowledged means equal heads.** A run waits until the page's Repo (linked) or the sync server
  reports exactly the heads its documents have. A document that others keep changing while the run
  waits may match only after the limit, which costs the wait and never a write. Knowing that the
  other side's heads *include* the run's would be enough, and needs a question the Repo does not
  yet answer cheaply.
- **What the pool's registry exposes, for the isolation work.** A pool's workers have the
  plugin registry (README, "A pool has the plugin registry"). So plugin code of every installed
  package can be loaded by any task's code in a pool: in a browser, in a run worker of the site's
  origin, beside the run's input and keys; on a Node host, in a thread with its user's privileges
  (their files, environment, processes and network), and a host's main thread imports every
  listed package's entry to describe it. A lookup by id is not pinned to a package or a version:
  whichever installed package last registered that id answers, in the version installed. These
  are the isolation work's to answer, with trust as a whole.
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
