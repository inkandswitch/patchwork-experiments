# tabletop-game v1 — a board game as data

**Status: v1, Patchwork-local.** A board game's components (what each piece
looks like and is) and where everything starts, as one JSON document. It is
what a `tabletop-game` doc holds, what a game this package or any other
ships is (`games/*.json`; dice's `games/liars-dice.json`), and what the TTS
importer translates a Tabletop Simulator save into. Laying a game out on a
table — keeping cards, filling bags, drawing dice, seating people — is this
package's, for every game alike: no game, and no importer, has code of its
own here.

- Structural schema: [contract/v1/schema.json](contract/v1/schema.json)
- Both stages of validation: [contract/v1/validate.js](contract/v1/validate.js)
- Readable types and constants: [contract/v1/types.js](contract/v1/types.js)
- Example: [contract/v1/examples/minimal.json](contract/v1/examples/minimal.json)
- Conformance fixtures: [contract/v1/fixtures/](contract/v1/fixtures/) and their [manifest](contract/v1/fixtures/manifest.json)

The layout is naval's rig contract's (a structural schema, a specification
of the rules it can't express, valid and invalid fixtures each naming the
stage and error code it fails with). Other packages keep copies of
`schema.json` and `validate.js` for their tests (dice, tts-import), since
packages never import each other. One fixture goes the other way:
`valid/tts-tiny-mod.json` is what tts-import translates its tiny fixture mod
into (its tests check the translation still is that file, kept beside its
copies), and this package's tests set it up and play it
(`src/table/imported.test.js`).

## Choices to revisit

Made while the project lead was away (2026-11-12); each is where the lead
might reasonably want it otherwise.

1. **Every card is kept, wherever it lies.** A piece with a `back` is a
   card, and on a table it is always drawn as its back with what it really is
   in a keeper's container — dealt, stacked, spread, loose, face up, in a
   bag. A face-up card is then shown to everyone by the table's rule, not by
   its own look. So any card can go into a hand privately. The cost: a plain
   keeper's container for the game's loose cards, and a keeper needed for
   any game with cards (none installed: nothing is laid out, and the maker is
   told).
2. **A deck lists its cards; a card doesn't name its deck.** The deck seam
   is fixed this way: `hidden`, `deck` and `count` on a card kind are gone; a
   deck is a thing in the setup with `cards: [kind, …]` (top first, repeats
   for copies). One kind can be in several decks.
3. **A deck's cards may have different backs.** Real TTS decks mix
   CustomDecks (Frosthaven does). Which back a card shows is public, as it is
   at a real table. (The old format refused it.)
4. **`secure` stays, as a deck's word**, meaning "nobody, not even whoever
   sets the table up, may know the order or a card they aren't shown". It
   names no keeper; the table asks for one whose players shuffle between them
   and falls back to a plain one, saying so (the template and the game page
   alike: `made-with.js` `tableNotes`).
5. **Containers are titled by the game and the deck** ("Lost Cities: Deck"),
   never by the scene a table is set down in (host-titled decks are gone,
   COMPOSITION.md §11).
6. **A hand is a piece with a `zone`, placed for a `seat`.** The seat moved
   from the piece to the thing, so two players' trays are one kind.
7. **A game with seats starts people in the seat body** (`view.start`,
   scene/TOOLS.md §2), where a press picks a piece up; one without starts
   them in Look (the orbit camera, not the editor). Every built-in game has
   seats.
8. **Pieces drawn by another package are documents.** A die is `doc: { "@patchwork": { type: "die" }, … }`, drawn by whatever `scene:source`
   supports that type; `traits` on a piece say what it does there
   (`dice.die`). The format names another package's datatype and trait only
   as data, the way a scene doc does.
9. **Bags are a convention, as keepers are.** A piece with `bag` holds the
   things its `contents` lists; the table writer hands them to whatever
   `scene:extension` says `container: "bag"` (the bag package's `fill`).
10. **Images are cropped cells, not UV maps**, and are drawn at a size set by
    the slab's longest side (512 px under 10 cm, 1024 under 30 cm, else
    2048), not by the game. A token's outline is `cutout`: the drawer decides
    disc, cut-out or rectangle from the image's alpha.
11. **No `States`, scripts, PDFs or per-thing About.** A TTS object's other
    states are left out (counted in the import's report); a PDF is a blank
    sheet; a game has one `about` text.
12. **Positions are explicit.** A TTS save's positions become the setup as
    they are; a hand-written game may use `count` and `grid`. There is no
    "resting on the table": a thing is where its `at` says.
13. **The doc's bookkeeping is beside the game, not in it**: `drawn` (each
    kind's GLB) and `tables`; the game page's JSON shows only the game.
14. **Dice docs without `faces` are numbered the usual way** (a change to the
    dice package's `dieOf`), so a game or an importer can say `shape: "d6"`.
15. **An imported deck is never `secure`.** At a TTS table anyone can search
    a deck, and a mod's decks are often in an order that matters (a scenario
    deck); a secure deck also waits for every seat to be taken. So the
    importer writes none, and making one secure is the game page's tick on
    that deck. The other way round, every face-down deck secure, is one line
    in tts-import's translate.js.

## 1. Smallest useful document

```json
{
  "format": "tabletop-game",
  "version": 1,
  "title": "Two pawns",
  "about": "A board and two pawns, for nobody's rules.",
  "pieces": {
    "board": { "name": "Board", "parts": [{ "shape": "box", "size": [0.3, 0.01, 0.3], "color": "#c8b38a" }], "locked": true,
               "snapPoints": [{ "position": [-0.05, 0.01, 0] }, { "position": [0.05, 0.01, 0] }] },
    "pawn": { "name": "Pawn", "parts": [{ "shape": "lathe", "profile": [[0, 0], [0.01, 0], [0.006, 0.02], [0, 0.03]], "color": "#3a78d8" }] }
  },
  "setup": [
    { "piece": "board" },
    { "piece": "pawn", "count": 2, "at": { "position": [-0.05, 0.01, 0] }, "grid": { "cols": 2, "across": [0.1, 0, 0], "down": [0, 0, 0] } }
  ]
}
```

## 2. Frame and units

Metres; Y up; right-handed; rotations are Euler XYZ in radians (three.js
order, `R = Rx·Ry·Rz`), the scene's own frame (scene/README.md). A piece is
drawn in its own frame, normally standing on y = 0; a thing's `at` places
that frame on the table, whose top is y = 0. A thing has no scale: a
non-uniform size is baked into its piece's parts.

## 3. The document

| field | | |
|---|---|---|
| `format` | `"tabletop-game"` | |
| `version` | `1` | |
| `title` | string | |
| `about` | string | plain text for the players: what it is, how it's played. Never enforced |
| `players` | string? | shown in lists ("2–4") |
| `pieces` | `{ [kind]: Piece }` | the kinds of thing: what each looks like and is. Kind ids are `[A-Za-z0-9][A-Za-z0-9._-]*` |
| `setup` | `Thing[]` | where everything starts, in the order it's laid out |
| `seats` | `{ [seatId]: { name, camera? } }`? | the places people sit, laid by whoever owns seats |
| `camera` | `{ position, target }`? | a fresh table's view |
| `origin` | object? | where it came from (free form; the TTS importer writes `{ tts: { saveName, fileName, workshopId } }`). A table set up from the game carries it |

## 4. Pieces and looks

```ts
Piece = {
  name: string,
  parts?: Part[],             // drawn from parts…
  doc?: { "@patchwork": { type: string }, … },   // …or as a document of that type, by whatever scene:source draws it
  back?: kind,                // a card: two-sided, kept; on the table it is drawn as this piece
  locked?: boolean,           // fixed in place (a board): never carried
  tags?: string[],            // the tagged snap points its copies fit (a card's are its back's)
  snapPoints?: { position: Vec3, rotation?: Vec3, tags?: string[] }[],
                              // places other pieces snap to, in its frame; a whole `rotation` is the frame a
                              // drawn card lies in there (a domino rack's places stand a tile on edge)
  snapRadius?: number,        // how near a snap point a thing snaps to it (and how far a hand's card slot reaches);
                              // without it the scene guesses from the points' spacing, and one point alone has none
  zone?: { min: Vec3, max: Vec3 },   // a hand, when a thing places it for a seat: a box in its frame, +Z toward the seat
  bag?: { rule: "random" | "random-replace" | "top" },   // a bag: things placed with `contents` go in it
  traits?: { [key]: object }  // traits every copy carries, as the scene documents them (a die's `dice.die`)
}
```

Every part may have `at` (where its base centre goes, default the origin),
`rotation` (about `at`), `color` (`#rrggbb` or `#rrggbbaa`: an alpha makes it
see-through), `roughness`, `metalness`, `name`. The shapes:

| shape | fields | |
|---|---|---|
| `box` | `size: [w, h, d]` | |
| `frustum` | `bottom: [w, d], top: [w, d], height` | a tapering box |
| `lathe` | `profile: [r, y][], segments?` | turned about +Y; normals face the way the profile runs (up the outside, down an inside) |
| `slab` | `outline: rect\|rounded\|hex\|circle\|cutout, size: [w, d], thickness, top?: Image, bottom?: Image, side?` | a card, tile, token or board: the outline extruded from y = 0 to `thickness`. A face with an image shows it as it is; without, `color`. `side` colours the edge. A `cutout` is cut by its top image's alpha (a round one is a disc, an opaque one a rectangle, anything else alpha-masked without sides), and without a bottom image shows its top's on both faces |
| `model` | `file: url, texture?: url, matrix?: number[9]` | an OBJ file doc (its v flipped to glTF's), every point through the row-major 3×3 `matrix` (scale, mirror, units; a mirror re-winds it), tinted by `color` |

`Image = { file: url, rect?: [x, y, w, h], turn?: 0|90|180|270 }`: a file
doc (an image), cropped to `rect` (fractions of the image, top left origin),
turned clockwise on its face by `turn`. **A top image reads from +Z**: its
top edge toward −Z, its left toward −X, seen from above. A bottom image reads
the same once the slab is turned over about its length (Z), as a card is.

A card's look and its back's are the same size. A piece's GLB carries its
snap points as the scene's connectors (`extras.connectors`, and whole frames
under `extras["tabletop.slots"]`) and `extras.snapRadius`.

## 5. The setup

```ts
Thing =
  | { piece: kind, id?, name?, at?: Pose, count?: int ≥ 1, grid?: { cols, across: Vec3, down: Vec3 }, seat?: seatId, contents?: Thing[] }
  | { deck: Deck, id?, at?: Pose }
Pose = { position: Vec3, rotation?: Vec3 }
Deck = {
  name: string,
  cards: kind[],              // top first; repeat a kind for several copies
  faceDown?: boolean,         // turned over about their length (a half turn about Z) where they lie
  shuffle?: boolean,          // shuffled when the table is set up (else as listed)
  secure?: boolean,           // nobody may know the order or a card they aren't shown (§7)
  deal?: { to: thingId, count }[],   // dealt face up onto the snap points of that thing's first copy, top card first
  spread?: { cols, cell }     // laid out face down in a jumble round `at` rather than stacked (a boneyard)
}
```

- `count` copies lie at `at`, the i-th moved by `(i mod cols)·across +
  ⌊i / cols⌋·down` in the thing's own frame. Several copies are a group in
  the scene, named for the thing.
- A stack is made bottom up from `at`, each card its back's thickness above
  the last (its thickest back's).
- `seat` makes the copy that seat's hand (its piece must have a `zone`).
- `contents` is what a bag holds (its piece must have `bag`): pieces and
  decks, laid out into the bag, never the scene; a bag may hold a bag.
- `id` names a thing for a deal.
- A `secure` deck kept by a joint keeper is shuffled by its players once
  every seat is taken, whatever `shuffle` says: its listed order is nobody's
  to know (card-table's first shuffle is of every card). Kept by a plain
  keeper instead, it is laid out as `shuffle` says.

## 6. Seats and camera

`seats` is what whoever owns seats lays (the seats package, found by its
plugin's `roster: true`); nothing here reads who sits where. A seat's
`camera` is its view; the game's `camera` is a fresh table's home view.

## 7. What a table does with it

`src/setup.js` lays any game out (`tableLayout`, pure), then
`table/made-with.js` makes what holds things (`makeHolders`): a container
per deck and one for loose cards, from a keeper found by `keeper: "joint"`
(a `secure` deck, where one is installed) or `"plain"`; then each bag, from
whatever says `container: "bag"`; and `writeTable` writes the scene in one
change, each card bound by its keeper's trait beside a bare
`tabletop.card`, each bag given its document. Shuffle, Draw, Wash, Stand on
edge, private hands and who may see what all act on those traits, never on
any game.

## 8. Laying a game out from another package

The `tabletop` scene:extension's metadata says `tables: "tabletop-game"`;
its module's `setUp(ctx, gameId, { parent?, transform?, view? })` lays a
registered game (a `tabletop:game` plugin, which loads to the game) out in a
drop context's scene. This package's templates and parts use it, and so does
dice's Liar's dice template.

## 9. Rules the schema can't say

Checked by `validate.js`'s semantic stage, once the structure is sound;
each code is one invalid fixture's.

| code | rule |
|---|---|
| `look` | a piece gives exactly one of `parts` and `doc` |
| `unknown-piece` | a thing, a deck's card or a card's back names a piece the game has |
| `card-back` | a card's back is a piece that isn't a card, and not itself |
| `zone-box` | a zone's `min` is below its `max` on every axis |
| `image-rect` | a rect has `w`, `h` > 0 and lies inside its image |
| `cutout` | a `cutout` slab has a top image |
| `lathe-profile` | a lathe's radii are ≥ 0 |
| `bag-card` | a card isn't a bag |
| `duplicate-id` | thing ids are unique |
| `unknown-seat` | a thing's `seat` is one of `seats` |
| `seat-zone` | only a piece with a `zone` is placed for a seat, and never in a bag |
| `contents-bag` | only a bag's thing has `contents` |
| `grid-count` | a `grid` lays out a `count` of 2 or more |
| `deck-card` | a deck lists only cards |
| `unknown-thing` | a deal names a thing of the setup |
| `deal-target` | a deal goes onto a piece on the table, with snap points for every card dealt there |
| `deal-count` | a deck deals no more cards than it has |
| `deal-spread` | a spread deck deals nothing |
| `camera` | a camera's position and target differ |

## 10. A tabletop-game doc

The doc is the game's fields at its top level, with `"@patchwork": { type:
"tabletop-game" }` and two things beside them that aren't the game:
`drawn: { [kind]: { url, key, bounds } }` (each piece's GLB file doc, drawn
by the game page and rewritten in place when the look changes; a GLB drawn
from file docs carries their `origin.urls`) and `tables: url[]` (the scenes
set up from it).
