# The engine contract

An **engine** is a deterministic program stepped one tick at a time from
per-player inputs. It is a single standalone `.wasm` file, with no JS glue,
and its whole state is its instance: linear memory, the memory's size, and
the mutable globals. Snapshot copies those out and restore writes them back,
so restore is exact by construction for any engine and any content.

## What a module exports

The C side is `engines/machine.h`. Pointers are wasm32 addresses, integers are little-endian.

| export | signature | |
|---|---|---|
| `memory` | memory | the module's own; not imported, not shared |
| `machine_info` | `() -> *{u32 hz_num, hz_den, players, input_bytes}` | constant |
| `machine_init` | `() -> i32` | boots from the content; 0 on success |
| `machine_input` | `() -> *u8` | `players * input_bytes`, port after port |
| `machine_step` | `() -> void` | one tick, reading the input buffer |
| `machine_output` | `() -> *{u32 rate, channels, count, *f32 samples, u32 events_len, *u8 events}` | optional; the last step's audio and events |
| `machine_frame` | `(i32 view) -> *{u32 width, height, *u8 rgba}` | optional; a picture from `view` |
| `machine_content` | `(u32 len) -> *u8` | optional; where the host copies the content in, before `machine_init` |
| `machine_fault` | `() -> *u8` | optional; why the last call trapped, NUL-terminated, for the host's error |
| `_initialize` | `() -> void` | optional; the WASI reactor's constructor call, run once before `machine_init` |

`content` is one byte string in a format the engine defines: an IWAD, a ROM,
or a small container of several files and options. It reaches the engine
one of two ways. An engine that exports `machine_content` has it copied into
its memory before `machine_init`, and from then on it is part of every
snapshot. Any engine may instead read it where and when it wants through
two imports, so content it only consults (a 28 MB IWAD) never enters memory
and snapshots hold only the program's state:

| import | signature | |
|---|---|---|
| `machine.content_size` | `() -> u32` | the content's length |
| `machine.content_read` | `(u32 offset, u32 len, *u8 dst) -> void` | copies content bytes into memory; past the end traps |

Both are pure functions of their arguments: the content is fixed for the
engine's life and named in its identity (below). A port nobody holds gets
zero bytes. An engine that needs to know who is present reserves a bit
for it in its input.

## What the host makes of it

`src/engine.js`: `compile(wasm)` checks and compiles once, then
`boot(content)` returns an engine at tick 0:

```
{ hz, tickRate: [num, den], players, inputBytes,   // hz = num / den
  step(inputs: Uint8Array),          // players * inputBytes
  snapshot(into?): Uint8Array, restore(snapshot),   // into: a dropped snapshot to reuse
  hash(): string,                    // 64-bit, of exactly what snapshot holds
  output(): { audio?: { rate, channels, samples: Float32Array }, events?: Uint8Array },
  frame(view?): { width, height, rgba: Uint8ClampedArray } | null,
  inspect(name, ...args): { result, memory } }  // any export, called on a copy
```

A trap in `machine_init`, `machine_step` or an inspected export is thrown as
an `Error` carrying the engine's `machine_fault` message (Doom's `I_Error`
text, for instance), with the trap as its `cause`.

- **`output()` reads; it does not drain.** The engine overwrites its output
  buffers at each step, so what `output()` returns is a function of the state
  after that step. A peer that never asks for output stays in the same
  state as one that does. Outputs of re-simulated ticks can be dropped or
  used.
- **`frame(view)` draws on a copy.** Drawing may write memory: Doom's
  renderer bumps `validcount`, which the simulation also reads, and fills
  visplanes. `view` is peer-specific, for example which player's eyes. So the
  host copies the live state into a second instance, the viewer, and draws
  there, afresh each call. The live state is never touched. The cost is one
  memory copy per drawn frame.
