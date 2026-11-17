# walk

The walk body for scenes (scene/TOOLS.md §4): first person on whatever the
scene is made of, contributed to the stage's body stack as `bodies: [walk]`.
Built only from the scene's extension contract (scene/STAGE.md).

| | | |
|---|---|---|
| `scene:extension` | `walk` | general: the walk body, which says where its walker stands (`avatar`) on the channel of the doc it walks in, and stands it at a stand spot for a body going over it (`stand(id)`: a station's eye is that walker's) |
| `scene:extension` | `walk.people` | a part of every doc (`traits: ["*"]`): everyone else who walks, drawn where `walk`'s `avatar` says, in every stage whatever the focus |
| `scene:extension` | `walk.spawn` | the part of walk's traits (below): a doc that carries one calls for this package by it (and lists it, as a `view.start` of `{ body: "walk", place: <a spawn point> }` needs); its verbs are Walk from here (menu, on a spawn point) and Climb (F, on a ladder, while you swim within 2 m of its foot) |
| trait | `walk.spawn` | on an object: where people start walking, facing the way it faces (`{}`); on an object with a `walk.stand`, at that stand spot. Written by whatever lays a level out: arena's spawn pad part, doom's layout through it, sailing's wheel |
| trait | `walk.support` | on an object: something you stand on that moves (a deck, a lift), walked in its own drawn frame, everything under it baked with it (`{}`) |
| trait | `walk.moves` | on an object: a moving part, never baked as drawn: `{ swept: "x"\|"y"\|"z" }` (the solid its turn sweeps), `{ blocks: true }` (an obstacle where it's drawn each frame: doom's doors) or `{}` (people pass through it) |
| trait | `walk.stand` | on an object: `{ at, facing?, claim? }` in its own frame, where someone stands to use it; whoever holds the object's `claim` is drawn standing there |
| trait | `walk.ladder` | on an object: `{ top }` in its own frame, the climb out of the water onto its owner |

How it stands: [DESIGN.md](DESIGN.md), "Standing on supports", and under it
"Foundations" (the mesh, B1–B7, the transitions and the cases, moved from
sailing's DESIGN). One walker, the navmesh walker, on any support, the
ground included; sailing walks her deck in it (N10). `pnpm test` runs
everything, the walker's enumerated cases and the stock sloop's static
checks (`deck-12m.test.js`, over a copy of her bake input) included.

## The body

- **id** `walk`, **label** Walk. It declares the walking keys (W A S D, the
  arrows, Shift to run, Space to jump), so every other key goes on to the key
  map, and a verb whose key it takes shows without one (walking, Draw is a
  button, not D). It asks for pointer lock and reaches **2 m**.
- **Where it starts** (`startOf`, pure): at the place it's given (a support:
  its spawn; a stand spot: P1 at its `at`, facing its `facing`; any other
  object, a spawn point: P1 at it, facing its way), else on the floor under
  the eye within 10 m, else at a spawn point, else where the walker
  respawns. Until every support's first mesh has landed it waits: no camera
  move, no avatar. A model still coming holds its support's bake back; a
  link, a model that failed and an object with no model don't (the stage's
  own rule for what has loaded). A support over 5M columns (E1M1's ground
  is 4.2M) is not baked until tiles land: walk says so once and waits.
- **Its floor is a navmesh per support** (DESIGN.md): the ground (the
  stage's frame, everything no support owns) and each `walk.support`, each
  baked from its objects' GLBs at their rest pose, placed by the doc's
  transforms (`supports.js`, the input adapter), kept for the page by a
  key while some support uses it, and rebaked off the frame loop when the
  key changes, the old mesh in use until the new one lands (then the
  walker is projected onto it: R1).
  The walker (`walker.js`, pure) keeps the person on a kept cell of the
  support they stand on, in its frame: the world pose is that support's
  drawn frame times the local feet, never fed back, so standing still on a
  moving deck leaves the local feet exactly as they were. Off an open edge
  it steps onto another support within 2 m below, swims in the stage's
  water (`water`'s contribution, every support's own water left out), or
  falls. A `walk.moves { blocks }` part (a door) blocks where it's drawn
  each frame, as a box in the walker's support's frame. The drawn eye eases
  across a STEP (`easeEye`); only the camera lags.
- **Presses**: without the lock a drag looks round and a tap goes on as a
  click (walking has no default press); under it a press is nothing of the
  body's, so the held tool and the holders down the chain have it.
- **On touch** there is no lock: the stage's touch pad (scene's
  `scene.touch`) shows the walking keys from their labels (Forward, Back,
  Left, Right on the pad; Run and Jump as buttons), and a finger dragging on
  the world looks round, at the same time. The look is the eye's, as under
  lock (scene/TOOLS.md Decisions 14): the use prompt sits in the middle of
  the view, and a tap on its button uses what you look at; a held verb
  ("hold F") lasts as long as the finger is on its button (scene/TOOLS.md
  Decisions 15).
- **Under another body** (a seat): it waits, its keys up and the camera let
  go; when that body goes, it walks on from the eye.
- **Presence**: `avatar` `{ on, feet, yaw, pitch, swimming }` at 20 Hz while
  walking (withdrawn under another body): `on` the support (null: the
  ground, as when swimming or falling), `feet` and `yaw` in its frame, at
  full precision. walk.people draws everyone else's in that support's drawn
  frame each frame, eased in the record's frame and snapped when `on`
  changes, named from their contact docs.

## Files

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/extension.js` | the extension: the body over the input adapter |
| `src/body.js` | the walk body: `walkBody(api)`, and its pure parts `startOf`, `floorUnder`, `avatarOf`, `aimOf` |
| `src/supports.js` | the input adapter: supports, what each bakes (`bakedObjects`, `trianglesOf`, `seedsOf`), `bakeKey`, the page's meshes, blockers, water |
| `src/people.js` | walk.people: the others, drawn in their support's frame (`ease`, `placeOf`) |
| `src/spawn.js` | walk's traits' part: Walk from here, Climb |
| `src/walker.js`, `src/navmesh.js`, `src/navcheck.js` | the walker, its bake and its checks (pure) |
| `src/walk.js` | the body's numbers (`BODY`, `SWIM`), the keys' wish, the look, `easeEye` |
| `src/test/stage.js`, `src/test/arena.js` | a stand-in stage; the walker's test arenas |

## Tests

`pnpm test`: the walker's tables (`walker*.test.js`, `navmesh.test.js`), and
the body on a stand-in stage (`body.test.js`): where it enters (place {spawn
point, eye over a floor, eye over nothing, a support} × world {ground only, a
moving deck}), riding a deck that {translates, turns 90°, heels 30°} ×
{standing, walking} (the local feet the still deck's, to the bit), a rebake
under you {a part added, the floor removed} (P1), waiting for the first
meshes, a seat, a stand spot, an eye held low, presence while jumping on a
deck, coming back on a turned deck, a support at scale 2, the eye easing up
a STEP. `supports.test.js`: what each support bakes (a swept part round
its hub), the key (every kind of seed), what holds a bake back {a link, a
failed model, no provider, no model, loading}, the column cap, the meshes
kept, the blockers (a door shut and open; hidden or carried ones don't),
water and the ladder's Climb (in its own doc). `extension.test.js`: the
people part, the avatar's ease and snap, and the presence round trip
{ground, support, swimming} drawn to 1e-9. In a browser, doom's `probes/doom.mjs`
walks E1M1 and arena's `probes/arena-run.mjs` the arena.

```
pnpm install && pnpm build && pnpm test
```
