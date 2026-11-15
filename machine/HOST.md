# The host

`src/host/` runs one machine session on each peer. It works for any engine
under [ENGINE.md](ENGINE.md), and knows nothing about Doom, the Super NES or
the toy.

Every present peer runs the engine itself, from the same inputs, as a
replicated reducer. Nobody's state is authoritative. The documents hold only
what is needed to rebuild the state:
- the engine's identity;
- who holds which port, and when;
- every port's inputs;
- checkpoints.

Live play runs ahead of the documents:
- Inputs travel as ephemeral messages.
- A missing input is predicted.
- A late input that proves a prediction wrong rolls the engine back and steps
  it again.

| file | what |
|---|---|
| `timeline.js` | the rollback core: belief about inputs, snapshots, the frontier; no I/O |
| `session.js` | the documents' shape, and pure functions over them: seating, chunks |
| `clock.js` | ticks from a clock; the session's stand-in for `api.clock`; a shared wall time |
| `host.js` | `createSession`, `Host.open(repo, url, …)`: the frame loop, seats, messages, durable writes, checkpoints, late join |
| `simnet.js` | an in-memory automerge-repo network with fixed latency and loss tables |
| `harness.js` | test support: peers in virtual time, and replaying a session's documents from scratch |

## Using it

```js
const handle = await createSession(repo, { wasm, content });
const host = await Host.open(repo, handle.url, { wasm, content, input: () => myPad });
host.sit(0);                    // take port 0, half a second from now
// every animation frame:
host.frame();                   // steps for at most `budget` ms (10), at least one step
draw(host.engine.frame(view));  // never step host.engine yourself
host.pause(); host.resume(); host.stand();
```

`host.tick` is the tick the engine is at. `host.frontier` is the first tick
whose inputs are not all known; below it, the state is the one every peer
has. `host.status` reports:
- `desync`: checkpoints whose hash differs from ours;
- `rebases`;
- `asked`: inputs requested again;
- `written`: chunks and checkpoints written.

`host.stats` reports rewinds, ticks re-stepped, and steps.

## The documents

```
session      engine: { wasm, content, genesis, hz: [num, den], players, inputBytes }
             vacant: bytes     chunk, every, roll: ticks
             clock: { t, at, until? }
             seats: { [id]: { port, by?, from, until?, inputs: url } }
             checkpoints: { [tick]: { url, hash, seating } }   the two newest
seat inputs  { session, seat, port, from, chunks: { [n]: bytes } }     only its holder writes
checkpoint   { session, tick, hash, state: gzip(snapshot) }             written once
```

Engine and content are SHA-256 hashes, so a commercial ROM never enters a
document. Each peer supplies its own copy, and `Host.open` refuses a
mismatch. `genesis` is the state's hash after boot. Start parameters, such as
Doom's skill and map, are part of the content (ENGINE.md: content is one byte
string, for example `doom.js`'s `content({ wads, args })`).

**Inputs: one document per seat, one writer each, one chunk a second.**
- Chunk `n` of a seat holds its inputs for ticks `[max(from, n·chunk), …)`,
  back to back.
- A chunk is written when its second is complete. It is written early only
  when the clock pauses or the holder stands, and then rewritten by the same
  holder when the second completes.
- No two peers ever write the same key, or even the same document. So once a
  holder has written its inputs, merging can never change them.
- When Keyhive arrives, a seat document can be made writable by its holder
  alone.

Measured (`node bench/doc-shape.mjs 120`):
- **Setup:** 4 players, 8-byte inputs, 35 Hz; Automerge 3.3.0-fragments.2,
  Node 24, Apple M4.
- **"receive"** is the time to apply one second's changes to a replica that
  has everything else.
- **"shared doc"** is the alternative: every seat's chunks in one document
  with four writers.

| play | shared doc: size / cold load / receive per s | doc per seat (4 docs): size / load / receive per s |
|---|---|---|
| 10 min | 115 KB / 14 ms / 0.95 ms | 114 KB / 8 ms / 0.70 ms |
| 30 min | 342 KB / 27 ms / 3.35 ms | 343 KB / 24 ms / 1.84 ms |
| 60 min | 685 KB / 53 ms / 6.84 ms | 686 KB / 44 ms / 4.56 ms |
| 120 min | 1.37 MB / 131 ms / 15.4 ms | 1.37 MB / 103 ms / 11.3 ms |

- Size is the same either way. Automerge compresses byte values about as well
  as gzip.
- What grows is the cost of receiving, because it is proportional to the
  number of changes a document holds (state-verify's finding).

**Seat documents roll every 10 minutes (`roll`).**
- At each boundary, the holder ends its seat and takes the same port again
  with a new document, in a single change.
- That caps every seat document at 600 changes: at most 0.7 ms a second to
  receive, and about 50 KB and under 10 ms to load. This holds however long
  the session runs.
- A roll is just a seat ending and a seat starting, so it needs no machinery
  of its own.

**Checkpoints: their own immutable documents, gzipped, every 60 s (`every`).**
- **Never in the session document:** Automerge keeps every replaced value, so
  1 MB checkpoints would grow it by 20 MB per 10 minutes (state-verify).
- **gzip via `CompressionStream`:** it runs off the calling thread. Measured with `node bench/checkpoint.mjs`, and Doom and the Super NES with their engines directly.

| state | raw | gzipped | gzip | gunzip |
|---|---|---|---|---|
| toy | 512 KB | 41 KB | 5.6 ms/MB | 2.8 ms/MB |
| Doom, Freedoom E1M1, 4 players | 6.56 MB | 2.4 MB | 117 ms | — |
| Super NES, Unarmed | 3.38 MB | 296 KB | 27 ms | — |
| heap-like 8 MB (synthetic) | 8 MB | 2.6 MB | 11 ms/MB | 2.1 ms/MB |
| incompressible 4 MB | 4 MB | 4 MB | 15 ms/MB | 0.9 ms/MB |

- **The 2.6 MB gzipped state in its own document:**
  - change 6 ms, save 62 ms, load 20 ms;
  - the same bytes stored raw: change 19 ms, save **282 ms**, load 37 ms.
    Automerge deflates the raw bytes itself, on the calling thread.
- **Why 60 s:**
  - A late joiner replays at most a minute of inputs. That is 2100 Doom
    ticks, 25 ms at 11 µs a step, or 3600 SNES frames.
  - Every peer's repo pays one save stall of tens of milliseconds a minute.
- **Pointer retention:** the session document keeps pointers to the two
  newest checkpoints, so its own history grows by about one small change a
  minute.
- **Who writes a checkpoint:**
  - The holder of the lowest held port, once the state at that tick is
    confirmed.
  - If nobody has written it a period later, the reference peer of the shared
    wall time writes it.
  - Two copies hold the same state, so either may win the key.
- **Verification:** every peer compares its own confirmed hash with the
  checkpoint's. A mismatch goes in `status.desync`.

## Live play

- **Messages.** Each holder sends its port's inputs as an ephemeral
  broadcast, `{ m: "in", seat, at, bytes }`.
  - A message goes out whenever there is a new input. It repeats the last 8,
    so one lost message costs nothing.
  - With nothing new to send, a message still goes out every 250 ms. That is
    the holder's heartbeat.
- **Gaps.** A peer missing an input below one it has asks the holder for it:
  `{ m: "need", seat, from }`. The answer covers up to four chunks.
  - In the burst test, 12 messages lost in a row per 40, with chunks of 2 s,
    the confirmed state trails the clock by at most 12 ticks.
  - Without asking it trails by 43, until the chunk lands.
- **Input delay `d`** = `round(0.1 s × hz)`: 4 ticks for Doom and the toy, 6
  for the Super NES. The rollback experiment's input-delay table (4 players,
  100 ms ±30% one-way) gives the basis:

  | d | rollbacks per second | displayed tics that differ from the final state |
  |---|---|---|
  | 0 | 16.6 | 79.6% |
  | 2 | 16.6 | 63.5% |
  | 4 | 6.8 | 17.5% |

  A delay of about the one-way latency removes most visible corrections.
  - `d` is local. Each peer stamps its own inputs, so peers may choose
    differently.
- **Prediction.** A missing input repeats the port's last known one.
- **Snapshots** (timeline):
  - Past the frontier, one every `every = 4` ticks. The rollback
    experiment's interval table shows cost flat from 4 and re-step depth
    growing past it.
  - Always one at the frontier itself.
  - Below the frontier, where nothing can be rolled back, one every 64
    ticks, only to move the floor.
  - Dropped snapshots are reused rather than reallocated.
  - Measured copy costs: Doom 0.57 ms for 6.56 MB, the Super NES 0.08 ms for
    3.38 MB.
- **Per-frame cost.** Measured with 4 peers on the WAN table with 1 in 10
  lost and one joining late, over all peers' `frame()` calls:

  | engine | p50 | p90 | p99 | max |
  |---|---|---|---|---|
  | Doom | 0.04 ms | 0.51 ms | 2.8 ms | 12.8 ms |
  | Super NES | 1.6 ms | 1.7 ms | 17 ms | 179 ms |

  - The SNES costs come from its 1.6 ms step: one step a frame, more after
    a rollback.
  - The SNES maximum is a joiner catching up on the frame thread, measured
    before the host had a time budget: `budget` (10 ms by default) now
    bounds the stepping in a frame, so a catch-up or a deep rollback spreads
    over frames.

## Time

The host never reads a wall clock to decide the tick. It reads a clock
`{ t(), running() }` and steps to `floor(t · hz)`, with `hz` the engine's
exact ratio.

