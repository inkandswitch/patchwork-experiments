# walk: standing on supports

*Design, written 2026-11-17 in lane/n10 (step 2 of 6). Steps 3–5 build it:
step 3 moves the walker into walk (pure; built, see "As built, step 3"),
step 4 gives walk's body supports, step 5 makes sailing walk in walk, step 6
republishes her examples and moves sailing's walking text here ("Foundations"). Every decision here was made
without the lead and is marked so in "Decisions"; what is the lead's taste is
asked in "Questions for the lead".*

walk has one walker: the navmesh walker sailing built for her deck
("Foundations", at the end: moved here from sailing's DESIGN), generalised
from one ship to any **support**, a frame you stand in. The stage's own frame
is a support too, the **ground**, so a level, a deck and a lift are walked by
the same code under the same invariant. Two walkers go:
- walk's ray walker (`walk.js` `step`, the down and ahead rays, `carried`,
  the body's `ride`);
- sailing's copy of the navmesh walker (her `aboard` body and everything
  under it; "What goes, what stays").

What sailing's walker proved stays proved. The bake's properties B1–B7, the
invariant I, the transitions W/A/V/P/R/SW and the enumerated cases carry
over with renames (ship → support, sea → water, OVERBOARD → OFF). This note
says only what is new or changed. The text it builds on is "Foundations",
at the end, moved here from sailing's DESIGN in step 6, renamed.

Nothing in walk or scene names a sailing concept. Sailing reaches walk only
at run time: the traits it writes on its parts, `api.body.enter("walk",
hull)`, and walk's presence record.

## Words

- **Support**: a frame you stand in. Each object with the trait
  `walk.support` is one, and so is the **ground**, the stage's own frame. A
  support's frame is its object's drawn world matrix with the scale divided
  out (rigid, metres), so its up is its object's +Y. The ground's is the
  identity.
- **Owner**: an object's nearest ancestor with `walk.support`, or the ground
  if it has none. A support owns itself. Each object is baked into its
  owner's mesh or into none. A support under a support (a dinghy in chocks, a
  lift aboard) is its own owner, so its subtree is not its parent's.
