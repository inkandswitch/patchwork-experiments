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
