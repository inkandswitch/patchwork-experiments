# doom

Doom-format maps in a [scene](../scene/README.md). Drop (or paste the URL of)
a `.wad` file doc into a scene and its first map is laid out: one object for
everything that doesn't move, one per door, and one per exit switch. Every one of them is the same
WAD file doc, seen through this package's provider with params of its own,
so the scene is a composition of references into one foreign document,
rebuilt from it, not a copy of it.

```
pnpm install && pnpm build && pnpm test
```

Nothing Doom-shaped is outside this package. The doors open with the joints
package's slide (`joints.slide`), an exit switch is the traversal package's
exit (`traversal.exit`), and a map that is a scene on its own is walked with
the arena's first-person play (`arena.level`, and arena's own spawn point
part at the player 1 start); none of them knows it is Doom. This package
writes their traits in the shapes they document and asks for arena's part by
id in the registry; it imports none of their code.

## What this package registers

| type | id | for |
|---|---|---|
| `scene:source` | `doom-map` | `file` docs with extension `wad`: a part of a map as a GLB (`src/source.js`) |
| `scene:extension` | `doom` | no traits, so it never runs: it is here for its `drop`, which lays out a dropped `.wad` (`src/layout.js`) |

### The provider: `{ map, door, line }`

| param | | |
|---|---|---|
| `map` | string | the map's name (`"E1M1"`, `"MAP01"`). There is no default map: a render doc names one, and one that doesn't is an error listing the WAD's maps |
| `door` | integer or null | a door, by its sector |
| `line` | integer or null | an exit switch, by its line. With neither, the static part (below); with both, an error |

A part's GLB is Y-up metres with its origin at the part's anchor: the
static part's is the middle of the map at height 0, a door's the middle of
its footprint at its shut height, an exit switch's the middle of its line on
its front sector's floor. Materials are
`KHR_materials_unlit`, the texture sampled NEAREST up close (mipmapped
between levels far off), its colour multiplied by the sector's light as a
per-vertex grey (with Doom's fake contrast: east–west walls a little darker,
north–south a little lighter). One primitive per texture, so a part draws in
one call per texture it uses. `asset.copyright` is the WAD doc's notice
(below). The render's notes say what of the map doesn't work here.

The params are one per object, so each part can be rebuilt on its own.
Every part is built at the same scale, 36 map units to the metre
(`UNITS_PER_METRE`), so a map's parts fit together by construction. A map
is resized by its static object's `scale`, set in one place; its doors are
attached to it, so the stage scales them, their travel and their speed with
it.

### The parts: rigid prisms for a 2.5D world

Doom's world is a plan of sectors, each with a floor and a ceiling height. A
door is a sector whose ceiling rises, stretching the walls beside it. A scene
object is rigid, so a map becomes rigid parts (`src/parts.js`):

- **the static part** (`door` and `line` null): everything that doesn't
  move but the exit switches, built **as if every working door were open**,
  and without the doors' ceilings. The wall above a door
  reaches down only to where the door's underside stops when open; the
  door's jambs reach up to there.
- **a door** (`door: <sector>`): the door as a prism: its underside (the sector's
  ceiling flat) and, on each line to a neighbour, the strip of that
  neighbour's upper wall the door covers when shut (its shut height up to its
  open one), set 0.25 units inside the door so the fixed wall above wins the
  depth test as the door slides up behind it. The door opens to the lowest
  neighbouring ceiling less 4 (Doom's rule), computed when it is built.
  A door beside a sky (an outdoor wall) would rise above that sky's ceiling
  height when open, where nothing hides it; none of E1M1's doors is.
  A door shuts to its floor (Doom's rule), so a door a map leaves ajar is
  imported shut, and its notes and the About say by how much it was open.
- **an exit switch** (`line: <line>`): an exit switch's line (types 11, and
  51 for the secret exit), its walls exactly as the static part would draw
  them, which the static part leaves out. It doesn't move: it is an object of
  its own so that a scene can say where it leads. An exit walked over (52,
  124) is a tripwire, not a thing used, and isn't imported.

**Pegging.** Every wall's texture is aligned as Doom draws the map **at
rest, with every door shut** (`textureTop`, from the Unofficial Doom Specs
§4.3), on every part alike, so the parts meet with no seam while the doors
are shut. An upper wall is pegged to the lower ceiling by default: its
texture stands on the door's bottom edge, so the door's face is the door's
and rises with it. An **upper-unpegged** face hangs from the ceiling beyond
instead, and Doom keeps it still in the world while the door moves over it;
a rigid door can't, so it is drawn right shut and rises with the door, and
the door's notes say so (none in E1M1; one in Freedoom Phase 1, E3M7's
sector 133). The tests check the seam at every door of E1M1 vertex by
vertex, and that each face's texture stands on the door's bottom edge after
its row offset (and that this check fails for a face made upper-unpegged).