The session carries the machine's own time, over a time its peers share:
the scene's world time in a scene (`worldClock`, "Phase 2b, in a scene"
below), a shared wall clock standing alone (the Machine tool):
- **`SessionClock`:** `{ t, at, until? }` in the session document.
  - At shared time `at` (ms) the machine's time was `t`. It runs at one
    second per second until `until`.
  - A run starts at `at`, never before: a peer whose shared time is short
    of it holds at `t`, so resuming never takes it below the tick it
    stopped at. `at` is the offset that makes tick 0 the machine's first
    moment, however far into the shared time it was made.
  - **Pause** writes `until` a quarter second ahead, so every peer has heard
    of it before reaching it and stops at the same tick. A peer that has
    already passed that tick rewinds to it, provided the tick is not below
    its floor.
  - A stop once set stands until a resume: a second pause within its
    margin would set an earlier one, which a peer ahead of the second
    pauser may already have passed.
  - **Resume** clears `until`.
  - A pause or resume rewrites the whole object, so a pause and a resume at
    the same moment settle by last writer and never mix.
  - Anyone may pause or resume (the lead's decision 5).
- **`SyncedWall`:** shared wall time over ephemeral ping and pong.
  - The reference is the smallest peer id heard from lately.
  - Every other peer takes the reference's time from the answer with the
    shortest round trip among the last 8, plus half that trip.
  - When the reference leaves, the next smallest has been following it.
  - In the tests, local clocks skewed by up to 143 ms agree on the tick:
    - within 1 tick on the LAN table (20–30 ms);
    - within `ceil(latency spread × hz)` on the WAN table (60–250 ms). Each
      estimate is off by at most half the spread of one-way latencies, and
      two peers' errors can add.

## Seats

A seat is `{ port, from, until? }`. Its id is `<peer id>.<from>`.
- **`seating(seats)`** is a pure function:
  - Seats are taken in `(from, id)` order.
  - Each seat is accepted if its port is free at its `from`.
  - A seat with `until ≤ from` is void.
  - So two people taking a port at once settle the same way everywhere: the
    earlier `from` wins, then the smaller id.
- **Taking a port.** `sit` takes the port half a second ahead (`claim`), so
  the others normally hear of it first.
- **Losing a race.** A peer that loses one voids its claim (`until = from`),
  for good.
- **Reaping.** A holder silent for 10 s (`reap`) loses the rest of its seat.
  - Any peer may end that seat where its durable inputs end, as that peer
    sees them. Two reapers settle by last writer.
  - Inputs that only ever went by message are then void for everyone.
- **A port nobody holds** sends `vacant`, which is zeros unless the session
  says otherwise.
  - That is the bot hook. An engine with a bot, such as Doom's closed-loop
    bot, plays a port whose input is vacant (or whose "present" bit is
    clear) itself, inside the engine. Who plays is then part of the
    deterministic state.

A seat change can reach into the past: a reap, a lost race, or a late claim.
- **Above the floor:** it is one more belief change, and the timeline rolls
  back.
- **Below the floor:** the peer starts again (a *rebase*). It uses the newest
  state at or before the change that it can have: a confirmed checkpoint
  already in hand, one in the documents, or genesis. Then it replays the
  durable inputs.
- **Checkpoints after the change are stale, by construction.** Each
  checkpoint, in the document or in a peer's hand, records `seating`, a
  64-bit key of who held each port over ticks [0, tick) (`seatingKey`). The
  state at a tick is a function of that seating and the seats' inputs, and
  a seat's input at a tick is made once by its one writer, so a checkpoint
  whose key is not the current seating's is stale, whoever wrote it and
  whenever. No peer starts from one, verifies against one, or writes one
  (a write whose seating changed while it was gzipping is abandoned); any
  peer that sees one in the document deletes it, on any change, so one
  written concurrently with the seat change by a writer that then vanished
  goes too. Confirmed again, they are written again.

## Late join

`Host.open` is a rebase to "now":
1. Check the engine and content hashes.
2. Restore the newest checkpoint, checking its hash, or boot and check
   genesis.
3. Load every seat document that matters from there.
4. Go live.

The few inputs not yet in a chunk come by asking their holders, the same
way gaps do. In the tests, the joiner starts from a checkpoint and settles on
the same state as everyone else, for the toy, Doom and the Super NES.

## Tests

All tests are finite: fixed tables and scripts, no randomness. Virtual time
comes from fake timers.

**`timeline.test.js`** (about 8 s):
- **Every arrival order.** Every arrival order of the inputs of 3 ticks ×
  2 ports, interleaved every way with the 3 local clock ticks, advancing
  after every event: 60,480 runs.
  - The state is always the spec's (stepped from boot with known-or-repeated
    inputs).
  - `put` reports a re-step exactly when the spec changed below the clock.
  - A confirmed state is the in-order run's.
- **Every arrival tick.** Every arrival tick of those inputs (4⁶), with a
  local port at delay 0, 1 and 2, at snapshot spacing 1, 2 and 4: 36,864
  runs.
  - The same checks hold.
  - Each checkpoint is handed over once, with the in-order state.
- **Every belief change.** Every change between two beliefs about one port's
  three inputs (unknown, A or B each), at every pair of clock positions:
  11,664 cases.
  - These include rewinds across memory growth.
  - A change below the floor is refused.
- **Other cases:**
  - a port that never arrives (snapshots stay capped, and late inputs repair
    everything);
  - rare snapshots where every input is known;
  - the step limit.

**`session.test.js`:**
- `seating` is checked against a declarative statement (the unique
  fixpoint, found by trying every subset) for every set of up to three seats
  with `from` in {0,1,2} and `until` in {none, 0..3}: 3,615 cases.
- `firstDifference` is checked against tick-by-tick comparison for every
  pair of seatings of up to two seats on two ports: 65,536 pairs.

**`host.test.js`** (real automerge-repo on `SimNet`):
- **Latency × loss × peers.** {LAN, WAN} × {lossless, 1 in 10 ephemeral
  lost} × {2, 3} peers, with skewed clocks, seats rolling every 2 s and
  checkpoints every 1 s. Each run plays, pauses, and must have:
  - every peer at the same tick, with every input below it;
  - one hash, equal to the documents replayed from genesis;
  - at every tick each peer confirmed, from where it started, the state the
    documents give there (the harness traces every step's hash);
  - no desync.
- **Other cases:**
  - a late joiner (starts from a checkpoint);
  - a late joiner on a time budget (catches up 5 steps a frame);
  - two peers taking one port at once (one holds it everywhere; the loser's
    claim is void);
  - a holder who vanishes (reaped, the others carry on);
  - standing and sitting again;
  - a loss burst (inputs asked for, lag bounded);
  - a seat ending below the floor (the peer rebases, and still agrees).

**`engines.test.js`:** four peers of Doom (skipped without the IWAD) and of
the Super NES on Unarmed, WAN with loss, one joining late, must all agree
with the documents.

**`bench/integration.test.js`** (`pnpm bench:integration`, about 45
minutes) does the same at full length with the host's default periods:
Doom on the bot demos and the Super NES on scripted Unarmed, 2 and 4
players, 0, 50 and 150 ms one-way, and a late spectator. It measures as it
goes; the numbers are in [README.md](README.md).

**Mutation checks**, each failing the tests that should catch it:
- the timeline ignoring a dirty tick 0;
- the frontier overshooting;
- prediction skipping the previous tick;
- checkpoints handed over before they are confirmed;
- no flush on pause;
- no clock sync;
- a loser keeping its claim;
- no rebase.

Without asking for gaps, only the burst test's lag bound fails. A
retraction treated as always dirty survives, as it should: it costs extra
re-steps, not correctness.

## Not done yet

- **The scene extension:** half built ("Phase 2b, in a scene" below).
- **Running the engine in a worker:** built ("Phase 2, the host side"),
  not yet used in a scene.
- **Deep rebases** to before the oldest retained checkpoint replay from
  genesis, loading every seat document. That is correct but slow for long
  sessions.
- **Cost.**
  - A snapshot is a full memory copy, about 0.1 ms per MB.
  - Hashing is about 0.5 ms per MB, done only at checkpoints.
  - Dirty-page tracking would cut both, but it needs a cooperating engine.

## Phase 2, the host side

Built before the scene's clock and bodies exist; none of it needs them. The
clock stays injectable: `Host.open(…, { clock })` takes any
`{ t(), running(), pause?(), resume?() }`, and `RemoteHost` reads such a
clock on the page each frame and hands the worker its `t` and `running`.
When `api.clock` lands it is passed as is (if its `t` is a property rather
than a method, a one-line adapter).

The surface, the same for a host on the page and one in a worker:

```js
host.frame();                       // as often as the view draws
const p = host.picture(view);       // { width, height, rgba } (a screen's texture)
for (const o of host.output()) …    // what the machine played since the last call (below)
host.sit(port); host.stand(); host.pause(); host.resume();
host.tick; host.frontier; host.revision; host.seat; host.status; host.stats;
await host.close();                 // a RemoteHost's waits until the page holds its writes
```

| file | what |
|---|---|
| `output.js` | what a listener hears under rollback: one policy, every engine |
| `../worker/remote.js` | `RemoteHost.open(repo, url, { worker, … })`: the page's side |
| `../worker/serve.js` | `serve(endpoint)`: the worker's side; `worker.js` is the entry |
| `../worker/port.js` | `PortAdapter`: an automerge-repo network adapter over a MessagePort |

### Decisions, made unattended (the lead was away)

**1. The host runs in a worker whole, with a repo of its own.**
- The worker (`serve.js`) runs `Host.open` unchanged, on an automerge-repo
  of its own with no storage, whose one peer is the page's repo over a
  `MessageChannel` (`PortAdapter`). That is how Patchwork's tab repo already
  reaches its shared worker, so it is the platform's own idiom.
- **Why not keep the handles on the page** and proxy reads and writes: the
  host reads and writes five documents, creates seat and checkpoint
  documents with URLs it needs at once, and sends and hears ephemeral
  messages. Mirroring that across threads means a sync state per document
  and ids made on the far side: re-implementing what automerge-repo does
  between two repos, and less well. Correct by construction instead:
  Automerge sync converges over any reliable ordered channel, and a
  MessagePort is one.
- **What the page's repo does:** it stores everything (the worker's repo
  keeps nothing), and relays the worker's ephemeral messages like any
  peer's. Patchwork's tab repo announces documents only to its shared
  worker (`sharePolicy`), so the machine worker (peer id `machine-…`) gets
  exactly the documents it asks for. `bench/worker` runs its page repos
  with that policy.
