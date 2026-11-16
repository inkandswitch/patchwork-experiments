# machine

Existing programs brought into Patchwork intact, as deterministic machines.
Chocolate Doom and a Super NES (MesenCE's core) run here unmodified in what
they compute, and every peer in a session runs them itself.

An **engine** is a standalone WASM module, stepped one tick at a time from
per-player inputs. Its whole state is its instance: linear memory, the
memory's size and the mutable globals. So snapshot (copy those out) and
restore (write them back) are exact by construction, for any engine and any
content. That is the WASM analogue of `fork()`.

A **session** is a replicated reducer:
- the documents hold only the engine's identity, who holds which port, every
  port's inputs, and checkpoints;
- every present peer steps the engine from those inputs;
- live inputs travel ahead of the documents as ephemeral messages, a missing
  one is predicted, and a late one rolls the engine back and steps it again
  (as GGPO does).

Nobody's state is authoritative, and nothing about Doom or the Super NES is
in the host.

```sh
pnpm install && pnpm test        # the fast tier, ~13 s; the Doom tests need the IWADs (below), else they skip
pnpm test:full                   # every exhaustive case too, at commit (~150 s)
pnpm bench:integration           # the real engines through the host, measured (~45 min; MACHINE_BENCH=doom-4-150 for one)
pnpm check:browser               # both engines in headless Chrome, against Node; PNGs
pnpm build:engines               # rebuilds engines/*/dist with emcc; the output is committed
```

Two Patchwork tools (Machine, and Machine history) play a machine on its
own. In a scene a machine is an object (`src/scene/`): its cabinet, its
session run on the scene's world time, its picture and sound at the
cabinet's screen, a seat per port (sit down to play that port, stand up to
give it back), and an empty cabinet from the parts bin that takes a ROM or
an IWAD dropped on it. **To play one:** look at its cabinet and press P,
or click Play on the prompt that appears (or choose it from the menu).
That sits you at its first free seat with that port's pad in hand, and a
panel at the bottom left says what the keys do. Escape puts the pad down
(P picks it up again), and standing up, or Watching in the seat picker,
gives the port back. A cabinet nobody is playing is stopped, and its screen
shows the last picture played or, if it has never been played, the game's
first picture, with "Stopped while nobody plays: P to play" under it. And a Doom's world beside it: "Lay out its world"
puts doom/'s own 3D map of the level beside the cabinet, and the game is
drawn in it from the engine's state, every frame, its monsters, players
and doors where the engine has them (HOST.md, "Phase 2b, in a scene").

## What is here