- **Loose**: never floor and never baked. An object is loose when it, or an
  ancestor up to its owner, is hidden (`visible: false`) or carries
  `scene.carry` (a die, a bag, a card). Groups have no geometry of their
  own. A link (another doc's stage) is not this stage's object, so it is
  not baked either (see "Questions", Q6).
- **Moving part**: an object with `walk.moves`, with its subtree. Its owner
  does not bake it as drawn:
  - `{ swept: "x" | "y" | "z" }`: baked as the solid its turn about that
    axis of its own frame sweeps (sailing's wheel: `sweptAbout`);
  - `{ blocks: true }`: a **blocker**, an obstacle drawn where it is each
    frame (the boom, a sliding door; "Blockers" below);
  - `{}`: ignored, it passes through people (a sail, an anchor on its rode).
- **Kept cell, side, rise, D_r, link**: as in "Foundations", per
  support. A side's record is STEP, WALL or OPEN; a WALL's or OPEN's `to` is
  a cell, **OFF** (off the support's outline: sailing's OVERBOARD) or NONE.
- **Stand spot**: an object with `walk.stand`. It is a seed of its owner's
  bake and a link in its mesh.
- **Ladder**: an object with `walk.ladder`, the climb from the water onto
  its owner. A seed at its top, a link with a foot in the water.
- **Water**: what the stage's `water` contribution answers,
  `api.collect("water")`'s `at(p, { not })` (water/WATER.md, "The
  contribution"), as sailing's sea-view reads it. Walk swims only in water
  owned by the ground: it asks `at([x, null, z], { not: [every support's
  id] })`, so water any support carries (a tank aboard) is left out, and
  the surface is that reader's height at (x, z). Today `not` takes one id;
  step 4 lets it take a list (a change to water, with water's test: a body
  under any listed id is left out, and one id behaves as now). Where `at`
  answers nothing there is no swimming.
- **Clear**: the body is clear at (p, f) when, for every support with a
  mesh (the ground included), the box that holds the body's cylinder
  (radius r, heights f to f + H) taken into that support's frame meets no
  interval of its raster in the open height range (f, f + H), over the
  columns within c/√2 of that box. A box, so a heeled support is judged
  conservatively; open, so feet resting on a surface are clear.

## The traits

Written by whatever lays a scene out (arena's parts, doom's layout,
sailing's parts and template). Walk declares each in `describes`, so a doc
that carries one calls for walk and lists it, as `walk.spawn` does today.

| trait | on | value | what walk does with it |
|---|---|---|---|
| `walk.spawn` | object | `{}` (unchanged) | where people start, facing the way it faces (as now); on an object with a `walk.stand`, at that stand spot, facing its `facing` (Decision 41); a seed and a `spawn` link of its owner |
| `walk.support` | object | `{}` | a support: its subtree, less sub-supports, loose things and moving parts, is baked in its frame |
| `walk.moves` | object | `{ swept?: "x"\|"y"\|"z", blocks?: true }` | a moving part (above); never more than one of the two |
| `walk.stand` | object | `{ at: [x,y,z], facing?: [x,y,z], claim?: kind }`, points in the object's own frame | a stand spot: a seed, and a `stand` link at `at` facing `facing` (default the object's origin). Whoever holds the object's claim of kind `claim` (`api.claimedBy`) is drawn standing there ("Presence under a body") |
| `walk.ladder` | object | `{ top: [x,y,z] }` in the object's own frame | a seed at `top`, a `ladder` link: `top` its cell, `foot` the nearest water point outside the owner's D_r to the object's origin |

Each trait's part has the trait's verb, as `walk.spawn` has Walk from here:
- `walk.ladder`'s is **Climb**, offered while you swim within reach of the
  foot (L1);
- `walk.support` and `walk.stand` have no verb of their own. You walk onto
  a support; a writer that wants a verb for entering at one offers it
  (sailing's Come aboard, `api.body.enter("walk", hull)`), so the hull's
  menu has one verb for the act, and its owner is the writer. A stand spot
  means what its writer says (sailing's helm); walk only stands people
  there.

## One body

A person is the same size on every support, so there is one parameter set,
`BODY`. It is sailing's `DECK` with walk's speeds and jump, because the deck
and the cockpit are where the numbers were proved (sailing's "Parameters":
the cockpit STEP, the shroud passage, the lifelines).

| name | value | was (walk / sailing) | why |
|---|---|---|---|
| `cell` c | 0.05 m | – / 0.05 | the coaming top and the lifelines (sailing's table) |
| `slope` | 35° | – / 35° | |
| `step` | 0.58 m | 0.45 / 0.58 | the cockpit's 0.546 rise is a STEP, the lifeline's 0.61 a WALL |
| `height` H | 1.75 m | – / 1.75 | |
| `eye` | 1.6 m | 1.6 / 1.6 | |
| `radius` r | 0.25 m | 0.35 / 0.25 | the shroud passage; a Doom corridor is 1.8 m or more |
| `jump` | 5.2 m/s at gravity 16 | 5.2 / 4.6 | apex 0.845 m: Doom's 24-unit stair (0.67 m) needs a jump, as now, and still gets one. Aboard it clears the lifelines more easily. The windlass top it now reaches is eroded away (0.43 m across, under the 0.57 m erosion disc), so nothing new is reachable |
| `walk`, `run` | 4.5, 7.5 m/s | 4.5, 7.5 / 3.2, 5.5 | walk's (Q3) |
| `march` | 1.5 m | – / 1.5 | |
| `drop` DROP | 2 m | – / – | new: the furthest down an OPEN side puts you onto another support (W3) |
| `sunk` SUNK | 1.5 m | – / 1.5 | feet this far under the water: awash, you swim |
| swim | depth 1.3, walk 1.3, run 2.2, accel 4 | – / same | sailing's `SWIM` |
| `fallLimit` | −60 m in the stage's frame | −60 / – | below it you respawn |
| `rest` | 0.5 s | – / – | new: held this long, falling, on a surface that is no cell, you are placed again (F5) |

Sailing's DECK and WALKER constants that are not body numbers go:
`boardWait` (a support whose model never loads leaves you where P1 put you:
see "Waiting"), `seatedEye` (a body over walk resumes at its eye: "Bodies
over walk").

## The bake, per support

`bake(input, BODY) → NavMesh` is sailing's `navmesh.js`, moved as it is
after step 1 (a floor only where its triangle meets the column's open
square, KNOWN_GAPS empty). Its steps 1–5, 7 and 8 do not change. What
changes is the input, the pruning (step 6), and when it runs.

### Input (the adapter, stage side)

For a support s with frame M_s (rigid) and its object's scale k:
- **triangles**: for each object o owned by s, not loose, not a moving part
  and not under one, in id order: `trianglesOf(api.content(o).root)` (the
  GLB's rest pose), placed by the doc transforms from o up to s (`placeIn`,
  not the drawn pose), scaled by k into metres. A `swept` part adds its
  swept solid the same way. For the ground, "up to s" is up to the root,
  and k is 1. `trianglesOf` reads an instanced mesh as one copy per
  instance, each through its instance matrix (terrain's trees); today it
  reads `isMesh` geometry only, so step 4 adds this, with a row.
- **index**: the triangles bucketed by the tiles their bounds meet (below),
  built once per key, so a tile reads only its own.
- **seeds**: the points of every `walk.spawn`, `walk.stand` and
  `walk.ladder` s owns, in s's frame.
- **key**: a hash of k and, for each baked object, its id, its file
  (`sourceUrl`, `renderUrl`), its transform relative to s, whether its
  model has loaded, its `swept` axis and its trait keys (sailing's
  `navKey`, generalised). The support's own drawn pose is not in it, so
  sailing never rebakes her because she moved. Blockers are not in it
  either: they are read each frame. There is no key while a baked object's
  model is still coming, by the stage's own rule for what has loaded
  (`contentIn`): content that loads (a source or a render) and hasn't,
  unless it is a link (its content is its doc, drawn by that doc's stage:
  no triangles here) or failed (status `error`, or `warn`: no provider).
  What isn't coming and hasn't loaded bakes as nothing; its loading later
  changes the key. A model rebuilt in place (the same urls) does not change
  it: owed (a content root's identity would, but would stop two views of
  one doc sharing a mesh).

An object that moves in play must be a support, a moving part or loose,
whether it moves by writing its doc transform or by a pose hold. The bake
reads doc transforms, so an untagged mover is baked where its doc says: a
doc-transform mover rebakes its owner at each write (correct, slow), and a
pose-held mover is a wall at its doc pose while it is drawn elsewhere
(wrong). The stage can't tell walk which objects will move, so the writer
that makes a thing move says how walkers meet it:
- **Doom's doors** are `joints.slide` parts that move by pose hold and
  write only their stops (joints/src/slide.js). Doom's layout writes
  `walk.moves { blocks: true }` beside each door's `joints.slide`
  (doom/src/layout.js, step 4). The door is then out of the ground's bake,
  so the doorway is open floor, the drawn door blocks it as a blocker
  wherever it is, and a stop write rebakes nothing (a blocker is not in the
  key). joints does not name walk; doom, which uses both, does.
- **Check C10** (a probe check) names every baked object that moved in play:
  its doc transform changed, or its drawn pose left its doc pose (a pose
  hold), while every door, lift and joint in the doc is cycled once by its
  own verb.

### Pruning (step 6), generalised

Sailing kept the components holding a seed and dropped the rest. That
can't stay: a floor you reach only by dropping off a ledge, from another
support (a lift's top, a pontoon reached by boat) or by a ladder is a
component of its own, and seeds alone would drop it. Nor can it be
replaced by a parity test ("inside closed geometry", C6): a level's room is
a closed shell, so parity calls every room inside.

**Order.** Today the bake renumbers kept cells right after pruning and
marches sides over kept cells only (sailing/src/navmesh.js, the `newOf`
renumbering before the side classification), so no side can name a dropped
component. In walk the order is: erode → components → **march every side
of every eroded cell** → prune → renumber, and a side whose `to` was
dropped is reclassified as its march says with that cell gone (WALL to
NONE, or OPEN when nothing else is in reach). The march is the same
function; only its input grows by the cells pruning will drop.

**The rule.** Components are the nodes of a graph. Two are joined when a
cell of one has a **passable** side into the other: a STEP, or a WALL with
rise ≤ the jump's apex (every drop is one: its rise is negative). The edge
is undirected, so a pit you can drop into but not climb out of is joined to
the floor above it. **Roots** are the components holding a seed (spawn,
stand, ladder top) and those with a passable side to OFF, which is where
anything from outside the support comes in: from the water, another
support, a fall. Kept: every component of area at least π r² (0.196 m², the
body's footprint) joined to a root. With no roots at all (a level with no
spawn and walls all round), every component of at least π r² is kept.

What it drops is a component no passage of any kind reaches: sealed in by
walls higher than a jump on every side and holding no seed (the bilge
under the sloop's deck, C3's "inside her closed hull"), or smaller than a
person. Keeping too much is safe (I never needs a cell pruned); dropping
what someone stands on is not, and the undirected edges and the OFF roots
are there to make that impossible short of a sealed room, which needs a
seed to be stood in.

A component smaller than π r² is dropped even when joined (a post top). You
can still land on it falling; F5 says what happens then.

C3 then holds by construction. It stays as a report: each dropped component
with its area, centroid and why (sealed, or under π r²).

### When it runs, and the budget

- A support is baked when first needed (a walker on it, or entering it),
  then again off the frame loop whenever its key changes. The old mesh
  stays in use until the new one lands, and walkers on it are projected
  onto the new one (R1). Meshes are kept by key for the page while some
  support's entry uses one, and no longer (E1M1's ground is 649 MB).
- **A cap: 5M columns** (`MAX_COLUMNS`; E1M1's ground is 4.22M). Until
  tiles land, a support whose grid is over it is not baked (its time and
  memory grow with its columns: a terrain ground would be tens of GB); nor
  is one whose bake threw. Either is said once (a notice) and not tried
  again for that key; walkers wait for it.
- **Budget: 500 ms** a bake, off the frame loop, measured where it runs
  (the sloop: 80–120 ms in Node, 219 ms in a loaded browser).
- **Big supports bake in tiles.** At 5 cm a map of 80 × 125 m (E1M1) is
  about 4M columns against the sloop's 18k, and a terrain ground (Cadboro
  Bay, Ucluelet: ground and seabed one mesh over kilometres, with harbour
  structures, buildings and instanced trees, in the same stage as the
  sloop) is orders of magnitude more. No whole-support step can be bounded
  there, so none is global. Any support whose grid is wider than one tile
  either way (the ground of every level and every terrain; never the sloop,
  240 × 76 columns) bakes in **tiles**:
  - squares of 128 × 128 columns (6.4 m) on the support's grid;
  - each baked from the index's triangles for its columns plus a margin of
    ⌈(r + c/√2 + march)/c⌉ columns, the furthest any step before pruning
    reads. So a tile's cells and sides are exactly the whole bake's there
    (step 4 tests this: below);
  - pruning is local: a component is judged only once every tile it
    touches is baked; one that touches an unbaked tile is kept until then
    (keeping is safe);
  - the tiles within two tiles of any walker on this page are baked ahead,
    nearest first, one per frame-loop idle slot, each within the budget;
  - a move into an unbaked tile is cut like a WALL (W2) until it lands, and
    a falling or swimming body's clear test treats an unbaked tile as solid.

  So the work follows the walkers, not the world: a tile's cost is bounded
  by its triangles, and only the index is built over the whole support. The
  index is O(triangles) once per key; step 4 measures it and a tile on
  E1M1, Cadboro Bay and Ucluelet. If Ucluelet's index is itself over
  budget, it is built off the loop in slices, and that is reported against
  Q4's alternative (terrain answering heights itself).

### Blockers

A `walk.moves { blocks: true }` part is an obstacle drawn where it is. Each
frame, its drawn box (the content box through its drawn world matrix) is
taken into the frame of the support the walker is on: an **oriented box**.
A move that would bring the body's cylinder (radius r, feet + step to feet
+ H) into the box grown by r is cut short (W2), and an airborne `h` is
capped under it (A1). Sailing's boom capsule is the thin case of this. A
rule that only shortens a move or lowers `h` can't break I. A blocker
moving into someone standing passes through them; it never pushes (as the
boom).

## The walker

`walker.js` is pure, in walk, and knows supports only by id, frame and mesh:

```js
env = {
  supports() → [id],          // the ground is id null
  frame(id) → M | null,       // rigid, metres; null: gone
  mesh(id) → NavMesh | null,  // null: not baked yet
  water(x, z) → number | null, // the surface's height there: ground-owned water (Words, Water), else null
  blockers(id) → [box],       // in that support's frame (step 3: sailing's capsules still)
}
// the raster for the clear test is each mesh's own `intervals` (kept from its bake);
// step 4 adds SOLID for an unbaked tile
```

### States

| state | fields | |
|---|---|---|
| `waiting` | `on`, `at` (where to stand, in on's frame) | on's first mesh hasn't landed: no position. Replaces `boarding` |
| `walking` | `on, cell, u, v, vel[2]` | |
| `airborne` | `on, cell, u, v, h, vy, vel[2]` | |
| `vaulting` | `on, cell, side, d, h, vy, vel[2]` | |
| `swimming` | `p[2]` (ground plan), `vel[2]` | the feet at `surface − depth`, clamped into the ground's free gap (below) |
| `falling` | `p[3]` (ground frame, the feet), `vel[3]`, `rest` (s held by a surface that is no cell) | new: off an OPEN side with nothing within DROP under it and no water |

`on` is a support id, null for the ground. `yaw` is to on's heading, and
`pitch` is the person's; neither is state. The world pose is derived each
frame, `M_on · local`, with the eye along on's up, as sailing's.

Gone from sailing's states: `station` (a station is a body over walk) and
`ladder` (its `t` always jumped 0 → 1, so L1 now goes straight to walking at
the top).

### Invariant I

Per state, with N the mesh of `on`:
- `walking`, `airborne`, `vaulting`: sailing's, unchanged, on any support,
  the ground included.
- `swimming`:
  - (a) `water(p)` is not null;
  - (b) for every moving support (every support but the ground) with a
    mesh, p lies outside its D_r in its frame (sailing's SW invariant);
  - (c) the **ground's gap**: the ground's raster columns within
    `r + c/√2` of p hold no interval meeting `[f, f + H]`, where f is the
    feet's height.
- `falling`: the body is **clear** at p (Words), and, from a falling
  state before it, clear over the whole **sweep** between them as F1 takes
  it (lifted out of anything that moved into it, then x, then z, then y):
  no wall passed through, whatever dt. Not D_r: a body above a moving deck
  is inside her D_r (her silhouette over all heights) and must still be
  able to fall onto her (F2).
- `waiting`: no position.

(c) is sailing's erosion test asked at run time of one column's disc, and
clear is (c) asked of every support. Each support keeps its raster for it
(in tiles, if tiled). With no geometry near p both hold trivially, so a doc
with only water and a boat asks nothing new of swimming.

`assertWalker` checks I after every step while asserting, as now. The flag
becomes `globalThis.__WALK_ASSERT__`, set by every probe page (sailing's
probes too).

### Transitions

Sailing's table holds, with these changes. W3 replaces sailing's W3 and A5.

| # | from → to | when | why I holds |
|---|---|---|---|
| **W3** | walking / airborne / vaulting → walking, airborne, swimming or falling | across an OPEN side of s (a vault whose `to` is OFF, at its end), at `X = M_s · exit` with the feet at height y | In order: **(1)** onto another support s′ (the ground included) with a kept cell in X's column whose surface is in `[y − DROP, y + step]`, the highest such (within 1e-6 a tie: heights are float32), ties to the lowest id, the ground last; airborne with `h = min(y − surface, headroom(cell))` if that is > 0, else walking (the min, as in V2, only trims a drop under a roof). **(2)** Else, if `water(X)` is not null, swimming at SW1's push of X (sailing's ring search, now testing (b) and (c)). **(3)** Else (or if the push finds nothing within its reach), if the body is clear at (X, y): falling at (X, y) with the walker's velocity. **(4)** Else the move is cut at the side, as a WALL (W2). (1) lands on a kept cell with `h ∈ [0, headroom]` by the min; (2) is SW1's guarantee; (3) enters falling only where it is clear, which is I for falling; (4) only shortens a move. An OPEN side of s is OFF s's outline, so s's own raster is clear at X (B5); what (4) catches is another support's geometry standing at X above y + step |
| **W5** | walking / airborne / vaulting → swimming | awash: the feet SUNK under `water` at the feet's world point | Swimming at SW1's push of the feet's plan point. With nowhere to push to, the walker stays where it is (it can stand, and nothing better is near) |
| **W6** | any on s′ → the same, cut | a move whose plan point would enter another moving support s″'s D_r | If s″ has a kept cell under the feet within `[y − DROP, y + step]`: W3 (1) onto it (stepping or jumping across). Else that axis is zeroed (W2). Only shortens a move. Another support moving into a still walker is not covered, as a blocker isn't |
| **SW1** | swimming → swimming | a move | Sailing's push, then (c): the feet go to `surface − depth`, clamped into the free gap of the column's disc (the highest interval top below, the lowest interval bottom above). A move into a column whose gap is shorter than H, or that it can't enter at the feet's height, has that axis zeroed |
| **SW2** | swimming → walking | (c)'s gap holds the feet at its bottom (the ground rises under you: a beach, a slipway) and the ground has a kept cell under p within step of the feet | Walking on that cell (wading out). Hysteresis against W5: the feet are 1.3 under the surface here and must be 1.5 under to swim again |
| **F1** | falling → falling | ballistic under gravity, steered in plan as airborne is (A's acceleration toward the wish). A support that moved into the body lifts it out first (P1's lift) | The plan move is taken axis by axis, in pieces no longer than r, each only if the body is clear at its end; an axis stopped is zeroed. Boxes under 2r apart cover the sweep between them, so the plan sweep is clear whatever dt. The vertical move (under maxMove < H, so its ends cover its sweep) is taken last: one that would leave the body not clear stops at the surface met, the feet resting on it from above (`vy` = 0, `rest` grows by dt) or the head under it from below (`vy` = 0). Each part keeps clear, so I holds, sweep included |
| **F2** | falling → walking | after F1's vertical move: a kept cell of any support (the ground included) under the centre whose surface the feet passed (from where they were to where they stopped), or, if they stopped resting, one within step under them | Lands on that cell (the highest, ties as W3 (1)), walking. The resting case is the slope: the body's box rests on the raster up to (r + c)·tan θ over the cell under its centre, and a kept cell is within step of that, so a kept cell is always landed on, never rested on. A cell that rose past the feet needs no window of its own: F1's lift has already put the feet on it |
| **F3** | falling → swimming | the feet go below `surface − depth` where `water` answers | As W5 |
| **F4** | falling → walking by P1 | the feet go below fallLimit | Respawn: P1 at a spawn (any support's, by id) or the ground's box middle |
| **F5** | falling → by P1, or F4 | `rest` ≥ 0.5 s: held by a surface that is no kept cell (a slope over 35°, a post top under π r², a sliver) | P1 of the feet, taking only a cell or water; with neither, F4. Either way a valid state, so there is no dead state: a steep slope you can't steer off within 0.5 s puts you on the nearest floor within P1's reach, or back at a spawn |
| L1 | swimming → walking | Climb (the ladder's verb) within reach of its foot | At the link's `top`, a kept cell (C1) |
| P1 | any → a valid state | `place(p)`: entering, respawn, resuming under a body | **Over every support**: sailing's projection onto each support's mesh (the cell nearest p in plan at most a step above it and at most 2 m below, a drop deeper than a step costing metre for metre; else none for that support), and the best-scoring cell of all of them, ties to the lowest id, the ground last. With no cell anywhere: swimming if `water(p)` answers and SW1's push lands; else falling at p if the body is clear there; else falling at the lowest clear point straight above p, found by raising the feet to the top of each interval met until clear (each support's raster is bounded above, so it ends at most at the top of every support's box). Total, and each answer satisfies its state's I. A support with no mesh yet: `waiting` |
| R1 | any on s → by P1 | s rebaked | the old local point projected onto the new mesh, as sailing's |
| G1 | any on s → by P1 | s is gone | P1 of the last world point over the remaining supports |
| WT1 | waiting → by P1 | on's first mesh lands | `at` projected (P1) |
| WT2 | waiting → by P1 | on is gone, or isn't a support any more | P1 of the last world point, as G1 |

Sailing's S1 and S2 (stations) go: a station is a body over walk. So do L2
and the B1/B2 boarding rows (WT1, WT2).

**The ground has OPEN sides only at the edge of everything.** Its D_r is
every column with geometry. Off a quay over a seabed, the march finds the
seabed, so the quay's edge is a WALL to it (a ledge: jump off) and the
vault ends under the water: W5. Off the end of a level with nothing beyond,
it is OPEN: W3 (1) finds a support below if there is one, (2) water if
there is any, and otherwise you fall (F) and respawn (F4). Today's walk does
the same, by falling to fallLimit.

## Bodies over walk

**A station is a body pushed over walk.** It is the station writer's
(sailing's `station`), with its own keys and verbs. Its eye stands at its
stand spot: the spot's `at` (in the spot object's own frame) through that
object's drawn world matrix, plus BODY.eye along its owner's up. While it is on top, walk waits: its keys are up, its
loop is stopped and the camera is let go, as under a seat today.

**Resuming is one rule for every body over walk:** when the body goes, walk
is put at P1 of its eye lowered by BODY.eye.
- Under a station, that is the stand link's cell (its projection of the
  same point; C1 puts it within 0.35 m in plan, and step 5 tests it to
  1e-9).
- Under a seat, the eye is about 1.15 m over the floor, so the point is
  0.45 m under it. That is within a step, so P1 stands you on the floor
  beside the seat. Sailing's `seatedEye` goes.

**Presence under a body.** A seated person has no standing avatar; someone
at a station should still be seen standing at it. Walk sees the body over
it (`view.body` is `{ id, owner, depth, lock, keys, serial }`, and
`view.bodies` the stack), but not what that body means: whether its person
stands, and where. Walk needs neither, with no scene change: under every
body it withdraws its avatar, as now, and **walk.people draws whoever holds
a stand spot's claim standing at it**. A `walk.stand` with `claim: kind`
names the claim that says who stands there; for each such spot, walk.people
asks `api.claimedBy(id, kind)` and draws that session's person (name and
hue from its presence) at the spot's `at`, facing `facing`, in the spot's
drawn frame. Sailing's stations hold `station` claims for their verbs
(the sail's only while a key is down, so the helmsman can still trim);
each station's `walk.stand` names the claim its verb holds for as long as
you stand there (the helm's `"station"`, the sail's `"halyard"` at the
mast: Decision 40), so one claim says who stands there and who may trim
is unchanged. Claims are scene's generic "who",
so nothing new crosses: walk reads a claim kind its own trait names. The
alternative, a scene field on the sitting, is Q1.

## Presence: `avatar` and walk.people

walk's presence record, on the channel of the doc it walks in, at 20 Hz:

```js
avatar = { on: supportId | null, feet: [x, y, z], yaw, pitch, swimming: boolean }
```

- `feet` is local to `on` (the ground: the stage's frame); `yaw` is to on's
  heading. Falling and swimming are on the ground (`on: null`), and
  `swimming` says which.
- Numbers to 3 decimals, as now.
- No back-compat: a record without `on` is drawn on the ground, which is
  what it always meant. Nothing else reads it (sailing's `crew` record
  goes).

**walk.people** draws each one in its support's frame, `placeOf(a,
worldOf)`: `M_on · feet`, and yaw plus on's heading. It eases in the
record's frame and snaps when `on` changes. `ease`, `placeOf` and the
shortest-turn rule move from sailing's crew.js. A record whose support isn't
in this doc draws nobody. A swimmer is drawn at the feet, so head and
shoulders show above the water. The name label is walk's `walk-name`, as
now.

## The body

The walk body keeps its contract: `{ id: "walk", label: "Walk", keys:
WALK_KEYS, lock: true, reach: 2 }`. N9's touch pad shows its keys from
their labels.

- **`enter(place)`**:
  - a `walk.spawn` or `walk.stand` object: P1 at its point;
  - a `walk.support` object: its own spawn's point, else its first stand's,
    else its box's top middle, projected onto it alone;
  - any other object: P1 of its world point;
  - no place: the eye, P1 of `eye − BODY.eye` if that lands within
    EYE_FLOOR (10 m) of the eye; else a spawn; else the ground's box middle.
  
  "Come aboard" is sailing's verb for `api.body.enter("walk", hull)`.
- **Each frame**:
  1. read the frames and the blockers;
  2. step the walker (dt capped at 0.05 s);
  3. check I;
  4. draw the eye: the camera at the derived eye, eased along on's up across
     a STEP (`easeEye`, moved from sailing; only the camera lags);
  5. publish the avatar.
- **The input adapter** keeps one entry per support, `{ key, mesh,
  baking }`, plus the ground's raster for (c). It rebakes off the frame loop.
- **Leaving** withdraws the avatar and stops the loop, as now.

## What goes, what stays

**walk loses:**
- `walk.js` `step` and its rays;
- `body.js`: `carried`, `invertRigid`, `ride()`, the `world.down` and
  `world.ahead` rays, and the raycast eye-floor test (EYE_FLOOR is now
  asked of P1);
- the ray tests in `walk.test.js`, and the riding tests in `body.test.js`
  (replaced by step 4's riding table).

`wishVelocity`, `look`, `lookDir`, `aimOf`, `WALK_KEYS`, `SPAWN`, `REACH`,
`startOf`'s order and `spawn.js` stay.

**walk gains** (moved from sailing in step 3, renamed):
- `navmesh.js` (the bake), `walker.js` (the state machine), `navcheck.js`
  (B1–B7, C1–C7, C9; C10 is a probe check), and their tests with their arenas
  (`walker.test.js`, `navmesh.test.js`, `walker.cases.test.js`);
- from sailing's `walk.js`: `BODY` as above, `SWIM` and `easeEye`;
- from sailing's `crew.js` (step 4): `trianglesOf`, the generalised
  `bakedObjects` / `navKey` / `navInput` (as `bakeInput(api, support)`),
  the mesh cache, `ease`, `placeOf` and `hueOf`.

**sailing loses** (step 5):
- `navmesh.js`, `walker.js`, `navcheck.js`, `walk.js` and their tests;
- `sloop-navmesh.test.js`, whose checks move to walk over a fixture (below);
- in `crew.js`: the `aboard` body, `WALK_KEYS` and `walkWanted`, the
  avatars (`ease`, `placeOf`, `hueOf`, `NAME_CSS` and the drawing), the
  input adapter (`bakedObjects`, `trianglesOf`, `navKey`, `navInput`,
  `boomOf`, `MESHES`), `standAtEye`, swimming, the ladder climb, and the
  `crew` presence record.

**sailing keeps**, as hers:
- the stations and their verbs (`stations.js`), and the `station` body,
  now pushed over walk, holding its station's `"stand"` claim while on
  top. Its eye stands at the station's `walk.stand`;
- the HUD, the sim and the physics;
- the traits she writes on her parts and template:
  - the hull: `walk.support`;
  - the helm's wheel: `walk.moves { swept: "z" }`;
  - the boom: `walk.moves { blocks: true }`;
  - the sail station's other moving pieces and the anchor:
    `walk.moves {}`;
  - each station: `walk.stand { at, facing, claim: "stand" }`, at the
    stand-off `walker.standOff` computes today;
  - the ladder: `walk.ladder { top }`;
  - her spawn: `walk.spawn`;
- Come aboard, as `api.body.enter("walk", hull)`: the hull's one verb for
  entering at it (walk offers none on a support);
- reading who is aboard, for the HUD, from walk's `avatar` (`on` is her
  hull) and `view.body` (`id` "walk", or her station);
- the deck geometry that the fixture is exported from.

**The sloop's static checks without a build-time link.** walk can't import
sailing's `ship.js`. walk keeps a copy of the stock sloop's bake input (her
triangles and seeds) as its own test arena,
`walk/src/test/fixtures/deck-12m.json`, a copy as CLAUDE.md allows, and
walk's tests run C1–C9, the bow check and C8 on it. Neither package's test
reads the other's files, so each still passes copied out on its own. The
copy is refreshed by a sailing script (`probes/export-deck.mjs <out>`), and
drift is caught at the repo root, as kit copies are (`scripts/check-kit.mjs`):
`scripts/check-fixtures.mjs` runs sailing's export and compares it with
walk's copy; the integrator runs it. A stale copy is still a valid arena;
it only stops being the sloop. The camber hull stays checked in the
browser (`probes/camber-run.mjs`), through walk at run time.

**Other packages** (each in the step that needs it, none in scene):
- **water** (step 4): `at`'s `not` takes a list of ids (Words, Water);
- **doom** (step 4): its layout writes `walk.moves { blocks: true }` on each
  door (The bake, Input);
- **sailing** (step 5): as above, plus `probes/export-deck.mjs`.

## Verification (what steps 3–5 build)

All finite and named, no random input. Each step of every case runs I.

**Step 3** (walk gets the walker, pure; sailing untouched):
- the 89 enumerated arenas, moved, with the oracle on raw triangles;
- **support over ground**: a 4 × 4 m unrailed deck, walked off each side,
  as pose {still, moved 3 m, heeled 30°, turned 180°} × side {−X, +X, −Z,
  +Z} × under the exit {ground 0, 0.3, 1 m below; ground 2.5 m below (past
  DROP); nothing} × water {none, a surface 1 m under the exit}. The ground
  is placed per row under that side's exit, so a heeled edge never starts
  in the slab. 4 × 4 × 5 × 2 = 160 walk-offs, each run until it settles,
  checked by I every step and by the oracle against both supports'
  triangles. Expected, by (under, water): ground within DROP → (1), either
  water; ground 2.5 m, water → (2); ground 2.5 m, none → (3) then F2 on
  the ground; nothing, water → (2); nothing, none → (3) then F4. So (1),
  (2) and (3) each have 32 or more rows, and the table states each row's
  case and asserts it;
- **W3 (4)**: the same deck beside a ground block rising 1 m above the exit,
  ×{still, heeled 30°} × 4 sides: the move is cut, the walker stays on its
  cell;
- **onto a moving support**: the deck over a 2 × 3 m dinghy (a second
  `walk.support`), drop {0.3 m, 1.5 m, 2.5 m} × dinghy pose {still, moved,
  heeled 20°}: W3 (1) onto her at 0.3 and 1.5, falling then F2 onto her at
  2.5 (her D_r holds the body throughout; clear does not);
- **W6**: walking from the deck toward the dinghy alongside, her deck {0.2
  m, 1 m below, 1 m above}: transfer, transfer, cut;
- **falling**: F1 against a wall (the axis zeroed), under a ceiling (`vy`
  0), F2 onto a cell that rises past the feet by {0, step}, F3, F4, and F5
  on {a 45° slope beside a floor within reach, a post top under π r² over
  nothing within reach}: P1 onto the floor, F4;
- **P1**: entry inside a closed box with no cell (lifted to the box's top,
  falling, clear), and a tie between a ground cell and a support's cell at
  the same score (the support's, ground last);
- **SW2**: a 10° beach rising out of water 1.5 m deep: wading out onto the
  first cell within step;
- **pruning**, each a named arena: no seeds and no roots × a component of
  area {π r² − one cell, π r²}; a pit below a ledge, a spawn above (kept:
  joined by the drop); a floor reached only from a lift (a second support)
  and dropping into a joined pit (kept); a sealed room with no seed
  (dropped) and with a stand in it (kept); a post top under π r² (dropped,
  F5 above covers landing on it); and the sloop's fixture, whose kept cells
  must be exactly today's 8,086 (the bilge stays dropped). Each with the
  old seed-only rule as the failing twin.

**As built, step 3** (2026-11-17, lane/n10). In walk/src: `navmesh.js`,
`walker.js`, `navcheck.js`, `frames.js` (only what they use) and
`test/arena.js`, moved from sailing; sailing is untouched and keeps its copy
until step 5. `BODY` (walk.js) is the one set of "One body", and the bake's
`NAV` is read from it. Renames: ship → support (`on`), OVERBOARD → OFF,
`env.surface` → `env.water(x, z) → height | null`, `boarding` → `waiting`
(no `boardWait`: a support whose model never comes leaves you waiting),
`__SAILING_ASSERT__` → `__WALK_ASSERT__`; `station`, `takeStation`,
`leaveStation` and the `ladder` state are gone (`climb` walks you at the
top). New: W3 (1)–(4), `falling` (F1–F5), P1 over every support
(`placeAt`, with the lift), F4's `respawn`, I for swimming (a)–(c) and
falling (clear). The clear test is exact box against box: the body's world
box against each raster box (a column's square × one interval, through the
support's frame) by separating axes, open by 1e-6, so a heeled support is
not judged by the box round it. Tests (walk 21 → 119 fast, 6 slow; after
the review fixes, one tier of 137):
- `navmesh.test.js` (64) and `walker.test.js`'s 29 moved cases, assertions
  unchanged but where the design changed them: 12's high wall 0.7 → 0.9
  (the apex is 0.845 now), 7, 9 and 29 walk fewer frames (4.5 m/s, so they
  stay on the 4 m floor), 19 climbs straight to walking, 20 (the station)
  is gone, B1/G1 became WT1/WT2, and 26 lands airborne 0.3 over the lower
  support, then walks (W3 (1));
- five falling rows: F1 against a wall and under a ceiling, F3, F5 on a
  post top, P1's lift out of a closed block;
- review fixes: F2 on a slope ({10°, 20°, 30°} × 4 facings × 4 points, 48
  drops, never resting); F2 onto a support risen past the feet by {0,
  step/2, step, 1 m} × {flat, heeled 20°}; F1 into a 2 cm wall at dt
  {1/60, 0.05, 0.1, 0.2} × 4 ways (never through; I's sweep and the
  oracle's every step) and I's sweep catching a jump through it; F5 on a
  45° wedge (P1 to its foot); F4 with no spawn (the ground's middle); a
  swimmer whose water drops or goes (P1 onto the seabed); P1's ties;
- `walker.cases.test.js`: the 89 arenas and the rafted table, unchanged,
  all green (KNOWN_GAPS ∅ since step 1), every row's name its own;
- `walker.supports.test.js`: the support over the ground, 224 rows
  (pose 4 × side 4 × (ground {0, 0.3, 1, 2.5 m} × water {none, at the
  ground's top, 1 m under X} + nothing × water {none, 1 m under X})), each
  row's W3 case and end asserted, I and `oracleAll` (both supports' raw
  triangles) every step; a 0.6 m deep support heeled ±30° off ±X (12); W3
  (4) beside a block, {still, turned 180°} × 4 sides, cut at the side (8:
  not the Verification's heeled 30°, which is W6's, below); onto the
  dinghy {0.3, 1.5, 2.5 m} × {still, heeled 20°, under way} × 4 sides (36,
  never resting); W3 (1)'s pick, the dinghy over the ground 1.9 m down
  and level with it (8); stepping up onto the ground {0.3 m, step} over
  the exit (16). Every row of the table asserts no falling state rests.
  Failing twins, run by reverting: sailing's W3 window (|dy| ≤ step) fails
  52 rows, no (c) 16, no W3 (3) all, no F2 2, (4) leaving the state as it
  was 8; no F5, no P1 lift and an unchecked F1 axis each fail their row.
  After the review, each fails its rows too: no landing at the cut (slope,
  risen), one plan piece (the 2 cm wall), F2 on the ground only (risen,
  dinghy), no lift (risen), the ground first (P1 ties, W3's pick), no
  upward window in W3 (1) (step up), the lowest cell (W3's pick), no
  ground middle in F4, a swimmer kept where the push fails, no sweep in I.

Not built in step 3, and owed by step 4 (they need the body's input, or
were not in this step's brief): pruning without seeds (the graph and its
roots; with no seeds the bake still keeps every component, which is what
the ground slabs here are), W6, SW2 and SW1's clamp into the ground's gap
(a swimmer's move whose push fails is not taken), blockers as boxes, tiles,
and the sloop's fixture (step 5's export). Also W6's: the Verification's
W3 (4) row heeled 30°. Upright in the deck's frame, the body leans its
head 0.87 m out over the low side, into the ground block beside it,
before the side is reached; another support's geometry inside the body
is W6's to stop.

**Step 4** (walk's body on supports):
- enter {place, eye over floor, eye over nothing, support id} × {ground,
  moving deck};
- riding {translate, turn, heel} × {standing, walking}: the local state
  bit-identical, the world feet `M · local`;
- rebake {part added, part removed under you};
- presence round trip {ground, support, swimming}: the record drawn
  where the walker stands, to 1e-9;
- blockers: a door box closing across a corridor, and a boom box swinging
  over a cockpit; doom's layout writes `walk.moves { blocks: true }` on
  every door it lays (a row per E1M1 door), and the ground's key is
  unchanged by a door's stop write;
- tiles: on two arenas (a level with a ledge and a pit, and a 30° ramp)
  baked whole and in tiles at grid offsets {0, 1, 63, 127} columns, every
  tile's cells and sides equal the whole bake's there, and a component
  crossing an unbaked tile is kept until it lands;
- `trianglesOf` reads an instanced mesh of n instances as n copies;
- water: `at(p, { not: [a, b] })` leaves out bodies under either, and
  `{ not: a }` answers as now (water's own test);
- probes: `doom/probes/doom.mjs` (E1M1 walked, its index's and a
  tile's bake times recorded against the 500 ms budget),
  `arena/probes/arena-run.mjs`, and the index and a tile timed on Cadboro
  Bay and Ucluelet (terrain's probes);
- links (Q6): before the ray walker goes, enter walk in each published
  example composed of links and record whether the floor under its spawn
  is its own stage's or a link's. Any that stands on a link stops the
  deletion, and the list goes to the lead with Q6.

**As built, step 4** (2026-11-17, lane/n10). The ray walker is gone
(`walk.js` `step`, `carried`, `invertRigid`, the rays, the old riding
tests); the body (`body.js`) steps `walker.js` over `supports.js`, the input
adapter: which objects are supports, what each bakes (`bakedObjects`: owned,
not loose, groups out, of the moving parts only `swept` ones, a swept part's
subtree swept with it), `trianglesOf` at the rest pose (instanced meshes as
one copy per instance), `seedsOf` (spawn, stand, ladder; a ladder faces from
its foot to its top, inboard), `bakeKey` (the support's own pose and the
blockers not in it; null while a model it bakes is loading), the page's
meshes by key (8 kept), `frameOf` (the drawn matrix, scale divided out),
blockers as oriented boxes (`walk.moves { blocks }`, drawn box into the
walker's support's frame; `meetsBlock` replaces `meetsCapsule`), and water
from the stage's `water` contribution with every support's id in `not`
(water's `at` takes a list now, with its test rows). The others are drawn by
walk.people in their support's frame (`ease`, `placeOf`, a loop while
anyone is drawn). Every walk trait is declared by the `walk.spawn` part,
whose verbs are Walk from here and Climb (F, on a ladder, swimming within
REACH of its foot). Doom's layout writes `walk.moves { blocks: true }` on
each door (one test row per E1M1 door). Arena is unchanged. Tests (walk 137
→ 155): `body.test.js` enter place × world (8, the eye rows asserting the
fall from the eye), the first bake at need, a model loading, riding move ×
walker (6: the local feet the still deck's to the bit, the world feet
`frame · local` exactly), rebake {part added, floor removed} (P1 asserted
against `place` on the new mesh), a seat; `supports.test.js` (9: instanced
and indexed triangles, ownership over every kind of object, seeds, the key,
a door shut and open across a corridor, a door's box in a deck's frame,
water's `not`, Climb offered within reach and not beyond, and taken);
`extension.test.js` presence round trip {ground, a heeled deck, swimming}
to 1e-9. Failing twins, run by reverting: presence rounded to the mm (round
trip), people ignoring `on` (round trip), no blockers (both door rows), the
key reading the drawn pose (key row), every bake on the frame loop and no
R1 (both rebake rows), the eye's floor by P1 alone (eye over floor),
feeding the world pose back into the walker (all six riding rows); water's
old single `not` fails 6 of its rows.

Measured, E1M1's ground (whole, one bake; its doors are blockers, not in
it): 5,465 triangles, 2,214 × 1,908 = 4.22M columns, 3.18M kept cells,
**11.4 s in headless Chrome** (doom/probes/doom.mjs, which logs each bake),
10.7 s in Node (erode 5.0, classify 2.2, putOut 1.2, rasterise 0.9 s),
**649 MB** of typed arrays kept (2.6 GB peak RSS in Node while it runs): 23
times the 500 ms budget. The two views of the probe share the one mesh (the
page's cache). So tiles (above, "When it runs") are needed for any level,
and are the first thing owed; until they land, a level's first walk blocks
the page for that long and keeps that much.

Still owed (not built in step 4): tiles; pruning by passable sides (every
support bakes with `prune: false`: every component kept, which is safe);
W6, SW2 and SW1's clamp; drawing a stand spot's claim holder (`claim`,
built in step 5);
Q6's check of the link-composed examples in real Patchwork (a link now
bakes as nothing and never holds a bake back, so none waits; whether any
example stands on a link's floor is still to see, before walk syncs); C10;
Cadboro Bay and Ucluelet (refused by the column cap until tiles); a model
rebuilt in place rebaking.

**Step 5** (sailing walks in walk):
- part kind → walk trait, for the stock sloop and a camber hull;
- each station kind: take puts the eye at its stand, leave puts walk at
  P1, to 1e-9;
- sailing's suites and aboard-run; the browser probes the plan lists
  (aboard-run, sailing-run, touch-run, harbour-run and the rest), within the
  probe policy.

**As built, step 5** (sailing walks in walk; commit on lane/n10): sailing's
navmesh, walker, navcheck, walk.js, aboard body, avatars and WALK_KEYS copy
are deleted; her parts write the traits ("What goes, what stays") and her
crew keeps only the `station` body. What it took of walk:
- the `walk` part runs in every stage (`traits: ["*"]`, Decision 32), so
  Come aboard enters walk in her own stage, however she is linked;
- the `avatar` contribution (Decision 33): this viewer's walker in this
  stage, the record its presence says (or null), which is how a writer
  reads `on` and `swimming` (presence has no record of one's own session);
- the resume rule lowers the eye along the up of the support walk stood on
  (Decision 34), so a body over walk on a heeled deck hands walk back
  exactly its stand spot;
- walk.people draws a stand spot's claim holder (`standing`, pure), placed
  as the seeds are (the doc's placement in the owner, its drawn frame);
- `globalThis.__WALK_LIVE__` (a probe page's Map) is told each live walker,
  which can now `place(p, yaw, pitch)` (P1 at a point: a respawn, the
  probes);
- the stock sloop's fixture (`src/test/fixtures/deck-12m.json`, exported by
  `sailing/probes/export-deck.mjs`, drift caught by
  `scripts/check-fixtures.mjs`) read through walk's adapter:
  `deck-12m.test.js`, C1–C9 on her seed-pruned bake, walk's own bake
  holding every cell of it (Decision 37), the bake budget, the bow, and
  every stand spot's link within 1 mm of the height it was written at.

Tables: resume on a deck {still, turned, heeled 20°, heeled 30° the other
way} → feet = P1 of the eye less BODY.eye along the deck's up, to 1e-9 (4
rows; the old rule, world Y, fails both heeled rows); the avatar
contribution before, on top, under a body, after (1); `standing` holder
{nobody, me, someone} × spot {no claim named, claim "stand"} (6). Sailing's
side: crew.test.js, part kind {hull, rig, jib, hook, helm, mainsheet, mast,
windlass, winch, ladder} × {stock sloop, a camber hull fitted from the bin}
→ exactly its walk traits (20), station {helm, mainsheet, mast, windlass,
winch} × {take, leave} → the eye at its stand spot EYE up her up / walk
asked P1 of the spot, to 1e-9 (10), on a pose turned and heeled 20°.
*Step 5 fixes*: the station's eye is walk's (`stand`, Decision 39), its
claim the verb's own (Decision 40), the wheel her spawn (Decision 41);
walk's table stand spot {on the deck, 0.3 m over it, 0.2 m into it} ×
deck {still, turned, heeled 20°, heeled 30° the other way} → stand()'s eye
BODY.eye up the deck's up over the deck under the spot, and resumed, the
feet there, to 1e-9 (12; an eye up the world's Y fails the 6 heeled); and
sailing's 10 rows check the protocol: the station taken at its own stand
spot, the eye exactly walk's there, and walk resumed from walk's eye as
she is drawn when you leave.

**New check C10** (in the probes, not the bake; "The bake, Input"): every
baked object stays at its doc pose, doc transform and drawn pose both, while
every door, lift and joint is cycled once. One that moved is named: it
should be a support, a moving part or loose.

## Decisions

All decided unattended (2026-11-17, lane/n10), for the lead.

1. **One walker, the navmesh one, and one body.** The ray walker and
   sailing's copy go. The body's numbers are sailing's deck numbers with
   walk's jump (5.2) and speeds (Q3), because a person doesn't change size
   between a quay and a deck, and the deck is where they were proved.
2. **The ground is a support.** It is the stage's frame, baked from
   everything owned by no `walk.support`. One code path and one invariant;
   the ground has no seeds unless it has spawns or stands.
3. **A support's up is its object's +Y.** glTF is Y-up. A model that isn't
   upright goes under an upright group, and the group carries
   `walk.support`. Sailing's body frame (bow −Z) is not needed: the grid's
   orientation in plan only moves the 5 cm quantisation.
4. **Moving parts:** `swept` is baked, `blocks` is an oriented box drawn
   each frame, and `{}` is ignored. The brief said a capsule; a box is the
   same rule, the boom is its thin case, and a capsule round a door slab
   would hold you its half-height off the door. Whatever makes a thing move
   tags it: doom tags its doors (joints names no walk), and C10 names any
   baked object that moved, by doc write or by pose hold.
5. **Pruning:** components joined by any passable side, either way, to a
   seed or to OFF are kept if at least π r²; with no roots, all of at least
   π r². Sides are marched before pruning. No parity test (a room is a
   closed shell). C3 becomes a report.
6. **W3 generalised:** onto any support within `[y − DROP, y + step]`, then
   water, then falling where clear, else cut as a WALL. DROP = 2 m, which
   is also P1's "2 m below".
7. **A falling state** in the ground's frame, steered as airborne, whose
   invariant is "clear" against every support's raster (not D_r, so it can
   land on a moving deck). It enters only where clear (W3 (3), P1's lift),
   lands on kept cells (F2), swims, respawns, and leaves a surface that is
   no cell after 0.5 s (F5). It replaces "fall to fallLimit through
   whatever the rays missed".
8. **Swimming is in the ground's frame, in ground-owned water only**, and is
   bounded by the ground's raster (c) as well as by the moving supports'
   D_r. Water a support carries is left out by `at`'s `not` list (a change
   to water, step 4).
9. **No station or ladder state.** A station is a body over walk, and walk
   resumes at P1 of its eye lowered by BODY.eye. That one rule also covers
   seats (`seatedEye` goes). The ladder climb is instant, as it always was.
10. **Someone at a station is drawn from a claim**, with no scene change:
    `walk.stand`'s `claim` names the kind whose holder stands there, and
    walk.people draws that holder at the spot; under every body walk
    withdraws its own avatar. Q1 asks whether the lead prefers a scene
    field instead.
11. **Presence** is `{ on, feet local, yaw, pitch, swimming }`. walk.people
    eases in on's frame and snaps on a change. No old records are honoured
    (the lead's no-back-compat rule).
12. **The sloop's static checks run in walk on a copied fixture**, which is
    walk's own arena. Drift is a repo-root check (`scripts/check-fixtures.mjs`,
    beside check-kit), never a package test, so both packages stay
    standalone.
13. **Budget 500 ms a bake or a tile.** Every support wider than a tile
    (every level and terrain ground) bakes in tiles around walkers, with
    tile-local pruning; only the triangle index spans the support. Measured
    in step 4 on E1M1, Cadboro Bay and Ucluelet (Q4).
14. **`__WALK_ASSERT__`** replaces `__SAILING_ASSERT__`.
15. **No verb on a support or a stand spot.** The writer offers entering at
    its support (sailing's Come aboard), so a hull has one verb for it.
16. **SW1's push stays local** (decided unattended (2026-11-17, lane/n10),
    for the lead). The ring search is driven by the moving supports' D_r
    only, as sailing's; the point it finds is then asked (a) and (c), and
    where they fail there is no swimming there (W3 goes on to (3)). Asking
    (c) inside the search carried a swimmer metres sideways to the ground's
    edge (2.5 m over a slab, water at its top). So `pushOut` is total no
    more: it answers null, and every caller has a next rule.
17. **`water(x, z)` answers a height, not `{ surface }`** (decided
    unattended (2026-11-17, lane/n10), for the lead): one number is all the
    walker reads; step 4's adapter makes it from water's `at`.
18. **No carrying of W3's X out past a heeled side** (decided unattended
    (2026-11-17, lane/n10), for the lead). A heeled, deep support's side
    can stand within r of X (a 0.6 m hull at 30°: 0.025 m); a falling body
    stops on it (F1) and F2 at the cut or F5 places it, so I holds, and the 12 deep-support
    rows pass without it. Carrying X out until the body cleared the support
    at every height was built and dropped as an appendage no row needed.
    What stays open is a body standing still on the ground under a heeled
    hull's overhang: another support's geometry is in no support's bake, so
    I says nothing of it; that is W6's, step 4.
19. **The support-over-ground table is 224 rows**, the brief's 96 (drop {0,
    0.3, 1} × water {none, at the ground}) and this design's 160 (2.5 m and
    nothing, water 1 m under X) as one table (decided unattended
    (2026-11-17, lane/n10), for the lead).
20. **F2 has no rising window; it lands at F1's cut instead** (decided
    unattended (2026-11-17, lane/n10), for the lead). The window "the cell
    rose past the feet by no more than step" never fired: F1's lift runs
    first and leaves the feet on or over every surface in the body's
    footprint. What was missing was the slope: the body rested on the
    raster beside its centre for F5's 0.5 s on any slope (on 30°, 33 drops
    in 40). F2 now also takes a kept cell within step under the feet where
    the vertical move stopped resting.
21. **Ties are within 1e-6, not 1e-12** (decided unattended (2026-11-17,
    lane/n10), for the lead). A cell's height is float32, so two supports
    built level read 1e-8 apart, and "ties to the lowest id, the ground
    last" (W3 (1), F2, P1) never applied.
22. **One test tier** (decided unattended (2026-11-17, lane/n10), for the
    lead). The enumerated tables take seconds; `pnpm test`, which CI and
    each.mjs run, now runs them (`walker.cases.test.js`,
    `walker.supports.test.js`).
23. **The ground's frame is the identity, with no hook** (decided
    unattended (2026-11-17, lane/n10), for the lead). `env.frame` is asked
    of moving supports only; a turned ground was honoured by half the
    walker (yaw) and not the rest (poses, points).

24. **The first mesh is baked when first needed, at once; only rebakes go
    off the frame loop** (decided unattended (2026-11-17, lane/n10), for the
    lead). An entering walker has nothing to stand on until its supports'
    meshes exist, so a deferred first bake only delayed the camera a frame,
    and an arrival read at once found nobody there (arena-run's "arrive at
    the spawn"). Rebakes keep the old mesh until the new one lands. A
    support whose models are still loading has no key, and the walker waits
    for it, with no time limit (a model that never loads keeps it waiting).
25. **Entering from the eye is P1 of the eye lowered by BODY.eye, when a
    kept cell of any support lies under it within 10 m** (decided unattended
    (2026-11-17, lane/n10), for the lead): more than DROP down that is
    falling, so you land on it, as the ray walker did. The test is a scan of
    the eye's column in every mesh (`floorUnder`).
26. **Presence is at full precision** (decided unattended (2026-11-17,
    lane/n10), for the lead): rounded to the millimetre, a peer was drawn up
    to 0.5 mm off in a moving frame; the round trip is now exact to 1e-9.
27. **Doom tags its doors in step 4, as built; whether is Q7** (decided
    unattended (2026-11-17, lane/n10), for the lead). The step's brief said
    doom's source and doc shapes stay unchanged; without the tag a door,
    which opens by pose hold, is baked shut where its doc puts it, and
    walking through it open (doom.mjs) cannot work. One trait per door, so
    E1M1's published docs must be republished (no back-compat): until they
    are, their doors are walls. **Release order:** walk must not be synced
    before the E1M1 examples are republished with the tag.
28. **Every walk trait is declared by the `walk.spawn` part, as built;
    its id is Q8** (decided unattended (2026-11-17, lane/n10), for the
    lead). It is now the part of walk's traits, with Climb beside Walk from
    here.
29. **Every support bakes with `prune: false` until the pruning by passable
    sides lands** (decided unattended (2026-11-17, lane/n10), for the lead):
    the seed-only rule would drop every floor of a level reached only by a
    jump or a drop; keeping everything is safe for I.
30. **A ladder's Climb reaches the walker through a page registry, by
    session and doc** (decided unattended (2026-11-17, lane/n10), for the
    lead). The verb is the `walk.spawn` part's (it runs in the ladder's
    doc); the walker is the `walk` part's (general, at the focus). body.js
    keeps the live walkers, and `walkerOf(session, url)` finds the one of
    this session walking this doc (by session alone it found the first,
    possibly in another doc of the page). The alternative, Climb offered by
    the general `walk` part itself where the walker is, depends on a general
    part's verbs reaching targets in the doc being walked; the lead's call.
31. **The column cap is 5M, a refused or failed bake is said once and not
    retried for its key, and meshes are kept only while used** (decided
    unattended (2026-11-17, lane/n10), for the lead), after step 4's
    review: an uncapped ground bake would freeze or crash the page on any
    terrain, a failed one was retried every frame, and eight kept meshes
    could be 5 GB on E1M1. The cap admits E1M1 (4.22M, 10–11 s once) and
    refuses Cadboro Bay and Ucluelet until tiles land; whether to hold walk
    instead until tiles land is the lead's (Q4).

32. **The `walk` part runs in every stage** (`traits: ["*"]`, decided
    unattended (2026-11-17, lane/n10), for the lead). A general part runs
    only at the focus, so a body asked for from a linked doc's stage (a
    boat's Come aboard, in a harbour) would walk the focus's stage, where
    her hull is no support (Q6). Every stage offering it, `enter` runs in
    the stage that asked (the caller's first: scene/STAGE.md), so a boat
    linked into a harbour is boarded in her own stage, and the body chip,
    a general part at the focus, still walks the focus. Each stage keeps
    an idle adapter (it bakes nothing until a walker needs it).
33. **walk contributes `avatar`** (decided unattended (2026-11-17,
    lane/n10), for the lead): `() => record | null`, this viewer's walker
    in this stage, the record its presence says, on top or under a body.
    `api.presence.get()` holds the peers, never one's own session, so a
    writer that must know whether its viewer walks on its support, or
    swims (sailing's HUD and verbs), reads it here, through the stage's
    generic `collect`, not through a sailing word in walk.
34. **Resuming lowers the eye along the up of the support walk stood on**
    (decided unattended (2026-11-17, lane/n10), for the lead), not along
    the stage's Y: a body over walk puts its eye BODY.eye up its support's
    up (the walker's own eye is there too), so on a deck heeled 20° the
    stage's Y would hand walk back a point 0.55 m to leeward, and each take
    and leave would walk you sideways. On the ground, and under a seat on
    level ground, the two are one.
35. **A stand spot is placed by the doc in its owner, drawn in its owner's
    frame** (decided unattended (2026-11-17, lane/n10), for the lead), for
    whoever stands people there (a station body, walk.people's claim
    holders), as its seed is: the owner's drawn frame · the spot's object
    placed in the owner by the doc · `at`. Not the object's drawn matrix: a
    stand spot on a turning wheel would turn with it. ("Bodies over walk"
    said the object's drawn matrix; this supersedes it.)
36. **Probe pages reach live walkers through `globalThis.__WALK_LIVE__`**
    (decided unattended (2026-11-17, lane/n10), for the lead), as bakes
    through `__WALK_BAKES__`; `place` is P1 at a point, which sailing's
    probes use where they put someone overboard or by the ladder.
37. **The sloop's static checks run on her seed-pruned bake** (decided
    unattended (2026-11-17, lane/n10), for the lead): walk bakes with
    `prune: false` (Decision 29), which keeps the bilge inside her hull,
    unreachable from every seed, so C2 and C6 fail on walk's own mesh. The
    fixture test and sailing's in-page check run C1–C9 on the same input
    pruned by its seeds and check walk's mesh holds every cell of it. When
    the pruning by passable sides lands they run on walk's own.

38. **Resuming looks at what the body's view looked at** (decided
    unattended (2026-11-17, lane/n10), for the lead): from where P1 stands
    you, toward the camera's target point (a seat's: the table), not along
    its old direction. Standing up from a seat P1 can move you half a metre
    (the floor under a seat's eye is often under the table), and the old
    direction then faced past the table; under a station, which leaves you
    where its eye was, the two are one.
39. **walk stands its walker at a stand spot for a body going over it: the
    `stand` contribution** (decided unattended (2026-11-17, lane/n10), for
    the lead): `stand(id) → { eye(), yaw } | null`, this viewer's walker in
    this stage put at P1 of stand spot `id` (on the floor under it), facing
    its `facing`; `eye()` is that walker's eye as drawn now, and a body
    over walk (a station) looks from it each frame. Leaving, the resume
    (Decision 34) is P1 of that eye less BODY.eye along the up of what the
    walker stands on, which is the walker's own feet: the round trip is
    walk's alone (body.test, stand spot {on, over, into the deck} × deck
    pose, to 1e-9), so no other package copies BODY.eye or the stand-spot
    placement. It replaces a station body that placed its own eye BODY.eye
    up from the spot and relied on walk's resume to undo it. null when not
    walking in this stage, so a body can only stand over walk where walk
    is (a station taken from another stage's walk comes aboard first).
40. **One claim says who stands at a spot** (decided unattended
    (2026-11-17, lane/n10), for the lead): `walk.stand`'s `claim` names the
    claim the body's own verb holds while it stands there, not one held
    for walk alone; a refused claim already stops that verb, so two people
    are never drawn at one spot.
41. **A spawn point on an object with a stand spot is at that spot**
    (decided unattended (2026-11-17, lane/n10), for the lead): people come
    in where someone stands (a boat's helm), with no object of its own for
    the point, so every hull its wheel is fitted to is entered there. A
    spawn point without a stand spot is at its origin, facing its way, as
    before.
42. **Sailing's walking text is walk's "Foundations", split by owner**
    (decided unattended (2026-11-17, lane/n10, step 6), for the lead): what
    holds for any support (the mesh's words, the bake's steps, NavMesh,
    B1–B7, the move, the transitions that survive, P1, the unit and
    enumerated cases, C1–C7 and C9, the grid and open-square decisions) is
    here, renamed; what is the stock sloop's (the cockpit's STEP table, her
    mesh's numbers, C8, the bow, the mainsheet beside a card table, her
    refitted fittings, the camber hull's numbers) stays in sailing's DESIGN,
    "Walking", which points here. States, transitions and checks walk
    dropped (station, ladder, boarding; S1, S2, L1, L2, B1, B2, G1; unit
    cases 20, 23b, 25) are not carried over: "States" and "Transitions"
    above say what replaced them.

## Questions for the lead

- **Q7. Doom's doors.** Step 4 tags each door `walk.moves { blocks }` in
  doom's layout (Decision 27) though the brief kept doom's doc shapes. The
  other way is walk treating any object under a pose hold as a blocker,
  which needs no doom change but makes every held pose a wall. Keep the
  tag (and republish E1M1 before walk syncs)?
- **Q8. The traits' part id.** It is still `walk.spawn` though it declares
  all five traits. Docs carry trait names and package urls, not part ids,
  so a rename (say `walk.traits`) changes no doc. Rename?

- **Q9. Reach while walking her deck.** Sailing's `aboard` body reached
  2.5 m; walk's reaches 2 m, so a station's verbs answer from half a metre
  closer than before (the station body still reaches 2.5). Should a
  support be able to say a reach, or is 2 m right everywhere?
- **Q10. The eye's frame.** Walking her deck now draws through walk's
  camera (field of view 75°, far plane 800 m) where sailing's was 60° and
  5,000 m: the horizon at sea is nearer and the deck wider. A body's
  numbers, or the world's (a sea asking for a far plane)?
- **Q11. A hull made a ship by hand.** The stock sloop is written a
  support; a hull given the Ship trait in the inspector becomes one when
  the first sailing part is put on her (parts.js writes `walk.support`
  then). Should the Ship trait's own adding write it (scene has no
  "adding this adds that"), or is fitting her out the moment?

- **Q1. Who draws someone at a station?** As designed, walk.people draws
  the holder of a stand spot's named claim at the spot (no scene change;
  the station body holds a `"stand"` claim). The alternative is a scene
  field: the sitting a body answers says `stands: true`, the stage copies
  it to `view.body`, and walk keeps publishing its own avatar at the body's
  eye while under it. That is one field in scene's body contract with one
  consumer, which is why it isn't the default.
- **Q2. Ledges.** A drop deeper than a step, inside one support, is a WALL
  you jump off (sailing's rule, kept). An OPEN side drops you up to DROP
  without a jump. So stepping off a deck onto a quay 1 m down just walks,
  but stepping off the cabin top 1 m down takes a jump. Doom walks off its
  ledges. Should a ledge of at most DROP be walked off everywhere (a vault
  with no rise)?
- **Q3. Speeds.** One body walks at 4.5 m/s (walk's) rather than sailing's
  3.2 m/s. Brisk on a deck, natural in a level. Or should a support be
  allowed to slow you?
- **Q4. The ground at scale.** Tiles around walkers (as designed), or a
  coarser cell for the ground only (10 cm, a quarter of the work) and a
  second number in the one body? On terrain, should the ground's heights
  come from terrain itself (a heightfield it answers, the bake taking only
  the structures on it) rather than from its kilometres of triangles?
- **Q5. Up.** Is "a support's up is its object's +Y" acceptable, with an
  upright group for models that aren't? Or should `walk.support` carry an
  `up`?
- **Q6. Floors across docs.** COMPOSITION says "a walker in a linked level
  stands on the host's floor". The bake reads only its own stage's
  objects (rays were the only space that crossed). So walking a linked level
  doesn't stand on the host, and walking a host doesn't stand on a linked
  boat. A boat linked into a harbour is boarded in her own stage, as today.
  Today's ray walker does stand across links in both directions
  (COMPOSITION, "Not mine is one value": the viewport's raycast covers
  every pick target), so this is a regression wherever someone walks
  across one. The published examples composed of links, where it could
  show: Games night, Games night and the Arcade, Arcade in the games room,
  the Quiet games room's game link, the Model room, Model basin and Ship at
  anchor, Harbour and Fitting out. Step 4 checks each (Verification)
  before the ray walker goes. Is the regression acceptable, or should the
  stage offer a host's triangles near a point (a scene change)?

## Foundations: the navmesh and the walker

*Moved here from sailing's DESIGN in step 6 (lane/n10), renamed: ship →
support, her body frame → the support's frame, sea → water, OVERBOARD →
OFF, `__SAILING_ASSERT__` → `__WALK_ASSERT__`. It is the text the sections
above build on; where they say otherwise (the one body, the bake's input
and pruning, the states, W3, falling, blockers, bodies over walk), they
win. What is the stock sloop's alone stays in sailing's DESIGN ("Walking":
the cockpit STEP, her mesh, her rails, her fittings).*

The ray walker this replaced asked the scene, each frame and in the world,
where the floor and the walls are, and it could be wrong in any frame
where a ray missed:
- the band between the step height and the lowest wall ray;
- a single centre ray across a heeled well wall;
- a lifeline taken for a floor.

Checking it took hundreds of walked routes. This design moves the geometry
questions to a **bake**, done once per support in its frame and checked
statically. **Motion** is a small state machine over the baked mesh, and
its state cannot name a place off the mesh. Correctness rests on three
things, each finite:
- the bake's properties (B1–B7 below), checked on every bake;
- the transitions, each shown to preserve the invariant;
- a list of unit cases, one per kind of situation.

### Words (the mesh's)

- **Column**: a `c × c` square of the support's plan (x, z), indexed
  `(i, k)` from the grid's origin. Rasterising triangles into a column gives
  its **intervals**: the closed y-ranges where any triangle's part inside the
  square lies, merged where they overlap.
- **Cell**: a floor in a column (the top of one interval) that passes the
  bake. It is the navmesh's face. A position on it is `(cell, u, v)` with
  `u, v ∈ [0, 1]`, so the plan point is `origin + ((i + u)c, (k + v)c)` and
  the surface height is the cell's plane there.
- **Side**: one of a cell's four edges, directed out of it (−X, +X, −Z, +Z).
  Every side of every cell carries exactly one record: STEP, WALL or OPEN.
  Two cells that share an edge each see it as their own STEP side.
- **Rise**: how far above this cell's surface the body's feet must be to go
  across a side. It is signed for a STEP (negative is a step down).
- **Silhouette**: the columns holding any of the support's baked geometry.
  `D_r` is the silhouette dilated by the radius. A point outside `D_r` is
  off the support: in the water, on another support, or falling.

### The bake

`bake(input, BODY) → NavMesh` (`navmesh.js`). It is pure, deterministic
and independent of triangle order. Its input (triangles in the support's
frame, and the seeds) is the adapter's ("Input", above); the parameters
are the one body's.

**Steps**:
1. **Rasterise.** For each triangle and each column its plan bounds touch:
   - clip the triangle to the column's closed square (Sutherland–Hodgman);
   - record the clipped polygon's `[ymin, ymax]`, and the same of its part
     in the column's *open* square: the square shrunk by the clip's own
     1e-9, so a piece lying on a column line (a wall, or a box's top) is on
     the boundary of both columns and has no part inside either. Call such
     a piece EDGE.

   Then merge overlapping intervals per column on the closed ranges, every
   piece alike. A wall on a column line lands in both columns,
   conservatively: an EDGE piece is an obstacle like any other.
2. **Floors**, judged on the pieces' open parts alone. Let `own` be the
   highest open part's top in the interval (none: no floor). `own` is a
   floor if either:
   - (a) a walkable triangle's open part reaches `own`; the floor's plane
     is that triangle's (the highest at the centre), clamped to its open
     part's range;
   - (b) a walkable triangle's open part tops out within `step` below
     `own`: steep stuff standing on a floor (a curb, a toe rail, a leaning
     wall straddling a column). The floor is flat at `own`.

   Either way some open part reaches the floor at its height, so every
   floor is held up by a triangle that meets its open square there, by
   construction: the invariant B1 checks (navcheck's `supported` asks of
   the open square). It holds however thin the part is: a wall on a line
   whose foot leans 1e-8 into the column outside makes its floor (rule b)
   at the sliver's top, 10% under the top only the line reaches. An EDGE
   piece's top is never a floor, which is what keeps a box whose side lies
   on a column line from making a cell at its height in the column outside
   it. When an EDGE piece rises above `own` (the column beside a lip, a
   crate or a wall on the line), the floor stays at `own` and its `top`
   stays the interval's top: erosion (step 5) measures a step against
   that, so the floor goes if the EDGE stuff rises more than a step over
   it and stays if not. Beside a box that is the box's own columns' doing
   too; beside a zero-thickness fence on the line, with no columns of its
   own, it is the floor's `top` alone that keeps the body a radius off it.

   Rule (b) is Recast's merge rule. It is what joins a side deck to a
   cabin top across a few centimetres of leaning wall. A stanchion or a
   post taller than `step` never becomes a floor.
3. **Headroom.** A floor's `ceil` is the bottom of the next interval up
   (+∞ if none). A floor with `ceil − s < H` is dropped. This removes a
   floor under a wire, a rim, a leaning stay, a floor under a floor (a
   bilge, an interior under a roof too low to stand in). Obstacles need no
   separate footprints: anything solid within H of a floor removes it.
4. **Connect.** Floor `f` and the floor `g` in the next column are
   connected if both hold:
   - `|s_g − s_f| ≤ step`;
   - `max(s_f, s_g) + H ≤ min(ceil_f, ceil_g)`.

   At most one `g` qualifies, because two floors in one column are at least
   H apart and H > 2·step. So connection is symmetric and unique.
5. **Erode.** Keep floor `f` only if every column whose square meets the
   disc of radius `r + c/√2` about f's centre has a floor `g` such that:
   - g is connected to f through columns in that disc;
   - `s_g ≤ s_f + step`;
   - `ceil_g ≥ s_f + H`.

   The `c/√2` covers every `(u, v)` in the cell. This one rule erodes from
   walls, wires, posts, ledges and unrailed edges alike. It doesn't erode
   at the steps themselves (a stair, a bench's edge), so you walk right up
   to them and onto them.
6. **Prune** ("Pruning", above: by passable sides to roots, else every
   component ≥ πr²; built as `prune: false` until that lands). Sailing kept
   the components holding a seed and dropped the rest, reported (C3).
7. **Classify every side of every kept cell, once:**
   - **STEP `to g`**: the next column holds a kept `g` connected to it.
     `rise = s_g − s_f` at the edge's midpoint.
   - Otherwise, **march** column by column along the side's axis, in the
     cell's row, up to `march`. For each marched column, `fit` is the
     lowest height above `s_f` at which the body (the disc of `r + c/√2`,
     from feet to `+H`) is clear of every interval there. `rise` is the
     running max of `fit`. The march stops at the first column that either:
     - holds a kept `g` with `s_g ≤ s_f + rise ≤ s_g + headroom(g)` (you
       can come down onto it, and the whole body fits there):
       **WALL `to g`**, `gap` = the distance to it;
     - lies outside `D_r` (the first column whose disc meets no silhouette
       column): **OPEN** if `rise ≤ step`, else **WALL `to OFF`**.
       `exit` = that column's centre at the cell's row: where you leave the
       support (W3).
     - Hitting `march` or an unbounded `fit` gives **WALL `to NONE`**.

   So a WALL says three things: walking stops here; a jump at least `rise`
   high gets across (to `g` or off the support); or nothing gets across.
   A ledge (a drop deeper than `step` inside one support) is a WALL `to`
   the floor below, with a rise of about 0, so it can be jumped off but not
   walked off (Q2).
8. **Silhouette and links.**
   - `D_r` as a bit per column, and for each `D_r` column its nearest column
     centre outside `D_r` (where a swimmer is put out).
   - **Links**, each `{ kind, id, at: (cell, u, v), yaw }` or a water
     point: `spawn`, one `stand` per stand spot, and per ladder a `top`
     cell and a `foot` water point outside `D_r` beside it.

     A spot is placed by **projection**: the kept cell nearest in plan
     whose surface is within `step` of the spot's height.

**NavMesh** (typed arrays, one object per bake key):

```js
{
  key,                          // the bake key: what it was baked from ("Input", above)
  params,                       // the one body's: { cell, slope, step, height, radius, jump, march }
  origin: [x0, z0], nx, nz,     // the grid, the support's frame
  cells: { i, k, y, gx, gz, ceil, headroom, region },   // Int32/Float32Array, one entry per kept cell
                                //   y(u,v) = y + gx·(u−½)c + gz·(v−½)c; headroom = min over the erode disc of ceil − y − H
  column: Int32Array(nx·nz + 1),// cells by column (prefix offsets), for projection
  side: {                       // 4 per cell: −X, +X, −Z, +Z
    kind: Uint8Array,           //   STEP | WALL | OPEN
    to: Int32Array,             //   a cell, OFF (−1) or NONE (−2)
    rise: Float32Array, gap: Float32Array, top: Float32Array,
    exit: Float32Array,         //   [x, z] for OFF and OPEN
    normal: Float32Array,       //   [x, z], the source wall's plan normal: only for how a slide feels
  },
  outside: Uint8Array(nx·nz), putOut: Float32Array,  // D_r and where to put a swimmer
  links: [{ kind: "spawn" | "stand" | "ladder", id, at: { cell, u, v }, yaw, foot? }],
  dropped: [{ region, area, centroid, why }],         // what step 6 pruned
}
```

### The invariant's foundation: B1–B7

`assertWalker(state, meshes)` checks I ("Invariant I", above) after every
step while `walker.asserting()`: under vitest (`import.meta.env.DEV`), in
every probe page that sets `globalThis.__WALK_ASSERT__`, and in any page
that sets the flag. A breach then throws in the body's tick. A production
build (`DEV` compiled to false) logs a failure, which the transitions say
can't happen, once and resolves it by projection.

**What I buys**, given the bake properties B1–B7 (each a static check):
- **B1**: every cell is a floor with headroom ≥ H, held up by a triangle
  meeting its column's open square.
- **B2**: every column within `r + c/√2` of a cell has a floor connected to
  it no more than `step` above it, and headroom up to its `+H`.
- **B3**: a STEP's `to` is a kept cell; a WALL's `to` is a kept cell, OFF
  or NONE; an OPEN's `to` is OFF.
- **B4**: STEP is symmetric.
- **B5**: every `exit`, every `putOut` and each ladder's `foot` lie outside
  `D_r`.
- **B6**: no cell lies inside a closed hull.
- **B7**: every vault's marched band is clear of the body at `s_f + rise`.

Together they give the guarantee: walking or airborne,
- the feet are on a floor;
- the body from `step` above the feet to its top (radius r) meets no baked
  surface;
- an airborne body's whole height is clear.

Below `step`, the legs are allowed to overlap what they step over: a curb,
a bench's edge.
- A vaulting body is clear by B7.
- A swimmer is clear of every support's plan outline.
- A support's frame is rigid and its geometry rides with it, so all of
  this holds in the world too: the world pose is derived each frame
  (feet = `M · local`, the eye along the support's up), and the support's
  motion is never an input to the state.

Not covered: what moves and isn't baked (blockers, "Blockers" above, only
cut a move short); other people.

### Motion

**One move** (walking, airborne): the plan displacement this frame is
`(dx, dz) = vel · dt`. It is capped at 1 m, so any `dt` works. It is walked
side by side, as a DDA walks a grid. For each next crossing:
- **within the cell**: move; `u, v` stay in `[0, 1]` (clamped after the
  arithmetic, which only moves within the cell);
- **at a side**, by its record. STEP sets `u` or `v` to the opposite edge
  (0 ↔ 1) of `to`.
- **corner rule**: a crossing exactly through a corner takes X before Z.
  The diagonal cell is only ever reached through one of the two orthogonal
  neighbours, and only if that neighbour's side is crossable too. So two
  WALL sides meeting at a corner let nothing through it.

Each pass either ends the move, crosses one side (at most `|dx|/c + |dz|/c +
2` of these), or zeroes one axis (at most twice), so it terminates.

**Sliding.** A blocked axis has its remaining displacement and its velocity
along that axis set to 0, and the other axis carries on. That alone is a
correct slide along a wall, and a stop in a concave corner. For feel, the
velocity is first projected along the wall's smoothed `normal`, so a 45°
wall doesn't stair-step. The projection changes only the velocity; the
side test still decides.

The transitions as sailing built them; walk's table ("Transitions", above)
generalises W3 and A5 (off an OPEN side onto another support, the water,
or falling), adds falling (F1–F5) and waiting (WT1, WT2), and drops the
station, ladder and boarding states:

| # | From → to | When | Why I still holds |
|---|---|---|---|
| W1 | walking → walking | a move within a cell or across a STEP | `to ∈ cells` (B3); `u, v` set to an edge, in `[0, 1]` |
| W2 | walking → walking | a move into a WALL side | That axis is zeroed; you stay in the cell |
| W4 | walking → airborne | jump | Same cell, `h = 0 ≤ headroom` (B1) |
| W5 | walking/airborne → swimming | awash: feet `SUNK` under the water (the support is going down) | You're put at `putOut` of the column you're in (B5) |
| A1 | airborne → airborne | `h += vy·dt` under gravity (the support's −Y), clamped to `[0, headroom]`; touching the top zeroes `vy` (a head bump) | Clamped into the invariant's range |
| A2 | airborne → walking | `h` reaches 0 | Same cell |
| A3 | airborne → airborne / walking | across a STEP: `h' = h − rise`. If `h' ≥ 0` and `h' ≤ headroom(to)`, airborne on `to`. If `h' < 0`, walking on `to` (a step up in the air). If `h' > headroom(to)`, blocked like W2 | `to ∈ cells`; `h'` checked against `to`'s range |
| A4 | airborne → vaulting | into a WALL with `h ≥ rise` and `to ≠ NONE`; otherwise blocked like W2 | `d = 0`; `h ≥ rise` |
| V1 | vaulting → vaulting | `d += |vel along the axis|·dt` (at least 1.5 m/s), `h` ballistic but within `[rise, top]` | `d` capped at `gap`; the band is clear (B7) |
| V2 | vaulting → airborne / walking / off | `d = gap`: onto `to` with `h = min(s_f + h − s_g, headroom(to))`. That is ≥ 0 because the march only stops where `s_g ≤ s_f + rise`; the march also checked that `s_f + rise − s_g ≤ headroom(to)`, so the min only trims a jump that is still rising. 0 means walking. For OFF: as W3 | `to ∈ cells` (B3) and `h ∈ [0, headroom]`, or as W3 |
| R1 | any on a support → by projection | its mesh is rebaked (parts changed) | The old local point is projected onto the new mesh (P1). Projected into the water, `yaw` gains the support's heading, so the look doesn't turn |
| SW1 | swimming → swimming | Move in the world at the surface, then `pushOut`: (1) up to four passes, each moving `p` to `M · putOut` of the support whose `D_r` holds it; (2) if it's still in any support's `D_r` (two so close their `D_r` overlap, each one's `putOut` in the other's), rings about the original `p`, a cell apart and sampled a cell apart round, to the first sample outside every support's `D_r` | Each answer is tested by checkWalker's own test over every support with a mesh, so it is outside the union. The search is total: at horizontal distance `D` from a support's origin a surface point is at least `√((D(1−sinθ) − Y)(D(1+sinθ) + Y))` from it in its plan (θ its tilt, Y the surface's height off its own, ≤ 10 m + the difference at `p`), which exceeds its grid's reach `E` once `D(1−sinθ) − Y > E`; the last ring is there. Only a support on its beam ends (sinθ ≥ 0.999) has no such ring; then the search stops at 200 m and, asserting, throws. This also covers a support moving into a swimmer |

**P1, projection**, is total and returns only valid states. It asks "over
the water?" first: a point outside every `D_r` with water under it swims
(in the order first written, any point at deck height anywhere projected
onto the deck). Else it goes to a cell whose surface is at most a step
above it and at most 2 m below it, the score plan distance with a drop
deeper than a step counting metre for metre, so a point in the air lands
on what's under it; else to the nearest cell in 3D (walk's P1 asks this
over every support, the ground last, and lifts to the lowest clear point:
"Transitions", above). The bake's seeds are projected the same way. Two
plainer rules each failed on camber's hull: with a symmetric ±step window,
a point just over a step above her aft deck snapped to her foredeck 7 m
away, which her sheer had brought within a step of it; with "nearest in
plan within the window", a seed over her deck took the bilge under it
whenever the nearest deck cell was a cell away. A seed with no kept floor
within a step of it keeps the nearest component instead (a 0.59 m post
standing on the spawn point: the enumerated cases' "box over the spawn
point" arena keeps it covered).

### Verification (the foundations')

No random routes. Each case's every step runs `assertWalker`.

**Unit cases** (`walker.test.js`, `navmesh.test.js`). Each is a fixture of a
few boxes as triangles, baked, then driven:

1. A flat floor: walk within a cell, and across cells. `u, v` stay in range.
2. A STEP up (0.3) and down: the cell changes, the feet follow the new
   plane, and the side back is a STEP (B4).
3. The threshold: a rise of exactly `step` is a STEP; `step + 1 mm` is a
   WALL. A drop of `step + 1 mm` is a WALL (ledge) with a rise of about 0.
4. A WALL (1.0): you stop with your centre `r` ± `c` from its face.
5. Sliding: walking at 30° into the wall keeps the along-wall component.
   Head on, you stop.
6. A concave corner (two walls at 90°): a diagonal move into it stops at
   the corner, and both axes are zeroed.
7. A convex corner (an L-shaped floor): walking along one wall carries on
   past the corner. A diagonal across the corner's cell goes through an
   orthogonal neighbour, never cutting the corner.
8. Exact diagonal through a vertex, both orthogonal sides WALL and the
   diagonal cell open: blocked. Then the same with one side STEP: through
   that side (the X-first tie order is checked both ways round).
9. A corner between a STEP (+X) and a WALL (+Z): a diagonal move crosses
   the STEP and slides along the WALL.
10. Head clearance: a floor under a ceiling lower than H isn't a cell. A
    jump under a ceiling at `H + 0.3` caps `h` at 0.3 and zeroes `vy`.
11. A wire pair over a floor (0.34 and 0.62, 6 mm): no cell under it or on
    it; the floor beside it is eroded by r; jumping over it works.
12. Jump over a low wall (rise 0.62 < apex 0.845): walking is blocked, a
    jump vaults it and lands beyond. A rise of 0.9: the jump is blocked.
13. Jump off a ledge (a cabin top 1 m over a sole): walking is blocked; the
    jump vaults down and lands.
14. OPEN: walking off an unrailed edge, you swim at `exit`, outside `D_r`.
15. A rail (WALL to OFF at 0.62): walking is held; a jump puts you in the
    water.
16. Ramps: 20° is walkable with STEP sides all the way up; 50° isn't.
17. Rule (b): a riser leaning 4.7 cm between a deck and a roof 0.45 above,
    in both alignments to the grid (inside one column, straddling two):
    STEP all the way. A 0.62 stanchion isn't a floor.
18. Swimming: pushed out of `D_r`. A support moved onto a swimmer puts them
    out.
18b. Two supports rafted 0.1, 0.3 and 0.6 m apart (their `D_r` overlap):
    walking off one's OPEN edge, jumping its rail, and the other closing on
    a swimmer between them each leave the swimmer outside both `D_r`, and
    at least r clear of both.
19. The ladder: from its foot, Climb has you walking at its top.
21. **A support's motion under a standing walker:** under any sequence of
    `M` (translation, heave, 30° heel, 20° pitch, yaw), the local state is
    bit-identical and the world feet equal `M · local`.
22. A support's motion under a walking walker: the same input sequence
    gives the same local trajectory under two different `M` sequences.
23. Rebake under a walker: the floor under you is removed, so you're
    projected to the nearest cell. An empty mesh means you swim, and on a
    support heading 90° the look direction is unchanged across it (R1's
    yaw). (23b, boarding, is walk's WT1/WT2; 20, a station, and 25, a seat,
    are bodies over walk: "Bodies over walk", body.test.js.)
24. `place`: a point over the water means swimming; a point by the deck is
    projected to a cell.
26. Stepping across: an OPEN side over another support's kept cell puts you
    on it, in its frame (W3 (1); airborne, then walking).
27. A huge `dt` or speed: the move is capped, and I holds.
28. A blocker: walking into it stops you; a jump under it is capped.
29. A 0.52 STEP up, then down: the state is exact (the feet jump in one
    frame), `step` reports the jump as `lift`, and the drawn eye (`easeEye`,
    only the camera) moves under 0.1 m a frame and catches up within
    0.15 s.
30. The assertion is on under vitest without the flag (`asserting()`).

**The enumerated cases** (`walker.cases.test.js`, finite and named; no
random input, so a failure names its arena, leg and step and runs the same
every time). Each case is:
- a 4 × 4 m arena: a floor alone; each kind of box alone, on the floor (a
  1 cm lip, a stair, a knee-high crate, a wall) and floating (a wire at shin
  height, a low ceiling, a table-high overhang, a box over the spawn point,
  which the bake's seed must step out of); a ramp at 0, 30 or 60° facing
  each of four ways; a thin post or rail along x or z, 1 or 3 cm; and all
  at once (8 boxes, 2 ramps, 3 rods). Every arena twice: its edges on the
  10 cm columns' lines, and 3 mm off them;
- 36 legs from the start, one per combination of forward, strafe, run and
  jump, 16 steps each, heading each of the eight ways, `dt` alternating
  1/240 and 1/20 s, under every extreme pose of the support (±3 m, ±0.5 m
  heave, ±30° heel, ±20° pitch, ±180° turn) in turn.

Each step checks I, and also an **oracle on the raw triangles, not the
mesh**:
- the feet are within `h + 2 mm` above a triangle in their column's open
  square;
- no triangle meets the cylinder of radius r over `[s + step, s + H]`
  (over `[s + h, s + h + H]` while airborne).

Every case's bake also passes B1, B3–B5. A case that starts on a support
must spend three quarters of its checks on it (so it walks among the
features, not off them). A second baked support (a 4 × 4 m deck, with or
without a rail) lies on each side of the first, touching or 1 m off,
riding with it, the walker on it or in the water between them: a swimmer
must be clear of both (I, and no triangle of either within r), and a
walker who steps across is checked against the other's triangles. 89
cases, baked at 10 cm (everything reads the cell size from the mesh's own
params), in about a second. They replaced a seeded `fast-check` property
test (the project's tests are finite and exhaustive, never random), and on
their first run found what it never had: a box's or ramp's side exactly on
a line between columns also made a cell at its height in the column
outside it, so the walker could stand up to a column's width past the
edge. The fix is the bake's (step 2), and with the oracle's support check
asked of the open square too, the old bake fails seven of them (the lip,
stair, crate and the 30° ramp each way). `navmesh.test.js` pins the rule on
its own, from both sides of the line: a box side on a 10 cm line or 3 mm
out over it × {1 cm lip, 15 cm stair, 45 cm crate, 120 cm wall} × each side
(32), and a 30° ramp's high end on the line or 3 mm out × each facing (8),
each against its twin 3 mm in; then a zero-thickness fence on a line or
3 mm off it × {lip, crate, wall} (6), a cage of 1.2 m fences on every line
(nothing kept inside: erosion's fast path must not take a fenced column as
plain), and a wall on a line leaning 1e-8 or 1e-6 into the column outside
(its floor at the sliver's top, B1). `walker.supports.test.js` walks off
supports onto supports, the ground and the water ("Verification", above).

**Static checks** (`navcheck.js`) on each bake: on the stock sloop's
fixture in `deck-12m.test.js`, and on the camber hull in sailing's
`probes/camber-run.mjs`.
- **C1**: spawn, each stand spot and each ladder's top project onto a kept
  cell, within 0.35 m in plan and `step` in height of where they were
  asked for.
- **C2**: every kept cell is reachable on foot (STEP sides only) from
  spawn. So is every C1 spot.
- **C3**: every dropped component is one of: inside a closed hull (C6's
  test); smaller than 0.25 m²; reached by no WALL side of a kept cell with
  a rise ≤ the jump apex. So nothing you could walk or jump to was
  dropped. (As built, it re-marches every non-STEP side over the bake's
  intervals, as the bake marches, offering the dropped floors as places to
  come down.)
- **C4**: every side of every kept cell has exactly one record. B3 and B4
  hold, and B5 too.
- **C5**: B1, B2 and B7, recomputed by brute force from the triangles, and
  the headroom with them. Per cell, exactly what the erosion promises: the
  cylinder of radius `r + c/√2` about the cell's centre (so radius r about
  every `(u, v)` in it) meets no triangle from `smin + step` to
  `smax + H + headroom`, and to the sky where the headroom is infinite: the
  standing band and the whole airborne envelope at once. Where it's
  finite, a triangle stands within 5 mm above that top in the disc's
  columns, so an understated or stale headroom fails too. Then B7 along
  every vault band. A bake that set every headroom to infinity, or halved
  them, fails C5.
- **C6**: no kept cell lies inside a closed hull. A point 5 cm above its
  surface is outside by ray parity, and three directions must agree.
- **C7**: stability. Rebaking at `step` ± 0.02 and r ± 0.02 keeps C1 and C2
  true.
- **C9**: two bakes of the same input are byte-identical; a shuffled
  triangle order too.

C8 and the bow check are the sloop's (sailing's DESIGN, "Walking").

### Decisions (the foundations')

- **The faces are grid cells, not welded source triangles.** A triangle
  navmesh needs polygon offsetting and booleans on a curved deck to erode
  and to cut out obstacles. Those are where bakes go wrong, and they can
  only be checked by sampling. On a 5 cm grid, each bake step is exact and
  finite: clip a triangle to a square; merge intervals; the disc test; one
  march per side. So the checks can cover every cell. The cost is a
  boundary quantised to 5 cm, and the erosion disc is padded by `c/√2` to
  keep it conservative. The input is still triangles, so every support
  bakes alike.
- **Baked from what's drawn** (the models), not from an analytic surface:
  the same code for every support, right for docs whose models predate
  the code that made them.
- **A symmetric step.** A drop deeper than `step` inside one support is a
  WALL (ledge) you can jump off.
- **Obstacles come in by headroom.** No footprint input; what moves is a
  blocker.
- **The body rides the support's up.** The eye is along its up, not the
  world's, so the camera stays in the checked volume; the horizon stays
  level.
- **Ladders and stepping across** are links and checks at the mesh's
  edges, not rays.
- **A floor needs a triangle that meets its column's open square**
  (decided unattended (2026-11-17, lane/n10), for the lead). A piece that
  only touches the square's boundary stays in the interval as an obstacle
  but is no floor and holds none up; the floor is the open pieces' top
  `own`, even under an EDGE piece above it, and erosion measures a step
  against the interval's whole top. The plainer reading, no floor at all
  in a column whose interval's top is an EDGE piece, would have cut the
  ground beside every lip or crate on a line and eroded a moat a radius
  wide round it, unlike the same box 3 mm off the line. Question for the
  lead: is "the open square shrunk by 1e-9" the definition you want, or
  should "on the line" carry a coarser tolerance (say 1 µm) for meshes
  authored in single precision? B1 holds either way (the floor is at the
  open part's top, however thin), so this is about intent only: GLB
  vertices sit ~1e-8 off a line at sloop scale, and at 1e-9 a sliver that
  thin of a 30 cm wall or a crate's side holds up a floor in the column
  outside, at its height there (a wall whose foot leans 1e-8 over the line:
  0.27 m, under its 0.30 top).

### As built (the foundations')

- **Intervals merge across gaps no body can use.** Two ranges in a column
  merge when they overlap *or* the gap between them is less than
  `H − step` (1.17 m). B2 needs that much clear over a neighbour's floor
  and a fit needs H, so no later rule can tell such a gap from solid:
  treating it as solid is exact. (The sloop's portlights sit 1 cm off her
  cabin's leaning side; without it, a column straddling the side made the
  cabin's edge a floor without headroom.)
- **A floor's surface is its triangle's plane clamped to that triangle's
  open part's range in the column** (`cells.lo`, `cells.hi`). So there is
  always a point of the triangle, inside the feet's column's open square,
  at the feet's height: what the oracle's support check tests. Coplanar
  triangles that tie for a column's floor share the plane and join their
  ranges, so triangle order can't matter (C9). Gradients are stored without
  −0.
- **Sides carry `top`**: the highest a vault's feet may rise and keep its
  band clear. The march checks the band at the final rise in every column
  before the stop (else `to` is NONE), and the vault clamps `h` to
  `[rise, top]`. C5 checks every band at both heights.
- **Erosion has two exact shortcuts before its BFS.** A disc column with no
  alive floor fails f; per-row prefix sums answer that in 2K + 1 looks. In
  a square window of "plain" columns, f passes outright. Plain means: one
  alive floor with no EDGE piece above it (`edged` false: its `top` its
  own), open sky, all four neighbours connected to it within
  δ = (step − slope·c√2)/(4K + 2) of its height. D_r uses the same row
  sums. The march's disc gathers are cached per column.
- **The eye eases across a STEP.** The walker's state is exact, so a
  0.52 m STEP moves the feet in one frame. `step` returns that jump as
  `lift`, and the body draws the eye with a lag along the support's up that
  closes at 5 m/s going up and 3.5 m/s going down (`easeEye`). Only the
  camera lags: I and the feet are untouched.