- **What it costs:** each document the host touches is held twice (the
  session ~1 KB, a seat ≤ 50 KB, a checkpoint 0.3–2.5 MB), and each change
  crosses the channel once, as a structured clone.
- **Pictures are transferred, not shared.** SharedArrayBuffer needs
  cross-origin isolation, which Patchwork cannot assume. A picture is a
  fresh copy out of the engine's memory anyway (`frame()` draws on a copy),
  so handing its buffer over costs nothing. The worker draws a view only
  when the page asked for it (`picture(view)`) and the state changed since
  it last drew it: its tick or `host.revision`, which counts steps and
  restores (a rollback can re-step to the same tick and reach another
  state there, as when a late input lands while paused).
  Audio samples are copied, then transferred: the host keeps what it
  delivered, to compare re-simulations with.
- **The page never waits.** `frame()` sends a request unless one is out;
  the answer brings the state, the pictures and the output. What the page
  shows is at most one worker frame old.
- **The budget is 25 ms in a worker** (10 on the page): the page does not
  wait for it, and a joiner catches up a quarter sooner (below).
- Options cross to the worker as data; functions such as `now` and `perf`
  are the worker's (`serve(endpoint, { now })` in tests).
- **Closing loses nothing.** The worker's repo stores nothing and syncs a
  change after it is made, so a link cut at once would drop the worker's
  last writes (a stand, the last chunk, a checkpoint). `close()` stops the
  host in the worker, which answers with the heads of every document its
  repo holds; the page keeps the link until its own repo has them all (or
  `wait` ms pass, for a worker that died), then closes it, and the
  worker's repo shuts down. Await it before ending the worker. After it,
  the page sends nothing and ignores any answer still in flight, and the
  worker refuses requests. One worker serves one host.

**2. Audio under rollback: deliver each tick once, at a lag; correct
events, crossfade samples.** `output.js`, the same for every engine:
- A tick's output is delivered once: when it is confirmed, or once the head
  is `lag` ticks past it (default 0.05 s: 3 SNES ticks, 2 Doom tics),
  whichever comes first. Until then a re-simulation just replaces it.
- A re-simulated delivered tick whose output is the same is not delivered
  again (dedupe).
- If its events differ, a correction `{ tick, events, was }` goes out while
  it is at most `late` (0.25 s) old: an interpreter starts late what is new
  and stops what is gone. For Doom that is a sound record appearing or
  disappearing; `doom.js`'s `events()` decodes both sides.
- Samples cannot be corrected, only continued. If the last delivered tick's
  samples were re-simulated differently, the next tick is crossfaded over
  its length from what the old timeline would have played next (or the
  last frame held) into the new one. Otherwise the new timeline continues
  what was played exactly, since its samples up to the boundary are the
  played ones.
- Ticks more than `stale` (0.25 s) behind where the stream should be are
  skipped, as a gap `{ gap: [from, to] }` (a joiner catching up, a stall),
  and the stream fades in from silence after it.
- **Routing:** the SNES's output is a PCM stream (stereo, 32 kHz, ~533
  frames a tick), for one positional source at its screen. Doom's is events
  with positions (`events()`: name, volume, origin x/y/z), for the scene to
  play the WAD's lumps (`sounds()`) at their origins.
- **Rejected:** confirmed ticks only. Exact by construction, but at WAN
  latency it plays 100–150 ms behind the picture, and a vanished holder
  silences everything until it is reaped (10 s). Confirmed-only is `lag:
  Infinity`, one option away.

**3. Traffic.**
- **At most 30 input messages a second per peer, whatever the engine's rate
  or the display's** (`send`, ms, default 1000/30). A token bucket keeps the
  average exact although frames quantize when a message goes. Each carries
  every input not sent yet plus the last 8 (the old rule sent only the last
  8, so a long frame could leave inputs to the chunks). A lost message
  costs nothing while the next one comes within 8 ticks.
- **Checkpoints can't be deleted.** automerge-repo has no distributed
  delete: `repo.delete` drops only the local copy; the sync server and the
  other peers keep theirs. So the session document now **links every
  checkpoint** made under the current seating instead of the two newest
  (stale ones, computed under another seating, are still unlinked). The
  documents exist anyway; linking them costs the session document nothing
  measurable (below), and it bounds the replay of any rebase.
- **A rebase earlier than the oldest checkpoint no longer replays from
  genesis**: it starts at the newest linked checkpoint at or before the
  change, so it replays at most one period (60 s: 3600 SNES frames, 5.8 s
  of CPU in the worker; 2100 Doom tics, 17 ms). Before, a change two
  minutes back in an hour-long session replayed the hour: 216,000 SNES
  frames, about 6 minutes of CPU, and every seat document since the start.

**4. Faults.**
- **A trap holds the timeline, it does not throw.** A step that traps has
  half-written memory, so the timeline restores the state before it, keeps
  it, and holds there while that state and the row it would step are the
  ones that trapped (`timeline.fault`). A belief change lets it try again,
  so a trap met only on a predicted input goes when the real input comes.
  Below the frontier it is confirmed: every peer with these inputs meets
  it.
- **The frame goes on.** `status.fault = { tick, error, confirmed }`; this
  peer still samples and sends its input, writes its chunks and reaps, so
  nobody waits for it and nobody reaps it. A trap only here leaves the
  others playing; a deterministic trap stops everyone at the same tick,
  agreeing.
- **A worker's failure is a status too** (`status.error`), kept across its
  reports.
- **Checkpoint writing survives a faulted writer.** One confirmed but not
  written a period later is written by the shared clock's reference peer;
  two periods later, by anyone (the reference may be the faulted peer).
- **Divergence** was already reported (`status.desync: [{ tick, ours,
  theirs }]`); it is now tested. A peer cannot tell which side is wrong
  from one checkpoint, so it says so and does nothing else.

### Numbers

Apple M4, Node 24, headless Chrome 157; other agents' builds were running
throughout, so real-time figures are noisy.

**The worker** (`pnpm check:worker`, `bench/worker/`): a Super NES session
on Unarmed in a headless Chrome page, page repos on an in-page SimNet (LAN,
real time). a and b play from the start, each host in a worker; at 55 s c
opens the session from the 30 s checkpoint, about 1550 frames behind. Every
animation frame the page asks each host for a frame and draws each peer's
picture into a canvas. Measured on the page's thread from c's open until 3 s
after it caught up: long tasks (> 50 ms), frame intervals, and the time each
frame spent on the machines ("work").

| c runs | catch-up (s) | long tasks: count / total / max (ms) | frame interval p50 / p99 / max (ms) | frames over 33 ms | page work per frame p50 / p99 / max (ms) | page work in all (ms) |
|---|---|---|---|---|---|---|
| in a worker (budget 25 ms) | 4.1 | 0 / 0 / 0 | 16.7 / 16.8 / 16.8 | 0 | 0.1 / 0.2 / 0.2 | 26 |
| on the page, budget 10 ms | 4.8 | 0 / 0 / 0 | 16.7 / 16.8 / 33.3 | 0 | 10.2 / 12.0 / 22.3 | 3,700 |
| on the page, no budget | 4.3 | 7 / 4,238 / 2,574 | 16.7 / 467 / 2,567 | 9 | 2.5 / 459 / 2,574 | 4,890 |

- **In a worker the page does nothing for the machines**: 0.1 ms a frame,
  26 ms in 7.3 s, no long task, no late frame, while c catches up 1,556
  frames (about 2.5 s of SNES CPU) and a and b play on. The same 10 s
  before c joined: 0.1 ms a frame.
- **Phase 1's budget alone already prevents long tasks**, but it takes 10–12
  ms of every 16.7 ms frame for 4.8 s: a scene drawing beside it would drop
  frames. Without the budget, the page freezes for 2.6 s.
- An earlier run with the worker's budget at 10 ms took 5.2–6.3 s to catch
  up; at 25 ms, 3.8–4.1 s; at 50 ms, no faster (4.0 s). Hence 25.
- Afterwards all three stopped at the same tick on pause. (That their states
  agree with the documents is the Node test's to show; check:browser
  showed Chrome's engines agree with Node's bit for bit.)

**Output** (`pnpm bench:output`, `bench/output.test.js`): one run per
engine over SimNet's WAN table with 1 in 10 messages lost; every step each
peer took is recorded with its output, so the same run is heard at every
lag, the policy being a pure function of that record. Against the documents'
outputs; a click is a boundary jump more than 0.02 of full scale past the
documents' jump there.

| engine | lag (ticks) | latency (ms) | samples wrong | crossfades | clicks | clicks without crossfades (worst jump) | events right when heard | corrected | left wrong |
|---|---|---|---|---|---|---|---|---|---|
| SNES, 2p, 45 s | 0 | 0 | 2.26% | 25 | 0 | 8 (0.10) | — | — | — |
| | 1 | 15 | 1.72% | 21 | 0 | 4 (0.08) | — | — | — |
| | 3 (default) | 44 | 0.83% | 11 | 0 | 2 (0.05) | — | — | — |
| | confirmed only | 104 | 0 | 0 | 0 | 0 | — | — | — |
| Doom, 4p, 30 s | 0 | 0 | — | — | — | — | 99.69% | 10 | 3 |
| | 1 | 28 | — | — | — | — | 99.69% | 10 | 3 |
| | 3 | 84 | — | — | — | — | 99.76% | 10 | 0 |
| | confirmed only | 148 | — | — | — | — | 100% | 0 | 0 |
| toy, 3p, 20 s | 0 | 0 | 72% | 448 | — | — | 99.43% | 12 | 0 |
| | 3 | 78 | 40% | 315 | — | — | 99.76% | 5 | 0 |
| | confirmed only | 136 | 0 | 0 | — | — | 100% | 0 | 0 |

- **On a real game, rollback rarely reaches the sound.** Unarmed's audio
  follows its state by frames, so even at lag 0 only 2.3% of ticks played
  differ from the record, nearly all in the menus. A single changed input
  in a round (a one-off check, 43 trials) changed the audio within 40
  frames once.
