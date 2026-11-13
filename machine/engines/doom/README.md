# Doom

Chocolate Doom as a machine engine (`../../ENGINE.md`): `dist/doom.wasm`,
418 KB, imports nothing but the content reads and emscripten's growth
notice. It plays any Doom or Doom II IWAD, with PWADs, in single player,
co-op or deathmatch for up to four players, and agrees with native
Chocolate Doom tic for tic.

| path | what |
|---|---|
| `build.sh` | upstream at a pinned commit + `patches/` + the two files below → `dist/doom.wasm` |
| `patches/0001-trace-saves-bot-join.patch` | the Chocolate Doom spike's instrumentation, unchanged: the per-tic trace hash this engine is checked with (and a bot, saves, late join, unused here) |
| `patches/0002-machine.patch` | what the game itself must change: sound events, per-player pickup sounds, `TRACE_Hashes`, two `static`s removed |
| `machine_doom.c` | the ABI: content, setup (mirroring `D_DoomMain`), input, step, output, frame, `doom_trace` |
| `i_machine.c` | Doom's platform layer, replaced: no clock, no files, no window, no sound device, no network |
| `include/` | `config.h` and three SDL header stand-ins (types and byte order only) |
| `test/` | the bot demos, the native trace hashes, `fetch-freedoom.sh`, `bench.mjs` |
| `../../src/doom.js` | the host's side: `content`, `ticcmd`, `demo`, `events`, `lumps`, `sounds` |
| `../../src/doom.test.js` | the tests |

## Building

```sh
sh engines/doom/build.sh        # or pnpm build:engines, which builds every engine
```

Upstream is `chocolate-doom` at `a2dfd51fcc00d272dc8a17a97ccd6683333ff4ea`
(the commit the spike patched). The script takes it with `git archive` from
`$CHOCOLATE_DOOM` (any clone holding the commit; default a fresh GitHub clone
under `$TMPDIR`), applies the patches in order, and compiles the game's
sources directly with emcc 7.0.0; nothing of upstream's build is run. The
output is byte-identical from a fresh GitHub clone and from the spike's
working copy: SHA-1 `023f0ba516c6fd31a7f78a3920313e1df1a7971a`.

Not compiled: `i_*.c`, `net_*.c`, `d_net.c`, `d_loop.c`, `m_config.c`,
`w_file*.c`. `i_machine.c` stands in for what the game calls of them, and
defines libc's WASI calls inside the module, so they are not imports: the
clock reads 0, there is no environment and no file, and printing goes
nowhere. `I_Error` keeps its message for `machine_fault` and traps.

## Content

Records of `u32 length, bytes`: first the arguments, NUL-separated, then the
WAD files, the IWAD first (`content({ wads, args })` in `src/doom.js`). The
files are read through `machine.content_read` at explicit offsets; only the
lumps the game caches enter its zone, so the 28 MB IWAD is never in memory.

The arguments are Chocolate Doom's own command line, read by its own
`M_CheckParm`: `-skill`, `-episode`, `-warp`, `-deathmatch`, `-altdeath`,
`-fast`, `-respawn`, `-nomonsters`, `-timer`, `-avg`, `-pack`, `-nodeh`,
`-dehlump`, `-setmem`, `-gameversion`, plus two of the machine's:

