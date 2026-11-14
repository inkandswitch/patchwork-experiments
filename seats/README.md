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
  A seat's camera is in its doc's root frame; `in` names an object of the
  doc it is given in instead. A game is a doc of its own (scene's
  COMPOSITION.md): linked onto a table aboard, its root is the table. Nothing outside this package reads or writes it. The plugin
  describes it (*Seats*, a map of entries), so the inspector can add, name
  and remove seats.
- **The picker**, over the view at the top right: pick a seat, or watch.
  It follows attention: shown while you sit at this doc's table, else (sitting
  nowhere) while you look at it. A room of linked games shows the picker of
  the one you're at; each game's seats are its own doc's.
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
  §4): sitting in a seat with a camera puts the view there (in the doc's
  root frame, which the stage takes to the world), and its ride (the body's,
  the only one that applies while seated) is the doc's root (or the object
  its camera is `in`) at the spot the seat looks at, tilting: a game linked
  onto a table aboard rolls with the table, and the view with it (the boat
  is how the boat is). It
  reserves no keys (D draws), locks nothing, reaches 2 m, and needs a seat
  (`here: false`: the body chip doesn't offer it). Sitting pushes it over
  whatever body you're in (walking her deck, or Look); standing up, the
  chip's Leave or watching pops it, and that body carries on.
- **"Sat down"**, told to the others (`api.send`, the seat id only).

## Conventions

| | |
|---|---|
| `roster` (contributed here) | `{ seats(scene) → [{ id, name, viewer \| null }], viewers(scene) → viewer[], open(scene) → string[], nameOf(scene, viewer) → string \| null, who(viewer) → string, sitting() → seatId \| null }`. All but `who` and `sitting` are pure in the snapshot (the doc alone: never presence or claims), so an `audience` policy may be built on them. `who` is what to call a viewer now: their contact's name once known, else their seat's, else "Someone". `sitting` is the seat this view is sitting in now: the seat body on top (standing up, walking off from it or watching is not sitting); a machine's port follows it (machine/HOST.md, Phase 2b) |
| `seatPlaces` (collected: whoever gives a seat somewhere to be) | `(scene) → [{ seat, id, min, max }]`: a box in object `id`'s own frame (a hand tray). A name tag goes on each, and a look at one is a look at its seat. Several places may share one object (a machine's ports along its front): a look at that object is at the place it lands in, else at your own among them if you sit at one, else at the nearest (`placeOn`) |
| `lay(d, seats)` (this plugin's module, found by `roster: true`) | writes `{ [seatId]: { name, camera? } }` into a scene doc being set up, empty; a seat already there keeps its player and takes the new name and view. A game is a doc of its own, so its seats are its doc's: a second game is a second doc, with its own `p1` and `p2` |

These are also listed in scene/STAGE.md, "Conventions", with the keepers'.
Where this package isn't loaded there is no roster: a hand is nobody's and
a deck waits for players; the stage offers the package from the scene's
`packages`.

## Files

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/seats.js` | the part: picker, claims and reconciling them with the doc, name tags, the station verb, the roster |
| `src/model.js` | its pure side: the trait, `seatState`, `rosterOf`, `lay`, `seatLookedAt` and `placeOn`, `seatVerb`, `seatTagAt` |
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