- **The crossfade removes every click it meets:** 8 boundaries at lag 0
  would jump up to 0.10 of full scale (−20 dB) without it; with it, none
  past 0.02. The exhaustive test proves the bound: a crossfade adds at
  most one tick's worth of slope.
- **Doom's sound records are right when heard 99.7% of the time;** the
  rest are corrected, except 3 ticks at lag 0 and 1 whose correction came
  more than `late` after they were heard.
- **The toy is the worst case,** its samples changed by every input at
  once: 72% of ticks heard at lag 0 differ from the record. That is what
  `lag` buys back, tick for tick.
- **So the default is 0.05 s:** it halves the SNES's wrong ticks, closes
  the late Doom corrections, and audio 50 ms behind the picture is within
  what people accept (sound trailing picture is tolerated to about 100 ms).

**Traffic** (`pnpm bench:traffic`, `bench/traffic.test.js`): 4 players, 20
s, 150 ms one-way fixed; inputs that change all the time. Per peer, per
second: messages it broadcast; ephemeral messages on the wire, sent and
received; rollbacks, ticks re-stepped, and the frontier's mean lag behind
the head.

| engine | topology | send | broadcast | sent | received | hub out | rollbacks | re-stepped | frontier lag (ticks) |
|---|---|---|---|---|---|---|---|---|---|
| SNES | mesh | every frame | 64 | 577 | 577 | — | 9.6 | 42 | 3.6 |
| | mesh | 30/s | 34 | 306 | 306 | — | 9.1 | 50 | 4.7 |
| | mesh | 20/s | 24 | 216 | 216 | — | 9.2 | 54 | 5.3 |
| | hub | every frame | 64 | 256 | 192 | 769 | 9.6 | 125 | 12.3 |
| | hub | 30/s | 34 | 136 | 102 | 408 | 9.1 | 128 | 13.2 |
| | hub | 20/s | 24 | 96 | 72 | 288 | 8.3 | 120 | 13.3 |
| Doom | mesh | every frame | 39 | 351 | 351 | — | 17 | 41 | 1.6 |
| | mesh | 30/s | 34 | 306 | 306 | — | 18.1 | 54 | 2.2 |
| | mesh | 20/s | 24 | 216 | 216 | — | 12.6 | 45 | 2.5 |
| | hub | every frame | 39 | 156 | 117 | 468 | 13.7 | 103 | 6.6 |
| | hub | 30/s | 34 | 136 | 102 | 408 | 13 | 103 | 7.1 |
| | hub | 20/s | 24 | 96 | 72 | 288 | 14.4 | 123 | 7.7 |

On a hub at 30/s, by number of players:

| engine | players | broadcast | sent | received | hub out |
|---|---|---|---|---|---|
| SNES | 2 | 32 | 64 | 32 | 64 |
| | 3 | 33 | 99 | 66 | 198 |
| | 4 | 34 | 136 | 102 | 408 |
| Doom | 2 | 32 | 64 | 32 | 64 |
| | 3 | 33 | 99 | 66 | 198 |
| | 4 | 34 | 136 | 102 | 408 |

- **30 a second halves the SNES's messages** (64 to 34 broadcast, 4
  of them clock pings and answers) for about one more tick of frontier lag
  (3.6 to 4.7, 18 ms) and 17% more re-stepping. 20 a second saves another
  30% for another 0.6 tick. Doom at 35 Hz barely changes (39 to 34).
- **It scales linearly per peer:** what a peer receives is 34 × (n − 1).
  The hub sends n(n − 1) × 34, as any all-to-all relay must: 408 a second
  for 4 players.
- **automerge-repo echoes.** It forwards every ephemeral message it has not
  seen to every peer but its originator. On a mesh that is the (n − 1)²
  sends per broadcast phase 1 measured; on a hub each peer also sends
  everything it hears back to the hub, which drops it as seen ("sent" is
  four times "broadcast" for 4 players). That is automerge-repo's, not the
  host's; Patchwork's Subduction relay publishes ephemerals by
  subscription and may not echo, which these numbers do not cover.
- On a hub every message crosses two links, so latency doubles (300 ms
  peer to peer here) and so does re-stepping; that is the topology's cost,
  not the rate's.

**Linking every checkpoint** (`node bench/retention.mjs`): a 4-player
session document with one checkpoint pointer a minute and seats rolling
every 10 minutes, saved, and loaded (median of 5).

| hours | two newest: bytes | load | all: bytes | load |
|---|---|---|---|---|
| 1 | 6,241 | 8.4 ms | 6,100 | 8.9 ms |
| 4 | 21,573 | 10.4 ms | 21,137 | 21.8 ms |
| 10 | 51,393 | 24.3 ms | 51,103 | 37.0 ms |

Automerge keeps every deleted value in history, so unlinking saved
nothing: the document is the same size either way. Loading the one with
600 live keys takes up to half again as long, about 13 ms after ten hours,
once per open.

### Tests

All finite, no randomness.
- **`output.test.js`:** every re-simulation pattern within 3 ticks of the
  head, over every sequence of 4 frames (each frame rewinds to any tick at
  or above the frontier, re-steps every tick from there keeping or changing
  each one's output, then steps 0, 1 or 2 ticks on): 43,905 sequences, at
  lags 0, 1, 2 and confirmed-only, then everything confirmed, about 11
  million checks. Each tick is delivered once, in order, exactly when due,
  with the timeline's output at that moment; a correction goes out exactly
  when a delivered tick's events changed and never otherwise; a crossfade
  happens exactly when the last played tick's samples changed; and no step
  in the played stream exceeds a ramp's slope plus a crossfade's (2/N),
  where an unfaded splice jumps up to 1. Each of these mutations fails it:
  no crossfade, no dedupe, no splice detection, a correction not
  remembered, the old timeline's next tick forgotten while a splice waits.
  Also gaps, fades, and confirmed-only skipping.
- **`timeline.test.js`:** an engine that traps on one input at one tick,
  under every change of one port's belief at every pair of clock positions,
  at snapshot spacing 1 and 4 (21,120 cases): held exactly when the belief
  steps into the trap, never stepped again while held, released when it
  doesn't, confirmed exactly when the inputs are all known, and the state
  always the spec's.
- **`host.test.js`:** every peer hears every tick once, in order, and its
  events end up the documents' (3 peers, WAN, lossy); 4 peers through a
  hub send at most 30 input messages a second and agree.
- **`faults.test.js`:** a trap on one peer (it says so, keeps its seat, the
  others play on and agree); a trap on every peer at a confirmed tick (all
  stop there, agree with the documents, inputs flow); a peer whose memory
  drifts (it reports the desync at the next checkpoint, the others do not);
  a seat change deeper than the two newest checkpoints (every peer rebases
  from the newest one before it, not genesis; the later ones are
  unlinked).
- **`../worker/remote.test.js`:** closing at once after a stand and a
  frame request: the page's repo has the stand when close resolves (and
  does not when the link is cut without waiting), the frame's late answer
  is ignored, and nothing is sent after; a view is drawn again exactly when
  its tick or the host's revision changed. And two hosts in "workers" (serve() on an
  in-process channel that structured-clones and transfers, so a buffer used
  after it was transferred would be found detached) and one on the page,
  WAN, lossy: pictures and output reach the page, and all three agree with
  the documents; a frame is never queued behind another; a trap in the
  worker reaches the page as a status while the others play on.
- **`bench/worker`** (`pnpm check:worker`): the browser measurement above;
  fails if the worker joiner makes a long task on the page or the peers
  stop at different ticks.

### Not done yet

- **A peer that diverged** says so but does not heal. It could restart from
  the checkpoint it disagrees with, but from one checkpoint it cannot know
  which side is wrong.
- **Subduction's ephemerals** were not measured; the hub here is an
  automerge-repo peer.
- **Playing the output** (an AudioWorklet fed by the PCM, Doom's lumps at
  their origins) is the scene extension's.
- **`api.clock`** landed, and is not passed as `clock` as is: a machine in
  a scene keeps its session clock, over world time (Phase 2b, Decision 1).
  `SyncedWall` stays for the Machine tool, which has no world.

## Phase 2b, in a scene

