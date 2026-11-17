# walk: standing on supports

*Design, written 2026-11-17 in lane/n10 (step 2 of 6), unbuilt. Steps 3–5
build it: step 3 moves the walker into walk (pure), step 4 gives walk's body
supports, step 5 makes sailing walk in walk. Every decision here was made
without the lead and is marked so in "Decisions"; what is the lead's taste is
asked in "Questions for the lead".*

walk has one walker: the navmesh walker sailing built for her deck
(sailing/DESIGN.md, "Walking: a navmesh in the ship's frame"), generalised
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
says only what is new or changed. The text it builds on moves here from
sailing's DESIGN in step 6, renamed.

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
- **Kept cell, side, rise, D_r, link**: as in sailing's DESIGN, per
  support. A side's record is STEP, WALL or OPEN; a WALL's or OPEN's `to` is
  a cell, **OFF** (off the support's outline: sailing's OVERBOARD) or NONE.
- **Stand spot**: an object with `walk.stand`. It is a seed of its owner's
  bake and a link in its mesh.
- **Ladder**: an object with `walk.ladder`, the climb from the water onto
  its owner. A seed at its top, a link with a foot in the water.
- **Water**: what the stage's `water` contribution answers,
  `api.collect("water")`'s `at(p, { not })` (water/WATER.md, "The
  contribution"), as sailing's sea-view reads it. Walk swims only in water
  owned by the ground: the world's open water (`body` null) or a bounded
  body the ground owns. Where `at` answers nothing there is no swimming.

## The traits

Written by whatever lays a scene out (arena's parts, doom's layout,
sailing's parts and template). Walk declares each in `describes`, so a doc
that carries one calls for walk and lists it, as `walk.spawn` does today.

| trait | on | value | what walk does with it |
|---|---|---|---|
| `walk.spawn` | object | `{}` (unchanged) | where people start, facing the way it faces (as now); a seed and a `spawn` link of its owner |
| `walk.support` | object | `{}` | a support: its subtree, less sub-supports, loose things and moving parts, is baked in its frame |
| `walk.moves` | object | `{ swept?: "x"\|"y"\|"z", blocks?: true }` | a moving part (above); never more than one of the two |
| `walk.stand` | object | `{ at: [x,y,z], facing?: [x,y,z] }`, both in the object's own frame | a stand spot: a seed, and a `stand` link at `at` facing `facing` (default the object's origin) |
| `walk.ladder` | object | `{ top: [x,y,z] }` in the object's own frame | a seed at `top`, a `ladder` link: `top` its cell, `foot` the nearest water point outside the owner's D_r to the object's origin |

Each trait's part has the trait's verb, as `walk.spawn` has Walk from here:
- `walk.ladder`'s is **Climb**, offered while you swim within reach of the
  foot (L1);
- `walk.support`'s is **Walk on**, which enters the walk body at the
  support (`api.body.enter("walk", id)`);
