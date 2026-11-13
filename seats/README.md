# seats

The places people take at a scene, and who sits in them. One
`scene:extension`, `seats`, run wherever a scene has the `seats` trait. It
names nothing that uses it: a table learns whose hand is whose and a
keeper who is playing through conventions (below), and the stage's body
stack takes its seat body as it takes any body, never by this package's
name. The stage knows nothing
of seats either (scene/COMPOSITION.md, decision 5): a scene that seats
people lists this package in its `packages`, like any other.

## What it is

- **The trait**, on the scene: `seats`,
  `{ [seatId]: { name, player: <viewer> | null, camera?: { position, target, in? } } }`.
  `in` is the object the camera is given in (a table aboard a ship); absent,
  the world. Nothing outside this package reads or writes it. The plugin
  describes it (*Seats*, a map of entries), so the inspector can add, name
  and remove seats.
- **The picker**, over the view at the top right: pick a seat, or watch.
  Seats at more than one table (several frames) are grouped by table, each
  group named for the object their views are in (`pickerGroups`).
- **Who sits where is the doc's** (`player`) and lasts. Whether that player
  is here now is a claim on the scene, `seat:<id>` (scene/STAGE.md,
  "Claims"): it lapses when they go, so a seat whose player has gone can be
  taken (after asking), and one whose player is here can't. Claims decide
  who may take a seat, never who sees what.
- **A name tag** on each of a seat's places ("Player 1 · Ana (away)"),
  wherever something contributes places (`seatPlaces`), on the place as
  drawn, following it while it moves.
- **A seat as a station** on the use prompt: walking, a look at a seat's
  place within reach offers *Sit as Player 1* (F); sitting, a look at your
  own offers *Stand up*. The verb says `reach: true`: the stage measures
  reach from the body's eye against its reach (scene/TOOLS.md §4).
- **The seat body** (`src/body.js`), contributed as `bodies` (scene/TOOLS.md
  §4): sitting in a seat with a camera puts the view there, through the
  object the camera is `in` as drawn now, and its ride (the body's, the only
  one that applies while seated) is that object at the spot the seat looks
  at, so the table holds still in front of you however the ship rolls. It
  reserves no keys (D draws), locks nothing, reaches 2 m, and needs a seat
  (`here: false`: the body chip doesn't offer it). Sitting pushes it over
  whatever body you're in (walking her deck, or orbit); standing up, the
  chip's Leave or watching pops it, and that body carries on.
- **"Sat down"**, told to the others (`api.send`, the seat id only).

## Conventions

| | |
|---|---|
| `roster` (contributed here) | `{ seats(scene) → [{ id, name, viewer \| null }], viewers(scene) → viewer[], open(scene) → string[], nameOf(scene, viewer) → string \| null, who(viewer) → string, around(scene, ids) → [{ id, name, viewer \| null }] }`. All but `who` are pure in the snapshot (the doc alone: never presence or claims), so an `audience` policy may be built on them. `around` is the seats at the table these objects are at (a deck's cards): for each, the seats in the nearest frame up its parents that is some seat's (`camera.in`), else those in the world. With one table that is every seat; with several, each its own, so a keeper waits only on its own table's players. `who` is what to call a viewer now: their contact's name once known, else their seat's, else "Someone" |
| `seatPlaces` (collected: whoever gives a seat somewhere to be) | `(scene) → [{ seat, id, min, max }]`: a box in object `id`'s own frame (a hand tray). A name tag goes on each, and a look at one is a look at its seat |
| `lay(d, seats)` (this plugin's module, found by `roster: true`) | writes `{ [seatId]: { name, camera? } }` into a scene doc being set up, empty, and returns `{ [given id]: id written }`. The map is made once; a scene that has seats gets these added: a seat whose camera's frame is gone takes the new view, and an id still at another table is written as `<id>-2`, `-3`… (a second table in one room). Setup code calls it instead of writing seats, and names its hands by the ids it returns |

These are also listed in scene/STAGE.md, "Conventions", with the keepers'.
Where this package isn't loaded there is no roster: a hand is nobody's and
a deck waits for players; the stage offers the package from the scene's
`packages`.

## Files

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/seats.js` | the part: picker, claims and reconciling them with the doc, name tags, the station verb, the roster |
| `src/model.js` | its pure side: the trait, `seatState`, `rosterOf`, `lay`, `seatLookedAt`, `seatVerb`, `seatTagAt` |
| `src/body.js` | the seat body: `seatPose` (pure) and `seatBody(api)` |
| `src/transform.js` | the two matrix operations it needs (a copy of the scene's) |
| `src/test/fake-world.js` | a stand-in stage with several views, claims that lapse, sessions never heard from, crashes without a bye and merges written by hand |

## Tests

`pnpm test`: the part on the fake world (claims, races, two tabs, reloads,
name tags, sitting down from walking and standing up, the view
aboard), its pure side, and the seat body over every kind of seat camera
and frame. In a browser, tabletop's `probes/seats.mjs` (two people, real
presence, a lapse and a takeover) and `probes/stations.mjs` (sitting down
and standing up while walking), and sailing's `probes/aboard-run.mjs`
(seated at a table aboard a moving ship) drive the built package.

```
pnpm install && pnpm build && pnpm test
```