A machine is an object in a scene (`src/scene/`): its source a machine doc
(the engine's kind and the content it boots), its content a cabinet the
`machine` scene:source builds, its trait `machine` holding the session this
object runs. The stage is not changed: everything here is the extension
contract (scene/STAGE.md) and a replicated process (TOOLS.md §7).

```js
// one machine on one view (running.js), what extension.js does for each object:
const m = await runMachine({ repo, url: session, wasm, content, ports, world: api.clock,
                             now: () => api.clock.now(), writable: () => api.writable(), by, input });
m.frame();                       // every frame: the host steps to the world's t; the process while it runs
screen.show(viewOf(m.host, { player })());
m.play(port); m.leave();         // a port, and the clock started; the last to leave stops it
```

The first four of the eight wiring steps (FOLLOWUPS, "Machine phase 2b"):

1. **The clock, with its offset.** `worldClock(handle, api.clock)` is the
   session clock with world time for its shared time: `at` is world ms, so
   a machine made hours into a world starts at tick 0, and pauses with its
   world. Its own `until` stops it while the world runs on.
2. **A replicated process.** While the machine runs, each view running its
   host registers `api.clock.process({ replicated: true, step() {} })`, so
   that someone computes world time; while it's stopped, none. Its step
   does nothing: the host is pulled from world time on every frame, not
   stepped (Decision 13).
3. **Queries across the worker.** `host.query(kind)` on Host and
   RemoteHost; the worker answers each kind asked for, for the state its
   frame reached, again only when that state changed.
4. **The screen.** The cabinet's GLB says where its screen is
   (`extras.machine.screen`: centre, width, height, in the shape the
   machine's pictures are meant to be seen); the extension draws a `Screen`
   texture on a quad there, in the object's displayed frame, every frame.
   It is unlit and not pickable: a press finds the cabinet behind it.

And, to play it at all: **Play** (P, within reach) takes a free port (the
one the screen shows if it's free) and puts the pad in hand as the held
tool, its keys its own; Escape puts it down and gives the port back.

Then steps 5, 6 and 8 (round 2):

5. **Sound** (`src/present/speaker.js`). A machine's speaker plays what
   `host.output()` delivers on one AudioContext, through `sound.js`: Doom's
   events from the WAD's own lumps, mixed as Doom mixes them for the player
   the screen shows (`screen()`), and its music by its own OPL code; any
   other engine's PCM stream. The Machine tool and the scene use the same
   speaker and differ only in where it comes out: the tool's out is the
   context's destination, the scene's a panner at the screen, placed every
   frame where the cabinet is drawn, with the context's listener at the
   view's eye (the top body's, else the camera's). The tool's own
   `audio.js`, which duplicated part of `sound.js` with a rougher mix, is
   gone, and so is `sound.js`'s `pcm` sink, which nothing used once the
   speaker took the stream. Doom's eyes and things are asked of the host
   only on a frame that needs them, at most once each.
6. **A seat per port** (`src/scene/seating.js`, `src/scene/hands.js`).
   The view that makes a machine's session also lays a seat per port in the
   same change, with the seats package's `lay` (found by `roster: true`,
   never by name), **on the machine's object**: the cabinet's own seats,
   copied and removed with it, never a table's players. They don't last
   (`lasting: false`): a port is held only while someone sits at it, and
   nothing about who sat there is written. They are "<title> · P<n>", each
   a view of the screen from a little in front of it, side by side, in the
   cabinet's frame, and the trait lists them by port (`seats: ["p1", …]`),
   so which port a seat is, and whether the machine has seats at all, is
   the trait's to say. The machine contributes `seatPlaces`: a strip across
   the cabinet's front below the screen, divided into one place per port,
   so each seat has a name tag and a look at the cabinet is a look at the
   seat whose part of it the look lands on. **Sitting is holding**: each
   frame, the port of the seat this view sits in (the roster's `sitting()`,
   `{ of, seat }`) is the port it should hold; sitting down takes it and
   puts its pad in hand, standing up (or watching, or moving to another
   seat, or leaving) gives it back, and the seat with it. Input is the
   host's as ever: messages first, the seat's own input document after.
   Escape puts the pad down and the port stays yours while you sit; P
   picks it up again.
8. **Content** (`src/scene/part.js`, `give` in `extension.js`). The
   machine's `scene:part`, Machine, puts an empty cabinet in from the parts
   bin: a machine doc of its own with no game. A ROM (.sfc, .smc) or an
   IWAD dropped on a cabinet that has no game is its game (`gameOf` in
   `load.js`, shared with the Machine tool): a new machine doc (kind,
   content, title), its content a doc holding the bytes, and the cabinet's
   source pointed at it. Its session and seats then come as for any machine
   object; the trait's `source` says which source its session was made
   for.

Then step 7 (round 3):

7. **The spectator's 3D world** (`src/present/spectator.js`, what decides
   in `src/scene/worlds.js`, wired in `extension.js`). "Lay out its world",
   on a Doom cabinet's menu, puts doom/'s map of the level the game is on
   beside the cabinet: doom/'s scene:source (`doom-map`, by id) over a WAD
   file doc of the IWAD the machine runs, with `whole: true` (the whole map
   as one part, each door a node in it), a model 3 m across, its lowest
   floor at the cabinet's feet, turned as the cabinet is. It carries the
   machine's trait `machine.world: { machine, source }`: the cabinet's id
   and the machine doc it ran then. Every
   view running that machine then draws its game in the map, every frame,
   from the engine's state: each thing Doom draws a billboard at its feet,
   turned to the eye with the rotation Doom would show a viewer there,
   lit as its sector, in the map's displayed frame (scale included); each
   door node moved up by how far its sector's ceiling stands above its
   floor (dressing: the map carries the machine's trait). The frame is the
   map's own say (its GLB's `extras.doom`: map, anchor, units per metre).
   On another level, between levels, with the machine gone, or once the
   cabinet runs another game than the one the world was laid out for, the
   map is as built: no things, every door shut. The host answers each
   query once a state (`Host.query`), so the speaker and every world share
   one answer.

### Decisions, made unattended (the lead was away)

1. **The machine's time is its session clock over world time, not
   `api.clock` passed as is.** The plan passed `api.clock` with the
   machine's pause as the world's. But a machine stops while nobody plays
   (quiet.js), and stopping a world because nobody is playing Doom in it
   would stop the boat and the doors too. So the world's pause stops the
   machine (world time stops), and the machine's own stop is its own
   (`until`, in world time). `SyncedWall` stays, for the Machine tool alone,
   which has no world.
2. **The offset is `at`, and a run never starts before it.** Step 1's
   `t0` is the session clock's `at` in world ms; `max(0, …)` became a rule
   of the session clock, on the wall as in a world: a peer short of `at`
   holds at `t`.
3. **A stop once set stands, for pauses made in sequence.** Found by the
   exhaustive clock test: a second pause inside the first's margin set an
   earlier stop, which a view ahead of the second pauser had passed. The
   rule holds when the second pauser has seen the first stop. Two pauses
   made at once (each written before the other arrives) each write a stop,
   Automerge's last writer keeps one, and a view that had passed it goes
   back to it: its timeline rewinds, as it does for a pause that reaches a
   view ahead of the pauser by more than the margin. The views still meet
   at the stop kept. A pause and a resume made at once settle the same way.
4. **The process is registered only while the machine runs.** A machine
   nobody plays keeps no world going (TOOLS.md §7, "Nobody present, no time
   passes"), and the first player's resume brings the computer back.
5. **The session is the object's, not the machine doc's.** The machine doc
   is the program and what it boots; each object is one running game on
   its own scene's clock. The trait's `session` is runtime: a copy of the
   object starts a game of its own. The first view able to (writable, and
   holding the object's `machine.session` claim) makes the session, on the
   world's time, and writes it on the trait. The machine doc's own
   `session` stays the Machine tool's, on the wall.
6. **One picture per screen, for everyone.** The trait's `player` says
   whose view the screen shows: a screen is a thing in the world, and
   everyone looking at it sees the same. It applies only to a machine with
   a view per player (Doom), clamped to the machine's ports, so a 1-player
   Doom set to player 3 shows player 0. The Super NES has one picture, and
   its screen and Play ignore the field (`playerOf`).
7. **The screen's place is read from the cabinet**, as dice read a die,
   never from a second copy of the numbers.
8. **Play is a held tool** (`api.hold`): the input path the stage already
   has, with no stage change. A station per port (step 6) decides where the
   player's eye goes; it may sit on top of this or replace it.
9. **In a scene the host runs on the page**, bounded by its 10 ms budget.
   The worker is built and answers queries, but hosting it from a Patchwork
   package needs a worker bundle that carries automerge-repo (an import map
   does not reach a module worker) and an adapter on the tab's repo; that
   is its own step.
10. **A machine plays only where the scene can be written.** Pins and
    mirrors never act; a read-only viewer sees a note. Spectating a
    read-only scene is deferred.
11. **The host's liveness runs on the stage's time** (`now: api.clock.now`:
    reaping, chunks, messages), as STAGE.md "Time" asks; its CPU budget
    stays on the wall.
12. **`Screen` takes three.js as a parameter** (`api.THREE`): a texture
    must be made by the three.js that draws it, and the package no longer
    imports three anywhere. Nor does it declare three as a peer dependency;
    its tests take three from devDependencies.

Made after review (round 1), also unattended:

13. **The machine is pulled, not stepped; the process only keeps world time
    going.** The replicated process's step is a no-op, written out
    (`step() {}`) because STAGE.md's process has a step. Making the host a
    stepped process would need two paths: the host must run on every
    frame while it's stopped too (a view that went past a stop rewinds to
    it, late inputs re-simulate, checkpoints settle, a resume is noticed),
    and a process is registered only while the machine runs (Decision 4).
    It also keeps its own rate (35 Hz, 60.1 Hz) and rolls back, which a
    forward-only step on the stage's 1/60 s grid can't say. **For the
    lead:** with this, the stage's replicated stepping (`stepTo` over
    replicated processes, paused up to `clock.t`) has no consumer that
    steps. The machine uses a process only to make world time pass. The
    stage could shrink "replicated" to that (a process every view has,
    never saved, with nothing to step), or keep the grid for a future
    deterministic simulation that is stepped. That is a stage decision,
    left to you.
14. **Starting is patient** (`src/scene/start.js`). A view that doesn't win
    the object's `machine.session` claim asks again every 2 s on the
    stage's time (`api.clock.after`). So does the claim holder when it
    can't make the session yet (the content still syncing, a fetch
    failing), and so does a view whose start failed for any reason. A
    holder that leaves lets its claim lapse (STAGE.md, "Claims"), and the
    next view to ask takes it. "No game yet" and a scene that can't be
    written are asked again too, since either can change. Retrying never
    stops on its own: a machine that can't start says why beside its
    screen and keeps trying, which costs one doc read every 2 s.
15. **Doom in a scene plays by keys only for now.** Its mouse turns and
    fires through pointer lock (`movementX`), and in a scene the pointer
    belongs to the body (it looks around). A held tool declaring
    `pointer: true` asks for the pointer free, the opposite of what Doom
    needs. Where the mouse goes belongs with step 6's stations, which
    decide where a player's eye and hands are.
16. **The extension's surface is the contract** (`update`, `commands`,
    `dispose`). The probe reads what it checks from the stage's own debug
    surface and the scene graph: the screen mesh (named
    `machine.screen:<id>`), the texture actually drawn, and each view's
    session replica and world time. Nothing in the extension exists only
    for the probe.
17. **A query is asked of the host once per state, answered or not.** The
    worker remembers a null answer (a kind the engine lacks) as it does an
    answer, so the Super NES isn't asked for a kind it can't answer on
    every frame (each ask copies the state). A null while loading isn't
    the engine's answer, and is asked again. (Since round 3's review the
    rule is Host.query's own, Decision 41; the worker sends an answer when
    the host's is a new one.)