- **`inspect(name, ...args)` is the same thing for any export:** an
  engine-specific query (Doom's `doom_trace`, the native trace hashes) runs
  on a fresh copy, and the caller reads its result from the copy's memory.
  Even an export that only reads leaves its stack frame in memory, so
  nothing but the ABI's own calls runs on the live instance.
- **`hz` is a ratio in the ABI** (the SNES engine is 21477270/357366, Mesen's NTSC master clock over a frame), so it is
  exact without floats in the struct.

## Why the state is only memory and globals

A WebAssembly instance holds memory, globals, tables, and the dropped-or-not
flags of passive segments. Anything else it would need comes in through
imports. `src/wasm-module.js` (`prepare`) settles each of these mechanically
before compiling, and refuses any module it cannot:

- **Imports:** only the host's fixed set (`IMPORTS` in `src/engine.js`). Each
  one must be a pure function of its arguments that keeps nothing. Today the
  set is `env.emscripten_notify_memory_growth`, a no-op, and the two content
  reads above. There is no
  clock, no randomness and no files, so time, entropy and file positions
  cannot live on the JS side because nothing could deliver them. An engine
  that needs another import adds it here, under that rule.
- **Memory:** exactly one, defined by the module, not shared, so there are no
  threads.
- **Mutable globals:** every one is exported (the module is rewritten,
  deterministically, to add `machine:global:<i>` exports) and captured. That
  includes the stack pointer, which is the same at every call boundary
  anyway. A mutable global of a type JS cannot read back exactly, such as
  v128 or a reference, is refused.
- **Passive data and element segments:** refused, because `data.drop` and
  `elem.drop` state lives outside memory.

Three rules cannot be checked from the binary without decoding the code, so
they are the engine's obligation:
- **Tables are not mutated after instantiation:** no `table.set`, `table.grow`
  or `addFunction`. Emscripten without dynamic linking complies.
- **No NaN bits reach state.** WebAssembly may return different NaN payloads on
  different hosts. Integer and fixed-point engines (Doom, SNES cores) are
  immune. The toy's floats are only output samples of finite values.
- **No relaxed SIMD.** Its results differ by hardware, so don't build with
  `-mrelaxed-simd`.

The two remaining sources of nondeterminism in WebAssembly are resource
exhaustion: a failed `memory.grow`, or stack overflow. Both stop the engine
with a trap or an error and never diverge silently, provided the stack sits
below the static data: emscripten's default puts it above, where an overflow
would overwrite data without a trap, so an engine should link with
`-Wl,--stack-first` (the stack then grows down towards address 0, past which
every access traps). All three engines here do. The host treats a trap as
a fault. Two caveats: a trap is not always the same on every host (a
`memory.grow` the browser refuses for lack of memory, or the host's own call
stack running out in deep recursion, can fault one peer and not another), so
a fault is a local failure for that peer to report, never a state to share;
and a program that checks malloc's result and carries on would make a refused
growth a silent divergence, so an engine should treat a failed allocation as
fatal.

## Snapshot and restore

`src/wasm-state.js`. A snapshot is laid out little-endian and is word-aligned
throughout:

```
u32 pages | u32 global count | 8 bytes per global | memory bytes
```

- **Restore** grows memory to the snapshot's size. Memory cannot shrink, so
  when the instance is bigger, because it grew after the snapshot, the engine
  restores into a fresh instance of the same compiled module. Memory size is
  part of the state, since `memory.size` is observable to the program, and
  stays exact too.
- **`hash()`** covers exactly the snapshot's bytes, without copying them. It
  is two MurmurHash3 lanes, which tell states apart but do not resist
  forgery. It is a full pass over memory, about 0.4 ms per MB on an M4
  (a snapshot copy is about 0.2 ms per MB), so a host checks at checkpoints,
  roughly 1 Hz, not every tick.

## What makes two peers' engines identical

A session records:

| field | value |
|---|---|
| `engine` | SHA-256 of the `.wasm` bytes, as built, before `prepare`'s deterministic rewrite |
| `content` | SHA-256 of the content bytes |
| `genesis` | `hash()` after `boot`, a cross-check that costs nothing |

`identify(wasm, content)` in `src/engine.js` computes the first two. Equal
engine bytes plus equal content give equal states at every tick for equal
inputs. Content that cannot be shared, such as a commercial ROM, enters the
document only as its hash, and each peer supplies its own copy.

Determinism is a property of the exact build. Built engines are committed
(`engines/*/dist/`, re-included past `.gitignore`) and must build
reproducibly: `pnpm build:engines` produces byte-identical output with the same
emcc.

## How each engine keeps state out of JS

- **toy** (`engines/toy`): its only import is the growth notice. The content is
  folded into its seed, and its randomness is an LCG in memory.
- **Doom** (`engines/doom`, details in its README): Chocolate Doom at a
  pinned commit, with the spike's trace patch (the hash it is checked
  against native with) and a small one of its own, built with
  `-sSTANDALONE_WASM`. Its
  own platform layer (`i_*.c`, networking, config) is not compiled;
  `i_machine.c` answers the game from memory or not at all.
  - The content is the arguments (Chocolate Doom's command line) and the
    WADs. They are read through the content imports at explicit offsets, so
    the IWAD is never in memory; only lumps the game caches are, in its
    zone.
  - The zone is one fixed block (6 MiB, the original's; `-mb` changes it),
    so a snapshot is about 6.6 MiB and drawing never grows memory.
  - `I_GetTime` is `gametic`; randomness is Doom's own table indices; libc's
    clock reads 0, files do not exist, printing goes nowhere, all defined
    inside the module (`i_machine.c`), not imported.
  - A step consumes its input (zeroes the buffer), so the state holds what
    the game made of it, each player's `cmd`, and not the bytes that came in.
  - The save button is dropped: a machine's saves are its snapshots.
  - Sounds and music leave as events, for the host to place and play from
    the WAD's own lumps (`src/doom.js`).
- **SNES** (`engines/snes`): MesenCE's SNES core, unmodified, at a pinned
  commit, behind a frontend of our own (`src/machine.cpp`). Mesen's
  `Emulator` (threads, frame limiter, rewind, movies, netplay, debugger,
  files) is not compiled; `src/host.cpp` defines what the core calls of it.
  - The ROM is the content, any cartridge. Five pads: port 1, and a multitap
    in port 2 holding four more, so two-player games use pads 0 and 1.
  - Settings are fixed in the engine: NTSC, all-zero power-on RAM, no frame
    skipping. Mesen's random generator (used only for the one cartridge it
    special-cases to random RAM) is in memory with a fixed seed.
  - libc's system calls are defined inside the module (`src/wasi.c`), not
    imported: the clock reads 1970 and never moves, the environment is empty,
    there are no files. So a cartridge clock (S-RTC, SPC7110) reads the same
    date everywhere, and firmware, MSU-1 data and battery saves are absent.
  - What the core can reach only through an absent feature (the debugger,
    Super Game Boy, Satellaview packs, SPC playlists) traps.
  - The core's own serializer is never used: the memory snapshot replaces it,
    which also sidesteps bsnes's libco save-state problem.
  - `hash()` is the contract's, over the whole snapshot (about 3.5 MB), not a
    chosen list of RAMs and registers. A list would have to name every chip's
    internal state to be exact; the whole memory cannot leave anything out.
