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
exact ratio. The stage's `api.clock` (TOOLS.md §7) is such a clock, and
`Host.open(…, { clock })` takes it as is.

Until `api.clock` lands, the session carries its own clock:
- **`SessionClock`:** `{ t, at, until? }` in the session document.
  - At shared wall time `at` (ms) the world time was `t`. It runs at one
    second per second until `until`.
  - **Pause** writes `until` a quarter second ahead, so every peer has heard
    of it before reaching it and stops at the same tick. A peer that has
    already passed that tick rewinds to it, provided the tick is not below
    its floor.
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

- **The scene extension** (phase 2): screens as textures, positional audio, a
  body or station per port.
  - The host is ready for it: `host.engine.frame(view)`,
    `host.engine.output()`, `host.seat`, `sit` and `stand`.
- **Running the engine in a worker.** The SNES's 1.6 ms step and a joiner's
  catch-up belong off the frame thread.
  - Meanwhile `budget` bounds the stepping in a frame (10 ms).
- **`api.clock`.** When it lands, pass it as `clock`. The session clock and
  `SyncedWall` then go.
  - Pausing then follows the stage's rules: immediate, not a quarter second
    ahead. Exactness at the pause tick becomes best effort, through the
    rewind.
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
- **`api.clock`**: when it lands, pass it as `clock`; the session clock and
  `SyncedWall` then go.