Made in round 2 (steps 5, 6 and 8), also unattended:

18. **Sound is the screen's, for everyone at it.** The speaker mixes Doom
    for the player the screen shows (the trait's `player`), as Decision 6
    has the picture: what you hear at a screen is what its picture would
    sound like, out of a panner at the screen. A seated player hears the
    screen's player's mix too, not their own; their own view of Doom is the
    screen's only when the screen shows them. The spectator's route
    (`world(toScene)`: sounds at their origins in a 3D Doom) belongs with
    step 7.
19. **One AudioContext per extension instance**, made with the first
    machine to run and woken by the first press in the stage. A view with
    machines in two linked docs has two contexts, each in its own stage's
    frame (panners and listener alike), which is what keeps them right.
20. **Sitting is holding, and Escape doesn't stand you up.** A port follows
    the roster's `sitting()`: the seat body on top, in one of this
    machine's seats. Standing up from the seat (the seats package's Stand
    up, or walking off from it) gives the port back, so a machine everyone
    has got up from stops (Decision 4). Standing up frees the seat too
    (Decision 29); walking off from it keeps it for you to come back to.
    Escape pops the held tool, never the body (scene/TOOLS.md §5), so it
    puts the pad down and keeps the port. That needed one addition to the
    seats package: `roster.sitting()`.
21. **A machine with no seats is played by Play alone.** Where no seats
    owner was installed when its session was made, its trait lists no
    seats, and P takes a free port with the pad and Escape gives it back,
    as in round 1. A machine whose trait lists seats has one way to take a
    port, sitting, and P only picks the pad back up, for every viewer: one
    without the seats package can't take a port by Play from under a seat
    (review, round 2). Seats are laid with a session; a machine made
    without them doesn't get them later.
22. **P acts on the machine you sit at, wherever the pointer is.** Seated,
    the pointer is free and the look follows it, so "the machine looked
    at" is a coin toss. The Play command answers for a look at anything
    that isn't a machine (another object, or nothing) with the machine
    whose pad you hold or whose seat you sit in. (Round 2 did this only for
    a look at nothing; the review caught it.)
23. **Several places on one object** (the seats package's `placeOn`): a
    look at the cabinet is at the place it lands in, else your own among
    them if you sit at one (seated, you look at the middle), else the
    nearest. Before, a look at an object with several places always meant
    the first.
24. *(Superseded by 29.)* A machine laid its seats in the doc's own seats,
    so it couldn't share a doc with a seated game.
25. **A game is chosen once.** A cabinet that already has a game doesn't
    take a ROM or an IWAD dropped on it: the drop is left to the other
    packages and the stage, as any drop the machine doesn't lay out (the
    review: taking it only to refuse it swallowed a file someone else could
    lay out). The Machine tool already chooses once. Put in another cabinet
    for another game.
26. **Content lives in documents.** The plan's step 8 kept game files out
    of documents (each peer supplying its own copy, found by a recipe and a
    cache: `content.js`). Licences don't bind this research, so a dropped
    ROM or IWAD goes into a content doc, as the Machine tool and the
    published examples already do, and `content.js` stays unused by the
    scene.
27. **An IWAD in a scene boots four players** (the most Doom has, a seat
    each), at skill 3, at its first map. A PWAD alone makes no game.
