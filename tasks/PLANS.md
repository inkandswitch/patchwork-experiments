# Plans

Work that is known about and not being done yet. Each section says what is
known, so it can be picked up without finding it out again.

## Latency and throughput

A task that does nothing, asked by a Node process of a Node host on the same Mac through the sync
server (about 75 ms a round trip), takes about 750 ms from asking to the asker having the result:
median 747–758 ms, worst 813–835 ms (`probes/node-run.mjs` check 1, 2026-11-25). The browser pool
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
| The thread saves what the code wrote | 47 / 56 | Measured with the thread saving the imported task document too; it now saves nothing for code that writes nothing |
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
  refusal the pool now recovers from in about 250 ms.
- **Asking again on a short timer after a refusal** (50, 100, 200 ms…). About 95 ms slower at the
  median than listening for the document, and a review per timer.
- **Sending the ask or the result as a message ahead of the document** (the lead, 2026-11-25): a
  worker would act on something not yet saved, a way round the system and not a faster system.
- **Starting threads ahead of time, or handing the job over while the claim is saved.** The first
  is hidden once the pool's forced writes are gone; the second loosens "saved before its code is
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

- **Hold back for the preferred pool.** On a queue that several pools serve, each takes a listed
  task at once and all but one give way within a sync delay (measured: one yielded run per task on
  a two-host queue). A pool could wait a moment when it hears another pool serving that the task's
  url hashes to: advice only, so a wrong guess costs what happens today. Wanted before work that
  costs money to start (a model call) shares a queue between machines.
- **What a task needs of the machine.** An entry could carry `needs` (plain labels), a pool say what
  it has, and a pool take only what it satisfies, the way it already declines code it does not
  accept. Affinity follows: every run records its pool, so a follow-up can need, or prefer, the pool
  that ran its predecessor. Waits on the first queue served by two kinds of machine.
- **A link in memory between a pool and its run workers.** A run worker's Repo has storage of its
  own (a directory in Node, a database in a browser), so what a task writes through `ctx.repo`
  reaches the page by the sync server, and a run's ending waits until the server has acknowledged
  it. Measured on 2026-11-25 (FACTS.md, "What a task writes"), that costs a run from about 0.2 s
  (10 KB) to 0.5 s (5 MB) and 1.1–1.8 s (20 MB) in Node, 0.2–1.7 s up to 5 MB in a browser, and
  an asker in another process then fetches what it could have been handed: 0.1–0.5 s up to
  1 MB, about 1 s at 5 MB, 3–10 s at 20 MB. With no server, what a run writes stays in its worker's storage. A
  message-channel link to the pool's Repo would carry it directly and work offline. Waits on a
  network adapter that works with the Repo in use.
- **A new worker for every run.** A worker is reused after a run that ended by itself, so code one
  task leaves running shares a thread with the next. Confining task code (an opaque-origin worker in
  a browser) requires fresh workers, and so does treating tasks as strangers to each other. Ending
  a worker once its run has ended loses nothing it wrote (the ending waits for the sync server;
  offline, the run's log says the writes stayed on the machine), so this waits only on confinement
  and on what a fresh worker costs: a run that wrote something ends only once the new worker's
  Repo has made its first connection to the server (not measured on its own).
- **What a stopped worker leaves behind.** A run worker ended before the server acknowledged what
  its run wrote (a stopped run not done within five seconds, a process or tab that died, a run
  written offline) leaves it in that worker's storage, and the next worker on the same storage does
  not send it: the Repo loads a stored document only when something asks for it. Sending what a
  slot's storage holds when a worker starts there would close this. Waits on a case that needs it;
  the solver packages write their run documents as they go, so a lost tail is what is at risk.
- **Finding queues.** A page with no document that names a queue asks its person's own queue
  (`ownQueue`). Queues one only asks of, and does not serve, have no place to be kept: the task
  storage could keep them as root keys of their own whose setting serves nothing, and tools pick
  from those. Waits on the first tool that asks a queue it does not serve.
- **Acknowledged means equal heads.** A run waits until the sync server reports exactly the heads
  its documents have. A document that others keep changing while the run waits may match only after
  the limit, which costs the wait and never a write. Knowing that the server's heads *include* the
  run's would be enough, and needs a question the Repo does not yet answer cheaply.
- **The shim that resolves a task's bare imports is fetched from a CDN** each time a browser pool or
  run worker starts, so a browser pool cannot start offline. Bundle it.
- **Slots count threads, not kinds of work.** A run waiting on the network holds a slot a build
  could use. Waits on the first long-waiting work moving here.
