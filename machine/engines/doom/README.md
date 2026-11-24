# Doom

Chocolate Doom as a machine engine (`../../ENGINE.md`): `dist/doom.wasm`,
420 KB, imports nothing but the content reads and emscripten's growth
notice. It plays any Doom or Doom II IWAD, with PWADs, in single player,
co-op or deathmatch for up to four players, and agrees with native
Chocolate Doom tic for tic.

Beside it, `dist/music.wasm` (76 KB) plays the music: Chocolate Doom's own
OPL music driver and OPL emulator, a module of their own, never in a
snapshot (Music, below).

| path | what |
|---|---|
| `build.sh` | upstream at a pinned commit + `patches/` + the two files below → `dist/doom.wasm`; and `music/` → `dist/music.wasm` |
| `patches/0001-trace-saves-bot-join.patch` | the Chocolate Doom spike's instrumentation, unchanged: the per-tic trace hash this engine is checked with (and a bot, saves, late join, unused here) |
| `patches/0002-machine.patch` | what the game itself must change: sound events, per-player pickup sounds, `TRACE_Hashes`, two `static`s removed |
| `patches/0003-opl-tempo-after-pause.patch` | the music player's one fix to Chocolate Doom's OPL library (a pause broke the next tempo change); not in the engine |
| `machine_doom.c` | the ABI: content, setup (mirroring `D_DoomMain`), input, step, output, frame, queries, `doom_camera`, `doom_trace` |
| `i_machine.c` | Doom's platform layer, replaced: no clock, no files, no window, no sound device, no network |
| `include/` | `config.h` and three SDL header stand-ins (types and byte order only) |
| `music/` | `music.c`, the music player's ABI and platform, and the SDL it needs with one thread (`SDL.h`, `SDL_mixer.h`) |
| `test/` | the bot demos, the native trace hashes, `fetch-freedoom.sh`, `bench.mjs` |
| `../../src/doom.js` | the host's side: `content`, `ticcmd`, `demo`, `events`, `lumps`, `sounds`; the queries' decoders, `listener`, `camera` |
| `../../src/doom-music.js` | `music(wasm, lumps, rate)`: the music player's host |
| `../../src/doom.test.js`, `../../src/doom-music.test.js` | the tests |

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
working copy, wherever the tree is unpacked: SHA-1
`8108618af149a057339603f8ff27298cb30a6473` (`doom.wasm`) and
`2394a476cbffc05496e686ca5299b7266eacb688` (`music.wasm`).

Not compiled into the engine: `i_*.c`, `net_*.c`, `d_net.c`, `d_loop.c`,
`m_config.c`, `w_file*.c`, `opl/`. The music player is `i_oplmusic.c`,
`mus2mid.c`, `midifile.c`, `memio.c` and `opl/{opl,opl_sdl,opl_queue,opl3}.c`,
plus `music/music.c`. `i_machine.c` stands in for what the game calls of them, and
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

### Placing sounds

Everything a scene needs to place a sound is in the events and the
queries, for any number of listeners:
- **The sound:** `sounds(...wads)` decodes every `DS*` lump (DMX format 3:
  u16 3, u16 rate, u32 count, then unsigned 8-bit samples, the first and
  last 16 of them padding) to `{ rate, samples }`, Float32 in -1..1.
  Freedoom's 69 are mostly 22050 or 11025 Hz, and one each at 16000,
  17990 and 44100.
- **The source:** the event's origin. Its handle is the `id` of the thing
  making it (the `things` query), so a sound can follow its thing as it
  moves; a door's or lift's sound comes from its sector's centre, at z 0.
- **The listener:** `listener(engine.query(QUERY.players), view)`, the eyes
  of the player that `frame(view)` draws, `{ x, y, z, angle }`.

What vanilla does with them (`S_AdjustSoundParams`), for a scene that wants
Doom's mix rather than its own: distance is `dx + dy - min(dx, dy) / 2` in
the map's plane, full volume within 200 units, silent beyond 1200 (on map 8
of each episode, never silent), linear between; stereo separation is
`128 - 96 · sin(angle from the listener's facing to the source)`, out of 255,
left to right. A player's own sounds, and origin-less ones, play unplaced.

### Music

The first event of every step is the song that should be playing. A host
makes it audible with the music player:

```js
const player = await music(musicWasm, lumps(...wads), 48000);   // doom-music.js
// each frame, after the host has stepped:
player.follow(events(engine.output().events)[0]);   // plays, switches, pauses, stops
play(player.render(frames));                        // { rate, channels: 2, samples }
```

- **What makes the sound is Chocolate Doom's own:** `i_oplmusic.c` (DMX's
  OPL driver, with the IWAD's GENMIDI instruments, OPL2 as Doom 1.9 drove
  it), reading MUS through `mus2mid.c` and `midifile.c`, into Chocolate
  Doom's OPL library and its Nuked OPL3 emulator, through its own SDL
  driver (`opl_sdl.c`). One fix (patch 0003): after a pause, the next tempo
  change shifted every pending event, so a song started after a pause was
  silent for a long while.
- **`music/music.c` is the platform under them,** with one thread:
  - SDL's mutexes are tokens. Waiting on a condition is time passing: one
    sample of the chip, rendered and dropped. Only OPL detection at init
    waits, for 1 ms.
  - `RegisterSong` writes a MIDI file and reads it back: the one file lives
    in memory (`fmemopen`).
  - Like the engines, it imports only the growth notice. Its libc has no
    clock, environment or files.
- **ABI:** `music_buffer(len) -> *u8` (where the host copies a lump),
  `music_init(rate)` (the buffer holds GENMIDI), `music_play(loops)` (the
  buffer holds a MUS or MIDI song), `music_stop()`, `music_pause(paused)`,
  `music_render(frames) -> *i16` (stereo), `music_fault()`.
- **Presentation, not simulation:** the player's state is in its own
  instance, never in the engine's memory, so it never enters a snapshot, a
  hash or a checkpoint. A song starts from its beginning when the player
  starts it, so a peer that joins late hears it from the top.
- **Level:** the driver's music volume is full (127); the host sets the
  level. E1M1 is about -20 dBFS RMS, peaking at -7.5.

## Frame and camera

`frame(view)` is what player `view` sees, drawn by Doom's renderer as
`D_Display` draws it: the full-width 3D view with the status bar
(`screenblocks` 10), or the intermission or finale, 320×200, through the
palette the game last set (damage and pickup tints included). A view that
is not a player in the game shows player 0's. For a player other than 0,
the status bar is restarted for that player on the copy, so its face starts
from the neutral one and player 0's messages are not shown.

`camera(engine, { x, y, z, angle })` (doom.js, through the engine's
`doom_camera` export) draws from anywhere in the level: a spectator's
screen, a security camera. Doom's renderer draws from a player, so the
camera is a player of its own on the copy, its body in none of the level's
lists, holding no weapon. The view fills the screen (320×200, no status
bar) through the plain palette. It costs what a frame does (about 0.35 ms).
- **No pitch.** Doom's renderer cannot look up or down: walls are vertical
  columns by construction. A camera has a position and a heading only.
- **z is absolute,** the eyes' height; a player's is about 41 above the
  feet.
- **Outside a level** (intermission, finale) the picture is 0 by 0.
- At a player's eyes, it sees exactly what that player's view shows, 16
  rows lower (its horizon is the 200-row screen's middle, the view's the
  168-row window's), less the weapon, the messages and any tint.

## Queries

`engine.query(kind)` reads the current state on a copy (ENGINE.md), and
`doom.js` decodes each kind into plain objects: map units, angles in
radians counterclockwise from east. Each is an array of little-endian
records:

| kind | `QUERY.` | records | each |
|---|---|---|---|
| 0 | `level` | one, 16 B | gamestate (0 level, 1 intermission, 2 finale, 3 demo screen), skill, episode, map, paused, deathmatch, in-game bits, leveltime, gametic |
| 1 | `players` | four, 32 B | body (thing id), eyes x, y, z (16.16) and angle (BAM), health, armor, in game, state (alive, dead, reborn), weapon, extralight |
| 2 | `things` | every mobj, thinker order, 48 B | id, x, y, z (feet), angle, radius, height, flags, health, type, doomednum, sprite (4 chars), frame (\| 0x8000 fullbright), player |
| 3 | `sectors` | every sector, map order, 32 B | floor, ceiling, floor and ceiling flats (8 chars), light, special, tag |
| 4 | `sides` | every sidedef, map order, 32 B | x and y texture offsets, top, middle and bottom textures (8 chars, "" for none) |

Any other kind is `null`. Together with the map's static lumps (vertexes,
linedefs, nodes), these are everything a scene needs to draw the level
itself, with its things in it, as it is at this tic:
- **Things** carry what a sprite renderer needs: the sprite and frame
  (`TROO` + frame 1 + rotation from angle is the lump `TROOB1`), and the
  colour translation of a player's body (`(flags >> 26) & 3`). A thing's
  `id` is the origin handle of its sounds. Those with `NOSECTOR` (teleport
  destinations) are never drawn by Doom.