28. **`play(port)` takes exactly that port.** Choosing a port (the
    screen's player if free, else the first free) is Play's, a pure
    `portToPlay`; a seat asks for its own port and no other. Host.sit is
    the one judge of whether a port is free. A seat doesn't ask for a port
    `holders()` shows someone holding (it isn't polled by a refusal every
    frame); it asks again once that port shows free, and Host.sit still
    refuses it while its last holder's seat is ending.

Round 2's review (Decisions 29-34):

29. **A machine's seats are its own, and don't last.** The review found
    the card table's ideas leaking into the machine through the seats it
    borrowed: one roster per doc (so a machine's ports counted as a card
    table's players, and as parties to an undo), a player kept after
    standing up (so a cabinet everyone had once sat at read "Ana (away)"
    on every port, and a newcomer was asked to "take their seat? You'll see
    what's theirs"), and seats that outlived their cabinet. One cause, one
    change to the seats package, with two consumers: seats have an owner,
    the doc (a table's, on the scene, as before) or an object (a machine's,
    on the object: copied and removed with it, never in the roster); and a
    seat may say `lasting: false`, held only by the claim of whoever sits
    in it, writing nothing. The two are separate: an object's seats may
    last, the doc's may not. The picker shows one owner's seats, those of
    what has your attention. Decision 24 goes.
30. **Which port a seat is, is the machine's trait's.** Round 2 packed
    machine and port into the seat's id (`<object>.p<n>`) and parsed it
    back, and worked out whether a machine had seats from the local
    roster. Now the trait lists the seat of each port (`seats`), written in
    the change that lays them; the port is its index there, and a machine
    has seats exactly when its trait lists some, whatever is installed
    here.
31. **A game given in the scene is a machine doc of its own.** A drop on an
    empty cabinet makes a new machine doc and points the cabinet's source
    at it, rather than writing kind, content and title into the empty doc.
    One key in one write: two views giving one cabinet a game at once end
    with one of the two whole, never one's kind with the other's content.
    (The review suggested a claim around the write; a drop's context has no
    `claim`, scene/STAGE.md, "Drops".) It also keeps a copy of an empty
    cabinet, which shares its empty doc, from getting the game too. And a
    session says which source it was made for (the trait's `source`,
    runtime like `session`): a session a view made meanwhile for the source
    that lost the merge is not this object's, and a new one is made.
32. **A dropped file's bytes are copied into a content doc.** The review
    asked to point the machine at the dropped file doc, or say why not. A
    session is made for its content, and a content doc is a value nobody
    edits; a file doc is whoever dropped it's, and a Machine tool or a file
    tool may change it. Content docs also have one shape (`{ title, bytes
    }`), and Doom's isn't the WAD's bytes at all (its start arguments come
    with them). The file doc is left as it was: nothing points at it, and
    an unreferenced doc costs nothing but storage.
33. **A WAD dropped on a cabinet where the doom package is installed too**
    goes to whichever of the two is first in registry order: both lay out
    dropped WAD files (doom's as a map). The general answer is a stage
    rule, offer a drop on an object to that object's extensions first, but
    the stage takes a rule only with two unrelated consumers, and this is
    one. With Decision 25, a cabinet that has a game no longer takes a WAD,
    so the overlap is only an empty cabinet's. Left for the lead, with the
    rule written down here as the proposal.
34. **The pad and the port are `hands.js`.** What sitting, Escape and P do
    moved out of the extension into a module of its own, given the
    machines, the held-tool slot, the roster's `sitting` and the trait's
    seats, so it is tested directly rather than only by a browser probe.

Made in round 3 (step 7), also unattended:

35. **The world is doom/'s map, laid out by the machine, with its doors as
    nodes.** A machine's world needs doom/'s geometry and the engine's
    motion. doom/'s own layout (a dropped WAD) makes doors that people
    open (`joints.slide`), and a door moved by two owners would rise twice;
    a stage object may be dressed only by an extension whose trait it
    carries. So doom/'s source gained one param, `whole` (the map in one
    part, a node per door and per exit switch, each exactly its own part
    at its own anchor), and the machine lays out that one object with its
    own trait. Rejected: the machine computing doom/'s door list and
    anchors itself (a second copy of doom/'s line specials), and attaching
    to a walkable map by stripping its slides (one package rewriting
    another's layout). Nothing changed in the stage.
36. **The map says where its frame is.** doom/'s parts now carry
    `extras.doom = { map, anchor, unitsPerMetre }`, as the cabinet's GLB
    says where its screen is (Decision 7); `doomWorld(wads, map, frame)`
    places things in the frame given, and drawing uses nothing else. Its
    own copy of doom/'s anchor rule is the default, and one production
    path uses it: "Lay out its world" works out where the map goes beside
    the cabinet before doom/ has built anything, so from the extent in
    the default frame (`besideCabinet`, which places the extent it is
    given and assumes nothing about where the anchor is inside it). If
    doom/ changed its anchor rule, a world laid out afterwards would stand
    off its place beside the cabinet by the difference; its things would
    still be drawn right, since they follow `extras.doom`. The world probe
    holds the two rules equal for E1M1. Rejected (round 3's review):
    moving the map once it is built (a second write, by one view, racing
    whoever moves it first), and building the map here to read its frame
    (doom/'s geometry twice, for a placement).
37. **A world shows one machine, named by the object's id in its trait.**
    Not a match by map name or WAD: two cabinets of one IWAD on one level
    would both claim it. A copy of the world shows the same game; a copy of
    the cabinet runs a game of its own, which no map shows until one is
    laid out for it (traits are copied as they are; ids in them are not
    remapped).
38. **The world's WAD is a file doc of the IWAD's bytes, one per game.**
    doom/'s source takes a `file` doc; the machine's content doc is its own
    records (start arguments and WADs). So the IWAD is stored twice (28 MB
    for Freedoom), once per game, not once per click: laying out another
    world reuses the file doc of a world already laid out for the same
    machine doc (its trait's `source`), and a view makes at most one for a
    machine however often the command runs (`wadFile`). A slice of only
    what drawing the map needs (doom/'s `make-fixture.mjs` makes one,
    1.5 MB for E1M1) would be the next step if the storage matters;
    licences don't bind this research and Automerge's costs are assumed
    fixed upstream. A game booting more than its IWAD isn't offered a
    world: the command is disabled and says why (doom/ builds a map from
    one WAD file, and a PWAD's things over the IWAD's map would be wrong).
39. **What is drawn is what Doom draws.** Things whose flags say NOSECTOR
    are left out, as Doom leaves them out; a thing's sprite is the one
    Doom would pick for a viewer where the eye is (rotation by bearing,
    mirrored lumps, fullbright), lit as doom/ lights its walls (the sector's
    level read as sRGB); a spectre is a dark see-through shape where Doom
    draws a fuzz. The player's own body is drawn too: a spectator sees
    every player. Doom's diminishing light with distance is not drawn
    (doom/'s walls don't have it either).
40. **Doors only, for now.** The engine moves every door, lift and floor;
    the whole map moves the plain doors doom/ makes parts of. Locked and
    remote doors (E1M1's 51, 71, 77, 145) and lifts (98, 103) are drawn
    where they rest. A part per moving sector of every kind is doom/'s to
    add (a lift is a floor and the strips of wall it uncovers), and the
    machine's dressing would move it unchanged (`doorAt` for ceilings, the
    sector's `rise.floor` for floors).

Round 3's review (Decisions 41-45):

41. **The host answers a query once a state.** Round 3 wrapped the host
    (`asked.js`) so the speaker and the worlds would share one answer a
    frame; the worker had its own memo, with another rule for nulls. Now
    there is one rule, `Host.query`'s: the engine is asked once per kind
    per state (tick and revision, as a picture is), its null kept like
    any answer, nothing kept while loading. Every reader of one state
    gets the same answer, which nobody changes. The worker sends an
    answer when it is a new one, without transferring its buffer (the
    host keeps it), so an answer crosses as a copy of a few kilobytes.
    `asked.js` and the worker's per-kind memo are gone.
42. **What decides a world is `worlds.js`, pure, apart from what draws.**
    Whether a world draws (`stateOf`), the command's state
    (`worldCommand`), where a world goes (`besideCabinet`) and its WAD
    (`wadFile`), each tested over its whole bounded space, rather than one
    path through a Chrome probe. A world keeps its map's doomWorld for one
    machine entry and one frame: a machine closed and opened again is
    another entry and reads its WADs again.
43. **A world names the game it was laid out for** (`source` on its
    trait, the cabinet's `sourceUrl` then). A cabinet given another game
    keeps its id, and the world would have drawn the new game's things
    over the old game's map whenever the map names matched. Now such a
    world rests, and its WAD file doc is reused only for worlds of the
    same game.
44. **Whether doom/'s map source is here is read when asked**, on the live
    registry. The stage starts and stops only the extensions that come or
    go (scene/STAGE.md), so the machine is not restarted when the doom
    package arrives after it, or leaves. The world probe installs the doom
    package after the machine has started.
45. **Beside a scaled cabinet.** The world's turn is the cabinet's without
    its scale (round 3 read a turn off the scaled matrix, wrong for any
    scale but 1). The gap from the cabinet's middle to the map's near edge
    grows with the cabinet's scale, since its side is further out; the
    map's own size and floor height don't. The near edge, the middle front
    to back and the lowest floor are taken from the extent as given, not
    from the anchor being the map's middle.
46. **The published example is a small Arcade of its own, not a cabinet in
    the Quiet games room** (decided at integration, 2026-11-14). The Arcade
    (`probes/publish-arcade.mjs`) holds the two machine docs already
    published, linked as cabinets' sources and never copied, and Doom's
    world laid out beside them as "Lay out its world" lays it out. Putting
    a cabinet in the room instead would have made tabletop's publisher
    write a machine, so one package's publisher would know another's
    objects. The room would also have to list machine and doom for every
    viewer of a room whose game is shared with the boat. And it would
    change the room's start, Watching at Lost Cities, which is the shared-game
    proof. A doc of its own lists only its own packages (scene, machine,
    doom, seats), and like any scene it can be linked into a mashup later
    with no code. The publisher writes the objects in node with fresh
    render docs, so the first view builds them. The cabinets' sessions and
    seats are their traits' and are made by the first view that can write
    the scene, so the published doc carries none.
47. **The Arcade's row is Doom, its world, then the SNES, and the home
    view is worked out from the pane** (decided by the final fixer,
    2026-11-14). As first published, the two cabinets stood 1.2 m apart
    with the world on Doom's right. In Patchwork's narrow pane the left
    cabinet was cut off at the pane's edge, and the two notes ("Stopped
    while nobody plays: sit at it to play", about 230 px each, centred
    under each screen) overlapped, so the stage's labels showed one of them
    straddling both cabinets. Now the SNES stands past Doom's world, the
    same 0.6 m gap from it as the world's from Doom, so the cabinets'
    labels are 4.65 m apart. Once the first view has laid the seats, the
    label a visitor sees at each cabinet is a seat's tag ("Doom · Freedoom
    E1M1 · co-op · P1 · free", about 260 px, drawn at the seat beside the
    cabinet), which outranks the note; a first relayout sized for the notes
    cut the Doom tag off at the pane's edge on every later visit. The
    publisher now works the camera's distance out from the tag's width and
    a 640 by 800 px pane with 45° of field: about 15.5 m from the row's
    middle. arcade-check asserts that every corner of each cabinet's bezel
    and of its bounding box projects inside the pane, and that each cabinet
    shows one label of its own, whole inside the pane; it is run on a first
    visit (notes) and a later one (tags). Both screens are black on
    arrival, by design: a machine runs only while someone plays it.

### Tests

- **`present/spectator.test.js`:** the billboard for 4 sprite shapes
  (offsets either side and wholly to one side), mirrored or not, from 16
  bearings at 3 heights, through 32 map poses (moved, turned, tipped, at 1
  and 1/36 scale): 12,288 cases, each checking the feet through the frame,
  the quad's four corners against Doom's span to the viewer's left and
  right (a mirrored lump right to left), and that it faces the eye. The
  door nodes moved by `doorAt` and put back (by rest(), and by a new
  root). Over the 4-player demo (needs the IWAD; every 105th tic, every tic
  in test:full): every thing Doom draws stands where the engine's own
  record puts it through the map's frame, worked out in the test from the
  raw query and doom/'s frame rule; every player's body where the players
  record says; every door node's underside at the engine's ceiling; doors
  10 and 100 reach exactly the travel doom/ builds them with, and the
  other nine never move. Mutation-checked: the viewer's right reversed,
  the mirror's place, the frame left out, the door's rest left out,
  doom-world's z axis flipped.
- **`scene/worlds.test.js`** (round 3's review): whether a world draws,
  over its machine (none, a Super NES, a Doom starting, one running) ×
  the source on its trait (its machine's, another, none) × its content
  (none, building, built without a frame, built) × the WADs having the
  map × the level (none, on the map, on another, between levels) × the
  things and sectors answered or not (1,536 cases, one drawing); its map
  read again for another machine entry or another frame and only then;
  the command's state over 7 machine entries × the map source here or
  not; where a world goes for 3 extents × 2 positions × 5 turns × 2 tilts
  × 3 cabinet scales (180 cases: turned as the cabinet, its near edge
  GAP times the cabinet's scale to its right, centred front to back, its
  lowest floor at the cabinet's feet, never enlarged); its WAD file doc
  over 5 scenes, three clicks at once and one more making at most one,
  and a failed make tried again; the map source installed after the
  extension started, and removed; a world's group made and gone with the
  trait and with the extension. Mutation-checked: the registry read once,
  no PWAD check, the cached map keyed without the entry, no source check,
  the turn from the scaled matrix, the gap not scaled, the extent assumed
  centred on the anchor, no memo of the file doc, no reuse, a failure
  kept.
- **`host/host.test.js`**, query (round 3's review): two peers over a WAN,
  rolling back, 240 frames each asking a subset of three kinds (one the
  engine lacks) twice: the same answer twice in a state, of the state the
  engine is in (its hash), the engine asked exactly once per kind per
  state. Mutation-checked (no memo).
- **`probes/world.mjs`** (headless Chrome, two views on real Automerge,
  the built scene, doom and machine packages, real keys; 22 checks).
  "Lay out its world" says it needs the doom package until the package is
  installed, after the machine's extension started, then is offered with
  no reload; the map carries the trait naming the cabinet and its game,
  and both views build it and draw the game. At tick 0, on both views:
  210 sprites, one at each spawn the WAD's THINGS give at skill 3 (read
  there, not from the engine), on the floor doom/ drew (a ray straight
  down) but the two that hang; all 11 doors shut. Ana steers the marine
  by the arrow keys to door 100 (469 tics) and presses E. At every tic her
  body stands on the floor Doom puts it on, worked out in the page from
  the WAD's lines (the highest floor under her 16-unit box, as
  P_CheckPosition takes it), or falls to it (the tic she steps off at the
  height she stood, then lower each tic), or her box is on a lift (Doom
  moves it, doom/ draws it at rest; 102 tics). On both views the door
  node's height is 2 units for each tic since tick 473, at every sample,
  up to 124 units. After Escape both views draw the same things and
  doors; with the map moved, turned and scaled every thing keeps its
  place in it; no page errors. (Round 3's report said more of the walk
  and the door than its probe checked, which passed with 70% of samples
  on the floor and only asked the door's heights to be even and rising.)

- **`host/clock.test.js`:** the session clock on world time over every
  schedule of 4 steps of nothing, a pause or a resume by either of two
  views whose world times are 0 to 3 steps (0.1 s) apart (2,500 cases):
  resuming never takes a view back; a pause takes a view back only when
  it's ahead of the pauser by more than the margin, and then to the stop;
  between writes no view's t goes back; a stop once set stands; stopped,
  both views agree on the tick. Also: tick 0 at creation however far into
  the world; a paused world stops the machine; the quiet stop in world time
  for seats ending at every tick 0–40. And pauses and resumes made at once:
  two replicas, each write reaching the other 0 or 1 steps later, either
  writer winning a tie (10,000 cases): a view's t goes back only onto a
  stop it had passed, or, running, when a write made at once overruled its
  own; the replicas end equal and the views at one tick (Decision 3).
  Mutation-checked: no clamp at `at`, a second pause moving the stop,
  `running()` ignoring the world, no clamp at the stop.
- **`worker/remote.test.js`:** every sequence of 3 frames (the state kept,
  re-stepped to the same tick, or stepped on) × the kinds asked for, among
  them one the engine can't answer (3,375 cases), over a host answering as
  Host.query does: the page is sent a kind's answer exactly when the state
  changed since that kind was last asked, and never a null; nothing while
  loading, then the answers once. And a real Super NES's work RAM reaching
  the page, equal to the worker engine's at that tick.
- **`scene/running.test.js`:** two views over automerge-repo in virtual
  time, the follower's world 0 to 0.2 s behind: made 2 hours into a world it
  starts at tick 0 and registers nothing; the process is registered exactly
  while the machine runs, on both views, through a world pause; two
  players, then none: both views stop at the same tick with the state the
  documents give, and stay there while the world runs on; the process is
  STAGE.md's shape (`replicated`, `step`) and stepping it moves nothing.
  Mutation-checked: the process always or never registered, no quiet stop,
  no world clock, a process with no step.
- **`scene/start.test.js`:** two or three views, each making the session
  fine, failing once or leaving while at it; the content there at once, a
  little later or much later; the views opening together or one after
  another (204 cases): some view that stayed writes the session, exactly
  once, and every view stops asking. And `retrying` over every sequence of
  three outcomes × when it's cancelled. Mutation-checked: no retry when the
  claim isn't won, none after a throw, giving up when the content isn't
  there.
- **`scene/extension.test.js`:** the extension's surface is `update`,
  `commands`, `dispose`; `playerOf` over both machines × 1–4 ports × 15
  values of the field (never a view the machine lacks; the SNES always 0);
  `screenMatrix` over 180 poses (the quad's corners on the screen
  rectangle's, through the object's matrix). Mutation-checked.
- **`manifest.test.js`:** every dependency and peer dependency is imported
  by the package's own code (three is no longer one).
- **`present/speaker.test.js`** (round 2): a PCM speaker plays delivered
  audio out of the node it's given, restarts after a gap, ignores
  corrections; a Doom speaker over every port shown × every event's player
  (none, 0-3) × an origin or none (40 cases): a player's own sound and an
  origin-less one play unplaced, any other is Doom's mix for the player
  shown, and the eyes are asked once and only for a placed sound; voices
  follow their things frame by frame and nothing is asked while nothing
  plays; hearing another player stops the old mix. Mutation-checked (the
  route's port fixed at 0; things asked every frame).
- **`scene/seating.test.js`:** a view's port over every seat it could sit
  in (this machine's listed and unlisted, another object's or the doc's of
  the same name, none) × 1-4 ports; the seats laid (names, not lasting,
  frames, eyes in front, none in one place) for both machines × 1-4 ports;
  the places partition the cabinet's front, each the machine's own seat;
  `follow` on a stub machine over every wanted × held port × the wanted
  one free, held, or just let go (67 cases): the calls it makes, that it
  never asks for a port someone plainly holds, and where it ends;
  `portToPlay` over every way 1-4 ports are held × every preferred port
  (98 cases). Mutation-checked (a held port asked for).
- **`scene/hands.test.js`** (review, round 2): a machine with seats, over
  every seat a view could sit in (none, either of this machine's, another
  machine's, the doc's own, another object's) × the pad in hand or put down
  × P looking at this machine, another, another object or nothing (48
  cases): the port follows the seat, Escape keeps it, P's verb and what it
  does, nothing noticed, and getting up gives the port back. A machine
  without seats, over three ways its ports are held × the pad × a seat sat
  in elsewhere × the four looks (48 cases): Play's port, full said, Escape
  gives it back. Mutation-checked (Escape always giving the port back; P
  on another object being that object; no fall back to the seat; a seated
  machine offered without sitting).
- **`scene/running.test.js`, a seat drives the port:** two views over
  automerge-repo, b sitting at P2; a follows each of the 27 sequences of
  three wants (none, P1, P2), 400 ms each: a holds what it wants unless b
  holds it, the pad is picked up once per port taken and put down once per
  port given back, two views never hold one port; then b gets up, a takes
  P2 if still waiting for it, and the machine stops exactly when nobody
  holds a port. Mutation-checked (a move that doesn't stand first; the pad
  never put down).
- **`scene/extension.test.js`:** a file dropped on each of five targets
  (nothing, a gone id, a plain object, a cabinet with no game, one with a
  game) × four files (a ROM, an IWAD, a PWAD, a text file): only a ROM or an
  IWAD on a cabinet with no game becomes its game, a new machine doc the
  cabinet's source now points at, no doc that was there changed; anywhere
  else, or on a cabinet with a game, it's left to others, unsaid. Two views
  giving one cabinet a game at once, over three pairs of files × either
  merge winner: one game, whole, and a session made for the loser is none
  of the cabinet's. `sessionOf` over 27 sources × sessions × stamps. The
  part puts in a machine doc of its own with the trait, where it was put.
  Mutation-checked (a session for another source taken; a second key
  written by a drop).
- **`patchwork/load.test.js`:** `gameOf` over eight names × five kinds of
  bytes.
- **seats/`seats.test.js`:** `placeOn` over 1-4 places × two poses × who
  sits × 156 points never on a boundary (4,368 cases), and through
  `seatLookedAt` among an object's own seats; `roster.sitting()` seated,
  stood up, and walking off from the seat. An object's own seats beside a
  table's (review, round 2): the picker follows attention to the cabinet,
  a thing on it, the table, or nothing; sitting at the cabinet claims on
  the cabinet, writes nothing, keeps your table seat, and the table's
  roster and parties never count it; every one of eight ways of getting up
  (Stand up, the chip's Leave, Watching, the table, the other port,
  leaving, a crash, the cabinet removed) frees the port for the next
  person, never "away", with no seat entry changed, and someone gone and
  back comes back to nothing; a copied cabinet's seats are its own;
  `seatState` over lasting × player × claim (30 cases). Mutation-checked
  (every seat lasting; the roster counting an object's seats; Leave
  keeping the claim; a removed seat's claim kept; the picker never an
  object's; a brief seat written like a lasting one).
- **`probes/seats.mjs`** (headless Chrome, two people on real Automerge
  docs, simulated time; scene, seats and machine built): Ana puts in an
  empty cabinet from the parts bin and drops Unarmed's ROM on it; a view
  makes its session and lays four seats; Ana sits at P1 and Ben at P2 with
  the seats picker, each in the seat body looking from their seat with
  their port's pad, the session giving port 0 to Ana and port 1 to Ben;
  Ana's Start lands in port 0's seat document and not port 1's, Ben's Right
  in port 1's and not port 0's, and the two views drew the same picture
  for every one of 349 ticks both drew; each view made one AudioContext,
  its panner at the screen's centre and its listener at that view's seat
  eye, and played the console's stream; Escape puts Ana's pad down with
  port 0 still hers, P picks it up; Ana watches and her port is given back
  while Ben plays on; Ben gets up and the machine stops on both views at
  one tick with one picture. 28 checks. After round 2's review, 33: the game
  is a machine doc of its own the cabinet points at, the empty doc left as
  it was; the four seats are on the cabinet, not lasting, listed by port on
  the trait, and the scene's own seats untouched; sitting writes nothing
  but the sitter's claim on the cabinet; and when Ana watches her seat is
  free, its claim gone, never "away". The probe page's `select` now selects
  through `api.view.select` (it had been writing a `selected` field into
  the stage's local state, which nothing reads as the selection; Ana's
  picker had worked only because her pointer was over her view).
- **`probes/scene.mjs`** now also checks each view's sound: Doom's music
  and the pistol from the WAD's own lump (22,050 Hz in Freedoom), and the
  Super NES's stream. 40 checks.
- **`probes/scene.mjs`** (headless Chrome, two people on real Automerge
  docs, simulated time): Doom (Freedoom E1M1) and the Super NES (Unarmed)
  each pasted into a scene, played by keys from one view, watched from the
  other. 38 checks: laid out and given a session; stopped at tick 0 on both
  views with no world computed; the picture on the cabinet's screen as the
  stage draws it (each corner of the quad 0.0849 m from the bezel face's
  corner, the bezel's width inset and 2 mm proud, read from the GLB's own
  vertices), and again after the cabinet is moved and turned, on both
  views; P puts the pad in hand; both advance and the world is computed,
  the picture moving with the keys (about 135 different pictures of Doom
  as Ana walks; Unarmed's title, lore, controls and menu as Ben presses
  Start); the two views drew the same picture for most ticks both drew
  (the rest drawn from a prediction of the player's input and put right;
  in the last run Doom 159 of 169, the SNES 402 of 402); Escape stops the
  machine for both at the same tick, the same picture on both screens,
  held there while the world runs on, the session's stop at that tick,
  and the world no longer computed. What each view shows is read from the
  stage and the view's own session replica (Decision 16): the hash is of
  the texture drawn, and the tick is the one the view's clock names, which
  the host steps to. Pairing pictures by that tick makes the mismatch
  count vary a little between runs; it stays far under the 10% allowed.

### Not done yet

- In the spectator's world: Doom's `world()` sound route (each sound at
  its origin in the map, through the map's frame), lifts, floors, and
  locked and remote doors (Decision 40), and a world that follows the game
  to its next level (today a world is of one map, and shows nothing while
  the game is elsewhere; laying out another is a click).
- Being a Doom player from the 3D world (the HUD puzzle): README.md, "Being
  a player from the 3D world", has what step 7 showed about it.
- A WAD dropped on an empty cabinet where the doom package is installed
  too goes to whichever of the two is first in registry order (Decision
  33): the stage rule that would settle it waits for a second consumer.
- Doom's mouse in a seat (Decision 15 stands: keys only).
- The host in a worker, in a scene (decision 9).
- A checkpoint nobody wrote in time is written by any peer a period later
  (with a clock passed in there is no `SyncedWall` reference). The view
  computing the world (`api.clock.computer()`) is the natural reference.
- A read-only viewer spectating (decision 10).
- Whether the stage keeps its replicated grid stepping (Decision 13), the
  lead's call.
- The Machine tool's own changes here are mechanical (the content helpers
  and `newSession` moved to load.js, the pad split from its DOM listeners;
  in round 2 its sound on the speaker and its game from `gameOf`). Checked
  in the real Patchwork by the final fixer on 2026-11-14 (the session's
  verify.mjs): the published Doom co-op and SNES machine docs open, "P1:
  play" starts each and its tick count rises; the empty Machine entry
  shows its chooser.