| path | what |
|---|---|
| [ENGINE.md](ENGINE.md) | the contract an engine meets, and how Doom and the Super NES meet it |
| [HOST.md](HOST.md) | the host's design: documents, live play, time, seats, late join, and the measurements behind each choice |
| `src/wasm-module.js` | checks a `.wasm` against the contract and exports every mutable global |
| `src/wasm-state.js` | snapshot, restore, copy and hash of memory plus globals |
| `src/engine.js` | `compile(wasm).boot(content)`: the engine object; `identify` |
| `src/host/` | the host: `createSession`, `Host.open`; `timeline.js` (rollback), `session.js`, `clock.js`, `simnet.js`, `harness.js` |
| `src/doom.js` | Doom's host side: content, ticcmds, demos, sound events, PCM, the queries' decoders, the listener, a camera |
| `src/doom-music.js` | Doom's music player: `music(wasm, lumps, rate)`, following the engine's music record |
| `src/content.js` | content provisioning: recipes, `identify`, a per-hash cache in IndexedDB, `provide(hash, …)` |
| `src/scene/` | a machine in a scene: `extension.js` (scene:extension `machine`: screens, sound, seats, Play, the controls panel, drops, worlds), `hands.js` (the pad in hand and the port it holds: what sitting, Play, Escape and P do), `controls.js` (what the keys do, from the keys the pad reads), `worlds.js` (what decides a machine's world: when it draws, its command, where it goes, its WAD), `running.js` (one machine on one view: the host on world time, the process, the quiet stop), `seating.js` (a seat per port: what's laid, the places, following a seat, the ports Play offers), `part.js` (scene:part `machine`: an empty cabinet), `cabinet.js` and `source.js` (scene:source `machine`: the cabinet GLB, its screen's place in its extras) |
| `src/present/` | presentation (phase 2b): `screen.js` (a picture as a three.js texture), `poster.js` (a stopped screen's picture when its state's own is blank: the engine's first, found on a private engine), `sound.js` (WebAudio routing of `output()`), `speaker.js` (a machine's sound on one AudioContext, for the tool and a scene), `doom-world.js` (Doom's things and sectors for a spectator), `spectator.js` (them drawn in doom/'s whole map: billboards, doors moved), `adapters/unarmed.js` (Unarmed's players and arena from WRAM) |
| `src/test-tier.js` | the test tiers' flag |
| `engines/machine.h` | the ABI, in C |
| `engines/toy` | a toy engine (C, 9 KB), for the exhaustive tests |
| `engines/doom` | Chocolate Doom, any IWAD and PWADs, 1 to 4 players, and its music player (`dist/music.wasm`); its own [README](engines/doom/README.md) |
| `engines/snes` | a Super NES for any ROM, 5 pads (a multitap in port 2); Unarmed (2 to 4 players) as the test cartridge |
| `bench/integration.test.js` | the integration bench: both engines, 2 and 4 players, 0/50/150 ms |
| `bench/browser/` | the browser check |
| `bench/doc-shape.mjs`, `bench/checkpoint.mjs` | the measurements behind the documents' shape |

## The contract

The full text is [ENGINE.md](ENGINE.md). In short:

- **One `.wasm` file, no JS glue.** Its identity is the SHA-256 of its bytes.
- **Exports:**
  - `memory`, its own and not shared;
  - `machine_info()`: the rate as a ratio (`hz_num/hz_den`, so the SNES's
    60.0988 Hz is exact), players, and input bytes per player;
  - `machine_init()`, `machine_input()` and `machine_step()`;
  - optional `machine_output()` (audio and events of the last step),
    `machine_frame(view)` (an RGBA picture) and `machine_query(kind)` (the
    state, read for a view of it: Doom's things and sectors, the SNES's
    RAMs);
  - optional `machine_content(len)` and `machine_fault()`.
- **Imports:** only the host's fixed set, each a pure function that keeps
  nothing:
  - emscripten's growth notice;
  - `machine.content_size` and `machine.content_read`, so a 28 MB IWAD is
    read where needed and never enters memory or snapshots.
  - No clock, no randomness and no files exist for an engine to read.
    Each engine defines libc's WASI calls inside itself: the clock reads 0,
    and there is no environment and no file.
- **Checked before compiling:**
  - imports, exactly one memory of the module's own, and no shared memory or
    passive data segments;
  - every mutable global is exported by a deterministic rewrite of the
    binary, so the snapshot captures it.
- **Snapshot:** `u32 pages | u32 nglobals | 8 bytes per global | memory`.
  - `hash()` is 64-bit, over exactly those bytes.
  - Restore into a bigger memory uses a fresh instance, because memory can't
    shrink.
- **`output()` reads and never drains.** `frame(view)`, `query(kind)` and
  `inspect(name)` run on a copy of the state, because drawing writes memory
  (Doom's `validcount`), and so does building a query's records.

Content is one byte string the engine defines: a ROM, or for Doom the
arguments plus the WADs. Start parameters are part of it.

## The host

The full text is [HOST.md](HOST.md). In short:

```js
const handle = await createSession(repo, { wasm, content });
const host = await Host.open(repo, handle.url, { wasm, content, input: () => myPad });
host.sit(0);                    // take port 0, half a second from now
// every animation frame:
host.frame();                   // steps for at most `budget` ms (10)
draw(host.engine.frame(view));  // never step host.engine yourself
host.pause(); host.resume(); host.stand();
```

**The documents:**
- **The session document** holds the engine's hashes (wasm, content,
  genesis), the rate, the clock, the seats (`{port, from, until?, inputs}`)
  and pointers to the two newest checkpoints.
- **One input document per seat.** Only its holder writes it: one chunk a
  second, under flat keys. It rolls over every 10 minutes, which caps its
  history.
- **One immutable document per checkpoint**, gzipped, every 60 s.

**Live play:**
- Inputs go out by `handle.broadcast`, each message repeating the last 8.
- Input delay is about 0.1 s: 4 ticks for Doom, 6 for the SNES.
- A missing input is predicted by repeating the port's last one. A late one
  restores the newest snapshot at or before its tick and re-steps.
- Snapshots are taken every 4 ticks past the confirmed frontier.

**Time:**
- The tick is `floor(clock.t() × hz)`. The clock is the session's own until
  the stage's `api.clock` lands.
- Pause is scheduled a quarter second ahead, so every peer stops on the
  same tick.

**Late join:** check the hashes, load the newest checkpoint (its hash is
checked), load the seat documents, ask the holders for the inputs not yet
written, then catch up within the per-frame budget.

## The numbers

Apple M4, Node 24 and headless Chrome 157. Other agents' builds and tests
were running on the machine throughout, so timings are noisy, by up to a
factor of two.

### The engines alone

| | Doom (Freedoom E1M1, 4 players) | Super NES (Unarmed) | toy |
|---|---|---|---|
| `.wasm` | 419,961 B (+ music 75,844 B) | 765,839 B | 9,309 B |
| rate | 35 Hz | 21477270/357366 ≈ 60.0988 Hz | 35 Hz |
| ports × input bytes | 4 × 6 (a ticcmd) | 5 × 2 (pad reports) | 4 × 2 |
| compile / boot | 2 ms / 3–10 ms | 2 ms / 2 ms | — |
| step | 8 µs | 1.6–1.9 ms | — |
| snapshot | 6,881,296 B (6 MiB zone; the IWAD stays out) | 3,538,960 B | ~0.5 MB |
| snapshot copy / restore | 0.1–0.25 ms / 0.1–0.5 ms | 0.2–0.5 ms / 0.1–0.3 ms | — |
| `hash()` | 2.3 ms | 1.2–1.4 ms | — |
| `frame()` | 0.3–0.4 ms, 320×200 | 0.15–0.2 ms, 256×224 | — |
| `query()` | 0.1–0.24 ms, any kind | 0.09–0.14 ms, any memory | — |
| checkpoint gzipped | 2.5 MB | 290 KB | — |

### Through the host

`pnpm bench:integration` (`bench/integration.test.js`) runs the host with
both engines over real automerge-repo on `SimNet`, in virtual time, using
the host's default periods.

**Setup:**
- **Doom** plays the bot demos (`bot2p.lmp`, `bot4p.lmp`), whose ticcmds
  change almost every tic.
- **The Super NES** plays the Unarmed scripts into a round. From frame 1500,
  each pad then fights on a fixed 150-frame pattern of its own, so its input
  keeps changing.
- **Players:** 2 or 4, each holding a port.
- **Network:** a full mesh at 0, 50 or 150 ms fixed one-way latency, no loss.
  Clocks are skewed by up to 143 ms.
- **Late spectator:** joins at 70 s, after the first checkpoint at 60 s.
- **Length:** 90 s of play, then a pause.

**What every run must show:** every peer, spectator included, at the same
tick, with the state's hash at **every tick it confirmed** equal to the
state the documents give when replayed from genesis. All 16 runs passed: 42
minutes, under heavy machine load.

**Per peer, per second of play** (the mean over the players; CPU in ms, real
time):
- **sim** is every step, re-steps included;
- **render** is each peer drawing its own view (`frame(view)`) every 16 ms;
- **snapshot** is snapshot plus restore;
- **rest of host** is the host's frame less sim and snapshot: the timeline,
  Automerge and messages.

| run | delay (ticks) | rollbacks/s | depth mean / p95 / max | re-stepped ticks/s | sim | render | snapshot | rest of host | host frame p50 / p99 / max (ms) |
|---|---|---|---|---|---|---|---|---|---|
| Doom 2p 0 ms | 4 | 0.01 | 14 / 14 / 14 | 0.16 | 0.33 | 18.52 | 0.13 | 2 | 0.025 / 0.28 / 16.12 |
| Doom 2p 50 ms | 4 | 0.02 | 7.67 / 15 / 15 | 0.13 | 0.36 | 18.38 | 0.11 | 1.98 | 0.026 / 0.28 / 6.74 |
| Doom 2p 150 ms | 4 | 6.27 | 2.67 / 5 / 17 | 16.74 | 0.79 | 27.5 | 4.61 | 3.83 | 0.048 / 1.03 / 42.36 |
| Doom 4p 0 ms | 4 | 0.02 | 11 / 16 / 16 | 0.25 | 0.59 | 25.19 | 0.14 | 3.8 | 0.053 / 0.34 / 7.55 |
| Doom 4p 50 ms | 4 | 0.02 | 10.5 / 14 / 14 | 0.24 | 0.56 | 26.04 | 0.18 | 3.89 | 0.054 / 0.41 / 9.91 |
| Doom 4p 150 ms | 4 | 16.78 | 2.46 / 5 / 7 | 41.28 | 0.92 | 22.35 | 7.14 | 3.03 | 0.064 / 0.78 / 10.09 |
| Doom 4p 50 ms, delay 0 | 0 | 16.46 | 2.93 / 5 / 16 | 48.24 | 1.05 | 24.92 | 7.14 | 3.44 | 0.062 / 0.94 / 12.19 |
| Doom 4p 150 ms, delay 0 | 0 | 18.02 | 6.43 / 8 / 25 | 115.9 | 1.68 | 23.17 | 10.16 | 3.57 | 0.072 / 1.15 / 12.33 |
| SNES 2p 0 ms | 6 | 0.01 | 1 / 1 / 1 | 0.01 | 95.14 | 6.96 | 0.07 | 1.84 | 1.541 / 4.19 / 12.65 |
| SNES 2p 50 ms | 6 | 0.01 | 17.5 / 19 / 19 | 0.19 | 137.41 | 9.14 | 0.12 | 3.73 | 1.704 / 10.98 / 22.5 |
| SNES 2p 150 ms | 6 | 2.57 | 4.88 / 7 / 16 | 12.56 | 148.68 | 9.03 | 2 | 3.07 | 1.636 / 11.34 / 16.95 |
| SNES 4p 0 ms | 6 | 0.01 | 3.25 / 4 / 4 | 0.03 | 121.2 | 8 | 0.14 | 4.43 | 1.636 / 11.84 / 34 |
| SNES 4p 50 ms | 6 | 0.02 | 4.5 / 8 / 8 | 0.1 | 92.8 | 7.28 | 0.1 | 2.73 | 1.543 / 2.39 / 28.55 |
| SNES 4p 150 ms | 6 | 7.87 | 4.39 / 6 / 40 | 34.55 | 159.56 | 6.86 | 2.38 | 3.11 | 1.628 / 11.65 / 21.22 |
| SNES 4p 50 ms, delay 0 | 0 | 7.68 | 4.7 / 7 / 32 | 36.06 | 173.82 | 11.79 | 10.37 | 17.27 | 1.666 / 13.21 / 873.09 |
| SNES 4p 150 ms, delay 0 | 0 | 7.77 | 9.53 / 13 / 35 | 74.08 | 246.27 | 9.58 | 4.51 | 6.98 | 1.801 / 13.91 / 127.35 |

**Reading it:**
- **Input delay hides latency up to the delay.** The delay is 4 ticks for
  Doom (114 ms) and 6 for the Super NES (100 ms). At 0 and 50 ms there is
  effectively no rollback; the few events are the pause and the spectator's
  arrival.
  - At 150 ms, Doom's 4 players roll back 17 times a second, 2.5 ticks deep
    on average.
  - With no delay, every remote input is late. Doom at 150 ms re-steps 116
    ticks a second, which costs 1.7 ms of CPU, because a Doom step is about
    8 µs.
- **Doom's cost is drawing.**
  - Simulation, rollbacks included, is under 2 ms a second.
  - Drawing is 18–27 ms a second: one 0.3 ms frame at 60 fps.
  - Snapshots are up to 10 ms a second at 150 ms with no delay: one 6.9 MB
    copy every 4 ticks past the frontier.
- **The Super NES's cost is its step.**
  - At 1.6 ms a frame it is about 100 ms a second before any rollback, and
    up to 250 ms a second with no delay at 150 ms.
  - That fits a frame budget, but only just. A browser host should step it
    in a worker.
- **Frame times:**
  - A host frame's median is 0.03–0.07 ms for Doom and 1.5–1.8 ms for the
    Super NES (one step).
  - The p99 is 1–14 ms.
  - The worst frames (16–42 ms, and one 873 ms) coincide with load spikes
    from other processes on the machine. The same runs' one-off timings
    (gunzip, identify) were 5–10× their usual at those moments.

**Durable bytes, and messages.** Input documents are saved with
`Automerge.save`; inputs per minute are counted over the time the seats were
held. Messages are counted per second over the whole run.

| run | input docs | inputs per minute | session doc | checkpoint doc | sync msgs/s | ephemeral msgs/s |
|---|---|---|---|---|---|---|
| Doom 2p 0 ms | 2 | 1.55 KB | 955 B | 2.54 MB | 6.2 | 142.7 |
| Doom 2p 50 ms | 2 | 1.53 KB | 956 B | 2.54 MB | 6.3 | 125.9 |
| Doom 2p 150 ms | 2 | 1.52 KB | 957 B | 2.54 MB | 6.3 | 126 |
| Doom 4p 0 ms | 4 | 3.50 KB | 1293 B | 2.53 MB | 57.1 | 2976 |
| Doom 4p 50 ms | 4 | 3.42 KB | 1305 B | 2.54 MB | 57.2 | 1702.9 |
| Doom 4p 150 ms | 4 | 3.38 KB | 1300 B | 2.54 MB | 57.4 | 1699.2 |
| Doom 4p 50 ms, delay 0 | 4 | 3.28 KB | 1295 B | 2.54 MB | 57.4 | 1705.3 |
| Doom 4p 150 ms, delay 0 | 4 | 3.59 KB | 1175 B | 2.54 MB | 56.7 | 1711.8 |
| SNES 2p 0 ms | 2 | 0.73 KB | 962 B | 0.29 MB | 6 | 224.4 |
| SNES 2p 50 ms | 2 | 0.70 KB | 958 B | 0.30 MB | 5.9 | 194.8 |
| SNES 2p 150 ms | 2 | 0.81 KB | 958 B | 0.29 MB | 6.3 | 207.5 |
| SNES 4p 0 ms | 4 | 1.28 KB | 1200 B | 0.30 MB | 47.8 | 4102.8 |
| SNES 4p 50 ms | 4 | 1.56 KB | 1185 B | 0.29 MB | 56.5 | 2744.5 |
| SNES 4p 150 ms | 4 | 1.29 KB | 1184 B | 0.30 MB | 48.4 | 2355.2 |
| SNES 4p 50 ms, delay 0 | 4 | 1.55 KB | 1185 B | 0.29 MB | 55.6 | 2699.9 |
| SNES 4p 150 ms, delay 0 | 4 | 1.40 KB | 1183 B | 0.30 MB | 53.4 | 2586.8 |

- **Inputs** cost about 0.8 KB a minute per player for Doom, and 0.3–0.4 KB
  for the Super NES. Automerge compresses the byte chunks.
  - An hour of 4-player Doom is about 200 KB, across 24 seat documents
    (each rolls every 10 minutes).
- **The session document** stays about 1 KB.
- **Checkpoints** are one immutable document a minute:
  - Doom, 2.5 MB: its 6.9 MB state gzipped. The 6 MiB zone is mostly free
    blocks.
  - Super NES, 0.3 MB: its 3.5 MB state gzipped.
  - The session points at the two newest, and older ones are garbage. A
    host that keeps documents should let them go.
- **Ephemeral messages grow with the square of the number of peers on a full
  mesh**, because automerge-repo forwards each ephemeral message it has not
  seen to its other peers. One broadcast among k peers is therefore
  (k−1)² sends.
  - Each holder sends one message per frame that has new input (35 or 60 a
    second), so 4 players plus a spectator come to 1,700 (Doom) and
    2,400–4,100 (Super NES) sends a second.
  - Through a sync server, which is how Patchwork connects, one broadcast is
    k sends: one up, k−1 down.
  - The 0 ms runs carry more messages than the 50 and 150 ms runs (Doom 4p:
    2,976 against 1,700). I have not found why.

**Late join.** The spectator opens the session at 70 s, while the others
play on.
- `open` is the virtual time from `Host.open` until it is ready. It is
  network round trips, plus the awaits on the right (real CPU, measured
  apart), which in virtual time run at the frame loop's speed. So it is an
  upper bound on the network's share.
- `behind` is how far its checkpoint is from the clock. Setting up the
  session took virtual time too, so this is 20–50 s of play, not 10.
- The spectator then catches up within the host's 10 ms budget, drawing
  every frame.

| run | joins at tick | open (virtual ms) | behind (ticks) | frames to catch up | catch-up CPU ms | max frame ms | identify | compile | gunzip | hash | boot | restore |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Doom 2p 0 ms | 2100 | 2956 | 1248 | 2 | 11.47 | 10.86 | 12.43 | 1.52 | 25.09 | 2.29 | 3.45 | 0.23 |
| Doom 2p 50 ms | 2100 | 3673 | 1502 | 3 | 22.71 | 11.18 | 12.68 | 1.6 | 31.06 | 5.34 | 6.16 | 0.27 |
| Doom 2p 150 ms | 2100 | 3448 | 1469 | 5 | 45.75 | 10.7 | 29.08 | 6.46 | 75.82 | 4.04 | 3.66 | 0.14 |
| Doom 4p 0 ms | 2100 | 588 | 1461 | 3 | 25.94 | 11.01 | 20.29 | 2.78 | 30.91 | 2.27 | 3.66 | 0.17 |
| Doom 4p 50 ms | 2100 | 800 | 1750 | 4 | 33.24 | 10.81 | 18.95 | 3.12 | 45.03 | 2.28 | 3.61 | 0.15 |
| Doom 4p 150 ms | 2100 | 1036 | 1846 | 5 | 49.71 | 11.25 | 22.25 | 1.59 | 33.04 | 2.84 | 3.96 | 0.33 |
| Doom 4p 50 ms, delay 0 | 2100 | 816 | 2090 | 4 | 41.17 | 11.38 | 18.34 | 1.68 | 55.79 | 2.4 | 3.69 | 0.51 |
| Doom 4p 150 ms, delay 0 | 2100 | 872 | 1235 | 3 | 23.45 | 11.31 | 18.39 | 4.13 | 31.73 | 2.44 | 4.17 | 0.25 |
| SNES 2p 0 ms | 3606 | 1536 | 1258 | 209 | 2219.7 | 10.96 | 1.12 | 2.11 | 31.35 | 1.47 | 1.18 | 0.33 |
| SNES 2p 50 ms | 3606 | 1864 | 1318 | 310 | 3528.13 | 19.16 | 0.65 | 8.83 | 13.19 | 2.78 | 0.77 | 0.25 |
| SNES 2p 150 ms | 3606 | 1876 | 971 | 209 | 2361.33 | 15.96 | 0.61 | 1.25 | 7.98 | 1.17 | 0.76 | 0.16 |
| SNES 4p 0 ms | 3606 | 588 | 1955 | 418 | 4810.61 | 14.62 | 5.19 | 11.2 | 8.64 | 1.13 | 0.31 | 0.16 |
| SNES 4p 50 ms | 3606 | 692 | 1037 | 172 | 1834.18 | 11.28 | 2.01 | 1.96 | 14.07 | 1.2 | 0.64 | 0.18 |
| SNES 4p 150 ms | 3606 | 800 | 1918 | 443 | 5201.51 | 24.66 | 28.31 | 31.66 | 16.41 | 1.17 | 0.44 | 0.17 |
| SNES 4p 50 ms, delay 0 | 3606 | 712 | 1010 | 265 | 3522.03 | 255.9 | 124 | 82.63 | 212.37 | 2.11 | 7.18 | 0.41 |
| SNES 4p 150 ms, delay 0 | 3606 | 856 | 1287 | 246 | 2786.44 | 20.88 | 45.54 | 6.38 | 9.12 | 1.16 | 0.46 | 0.19 |

- **Doom** catches up 1,200–2,100 ticks in 2–5 frames. Its step is 8 µs, so
  the budget hardly matters.
- **The Super NES** needs 170–440 frames (3–7 s) at about 6 steps a frame.
  - Without the budget (the host before this work), all of that CPU would
    fall in one frame: 1.8–5.2 s, going by the catch-up CPU column.
  - A joiner a full minute behind would need about 10 s.
- **Cost of loading:**
  - The checkpoint loads in 10–30 ms of gunzip, a 1–2 ms hash and a
    sub-millisecond restore.
  - Identifying the content (SHA-256 of the 28 MB Doom content) is 12–20 ms.

### The browser

`pnpm check:browser` (`bench/browser/run.mjs`) does the following:
1. Runs `bench/browser/scenario.js` in Node.
2. Serves the package and runs the same module in headless Chrome.
3. Compares the two, and writes the browser's frames as PNGs.

The scenario covers both engines:
- **Doom** plays 1500 tics of the 4-player bot demo and draws all four
  players' views at tics 700 and 1500.
- **The Super NES** plays 1500 frames of the 4-player Unarmed script and
  draws frames 300, 1200 and 1500.
- Each engine hashes at four fixed ticks, then restores its middle snapshot
  and re-steps to the end.

Results (`check:browser` writes them to `bench/browser/out/`):
- **Hashes:** Chrome and Node agree on every hash at every fixed tick, for
  both engines.
- **Frames:** they agree on every frame's pixels (an FNV-1a of each frame's
  RGBA).
- **Restore:** in both, the restore comes back to the same state.

| | Doom: Node | Doom: Chrome | Super NES: Node | Super NES: Chrome |
|---|---|---|---|---|
| compile | 1.5 ms | 30 ms | 1.7 ms | 7.2 ms |
| boot | 9.9 ms | 15.6 ms | 2.2 ms | 2.0 ms |
| step (mean) | 7.7 µs | 8.4 µs | 1.73 ms | 1.57 ms |
| restore | 0.28 ms | 0.4 ms | 0.11 ms | 0.3 ms |
| hash | 2.24 ms | 2.3 ms | 1.18 ms | 1.3 ms |
| frame | 0.32 ms | 0.4 ms | 0.15 ms | 0.2 ms |

The pictures are what they should be:
- **Doom:** four different first-person views of E1M1 at tic 1500, each with
  its own status bar (ammo, health, face).
- **Super NES:** Unarmed's lore screen at frame 300, then the 4-player arena
  at frames 1200 and 1500, the four gladiators placed and the HUD showing 4
  heads.

## Rebuilding

The built engines in `engines/*/dist/` are committed. An engine's identity is
its exact bytes, and the tests must not need a compiler. Each build is
byte-for-byte reproducible.

| engine | SHA-1 of `dist/*.wasm` | upstream |
|---|---|---|
| toy | `5a45916394a174bb8735000244be21ab27febcf7` | `engines/toy/toy.c` |
| Doom | `8108618af149a057339603f8ff27298cb30a6473` | chocolate-doom `a2dfd51f`, plus `engines/doom/patches/` |
| Doom's music | `2394a476cbffc05496e686ca5299b7266eacb688` | the same tree's OPL music code, plus `engines/doom/music/` |
| Super NES | `285177b31244b56118df416fbc6421800da7029a` | MesenCE `4b8a196e`, unmodified, plus `engines/snes/src/` |

- **Toolchain:** emcc 7.0.0 (`brew install emscripten`). Each build is a
  standalone wasm with no JS glue: `-O2 -sSTANDALONE_WASM --no-entry
  -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH`, with `-ffile-prefix-map` for
  reproducibility.
- **Command:** `pnpm build:engines` runs `engines/{toy,snes,doom}/build.sh`.
  Each script can be run on its own, from anywhere.
- **Upstream sources:**
  - `$CHOCOLATE_DOOM` and `$MESENCE` name existing clones.
  - Otherwise the scripts clone the pinned commit under `$TMPDIR`, outside
    the package.
  - Nothing from upstream is executed: the sources are compiled directly,
    and only `git archive` of the commit is read.
- **Scratch:** Doom's tree is remade from the commit on every build
  (`$DOOM_TREE`). The SNES objects are cached (`$SNES_OBJ`), but only for
  the commit, compiler and flags named in the cache's stamp; any change
  empties it, since a stale object gives a different binary.
- **Checked:** from fresh clones in a copy of the package alone, all four
  builds give the bytes above, and so does the SNES build over an old,
  stale object cache.
- **Fixtures:**
  - The Unarmed ROM (256 KB) is committed.
  - The Freedoom IWADs (28 MB each) are not. `sh engines/doom/test/fetch-freedoom.sh`
    fetches Freedoom 0.13.0 and checks its SHA-256s; freedoom1.wad is what
    the engine plays, freedoom2.wad only has its sprites decoded.
    Alternatively, point `FREEDOOM1` (and `FREEDOOM2`) at copies.
  - Without the IWAD, the Doom tests and bench rows skip.

## Tests

`pnpm test` runs vitest's fast tier, for iterating (13 s on an M4 with
two workers); `pnpm test:full` (`MACHINE_FULL=1`) adds every exhaustive
case, and is what runs at commit (150 s). A test only the full tier runs is
marked `test.skipIf(!FULL)`; one the fast tier runs on a prefix says where
it cuts (`src/test-tier.js`). Every test is finite, with fixed inputs, fixed
latency and loss tables, and virtual time; nothing is random.
`src/test-setup.js` keeps it so under load: work that runs on real threads
(compiling, SHA-256, gzip) finishes before it is awaited, `performance.now`
is virtual too, and Automerge's ids come from a fixed sequence, so how far
virtual time got never depends on how busy the machine is. (Before this, the
host tests' timing, and with it some of their counts, varied run to run.)
A rare residue remains under heavy parallel load: about 1 in 16 runs of
the host test files, a settle finds peers stopped at different ticks after
a pause. Its source is below the host, in
automerge-repo's scheduling; it is left open.

- **Toy (`src/toy.test.js`):** restore every state into every prior state
  (1,250 pairs), across memory growth.
- **Snapshot and module checks:** `src/wasm-state.test.js` and
  `src/wasm-module.test.js` cover every memory size pair, every global type,
  every element segment encoding, and every refusal.
- **Exactness from other angles (`src/exactness.test.js`):** a snapshot
  taken mid-rollback (restored, then partly re-stepped) is byte for byte
  the reference's, for every restore point and distance on the toy and once
  on the Super NES, and goes on exactly in a fresh engine, in one that has
  outgrown it, in a separately compiled one, and in the engine that took it.
- **Doom (`src/doom.test.js`):**
  - every tic of the 1-, 2- and 4-player bot demos hashes as native
    Chocolate Doom's trace does (4201 states each);
  - restore torture;
  - drawing, a camera, every query and reading never change the state,
    every tic of the 4-player demo;
  - the queries are E1M1 as its lumps have it at tic 0, and follow the
    game (doors, lifts, lights, corpses);
  - a camera at a player's eyes sees that player's view;
  - sounds, the listener and content.
- **Presentation (`src/present/`):**
  - the screen: one texture for its life, no copy, an upload per new
    picture, each machine's aspect;
  - sound, on a fake WebAudio context that renders what was scheduled:
    the resampler over every way of cutting a signal, the stream over every
    arrival pattern of 6 frames bringing 6 ticks (it plays on exactly while
    the lead covers the lateness, else restarts once; never a click),
    stalls, gaps, bursts and drift; Doom's voices and corrections (each
    origin left making what the corrected tick leaves it making, 324
    pairings); Doom's mix against S_AdjustSoundParams; E1M1's music from
    the real player, sample for sample;
  - Doom's world: rotation selection by r_things.c's expression and its
    geometry at every 1/32 turn of facing and bearing and either side of
    every edge; the BSP's sector against the map's lines on a 16-unit grid
    (E1M1; every map of freedoom1 in the full tier, 1.3 M points); things
    on the floors Doom spawned them on; every sprite of both Freedoom IWADs
    decoded and checked against a second decoder (853 and 1350 lumps);
  - Unarmed: every frame of the scripted runs, each player where the game
    then draws it (the PPU's OAM), facing what the buttons asked, inside
    the arena; PNGs of it are evidence, not tests.
- **Content (`src/content.test.js`):** `parts` is `doom.js content()`'s
  layout; identification of WADs and cartridges; the cache with storage
  failing every way; `provide` over every ordering of up to three of seven
  candidates, with and without a recipe, against a rule stated apart.
- **Doom's music (`src/doom-music.test.js`):** E1M1 from the engine's
  record, every song in the IWAD, pause and stop, and songs after them.
- **Super NES (`src/snes.test.js`):**
  - two engines agree on every frame;
  - observers change nothing, queries of every memory every frame
    included;
  - the queried CGRAM holds the HUD's colours;
  - 55 restores;
  - each pad plays;
  - a golden hash.
- **Host (`src/host/`):**
  - the timeline against an independent spec, under every arrival order,
    also one step per event (a budgeted re-simulation that inputs land in
    the middle of);
  - seating as a fixpoint, and `seatingKey` equal exactly when the seatings
    agree before the tick;
  - peers over SimNet at LAN and WAN latency, with and without loss;
  - a late joiner, with and without a time budget;
  - contested seats, a vanished holder, a rebase, and a stale checkpoint
    left by a vanished writer (never started from, and deleted);
  - four peers of Doom and of the Super NES.

  Every host test ends with the harness's `settle`. Every peer must be at
  the same tick, and at **every tick it confirmed** its state's hash must
  equal the state the documents give when replayed from genesis. The
  harness traces each engine's steps to check this.

## Not done yet

- **The scene extension** (phase 2b): the clock, the process, queries
  across the worker and the screen are built (HOST.md, "Phase 2b, in a
  scene"); positional sound (`output()`, with Doom's events carrying
  positions), a station per port, Play as the way in (it sits you at a
  free port), a stopped screen's poster, the controls panel and the
  spectator's world are built too;
  Doom's mouse in a scene (it plays by keys there), the world's sound at
  its origins, and lifts and locked doors in the world are not (HOST.md,
  "Not done yet").
- **The host in a worker, in a scene.** The worker is built (below, and
  `src/worker/`) and answers queries, but in a scene the host runs on the
  page: hosting the worker from a Patchwork package needs a worker bundle
  that carries automerge-repo (HOST.md, Phase 2b, decision 9).
- **From the engines:**
  - views other than player 0 restart the status bar's face;
  - the SNES has no PAL timing, and cartridges that need firmware are
    missing;
  - snapshots are whole-memory (Doom 6.9 MB, SNES 3.5 MB). Dirty-page
    snapshots would be the next reduction.

## Being a player from the 3D world

Out of scope so far, by the lead's instruction: how someone in the
composed 3D world sees Doom's HUD and plays as player N there, rather
than at the screen. What building the spectator's world (HOST.md, step 7)
showed about it:

- **Everything needed to place player N in the world is already read.**
  The players query has each player's eyes (x, y, z, angle) and body; the
  map's frame comes from the map itself (`extras.doom`); so player N's eye
  in the stage is the map's displayed matrix applied to those eyes. At the
  model's scale (3 m across) that eye is a few centimetres up: the camera's
  near plane would have to scale with the map, or the map be laid out at
  1:1 (its `scale`, one field) to be played from inside.
- **The body would be the machine's, not the walk body.** Doom moves its
  player (its collision, its momentum, its doors), and every peer computes
  that from the inputs, so the scene can't move the player; it can only
  send ticcmds. A body the machine contributes (`bodies`, as sailing
  contributes aboard and the station) whose `eye()` is player N's eyes and
  whose keys are the pad's (forward, turn, use, fire: what Play's held tool
  declares now) would make "be player N" a body change, with nothing new in
  the stage. `camera.ride` doesn't fit: it rides an object, and the player
  is a billboard the extension draws, not an object. Its `lock` would also
  settle Doom's mouse (Decision 15): a body that owns the pointer.