**Sectors** are traced from their sides into loops (the sector always on the
right; at a vertex where several edges leave, the sharpest right turn, so a
loop keeps to one face; a loop that passes a vertex twice is split there),
holes go in the smallest outline holding them, and each outline with its
holes is cut by earcut (ISC). `F_SKY1` ceilings aren't drawn, nor upper
walls between two sky ceilings.

**Scale.** 36 units to the metre puts Doom's common 16-unit steps (0.44 m)
under the arena walker's 0.45 m step; its 24-unit steps (0.67 m) need a jump,
which the walker has (an apex near 0.85 m). Doom's 56-unit player is 1.56 m.

### The drop: a map as a scene

`layOutMap` (the `doom` extension's `drop`) lays out a dropped WAD's first
map where it was dropped:

```
group "<map>"            infoUrl: an About doc (markdown)
└ <map>                  { map, door: null }, locked
  ├ Door <sector> × n    { map, door: <sector> }, locked; joints.slide
  ├ Exit switch × n      { map, line: <line> }, locked; traversal.exit { verb: "Exit" }
  └ Spawn point          arena's part, at the player 1 start (an empty scene only)
```

The doors are attached to the static part, so moving or resizing the map
moves and resizes them, and a door slides along its parent's +Y.

Dropped into an **empty** scene, the map is the scene, so it is made a
level: `arena.level` `{ look: "sky" }` (the arena's sky alone: the light is
baked in, so a sun would light nothing), and a spawn point at the player 1
start, made by arena's own `arena.spawn` part (found in the registry by id;
without arena installed there is none, and no level to spawn in). Dropped
into a scene with something in it already, the map is a piece of that
scene: no level, no spawn, the scene's game (if any) left as it was.