- `walk.stand` has no verb of its own. A stand spot means what its writer
  says (sailing's helm); walk only stands people there.

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
  and k is 1.
- **seeds**: the points of every `walk.spawn`, `walk.stand` and
  `walk.ladder` s owns, in s's frame.
- **key**: a hash of k and, for each baked object, its id, its file
  (`sourceUrl`, `renderUrl`), its transform relative to s, whether its
  model has loaded, its `swept` axis and its trait keys (sailing's
  `navKey`, generalised). The support's own drawn pose is not in it, so
  sailing never rebakes her because she moved. Blockers are not in it
  either: they are read each frame.

An object that moves in play by writing its doc transform must be a
support, a moving part or loose. Otherwise its owner rebakes each time it
moves. That is correct but slow, and the probe check C10 names it.

### Pruning (step 6), generalised

Sailing kept the components holding a seed and dropped the rest. Two things
change.

1. **No seeds.** A support with no seeds (a raft, a lift, a level with no
   spawn) keeps every component whose kept area is at least the body's
   footprint, π r² (0.196 m²). With seeds the rule is sailing's.
2. **Kept is closed under jumps.** After classifying, any dropped component
   that a kept cell's WALL side reaches (`to` a cell of it, rise ≤ the
   jump's apex) is kept too, and the sides are classified again. This
   repeats until nothing more is kept; each pass keeps at least one more
   component, so it ends.

   On the sloop it changes nothing: her only drops are inside her (C3).
   On the ground it is what keeps a floor below a ledge, which in a level is
   often a component of its own (you drop into it and can't walk back up).
   Without it, a level with a spawn would prune every such floor.

C3 then holds by construction ("nothing you could jump to was dropped"). It
stays as a report: each dropped component with its area, centroid and why
(inside closed geometry, under π r², reached by nothing).

### When it runs, and the budget

- A support is baked when first needed (a walker on it, or entering it),
  then again off the frame loop whenever its key changes. The old mesh
  stays in use until the new one lands, and walkers on it are projected
  onto the new one (R1). Meshes are cached by key for the page.
- **Budget: 500 ms** a bake, off the frame loop, measured where it runs
  (the sloop: 80–120 ms in Node, 219 ms in a loaded browser).
- **The ground is measured on E1M1** (doom's probe, step 4). At 5 cm, a
  map about 80 × 125 m is about 4M columns, against the sloop's 18k, so it
  will likely be over budget. If it is, the ground bakes in **tiles**:
  - squares of 128 × 128 columns (6.4 m);
  - each baked from its columns plus a margin of
    ⌈(r + c/√2 + march)/c⌉ columns, the furthest any bake step reads. So a
    tile's cells and sides are exactly the whole bake's there;
  - pruning is the one global step, so a component that reaches an
    unbaked tile is kept until that tile is baked (keeping is safe: I
    never needs a cell pruned);
  - the tiles within two tiles of any walker on this page are baked ahead,
    nearest first, one per frame-loop idle slot;
  - a move into an unbaked tile is blocked like a WALL (W2) until it lands.

  Whether this is wanted, or whether the ground should be coarser (10 cm
  where nothing is finer), is Q4.

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
  water(x, z) → { surface: number } | null,  // ground-owned water at that plan point, else null
  blockers(id) → [box],       // in that support's frame
  ground: { raster(col) → intervals },       // the ground's column intervals, kept from its bake (swimming, falling)
}
```

### States

| state | fields | |
|---|---|---|
| `waiting` | `on`, `at` (where to stand, in on's frame) | on's first mesh hasn't landed: no position. Replaces `boarding` |
| `walking` | `on, cell, u, v, vel[2]` | |
| `airborne` | `on, cell, u, v, h, vy, vel[2]` | |
| `vaulting` | `on, cell, side, d, h, vy, vel[2]` | |
| `swimming` | `p[2]` (ground plan), `vel[2]` | the feet at `surface − depth`, clamped into the ground's free gap (below) |
| `falling` | `p[3]` (ground frame), `vel[3]` | new: off an OPEN side with nothing under it and no water |

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
- `falling`: (b) and (c) for the body at p.
- `waiting`: no position.

(c) is sailing's erosion test asked at run time of one column's disc. The
ground keeps its raster for it (in tiles, if tiled). With no ground
geometry near p it holds trivially, so a doc with only water and a boat
asks nothing new.

`assertWalker` checks I after every step while asserting, as now. The flag
becomes `globalThis.__WALK_ASSERT__`, set by every probe page (sailing's
probes too).

### Transitions

Sailing's table holds, with these changes. W3 replaces sailing's W3 and A5.

| # | from → to | when | why I holds |
|---|---|---|---|
| **W3** | walking / airborne / vaulting → walking, airborne, swimming or falling | across an OPEN side of s (a vault whose `to` is OFF, at its end), at `X = M_s · exit` with the feet at height y | In order: **(1)** onto another support s′ (the ground included) with a kept cell in X's column whose surface is in `[y − DROP, y + step]`, the highest such, ties to the lowest id, the ground last; airborne with `h = min(y − surface, headroom(cell))` if that is > 0, else walking (the min, as in V2, only trims a drop under a roof). **(2)** Else, if `water(X)` is not null, swimming at SW1's push of X (sailing's ring search, now testing (b) and (c)). **(3)** Else, or if the push finds nothing within its reach, falling at (X, y) with the walker's velocity. (1) lands on a kept cell with `h ∈ [0, headroom]` by the min; (2) is SW1's guarantee; (3): see F1 |
| **W5** | walking / airborne / vaulting → swimming | awash: the feet SUNK under `water` at the feet's world point | Swimming at SW1's push of the feet's plan point. With nowhere to push to, the walker stays where it is (it can stand, and nothing better is near) |
| **W6** | any on s′ → the same, cut | a move whose plan point would enter another moving support s″'s D_r | If s″ has a kept cell under the feet within `[y − DROP, y + step]`: W3 (1) onto it (stepping or jumping across). Else that axis is zeroed (W2). Only shortens a move. Another support moving into a still walker is not covered, as a blocker isn't |
| **SW1** | swimming → swimming | a move | Sailing's push, then (c): the feet go to `surface − depth`, clamped into the free gap of the column's disc (the highest interval top below, the lowest interval bottom above). A move into a column whose gap is shorter than H, or that it can't enter at the feet's height, has that axis zeroed |
| **SW2** | swimming → walking | (c)'s gap holds the feet at its bottom (the ground rises under you: a beach, a slipway) and the ground has a kept cell under p within step of the feet | Walking on that cell (wading out). Hysteresis against W5: the feet are 1.3 under the surface here and must be 1.5 under to swim again |
| **F1** | falling → falling | ballistic under gravity; the plan move cut by (b) and (c) like SW1's | Each step that would break (b) or (c) is cut, axis by axis, and a vertical move that would bring the head into an interval sets `vy` to 0 at the gap's top |
| **F2** | falling → walking / airborne | the feet cross down through a kept cell's surface of any support (the ground included), or the cell rose past them this step by no more than step | Lands on that cell, `h = 0` |
| **F3** | falling → swimming | the feet go below `surface − depth` where `water` answers | As W5 |
| **F4** | falling → walking by P1 | the feet go below fallLimit | Respawn: P1 at a spawn (any support's, by id) or the ground's box middle |
| L1 | swimming → walking | Climb (the ladder's verb) within reach of its foot | At the link's `top`, a kept cell (C1) |
| P1 | any → a valid state | `place(p)`: entering, respawn, resuming under a body | **Over every support**: sailing's projection onto each support's mesh (the cell nearest p in plan at most a step above it and at most 2 m below, a drop deeper than a step costing metre for metre; else none for that support), and the best-scoring cell of all of them, ties to the lowest id, the ground last. With no cell anywhere: swimming if `water(p)` answers, else falling at p. Total. A support with no mesh yet: `waiting` |
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
stand spot: the spot's `at` through its owner's drawn frame, plus BODY.eye
along that frame's up. While it is on top, walk waits: its keys are up, its
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
at a station should still be seen standing at it. Walk can't see the body
over it: `view.body` has `{ id, owner, depth, lock, keys }`. So the sitting
a body answers gains one field, `stands: true` ("its person stands at its
eye"), which the stage copies to `view.body` (router.js, one field; a
scene change, Q1). Under a body that stands, walk keeps publishing its
avatar at P1 of the body's eye lowered by BODY.eye, at the presence rate,
from a light loop that runs only while it is suspended. Under any other
body it withdraws its avatar, as now.

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
  (`walker.test.js`, `navmesh.test.js`, `walker.cases.slow.test.js`);
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
  now pushed over walk, with `stands: true`. Its eye stands at the
  station's `walk.stand`;
- the HUD, the sim and the physics;
- the traits she writes on her parts and template:
  - the hull: `walk.support`;
  - the helm's wheel: `walk.moves { swept: "z" }`;
  - the boom: `walk.moves { blocks: true }`;
  - the sail station's other moving pieces and the anchor:
    `walk.moves {}`;
  - each station: `walk.stand { at, facing }`, at the stand-off
    `walker.standOff` computes today;
  - the ladder: `walk.ladder { top }`;
  - her spawn: `walk.spawn`;
- Come aboard, as `api.body.enter("walk", hull)`;
- reading who is aboard, for the HUD, from walk's `avatar` (`on` is her
  hull) and `view.body` (`id` "walk", or her station);
- the deck geometry that the fixture is exported from.

**The sloop's static checks without a build-time link.** walk can't import
sailing's `ship.js`. A script in sailing exports the stock sloop's baked
triangles and seeds to `walk/src/test/fixtures/deck-12m.json`, a copy, as
CLAUDE.md allows. walk's tests run C1–C9, the bow check and C8 on it, and
sailing's test fails if its export differs from the copy. The camber hull
stays checked in the browser (`probes/camber-run.mjs`), through walk at run
time.

## Verification (what steps 3–5 build)

All finite and named, no random input. Each step of every case runs I.

**Step 3** (walk gets the walker, pure; sailing untouched):
- the 89 enumerated arenas, moved, with the oracle on raw triangles;
- **support over ground**: a 4 × 4 m deck over a ground slab, as pose {still, moved 3 m, heeled 30°, turned
  180°} × side {−X, +X, −Z, +Z} × drop to the ground {0, 0.3, 1 m} ×
  water {none, at the ground's level}. That is 96 walk-offs, each checked
  by I and by the oracle against both supports' triangles. W3 (1)/(2)/(3)
  are each hit, and the table says which, row by row;
- falling: off an OPEN edge with nothing under it, F4 respawns; with a
  second support 1.5 m under the exit, F2 lands on it; with water, F3
  swims;
- pruning: no seeds × a component of area {π r² − one cell, π r²}; and a
  ledge-separated floor with a seed above it, kept by the closure.

**Step 4** (walk's body on supports):
- enter {place, eye over floor, eye over nothing, support id} × {ground,
  moving deck};
- riding {translate, turn, heel} × {standing, walking}: the local state
  bit-identical, the world feet `M · local`;
- rebake {part added, part removed under you};
- presence round trip {ground, support, swimming}: the record drawn
  where the walker stands, to 1e-9;
- blockers: a door box closing across a corridor, and a boom box swinging
  over a cockpit;
- probes: `doom/probes/doom.mjs` (E1M1 walked, its bake time recorded
  against the 500 ms budget, decides tiles), `arena/probes/arena-run.mjs`.

**Step 5** (sailing walks in walk):
- part kind → walk trait, for the stock sloop and a camber hull;
- each station kind: take puts the eye at its stand, leave puts walk at
  P1, to 1e-9;
- sailing's suites and aboard-run; the browser probes the plan lists
  (aboard-run, sailing-run, touch-run, harbour-run and the rest), within the
  probe policy.

**New check C10** (in the probes, not the bake): every baked object's
doc transform stays put while play runs untouched for 2 s. An object whose doc transform changed is
named: it should be a support, a moving part or loose.

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
   would hold you its half-height off the door.
5. **Pruning:** without seeds, keep components of at least π r². And keep
   whatever a jump reaches from what is kept (the closure), so a floor below
   a ledge survives. C3 becomes a report.
6. **W3 generalised:** onto any support within `[y − DROP, y + step]`, then
   water, then falling. DROP = 2 m, which is also P1's "2 m below".
7. **A falling state** in the ground's frame, bounded by (b) and (c), which
   lands, swims or respawns. It replaces "fall to fallLimit through
   whatever the rays missed".
8. **Swimming is in the ground's frame, in ground-owned water only**, and is
   bounded by the ground's raster (c) as well as by the moving supports'
   D_r. Water a moving support carries (a tank aboard) is never swum in.
9. **No station or ladder state.** A station is a body over walk, and walk
   resumes at P1 of its eye lowered by BODY.eye. That one rule also covers
   seats (`seatedEye` goes). The ladder climb is instant, as it always was.
10. **`stands` on a body's sitting** (a one-field scene change) lets walk
    show someone standing at a station. See Q1 for the alternative.
11. **Presence** is `{ on, feet local, yaw, pitch, swimming }`. walk.people
    eases in on's frame and snaps on a change. No old records are honoured
    (the lead's no-back-compat rule).
12. **The sloop's static checks run in walk on an exported fixture**, which
    is a copy, not a link. Sailing checks that its export still matches.
13. **The ground's bake budget is 500 ms.** If E1M1 is over it, the ground
    is tiled as above (Q4).
14. **`__WALK_ASSERT__`** replaces `__SAILING_ASSERT__`.

## Questions for the lead

- **Q1. Who draws someone at a station?** As designed, the station body says
  `stands: true` (a scene field), and walk keeps the avatar at the station's
  eye. The alternative needs no scene change: a body over walk entered at an
  object with `walk.stand` moves walk's walker onto that stand link, and
  leaving resumes there exactly, with no projection. But walk would then
  read the place of another extension's body, which the stage doesn't
  expose either.
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
  second number in the one body?
- **Q5. Up.** Is "a support's up is its object's +Y" acceptable, with an
  upright group for models that aren't? Or should `walk.support` carry an
  `up`?
- **Q6. Floors across docs.** COMPOSITION says "a walker in a linked level
  stands on the host's floor". The bake reads only its own stage's
  objects (rays were the only space that crossed). So walking a linked level
  doesn't stand on the host, and walking a host doesn't stand on a linked
  boat. A boat linked into a harbour is boarded in her own stage, as today.
  Is that acceptable, or should the stage offer a host's triangles near a
  point (a scene change)?
