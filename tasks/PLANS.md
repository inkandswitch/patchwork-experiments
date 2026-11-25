# Plans

Work that is known about and not being done yet. Each section says what is
known, so it can be picked up without finding it out again.

## Latency and throughput

Set aside on 2026-11-25 in favour of getting the system's design right first.
Everything below was measured that day on one Mac, in headless Chrome 158
against patchwork.inkandswitch.com, with the fork as published then.

### What a task costs

A task that does nothing, asked for one at a time with both workers idle,
from asking to the asker having the result (median of 30):

| Asker and worker | Median | p90 |
|---|---|---|
| Same browser, asker on the tab's tasks Repo | 47 ms | 105 ms |
| Same, code from a package rather than a `data:` URL | 50 ms | 86 ms |
| Same browser, asker on the site's own Repo | 529 ms | 682 ms |
| Node host, asker a separate peer on the same machine | 525 ms | 584 ms |

The first run of a package's code adds about 80–170 ms in a browser (fetching
the module) and about 400 ms in a Node host (fetching the files from
automerge). For comparison, a bare worker on an empty page answers in
0.014 ms once it is running, and in 2–3 ms if a new worker is made per call.

The tab's tasks Repo and the workers' Repos share a database ("the family",
see `src/ids.ts`). The site's own Repo is not in the family, so anything asked
through it travels by the sync server both ways, as it does to a Node host.
That is the half second. `@awarth/tasklib` asks through the site's Repo.

### Where the time goes

One task, each step timestamped where it happens (`src/trace.ts`), median
time since asking:

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
  flushed as they are made (`job-client.ts`, `worker.ts`). Before this a task
  took 217 ms, not 47: a Repo holds a document's changes for up to 100 ms
  before saving them (its `subductionSaveThrottle`), and both the ask and the
  result waited that out.
- **A router no longer believes a stale heartbeat.** A pool's once-a-second
  heartbeat repeats each worker's doc as the pool last had it. A heartbeat
  that caught a worker mid-task kept it marked busy until the next one, a
  second later. The forty-task run showed it: one worker idle for 1034 ms,
  the other not given its first task for 870 ms. A worker's doc now counts
  the tasks it has taken on, the heartbeat carries the count, and the router
  goes by whichever is later (`heardRunning` in `claims.ts`). The stalls are
  gone; the total did not drop, because the next limit is the 70 ms above.
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

1. **The worker's "I'm free" reaching the router.** Most of every hand-over.
   Either find out why the zero throttle did not act in the workers (watch
   the family's heads channel for when a worker's doc is announced as saved,
   against the trace of when it changed), or flush the worker's own doc the
   way the task doc is flushed. The isolated measure says about 9 ms is there
   to be had, which would be roughly a fourfold gain on a run of quick tasks.
2. **`flush` does more than save.** It also waits for storage to settle and
   for compaction, which is most of the 7.9 ms between a run being recorded
   and saved. The rest of the family needs only the save.
3. **One document fewer per task.** A task is its own doc, which the asker
   saves and the worker then loads: about 5 ms on the way out, more in a
   run of tasks. Putting a small task in its queue entry would remove both.
   That is a design question (what a task is) more than tuning.
4. **Asking through the right Repo.** Half a second against 47 ms. Anything
   in a tab that wants a quick answer should ask through the tab's tasks
   Repo, which `src/job-client.ts` does when handed it.
5. **Capacity.** One task per worker, two workers per browser, is a separate
   limit from all of the above.

Not on the list, by decision (2026-11-25): sending the ask or the result as a
message ahead of the document. A worker would be acting on something not yet
saved, and it is a way round the system, not a faster system.

### Measuring it again

```
node probes/real-run.mjs <automerge:package url> --latency 30
node probes/node-run.mjs <automerge:package url> --latency 30
```

The first prints the step table, the four figures for one task, and the
forty-at-once run with each worker's hand-over. The second prints the figures
through a Node host. Publish the build to a package of its own first (see the
probes' headers): the probes run what is published, not the working tree.