Each door's slide is `{ axis: [0, 1, 0], stops: { closed: 0, open: travel },
speed, wait, at: "closed" }` in metres and seconds: Doom's speeds (2 units a
tic, 4× for blazing doors) and wait (150 tics, 4.3 s), from its specs.

Each exit switch is an exit with the verb "Exit" and **no destination**
(`{ verb: "Exit" }`): where a map leads is the scene's to say, by setting
its `to` (the inspector's Leads to, or a publisher), and until it says, the
switch offers nothing. Where a Doom exit goes next (E1M2) isn't a document
this package can name.

**What works here, and what doesn't.** Plain doors work: sectors opened only
by doors used directly, with no key (line types 1 and 117, open–wait–close;
31 and 118, open and stay). Everything else that moves a sector (lifts,
floors, stairs, ceilings, crushers, locked doors, doors worked from a
distance by switches or tripwires) is imported where it rests and listed as
not working here; exits, lights, teleporters and scrolling walls are listed
as not imported (`src/specials.js`); exit switches are parts of their own
(above). Things other than the player 1 start are
not imported (monsters, items and decorations are mechanics or sprites, for
later). The list is in the About doc and in the static part's notes.

E1M1: 11 plain doors (sectors 10, 34, 48, 54, 64, 78–81, 84, 100), and an
exit switch (line 407). Not working: the locked doors (51, 71), the lifts
(98, 103), the lowering floor (76, 126, 129), the tripwire doors (77, 145).
Not imported: 291 things. The exit switch can be walked to from the player 1
start through plain doors (10, 34, 64) and off a lift where it rests (98: a
drop of 3.8 m), which `parts.test.js` checks over the map's sectors.

### Where it comes from: the notice

The WAD file doc carries where it came from and on what terms:
`origin: { name, urls, notice }`, the notice verbatim. Every GLB built from
it carries the notice as `asset.copyright`, and the map's About doc quotes it.

A Freedoom IWAD says it is Freedoom (a `FREEDOOM` lump holding its version)
but not on what terms; the release ships them beside it. One pure function,
`originOf(doc, wad)` (`src/freedoom.js`), answers for both the provider and
the drop: the doc's `origin`, else, for a Freedoom IWAD, its release's. So a
GLB carries Freedoom's notice whether or not the drop has run. The notice's
years change between releases, so it is known only for the release it was
copied from (0.13.0's `COPYING.txt`, verbatim, BSD 3-clause); another
release is named, and its About asks for its notice rather than stamping it
with 0.13.0's. When a notice is known and the doc has none, the drop also
writes it onto the file doc, so every place the doc is shared carries it.
The About says the scene is made from Freedoom's data, is not Freedoom, and
isn't endorsed by the Freedoom project, whenever the WAD is Freedoom's (by
its lump, not by what its origin is called). A WAD with no notice that isn't
Freedoom gets an About saying so.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/wad.js` | reading a WAD: the directory, a map's lumps, the palette, textures, pictures, flats (from the Unofficial Doom Specs) |
| `src/sectors.js` | a sector's loops and triangles |
| `src/specials.js` | what each line special does; which sectors are plain doors, which lines exit switches, and what rests |
| `src/parts.js` | a part's triangles by texture: walls, pegging, floors, ceilings, the door prism, an exit switch's walls |
| `src/images.js` | textures and flats as RGBA through the palette; RGBA as PNG |
| `src/glb.js` | the GLB writer for unlit, textured, palette art (not the scene's kit encoder, which has no textures) |
| `src/source.js` | the provider |
| `src/layout.js`, `src/extension.js` | the drop |
| `src/freedoom.js` | Freedoom's notice by release, knowing a Freedoom WAD, and `originOf` |
| `src/test/e1m1.wad`, `src/test/COPYING.txt` | the tests' WAD: Freedoom 0.13.0's E1M1 and only what drawing it needs (1.5 MB), and Freedoom's notice |
| `probes/make-fixture.mjs` | makes that WAD from a full one |
| `probes/doom.mjs`, `probes/doom-probe.html` | the browser probe (below), with copies of the scene's probe helpers |
| `probes/publish-e1m1.mjs`, `probes/e1m1-probe.html` | publish E1M1 from the test slice as a scene (`--dry-run` to only check; `--exit <url>` to give its exit switch somewhere to go; `--set-exit <scene> <url>` to change only that on one already published); `probes/scene-packages.mjs` gives the scene its suggested import and `packages` |

## Testing

`pnpm test` runs on `src/test/e1m1.wad`, exactly:

- `wad.test.js`: E1M1's counts (182 sectors, 1,175 lines, 292 things),
  references, specials, the player 1 start; every texture and flat it names
  is in the WAD; a picture's posts.
- `sectors.test.js`: every sector of E1M1 is bounded by closed loops; its
  triangles cover it exactly (twice their area equals twice the polygon's, in
  integers), none overlaps another of its own (separating axes, exact), none
  is outside it or crosses its boundary; no two sectors' triangles overlap
  (all 1,434 against each other). Measured: 14 sectors in several parts, 35
  holes; E1M1 has no vertex where two loops of one sector meet, so that case
  is tested on small maps (two squares at a corner, a hole touching its
  outline). Across all 100 Freedoom maps (28,568 sectors, 150 with such a
  vertex, 3,326 in several parts, 5,663 holes) every sector's triangles have
  exactly its area: measured with the full WADs, not in the tests.
- `parts.test.js`: Doom's pegging, every kind of wall under every
  combination of the two pegging flags (16 cases); every door of E1M1 meets
  the static wall above it with the same texture coordinates at the seam,
  and on each of its lines has its texture's bottom row on its bottom edge
  after the side's row offset (doors 48 and 84 have offsets); that check
  fails when those doors' faces are made upper-unpegged, and their notes
  then say so; a door left ajar is imported shut with its faces and seams
  still aligned; the static part has no ceiling over a door; the lifts are
  drawn where they rest; the exit switch (line 407) is exactly the
  walls the static part would draw there, which it leaves out, and is
  reachable on foot from the player 1 start.
- `source.test.js`: the static GLB (153 primitives: E1M1's 154 textures but
  the exit switch's; unlit, NEAREST, PNGs, copyright), a door's frame, an exit
  switch's (one wall, SW1GRAY), the same bytes twice, a Freedoom WAD's notice
  in its GLBs before any drop, the notes, failures (no default map).
- `layout.test.js`: the drop against a stand-in drop context: into an empty
  scene, the group, the 13 parts and their params, the parent, the slides,
  the exit switch (an exit called Exit, with nowhere to go), the level, arena's spawn part asked for by id and put at the start; into
  a scene with something in it, no level and no spawn; without arena, no
  spawn; the notice written to the file doc; the About, its disclaimer
  whenever the WAD is Freedoom's (and only then), and a release whose
  notice isn't known.

**The browser probe** plays E1M1 with a real keyboard and mouse in headless
Chrome: the BUILT scene, arena, joints and doom packages, on real Automerge
documents (two peers, each its own replica, merged 25 ms apart).

```
(in scene/, arena/, joints/ and doom/) pnpm build
node probes/doom.mjs --wad <freedoom1.wad> [--shots <dir>] [--gpu] [--show]
```

A pastes the WAD's URL into an empty scene; both views play; A and B walk
from the player 1 start through the great hall to door 100 (about 38 m); B
walks into the shut door, moves over a metre and is stopped; A presses F at
it; both see it rise 3.44 m and rest open; B walks through; C joins while it
is open and draws every door where the doc has it; it closes itself after
its wait; the doc's history shows two writes for the cycle; the door is
copied into another scene (⌘C, ⌘V), which has no game and so offers only
editing, and opens there from its menu (right-click) and closes itself; draw calls
and frame times are measured. It prints a JSON report and exits non-zero if
any check fails.

Measured (Chrome 1660 × 960): the whole map in 179 draw calls, first person
159–162; pasted, the map is built and shown in 0.5–0.9 s (the static part
builds in 0.2 s, 1.25 MB; each door in 20–60 ms, about 12 KB);
on the Mac's GPU (`--gpu`) one view holds 60 fps (16.7 ms median and 90th
percentile) both from above and in first person; on SwiftShader 16.7 ms from
above and 50 ms in first person.
