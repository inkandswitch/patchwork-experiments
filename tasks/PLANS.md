# Plans

Work that is known about and not being done yet. Each section says what is
known, so it can be picked up without finding it out again.

## Latency and throughput

Set aside on 2026-11-25 in favour of getting the system's design right first.
Everything below was measured that day on one Mac, in headless Chrome 158
against patchwork.inkandswitch.com, with the fork as published then: the
router-based system, now gone. Only the Node host's figures were measured
again since, with the pool (marked so).

### What a task costs

A task that does nothing, asked for one at a time with both workers idle,
from asking to the asker having the result (median of 30):

| Asker and worker | Median | p90 |
|---|---|---|
| Same browser, asker on the tab's tasks Repo | 47 ms | 105 ms |
| Same, code from a package rather than a `data:` URL | 50 ms | 86 ms |
| Same browser, asker on the site's own Repo | 529 ms | 682 ms |
| Node host, asker a separate peer on the same machine (router) | 525 ms | 584 ms |
| The same with the pool (median and worst of 10) | 735–744 ms | 813–980 ms |

With the pool, the Node figure splits as about 390 ms from asking to the
pool's run being appended (the queue's change and then the task reach the
pool's Repo through the sync server), 100 ms from that run to its end (about
50 ms of it in the run worker's thread, the rest saving the run's start and
handing over the task's document), and 255 ms from its end to the asker.
`probes/node-run.mjs` prints these as its first check.

The first run of a package's code adds about 80–170 ms in a browser (fetching
the module) and about 400 ms in a Node host (fetching the files from
automerge). For comparison, a bare worker on an empty page answers in
0.014 ms once it is running, and in 2–3 ms if a new worker is made per call.

The tab's tasks Repo and the workers' Repos share a database ("the family",
see `src/ids.ts`). The site's own Repo is not in the family, so anything asked
through it travels by the sync server both ways, as it does to a Node host.
That is the half second. `@awarth/tasklib` asks through the site's Repo.

### Where the time goes

One task in the router-based system, each step timestamped where it
happened (by a trace module that went with it), median time since asking:

| ms | Step | Since the last |
|---|---|---|
| 0.6 | task doc made | |
| 2.7 | task doc saved | 2.1 |
| 4.0 | listed in the queue | 1.3 |
| 7.2 | listing saved | 3.2 |
| 12.1 | router hands it out | 4.9 |
| 12.5 | worker told | 0.4 |
| 15.6 | worker has the task doc | 3.1 |
| 16.3 | code loaded and run | 0.7 |
| 16.6 | run recorded | 0.3 |
| 24.5 | run saved | 7.9 |
| 29.2 | asker has the result | 4.7 |

The work is under a millisecond. The rest is a document being saved by one
Repo and loaded by another, six times: a Repo in the family hears of a change
only when the Repo that made it has saved it, and then reads it from the
database.

### A run of quick tasks

Forty tasks of 20 ms asked for at once, on two workers, take about 2.8 s.
With nothing in the way they would take 0.4 s. Each worker's hand-over from
one task to the next, median:

| ms | Step |
|---|---|
| 1.3 | run recorded, worker says it is free (a change to its own doc) |
| 70–75 | that change reaches the router |
| 0.1 | router hands out the next |
| 0.4 | worker told |
| 9 | worker has the next task's doc |

So a worker does about twelve quick tasks a second, and nearly all of the
wait is the worker's own doc reaching the router.

### What was changed

- **Saved at once.** The asker's listing and the worker's run record are
  flushed as they are made (now in `task-client.js` and `pool.ts`). Before this a task
  took 217 ms, not 47: a Repo holds a document's changes for up to 100 ms
  before saving them (its `subductionSaveThrottle`), and both the ask and the
  result waited that out.