- `-players <n>`: ports 0 to n-1 are in the game. More than one, or
  `-solo-net`, makes it a netgame (vanilla's co-op rules), as a demo does.
- `-mb <MiB>`: the zone, default 6 (linuxdoom's `mb_used`). A frame needs
  about 3 on E1M1.

The game is told by its lumps, not a file name (`-pack` for TNT and
Plutonia). Chex Quest and Hacx, which Chocolate Doom tells by file name, are
not supported. A Freedoom IWAD's DEHACKED lump is loaded as Chocolate Doom
does.

## Input

Six bytes per port, the ticcmd that vanilla Doom sends over the network:
`forwardmove` (i8), `sidemove` (i8), `angleturn` (i16 LE, the full 16
bits), `buttons`, `chatchar`. A port nobody holds sends zeros, a player
standing still. `ticcmd()` builds one; `demo(lmp)` reads a Doom 1.9 demo
(or a longtics one) into content arguments and one step per tic.

The step consumes its input (zeroes the buffer), so a snapshot holds what
the game made of it, each player's `cmd`, not the raw bytes. The save
button (`BT_SPECIAL | BTS_SAVEGAME`) is dropped: a machine's saves are its
snapshots. Pause works as in a netgame: anyone can press it.

## Output

No audio stream. Events, 28 bytes each (`events()` decodes them):

| offset | |
|---|---|
| 0 | kind: 1 music, 2 sound, 3 stop |
| 1 | i8: whose body the origin is (0-3), else -1; for music, 1 if paused |
| 2 | sound: volume 0-127; music: 1 if it loops |
| 4 | lump name, 8 bytes NUL-padded: `DSPISTOL`, `D_E1M1` |
| 12 | u32 origin handle (0 for none), stable while the thing exists |
| 16 | i32 x, y, z of the origin, 16.16 map units |

Every step's events start with the music that should be playing now, a
state rather than an edge, so a peer that restored or joined late needs no
history. Sounds follow in the order the game made them, recorded before
vanilla's listener logic: every sound, for every listener, with its
position. A host plays its own player's sounds and origin-less ones without
position, as Doom does, and places the rest. A new sound from an origin
replaces the one it was making (vanilla's one-channel-per-origin rule); a
stop ends it. The DMX lumps decode to PCM with `sounds(...wads)`.

Vanilla plays pickup sounds only for the console player; the patch sends
them for every player, from that player's body. The console player's still
goes through vanilla's path, so its `M_Random` calls, which the trace hash
covers, are unchanged.

## Frame

`frame(view)` is what player `view` sees, drawn by Doom's renderer as
`D_Display` draws it: the full-width 3D view with the status bar
(`screenblocks` 10), or the intermission or finale, 320×200, through the
palette the game last set (damage and pickup tints included). A view that
is not a player in the game shows player 0's. For a player other than 0,
the status bar is restarted for that player on the copy, so its face starts
from the neutral one and player 0's messages are not shown.

## What is checked (`src/doom.test.js`)

The demos were recorded by patch 0001's closed-loop bot on Freedoom 0.13.0
E1M1 at Ultra-Violence, 1, 2 and 4 players, 4200 tics each; the native
hashes are the native engine's trace after each of their tics.

- **Native equality:** for each demo, the strict trace hash (every section:
  mobjs, players, sectors, specials, world, misc, thinker order, links, both
  RNG indices) after every one of the 4201 states equals native Chocolate
  Doom's. Memory never grows in play.
- **Restore:** at every 35th tic of each demo (and every tic of the first
  140 of the 4-player one) the reference's snapshot is restored into a peer
  that has just stepped those tics on predicted inputs, and into a freshly
  booted engine; both then step the true inputs and must equal the
  reference byte for byte after every tic.
- **Observation changes nothing:** the 4-player demo, with every player's
  frame, the output and a trace taken after every tic, stays byte-equal to
  a plain run at every tic. A drawn copy's memory does differ from the live
  state, so drawing on the live instance would not be harmless.
- **Frames:** four players' views differ; equal states draw equal frames.
- **Sounds:** every sound in the 2-player demo is a lump with PCM; the
  music record is `D_E1M1`, looping; both players' pickups are heard.
- **Input edges:** the save button is dropped, pause pauses.
- **Content:** the snapshot is under 8 MB, below the IWAD; a bare WAD, five
  players and a 1 MiB zone are refused with Doom's own message.

The IWAD is not committed: `sh engines/doom/test/fetch-freedoom.sh` fetches
and checks it (or set `FREEDOOM1`). Without it the Doom tests are skipped.

## What it costs

`node engines/doom/test/bench.mjs`, Apple M4, Node 24, idle machine:

| | |
|---|---|
| `doom.wasm` | 417,910 bytes; compiles in about 3 ms |
| boot (IWAD directory, `R_Init`, E1M1 loaded) | 4-6 ms |
| step | 3-4 µs per tic (p99 about 12 µs) |
| frame (copy to the viewer, draw, RGBA) | about 0.25 ms |
| snapshot | 6,881,296 bytes: 0.2 ms new, 0.1 ms into a reused buffer |
| restore | 0.1 ms |
| hash | 2.3 ms |

The snapshot is the 6 MiB zone plus about 0.5 MB of static data, heap and
the 64 KiB stack (which sits below the data, so an overflow traps). Doom
uses about 1.3 KB of that stack.