- **Sectors** move (doors, lifts, crushers) and flicker; **sides** change
  texture (switches) and scroll.
- **Players** are the eyes, for a camera (`camera(engine, players[v])`) and
  a listener. Doom sets them in a player's first tic; at tic 0 their z is
  0.

The records are built in the zone of the copy (about 0.1–0.2 ms per query,
nearly all of it the copy of the state).

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
  frame, a camera at every player's eyes, every query (and one kind that
  does not exist), the output and a trace taken after every tic, stays
  byte-equal to a plain run at every tic (4200 tics). A drawn copy's memory
  does differ from the live state, and a query run on the live instance
  changes the state at the first tic, so neither is harmless on the live
  instance.
- **Queries are the map:** at tic 0, every sector and sidedef equals its
  record in E1M1's lumps (with the light and timed-door specials cleared,
  as `P_SpawnSpecials` clears them), the things are exactly the map's
  things that a co-op Ultra-Violence game spawns (map number, position,
  angle), plus the four players on their starts, eyes 41 above their feet
  after the first tic.
- **Queries follow the game:** every tic of the 4-player demo, each
  player's body is the thing that says it is; the doors and the lift the
  bots open (sectors 10, 98, 100, 103) move, lights flicker, and corpses
  appear.
- **Camera:** equal states draw equal pictures; at each player's eyes at
  tic 1800 it equals that player's view outside the weapon's columns, pixel
  for pixel; turned or raised, it differs.
- **Listener:** each view hears from its player's eyes; a view not in the
  game is player 0's.
- **Frames:** four players' views differ; equal states draw equal frames.
- **Sounds:** every sound in the 2-player demo is a lump with PCM; the
  music record is `D_E1M1`, looping; both players' pickups are heard; every
  `DS*` lump in the IWAD decodes.
- **Music (`src/doom-music.test.js`):** following the 1-player game's
  record plays `D_E1M1`, audible every second for 10 s, never clipping,
  identical on two players; all 41 songs in the IWAD play; pause and stop
  fall silent within a second, and a song started after a pause, a pause
  and resume, or a stop sounds as on a fresh player (within 10% RMS; without
  patch 0003, silent after a pause); a sound lump, a missing lump and WADs
  without GENMIDI are refused. The player imports only the growth notice.
- **Input edges:** the save button is dropped, pause pauses.
- **Content:** the snapshot is under 8 MB, below the IWAD; a bare WAD, five
  players and a 1 MiB zone are refused with Doom's own message.

The IWAD is not committed: `sh engines/doom/test/fetch-freedoom.sh` fetches
and checks it (or set `FREEDOOM1`). Without it the Doom tests are skipped.

## What it costs

`node engines/doom/test/bench.mjs`, Apple M4, Node 24, idle machine:

| | |
|---|---|
| `doom.wasm` | 419,961 bytes; compiles in about 3 ms |
| boot (IWAD directory, `R_Init`, E1M1 loaded) | 4-6 ms |
| step | 3-4 µs per tic (p99 about 12 µs) |
| frame (copy to the viewer, draw, RGBA) | about 0.25 ms |
| camera (the same) | about 0.35 ms |
| query (copy to the viewer, records) | 0.1–0.2 ms, any kind |
| `music.wasm` | 75,844 bytes; init 1 ms; 12–15 ms per second of stereo at 44.1 or 48 kHz |
| snapshot | 6,881,296 bytes: 0.2 ms new, 0.1 ms into a reused buffer |
| restore | 0.1 ms |
| hash | 2.3 ms |

The snapshot is the 6 MiB zone plus about 0.5 MB of static data, heap and
the 64 KiB stack (which sits below the data, so an overflow traps). Doom
uses about 1.3 KB of that stack.