- **The player's own body must not be drawn for its own eye.** Doom never
  draws the console player's mobj (it is behind the view plane); the
  spectator draws every player, which from inside your own body is a
  sprite in your face. The world would skip player N's thing for that view
  alone.
- **The HUD is two things.** The status bar and messages are the engine's
  own picture (`frame(view)`'s bottom 32 rows, and its top lines), which an
  overlay could show as they are, scaled. The weapon in hand (Doom's
  psprites) isn't in any query: the players query says which weapon, not
  its state or frame. Drawing the gun from the 3D world needs a query of
  the psprites (an engine change, small, in `machine_doom.c`), or the
  engine's own renderer for that layer alone.
- **Two pictures of one game must agree.** The 3D world is drawn from the
  head (predicted inputs included, as the screen is); a correction moves
  billboards and doors back a few tics, the same correction the screen
  shows. Nothing more is needed for a player than for a spectator.
- **Sound** follows: `world(toScene)` with the map's matrix as `toScene`
  puts each sound at its origin in the map, which is where a player inside
  it hears it.

## Phase 2, the engine side

What the scene will need from the engines, built before the scene's
clock and bodies exist. Nothing here is in `src/host/`; the host's clock
stays injectable (`Host.open(…, { clock })`, any `{ t(), running() }`), so
`api.clock` can replace the session's own when it lands.

**Decisions, made unattended (the lead was away):**
- **Queries are one export, `machine_query(kind)`,** returning
  `{u32 len, *u8 bytes}`, kinds engine-defined and listed in ENGINE.md.
  Not `machine_inspect`: the host's `inspect(name, ...)` already names the
  general "call any export on a copy", and each ABI export `machine_x` has
  the method `x` (`output`, `frame`, `query`). Kinds are integers, not
  strings, so the ABI stays two words; `doom.js` names them (`QUERY`).
- **Queries run on a copy, like frames,** and the copy is most of their
  cost. Running on the live state was measured to change it at the first
  tick (Doom builds its records in its zone), so the copy is not caution
  but necessity; a batch of kinds per copy was not worth its API at 0.1–0.2
  ms a query.
- **Doom's queries are records, not raw memory:** level, players, things,
  sectors, sides, enough with the map's static lumps to draw the level as
  it stands. Names, not indices (sprites, flats, textures), so a host needs
  no table of the engine's internals. Doom has no pitch; the players' and
  camera's views say so rather than carry a zero.
- **The Super NES's queries are its raw memories** (WRAM, VRAM, OAM, CGRAM,
  ARAM, SRAM) and nothing game-specific: a game's adapter reads them.