- **A router stopped believing a stale heartbeat.** A pool's once-a-second
  heartbeat repeats each worker's doc as the pool last had it. A heartbeat
  that caught a worker mid-task kept it marked busy until the next one, a
  second later. The forty-task run showed it: one worker idle for 1034 ms,
  the other not given its first task for 870 ms. A worker's doc then counted
  the tasks it had taken on, the heartbeat carried the count, and the router
  went by whichever was later. The stalls went; the total did not drop,
  because the next limit was the 70 ms above. (The router, its heartbeats
  and worker docs are gone now; a pool takes work itself.)
- **Tracing**, and `--latency N` on both probes (see below).

### Tried and taken out

Setting `subductionSaveThrottle: 0` on the family's Repos, in place of the
explicit flushes. Measured on its own, between two Repos sharing a database
on the real site, it does what it should:

| Pattern | Default (100 ms) | Zero |
|---|---|---|
| One change after a quiet spell | 6.6 ms | 5.5 ms |
| The second of two changes 20 ms apart | 90 ms | 9.5 ms |
| That pair, repeating every 45 ms | 63 ms | 8.6 ms |

The third row is a worker taking a task on and finishing it, over and over,
and 63 ms is the 70 ms in the hand-over above. But with the setting in the
fork, a single task took the same 40-odd ms and the hand-over still took
about 60. The built worker scripts did carry the setting. Why it made no
difference there is not known, so it is not in the code.

### Where to start

1. **The worker's "I'm free" reaching the router** was most of every
   hand-over. There is no router now: a pool frees its own slot when it has
   saved a run's end. Why the zero throttle did not act in the workers is
   still not known, and still worth finding out where a pool and its askers
   share a database.
2. **`flush` does more than save.** It also waits for storage to settle and
   for compaction, which is most of the 7.9 ms between a run being recorded
   and saved. The rest of the family needs only the save.
3. **One document fewer per task.** A task is its own doc, which the asker
   saves and the worker then loads: about 5 ms on the way out, more in a
   run of tasks. Putting a small task in its queue entry would remove both.
   That is a design question (what a task is) more than tuning.
4. **Asking through the right Repo.** Half a second against 47 ms. Anything
   in a tab that wants a quick answer should ask through the tab's tasks
   Repo, which `src/task-client.js` does when handed it.
5. **Capacity.** One run per run worker, and as many run workers as the
   pool has slots, is a separate limit from all of the above.

Not on the list, by decision (2026-11-25): sending the ask or the result as a
message ahead of the document. A worker would be acting on something not yet
saved, and it is a way round the system, not a faster system.

### Measuring it again

```
node probes/node-run.mjs
```

Its first check asks a Node host for ten tasks that do nothing, one at a
time, and prints the figures above; it runs the working tree's build
(`pnpm build:node`), and publishes nothing. `probes/real-run.mjs`, which
measured the browser, was written for the router-based system and waits to
be rewritten for the browser's pool.

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
  reaches the page by the sync server. A message-channel link to the pool's Repo would carry it
  directly and work offline. Waits on a network adapter that works with the Repo in use.
- **A new worker for every run.** A worker is reused after a run that ended by itself, so code one
  task leaves running shares a thread with the next. Confining task code (an opaque-origin worker in
  a browser) requires fresh workers, and so does treating tasks as strangers to each other. Waits on
  the link above, since a worker ended at once must first hand over what its task wrote.
- **A queue of one's own, and finding queues.** A page with no document that names a queue has
  nowhere to ask. The account's list of served queues could also hold queues that are only asked of.
  Waits on the lead's decision about the account document.
- **Secrets.** Nothing here holds one. Work that needs a key (model calls, agent sessions) stays
  where it is until run workers are confined and there is a rule for which runs may spend what.
- **The shim that resolves a task's bare imports is fetched from a CDN** each time a browser pool or
  run worker starts, so a browser pool cannot start offline. Bundle it.
- **Slots count threads, not kinds of work.** A run waiting on the network holds a slot a build
  could use. Waits on the first long-waiting work moving here.
