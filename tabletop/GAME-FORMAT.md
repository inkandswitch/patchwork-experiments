# tabletop-game v2 — a board game as data

**Status: v2, Patchwork-local.** A board game's components (what each piece
looks like and is) and where everything starts, as one JSON document. It is
what a `tabletop-game` doc holds, what a game this package or any other
ships is (`games/*.json`; dice's `games/liars-dice.json`), and what the TTS
importer translates a Tabletop Simulator save into. Laying a game out on a
table — keeping cards, filling bags, drawing dice, seating people — is this
package's, for every game alike: no game, and no importer, has code of its
own here.

- Structural schema: [contract/v2/schema.json](contract/v2/schema.json)
- Both stages of validation: [contract/v2/validate.js](contract/v2/validate.js)
- Readable types and constants: [contract/v2/types.js](contract/v2/types.js)
- Example: [contract/v2/examples/minimal.json](contract/v2/examples/minimal.json)
- Conformance fixtures: [contract/v2/fixtures/](contract/v2/fixtures/) and their [manifest](contract/v2/fixtures/manifest.json)

The layout is naval's rig contract's (a structural schema, a specification
of the rules it can't express, valid and invalid fixtures each naming the
stage and error code it fails with). Liar's dice and every game the TTS
importer makes are checked against it too. `valid/tts-tiny-mod.json` is
what the importer translates its tiny fixture mod (`fixtures/tiny-mod`)
into (`src/tts/importer.test.js` checks the translation still is that
file), and `src/table/imported.test.js` sets it up and plays it.

## Choices to revisit

Made while the project lead was away (2026-11-12); each is where the lead
might reasonably want it otherwise.

1. **Every card is kept, wherever it lies.** A piece with a `back` is a
   card, and on a table it is always drawn as its back with what it really is
   in a keeper's container — dealt, stacked, spread, loose, face up, in a
   bag. A face-up card is then shown to everyone by the table's rule, not by
   its own look. So any card can go into a hand privately. The cost: a plain
   keeper's container for the game's loose cards.
2. **A deck lists its cards; a card doesn't name its deck.** The deck seam
   is fixed this way: `hidden`, `deck` and `count` on a card kind are gone; a
   deck is a thing in the setup with `cards: [kind, …]` (top first, repeats
   for copies). One kind can be in several decks.
3. **A deck's cards may have different backs.** Real TTS decks mix
   CustomDecks (Frosthaven does). Which back a card shows is public, as it is
   at a real table. (The old format refused it.)
4. **`secure` stays, as a deck's word**, meaning "nobody, not even whoever
   sets the table up, may know the order or a card they aren't shown". It
   names no keeper; the table gives it to the one whose players shuffle
   between them (`made-with.js` `prepareTable`).
5. **Containers are titled by the game and the deck** ("Lost Cities: Deck"),
   never by the scene a table is set down in (host-titled decks are gone,
   HISTORY.md).
6. **A hand is a piece with a `zone`, placed for a `seat`.** The seat moved
   from the piece to the thing, so two players' trays are one kind.
7. **A game with seats starts people in the seat body** (`view.start`,
   scene/STAGE.md, "Arriving"), where a press picks a piece up; one without starts
   them in Look (the orbit camera, not the editor). Every built-in game has
   seats.
8. **Pieces drawn from a document are documents.** A die is `doc: { "@patchwork": { type: "die" }, … }`, drawn by whatever `scene:source`
   supports that type (here, `src/dice/`'s); `traits` on a piece say what it
   does there (`dice.die`). The format names a datatype and a trait only as
   data, the way a scene doc does.
9. **Bags hold things out of the scene.** A piece with `bag` holds the
   things its `contents` lists; the table writer puts them in a bag
   document (`src/bag/fill.js`).
10. **Images are cropped cells, not UV maps**, and are drawn at a size set by
    the slab's longest side (512 px under 10 cm, 1024 under 30 cm, else
    2048), not by the game. A token's outline is `cutout`: the drawer decides
    disc, cut-out or rectangle from the image's alpha.
11. **No scripts, PDFs or per-thing About.** A PDF is a blank sheet; a
    game has one `about` text. (A TTS object's other States come across as
    its piece's `states`, choice 23.)
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
16. **Assets are named where they are, and cached in the game.** A part's
    image or model is a file doc's `automerge:` URL or the web's `http(s)`
    one (a TTS mod's own); the first viewer who draws something from a web
    asset fetches it and caches it in a file doc the game's `assets` names
    under that URL, so the game, and every copy of it, has it from then on
    (§10). A host that refuses a page's fetch (no CORS) leaves what uses it
    drawn without it. v2 for this: a v1 reader can't fetch.
17. **A slab can be as wide as its picture** (`aspect: "image"`), as a TTS
    tile or token is: the importer reads no image, so it can't say how wide.
18. **A game's ways of being set up are its recipe's options** (2026-11-18,
    replacing that morning's `variants`: one mechanism, not two). Options
    combine (players × expansion), and one setup holds every thing any table
    of it can lay, which a recipe takes from, moves and adds kits to, so
    every table draws from one set of pieces and one `assets` cache. Draw
    Dominoes is one setup with a `players` option.
19. **A condition is one comparison on an option** (`"players >= 3"`, a bare
    boolean option), a step's `when` and `unless` together at most two.
    Anything past that is a scripted step, later; none is built.
20. **Start steps are resolved when the table is laid out** (`setup.js`
    `startPlan`): which objects a shuffle mixes and where each dealt card
    goes are worked out from the game, so they're pure and tested without a
    stage; Start game only asks the keeper to shuffle and writes the moves.
    What a dealt card *is* stays its keeper's. Start runs whatever has moved
    since (it lays the game out as the recipe says).
21. **Who goes first is drawn by lots** (`src/dice/lots.js`, open to all,
    between the seated players' clients, as a die's roll is): nobody chooses
    it, whoever presses Start included. Where lots aren't running, a start
    that chooses who goes first waits for them. A shuffle is its keeper's:
    the joint keeper's is fair by construction (every player takes part);
    the plain keeper's is trust-the-dealer by design (anyone may read its
    container, so whoever presses Start shuffles, as at a real table).
22. **Lost Cities' deal stays a deck's `deal`** (laid out with the table,
    the joint keeper settling which card is which at its first shuffle):
    it was never dealt by code. Moving it to a start step would mean every
    Lost Cities table waits for Start to be pressed before its hands fill
    (five probes assume they're dealt at setup); the lead's call.
23. **A piece may have other looks, its `states`** (2026-11-18), as a TTS
    object has States (Arcs's damaged ships, a board's look for three).
    They are public: anyone at the table may turn a piece to another state,
    for everyone, as an ordinary write; the doc says which state each
    thing shows, as it says which piece it is. A card has none, nor does a
    card's back (what a card shows is its keeper's), so a state never
    shows what's hidden. Which state a thing shows is play: a copy (a
    forked session) shows the look it was laid out in. Two people turning
    one piece at once: the last write wins, and both see it.

## 1. Smallest useful document

```json
{
  "format": "tabletop-game",
  "version": 2,
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
| `version` | `2` | |
| `title` | string | |
| `about` | string | plain text for the players: what it is, how it's played. Never enforced |
| `players` | string? | shown in lists ("2–4") |
| `pieces` | `{ [kind]: Piece }` | the kinds of thing: what each looks like and is. Kind ids are `[A-Za-z0-9][A-Za-z0-9._-]*` |
| `setup` | `Thing[]` | where everything starts, in the order it's laid out |
| `seats` | `{ [seatId]: { name, camera? } }`? | the places people sit, laid by whoever owns seats |
| `camera` | `{ position, target }`? | a fresh table's view |
| `origin` | object? | where it came from (free form; the TTS importer writes `{ tts: { saveName, fileName, workshopId } }`). A table set up from the game carries it |
| `assets` | `{ [webUrl]: { file } }`? | where a web asset is cached: the file doc (`automerge:`) holding what its `http(s)` URL gave. Written by whoever first draws from it (§10), or the importer for what came with a mod |
| `recipe` | `Recipe`? | how the setup is adapted to the options a new game is given, and started (§6) |

## 4. Pieces and looks

```ts
Piece = {
  name: string,
  parts?: Part[],             // drawn from parts…
  doc?: { "@patchwork": { type: string }, … },   // …or as a document of that type, by whatever scene:source draws it
  states?: { name: string, parts?: Part[], doc?: {…}, snapPoints?: […] }[],
                              // other looks it can be turned to (§4, "States"); its own is called by its `name`
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
| `slab` | `outline: rect\|rounded\|hex\|circle\|cutout, size: [w, d], thickness, aspect?: "image", top?: Image, bottom?: Image, side?` | a card, tile, token or board: the outline extruded from y = 0 to `thickness`. A face with an image shows it as it is; without, `color`. `side` colours the edge. A `cutout` is cut by its top image's alpha (a round one is a disc, an opaque one a rectangle, anything else alpha-masked without sides), and without a bottom image shows its top's on both faces. With `aspect: "image"` it is as wide as its top image (its cell, as turned) says: `size[0]` is its width for a square one, and its width while the image can't be had |
| `model` | `file: url, texture?: url, matrix?: number[9]` | an OBJ (its v flipped to glTF's), every point through the row-major 3×3 `matrix` (scale, mirror, units; a mirror re-winds it), tinted by `color` |

A `url` is a file doc's (`automerge:`) or the web's (`http(s)`, fetched
when first drawn from and cached through `assets`, §3).
`Image = { file: url, rect?: [x, y, w, h], turn?: 0|90|180|270 }`: an
image, cropped to `rect` (fractions of the image, top left origin),
turned clockwise on its face by `turn`. **A top image reads from +Z**: its
top edge toward −Z, its left toward −X, seen from above. A bottom image reads
the same once the slab is turned over about its length (Z), as a card is.

**States.** A piece's `states` are other looks it can show, each named, and
drawn as the piece's own is (its `parts` or `doc`, exactly one), with its own
snap points or else the piece's. The piece's own look is called by its
`name`; no two of its looks share a name. A thing shows its piece's own look
unless its `state` names another (§5), and at a table anyone can turn it to
any of them (§7). A card, and a card's back, has none.

A card's look and its back's are the same size. A piece's GLB carries its
snap points as the scene's connectors (`extras.connectors`, each with its
whole frame, which the scene keeps) and `extras.snapRadius`.

## 5. The setup

```ts
Thing =
  | { piece: kind, id?, name?, tags?: id[], at?: Pose, state?: name, count?: int ≥ 1, grid?: { cols, across: Vec3, down: Vec3 }, seat?: seatId, contents?: Thing[] }
  | { deck: Deck, id?, tags?: id[], at?: Pose }
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
- `state` is the look its copies are laid out showing: its piece's own
  (its name) or one of its `states`.
- `contents` is what a bag holds (its piece must have `bag`): pieces and
  decks, laid out into the bag, never the scene; a bag may hold a bag.
- `id` names a thing for a deal, and for a recipe's steps; `tags` are what
  a recipe takes things away by (never a snap point's tags: those are a
  piece's).
- A `secure` deck's listed order is nobody's to know, so a joint keeper
  shuffles every card of it, whatever `shuffle` says (§7). Kept by a plain
  keeper instead (choice 4's fallback), it is laid out as `shuffle` says.

## 6. Seats, camera and the recipe

`seats` is what whoever owns seats lays (the seats package, found by its
plugin's `roster: true`); nothing here reads who sits where. A seat's
`camera` is its view; the game's `camera` is a fresh table's home view. A
seat's `at` is its area: where a kit is laid for it, +Z toward its player.

The **recipe** says how the setup is adapted to the options a new game is
given (how many play, which expansion), and what Start game does once
every seat is taken. It's data: `contract/v2/recipe.js` lays it out
(`applyRecipe(game, values)`, pure), the validator checks every way its
options can be set, laid out, and the setup holds every thing any table of
it can lay.

```ts
Recipe = { options?: Option[], spots?: { [name]: Pose }, layout?: LayoutStep[], start?: StartStep[] }
Option =
  | { kind: "integer", key, label, min, max, default }
  | { kind: "enum", key, label, options: { value: string | int, label }[], default }
  | { kind: "boolean", key, label, default }
Step = { when?: Condition, unless?: Condition } & …    // applies when `when` holds and `unless` doesn't
Condition = "<option>" | "<option> <op> <value>"       // op: == != < <= > >= (an order only on an integer)
At = Pose | spotName
LayoutStep =
  | { remove: { id } | { tag } | { seat } }   // take things away (a seat: with its hands)
  | { place: { [thingId]: At | { state, at?: At } } }   // these things here (out of their bag, if in one), or showing that state
  | { seats: { [seatId]: At } }              // move seats' areas, and what's theirs (hands, camera), rigidly
  | { kit: Thing[] }                         // at each seat's area, once every other step has run
StartStep =
  | { shuffle: deckId }                      // its cards, mixed by their keeper
  | { deal: deckId, count }                  // count into each seat's hands, a card to each card slot
  | { draw: deckId, count, to: thingId }     // count face up onto that thing's snap points
  | { first: true }                          // who goes first: one of the seats, by lots
```

- **Options** are what the launcher's New game and the game page's Set up
  a table ask (a picker each; a checkbox for a boolean), the default where
  nothing's chosen. A template's params are its game's options. A session
  is named for them ("Draw Dominoes (3 players), …").
- **Layout** runs in order when a table is made, from the game and the
  values alone, so nothing hidden is in it: `remove` by thing id, tag
  (every thing so tagged, contents too) or seat (and every thing placed
  for it); `place` lays a thing at a pose or a named spot, taking it out of
  a bag if it's in one (a TTS memory bag's layout), or turns it to one of
  its piece's states, where it is unless an `at` goes with it (a board's
  look for three); `seats` moves a seat's
  area to a pose or spot, its hands and camera with it; then each `kit` is
  laid at every seat's area, in the seat's frame: its ids become
  `<id>.<seat>`, `{seat}` in a name the seat's name, and a piece with a
  `zone` that seat's hand.
- **Start** steps are what Start game does (`src/table/start.js`), a verb
  on the table's bar of tools, enabled once every seat is taken; once
  started it says so, and does nothing again. They involve hidden
  information, so they go through the keepers: a shuffle asks the cards'
  keeper; a deal takes the deck's top cards into each seat's hands' card
  slots (slots with tags that take the cards, as Draw's), seat by seat; a
  draw takes them face up onto a thing's snap points. A deck is the game's,
  or, where a kit has one, each seat's own (`<deckId>.<seat>`). Choosing
  k of n at random is a shuffle then a draw of k. They are resolved to the
  table's objects when it is laid out (choice 20) and written into the
  scene's trait `tabletop.start`.
- `applyRecipe` gives the game as laid out: its setup and seats as the
  steps leave them, no options, spots or layout, and `recipe: { start }`
  with the start steps that apply, unconditional.

The TTS importer writes a recipe where a mod's data says one (README.md,
"Importing a TTS mod"): how many play, from its hands; each memory bag's
layout, as `place` steps; shuffling its face-down decks at the start.

## 7. What a table does with it

`src/setup.js` lays any game out (`tableLayout`, pure), then
`table/made-with.js` makes what holds things and finds who seats people
(`prepareTable`): a container per deck and one for loose cards, from a
keeper: the joint one for a `secure` deck (its players shuffle every card
of it once every seat is taken, as its first shuffle does,
`src/keep/deck.js`), else the plain one; then each bag
(`src/bag/fill.js`); then whoever owns seats (`roster: true`), with what
the maker is to be warned of; and
`writeTable` writes the scene in one change, each card bound by its keeper's trait beside a bare
`tabletop.card`, each bag given its document, and the recipe's start steps
as they apply to this table's objects (the scene trait `tabletop.start`,
§6). Shuffle, Draw, Wash, Stand on edge, Start game, private hands and who
may see what all act on those traits, never on any game. A game with a
recipe is laid out as `applyRecipe` gives it first.

## 8. Laying a game out in a scene

`src/table/template.js` `setUp(ctx, gameId)` lays a registered game (a
`tabletop:game` plugin, which loads to the game) out in a drop context's
scene. Every template and game part here uses it, Liar's dice's too.

## 9. Rules the schema can't say

Checked by `validate.js`'s semantic stage, once the structure is sound;
each code is one invalid fixture's.

| code | rule |
|---|---|
| `look` | a piece gives exactly one of `parts` and `doc`, and so does each of its states |
| `state-name` | a piece's states are named, each name its own and none the piece's |
| `state-card` | a card, or a card's back, has no states |
| `unknown-state` | a thing's `state`, or a place step's, is a look of its piece (its name, or one of its states'): never a deck's |
| `unknown-piece` | a thing, a deck's card or a card's back names a piece the game has |
| `card-back` | a card's back is a piece that isn't a card, and not itself |
| `zone-box` | a zone's `min` is below its `max` on every axis |
| `image-rect` | a rect has `w`, `h` > 0 and lies inside its image |
| `cutout` | a `cutout` slab has a top image |
| `aspect` | a slab as wide as its image has a top image |
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
| `option` | an option's key is its own, its values its own, an integer's range not empty, its default one of its values |
| `condition` | a condition is one comparison on an option, with one of its values; an order only on an integer |
| `options-many` | the options can be set at most 512 ways (each is laid out and checked), and laying every one out costs at most 20 million things' worth (`layoutCost`: the setup's things, cards and seats per step, and the game's size) |
| `unknown-tag` | a step takes away by a tag some thing has |
| `unknown-spot` | a step's spot is one of the recipe's |
| `seat-area` | a seat that moves, or a game with a kit, has every seat's area (`at`) |
| `start-deck` | a start step's deck is a deck on the table (the game's, or each seat's from its kit) |
| `deal-hand` | a deal fits every seat's hands' card slots |

A recipe's layout steps name a thing (`unknown-thing`) and a seat
(`unknown-seat`) the game has; its start steps take no more cards from a
deck than it has (`deal-count`), and a draw fits its target
(`deal-target`). With a recipe, every way its options can be set is laid
out and held to every rule above; an error the game itself has is said
once, as the game's, and any other names the values ("laid out with
players = 2").

## 10. A tabletop-game doc

The doc is the game's fields at its top level, with `"@patchwork": { type:
"tabletop-game" }` and two things beside them that aren't the game:
`drawn: { [kind]: { url, key, bounds, missing? } }` and `tables: url[]`
(the scenes set up from it).

`drawn` holds each piece's GLB file doc, drawn the first time something
needs it (`src/pieces.js`) and rewritten in place when its look changes;
a GLB drawn from files carries their `origin.urls`, and `missing` lists the
files it had to do without (tried again when next needed, after a while).
Setting up a table draws what it lays out (its things, a card's back,
what's in its bags); a card's face is drawn when a keeper first shows it
to someone, with every card it may share a container with (its deck's, or
the loose cards, in the setup or a recipe's kit) and every card cut from the same sheets, closed over both,
made and recorded in kind order in one change, so `drawn` and `assets` say
which containers' cards have been seen, never which card. Only
a viewer who can write the game writes `drawn` or `assets`; two writing one
entry at once each write theirs only where nothing is yet, and the merge
keeps one.