- **Doom's music is a separate module** (`dist/music.wasm`) of Chocolate
  Doom's own OPL driver and emulator, compiled from the same pinned tree,
  with a small platform under it (`engines/doom/music/music.c`) and one
  upstream bug fixed (patch 0003:
  a pause broke the next tempo change). It is presentation, so it is
  outside the contract: no snapshots, no identity. Rejected: decoding MUS
  in JS (a second, unchecked copy of DMX's behaviour), and putting music in
  the engine (it would enter every snapshot, and checkpoint it).
- **A camera is Doom's own export, `doom_camera(x, y, z, angle)`,** reached
  through `inspect`: a player of its own on the copy, full screen, plain
  palette. `machine_frame(view)` keeps one integer; a camera needs four,
  and only Doom has one.
- **Sound effects needed nothing new in the engine:** the events already
  carry the origin (now the same id as the thing's, so a sound can follow
  its body), `sounds()` already decoded every DMX lump, and the listener
  per view is the `players` query (`listener()`).

**Numbers** (Apple M4, Node 24, other agents' builds running):

| | |
|---|---|
| `doom.wasm` / `music.wasm` / `snes.wasm` | 419,961 / 75,844 / 765,839 bytes |
| Doom query, any kind | 0.1–0.24 ms (the 6.9 MB copy is most of it) |
| SNES query, any memory | 0.09–0.14 ms |
| Doom camera / frame | 0.35–0.68 ms / 0.27–0.48 ms |
| Doom's things / sectors / sides on E1M1, 4 players | 253 × 48 B / 182 × 32 B / 1829 × 32 B |
| music: init / render | 1 ms / 12–15 ms per second of stereo at 44.1 or 48 kHz (1.2–1.5% of a core) |
| E1M1's music | -20 dBFS RMS, peak -7.5 dBFS, at the driver's full volume |

**Rebuilding changed both engines' bytes,** so their identities (the
table above), and the Super NES golden (`ff7d5702b622b02c`); Doom's tests
check against native traces, which do not depend on the build.

## Phase 2, the host side

What the scene will need from the host, built before the scene's clock and
bodies exist; the full text and numbers are in [HOST.md](HOST.md) ("Phase
2, the host side"). The host's clock stays injectable (`{ clock }`), so
`api.clock` can replace the session's own when it lands.

```js
// on the page, the engine and timeline in a worker running src/worker/worker.js (bundled):
const host = await RemoteHost.open(repo, url, { worker, wasm, content, input: () => myPad });
// the same surface as Host:
host.frame(); draw(host.picture(view)); play(host.output()); host.sit(0); host.status.fault;
```

| path | what |
|---|---|
| `src/host/output.js` | what a listener hears under rollback, one policy for every engine |
| `src/worker/` | `RemoteHost` (page), `serve` and `worker.js` (worker), `PortAdapter` (a repo peer over a MessagePort) |
| `src/host/faults.test.js` | traps, divergence, deep rebases |
| `bench/worker/` | `pnpm check:worker`: a SNES joiner catching up, in headless Chrome, measured on the page's thread |
| `bench/output.test.js` | `pnpm bench:output`: what each peer hears, against the documents, at every lag |
| `bench/traffic.test.js` | `pnpm bench:traffic`: ephemeral traffic by send rate, mesh and hub, 2–4 players |
| `bench/retention.mjs` | the session document's cost of linking every checkpoint |

**Decisions, made unattended (the lead was away):**
- **The host runs in a worker whole, on a repo of its own** whose one peer
  is the page's repo over a MessageChannel, the way Patchwork's tab repo
  reaches its shared worker. Proxying handles across threads would
  re-implement Automerge sync. Pictures are transferred
  (SharedArrayBuffer would need cross-origin isolation, which Patchwork
  can't assume). The page never waits for the worker.
- **Audio: each tick delivered once, 0.05 s behind the head or when
  confirmed;** re-simulations that change nothing are dropped; changed
  events go out as corrections; changed samples are crossfaded at the
  splice. SNES: a PCM stream for a positional source. Doom: sound events
  with positions, for the scene to play the WAD's lumps.
- **At most 30 input messages a second per peer**, each carrying every
  unsent input plus the last 8.
- **Every checkpoint stays linked** (they can't be deleted; unlinking saved
  nothing), so a rebase replays at most one period, never from genesis.
- **A trap holds the timeline and is a status** (`status.fault`); the peer
  keeps sending inputs, so nobody waits for it.
- Outside `src/host` and `src/worker`: `esbuild` as a dev dependency (to
  bundle the worker check), and `bench:integration` now names its file, so
  the new benches stay out of it.

**Measured** (HOST.md has the tables):
- A Super NES joiner catching up 1,556 frames in a worker: no long task on
  the page, no frame over 16.8 ms, 0.1 ms of page time a frame. On the page
  with phase 1's budget: no long task either, but 10–12 ms of every frame
  for 4.8 s. Without a budget: a 2.6 s freeze.
- Over WAN with loss, at the default lag: 0.8% of SNES ticks heard differ
  from the record and no click (the same stream without crossfades has
  some, up to 0.05 of full scale; at lag 0, up to 0.10); 99.8% of Doom's
  sound records right when heard, the rest corrected.
- 30 messages a second halves the SNES's traffic for about one tick of
  frontier lag; through a hub each peer receives 34 × (n − 1) a second.

From "Not done yet" above, now done: the worker, ephemeral traffic,
checkpoint garbage (they can't be deleted; every one stays linked), and
rebasing before the oldest checkpoint. `api.clock` and the first half of
the scene extension came after, in phase 2b (HOST.md). Still open: the rest
of the scene extension, and the host side's own list in HOST.md.
