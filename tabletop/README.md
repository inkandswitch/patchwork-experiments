# tabletop

Board games as documents. A **tabletop game** says what its pieces look like,
how many of each there are and where they start. **Set up a table** lays them
all out in a new [scene](../scene/README.md) and opens it in the scene's
**hand**, where everyone with the scene open can carry pieces around: they snap
to the board's spaces and stack on whatever is already there. Rules are a
description for the players, not enforced.

Make a Tabletop game and pick one to start from, or start an empty scene
from **Lost Cities**, **Santorini** or **Draw Dominoes** on its start screen
(Templates, below):

- **Santorini** (Gordon Hamilton): an island board of 5×5 spaces, 22 / 18 / 14
  building levels, 18 domes, and two workers each for three players.
  Everything is in plain sight.
- **Lost Cities** (Reiner Knizia): 60 cards in five expeditions, a board with a
  discard pile for each, and a hand tray for each of two players. The deck is
  shuffled face down and dealt, 8 to each tray; pick your seat in the scene and
  only you see your hand's faces. Cards are drawn with boxes (seven-segment
  numbers), no textures.
- **Draw Dominoes** (the traditional double-six draw game, for 2, 3 or 4;
  the block game is the same set without drawing): the 28 tiles of a
  double-six set, 50 × 25 × 9.5 mm, face down on a felt (the boneyard), and
  a rack for each player where a tile stands on edge facing them: they see
  its face, everyone else its back (as one stood up on the table in front of
  them does: U, playing without a rack). Wash the boneyard (W), draw from it
  (D) as often as you like, lay a tile flat (U) and carry it into the line face
  up, Q / E to turn it (a double crosswise; the line turns at the felt's
  edge by hand), and at the end lay your hand face up for everyone
  (right-click). Nothing deals: 7 tiles each, or 6 with four, is the
  players' to draw. The art (ivory tiles, black pips, a bar with a brass
  spinner, a plain back) is drawn here from boxes and discs.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `tabletop-game` | a game (listed) |
| `patchwork:tool` | `tabletop-game` | its page: about, pieces, set up a table, the tables set up so far, the definition as JSON |
| `tabletop:game` | `santorini`, `lost-cities`, `draw-dominoes-2`, `-3`, `-4` | games an empty tabletop-game can start from |
| `scene:template` | `tabletop.lost-cities`, `tabletop.santorini`, `tabletop.dominoes-2`, `-3`, `-4` | an empty scene's start screen: the game's table, laid out in that scene with its own art (Templates, below) |
| `scene:extension` | `tabletop` | what a table's pieces do: hands (private zones), cards, Shuffle, Draw, Wash, Stand on edge / Lay flat, Lay my hand face up (Tables, below) |
| `scene:extension` | `tabletop.rule` | who may see what at a table, as the stage's `audience` policy: hands and face-up cards (Tables, below) |
| `scene:part` | `tabletop.pawn`, `tabletop.token`, `tabletop.card-spot`, `tabletop.table`, `tabletop.lost-cities`, `tabletop.dominoes-2`, `-3`, `-4` | the editor's parts bin, under "Tabletop" (Parts, below) |

It registers no plugin type for decks and no deck datatype. Two things at a
table are other packages', met only through the stage (scene/STAGE.md,
"Conventions"): **seats** (the scene's own `scene.seats` part: the picker,
who sits where) and **what a hidden card really is** (a *keeper*: `keep`'s
plain one, `card-table`'s joint one). This package names neither.

## Adding a game

A game is a `tabletop:game` plugin, from this package or any other:

```js
{
  type: "tabletop:game",
  id: "my-game",                    // globally unique
  name: "My Game",
  icon: "Dices",                    // lucide name
  players: "2–4",                   // shown in the list
  blurb: "One line about it.",
  async load() { return await import("./my-game.js") },   // a module with fill(doc)
}
```

`fill(doc)` runs inside a change on an empty tabletop-game and writes it: title,
about, pieces, order, and seats / decks / camera if it has them (below). The
game page lists every registered game; once filled, the doc is the game, and
nothing goes back to the plugin — editing the pieces edits this copy only.

So a game is data, and everything a table does with it — drawing pieces,
dealing, shuffling, hands — is generic, and none of it knows a rule, a turn
or a legal move: pieces behave like physical ones. A new game needs no new
code here, unless its pieces need a shape the parts can't make.

It does not depend on the scene package. It writes `scene` docs and `file`
docs in the shapes the scene documents, and opens the result with the `scene`
tool by id. Without the scene installed the tables are just documents.

## How it fits the scene

- Each kind of piece is drawn once, as a GLB `file` doc. Every copy of it is
  a **passthrough** object showing that doc (provider `file-glb`, no render
  doc). Whose doc it is depends on how the table was made:
  - **set up from the game page**: the game keeps it (`glbUrl`), and every
    table set up from that game shares it. The game page redraws a kind's GLB
    in place when its parts change, so tables already set up change with it.
  - **started from a template**: the scene keeps it (`doc.assets`, by
    `ctx.file`; scene/STAGE.md, "Parts"), under a key that names the game,
    the kind and a hash of what it is drawn from
    (`tabletop/lost-cities/back@1a2b3c4d`). There is no game doc, so the table
    stands alone, and new art gets a new key: a table made with the old keeps
    its own.
- A board's spaces are **connectors** in its GLB (`extras.connectors`, see the
  scene's GLB conventions), made from the piece's `snapPoints`. The scene's hand does the snapping and stacking;
  nothing here is specific to Santorini.
- The board is set up **locked**, so dragging it orbits instead.
- On a table set up from the game page, each copy's About (`infoUrl`) is the
  game, so selecting a piece in the scene shows the rules. A template's table
  has no game doc, and no About.
- Hands (private zones) and cards are this package's own, added to the scene
  by its scene extensions (Tables, below); the scene doesn't know about them.
- **Hidden pieces** (cards): in the scene each one is its `back` piece, called
  by the back's name, with the trait `tabletop.card`; which card it really is
  goes only into a keeper's container, and the card carries that keeper's
  own trait naming its slot there. Cards are created in deck order and
  grouped by deck, not by kind, so ids, groups and order say nothing. A
  seat's hand tray is a piece with a `zone`, and becomes a hand in the scene.
  An ordinary deck goes to a plain keeper (its container readable by anyone
  who opens it); a `secure` deck to a joint keeper where one is installed
  (the seated players' clients shuffle it between them once every seat is
  taken, so nobody knows the order). Lost Cities' is secure; the game page
  has a toggle.

## Tables

A table is a scene with this package's traits on it, which its scene
extensions (`src/table/extension.js`, `src/table/rule.js`) understand. The
scene itself knows none of this (scene/README, "Extensions"), and a scene
without the tabletop package installed shows a table's cards as their backs
and nothing else.

| trait | on | |
|---|---|---|
| `tabletop.zone` | an object | `{ seat, min: [x,y,z], max: [x,y,z] }`: a **hand**, a seat's private area: a box in the object's own frame, whose +Z points toward its seat (where a tile stood in it faces). `seat` is a seat's id, as whoever owns seats names it |
| `tabletop.card` | an object | `{}`: a **card**, or a **tile** (a domino): two-sided (face up outside every hand it is shown to everyone), and in a pile it can be shuffled and drawn, spread out face down it can be washed. What it really is, is its keeper's |

**Copies.** The scene copies objects between scenes (and duplicates them in
one); the traits' descriptions say what a copy takes (scene/STAGE.md,
"Copying objects"). A copied card is still a card, but its keeper's binding
is left behind (the keeper's trait is `runtime`): it's a bare back nothing
keeps, and the scene it lands in is never set to reading (or, for a joint
keeper, shuffling) another table's deck. A copied hand keeps its seat's id.

**Who may see what** (`src/table/visibility.js`, contributed as the stage's
`audience` by `tabletop.rule`; scene/STAGE.md, "Audience"). Two physical
things:

| | the policy's answer |
|---|---|
| anything lying in a **hand** (its origin is), whichever way up | `{ show: [player], only: [player] }`: turned toward whoever sits in that seat, screened from everyone else. A hand nobody sits at: `{ show: [], only: [] }` |
| a **card standing on edge** outside every hand, its face toward a hand | as if it were in that hand: `{ show: [player], only: [player] }` (nobody sat there: `{ show: [], only: [] }`) |
| a **card** lying **face up** outside every hand (or standing, its face toward no hand, and turned up at all) | `{ show: "all" }` |
| a card face down outside every hand; anything that isn't a card | nothing |

Standing (`standingIn`) means its face (+Y) is nearer level than up or down
in the frame it lies in: more than 45° from either, the same test as Stand
on edge's. Toward a hand (`facing`) means: of every hand, the one the level
way from it to the middle of that hand's box is nearest the level way its
face looks, within 45°, so at most one; a tie goes to the nearer hand, then
the lower seat id, then the lower hand id. That is a domino stood up on the
table in front of you, with no rack: yours to see, its back to everyone
else. Turn it round to face someone else and it's theirs, as it would be.

Face up (`faceUpIn`) means its own +Y points the way the up of the frame it
lies in does: its parent's +Y, the world's at the root. So a card on a table
aboard a ship is face up or down as it lies on the table, whatever she does
(heeling, pitching, even upside down in a knockdown), and it's judged from
the doc, not the pose drawn this frame, so every peer agrees and nothing
flickers as she moves. Who sits where comes from the seats' `roster`.

The rule is its own extension with no `activities`, so it holds while
someone edits and whatever else a viewer is doing. The stage merges it with
any other package's policy; a keeper then draws each card by the one rule
keepers share (scene/STAGE.md, "Keepers"). At a table with only this
policy, that comes to:

| to you, a kept card is | when |
|---|---|
| its **face** | it's in your own hand (whichever way up), or standing on the table facing your hand, or face up on the table, and your client knows it |
| its **back** (the object's own look) | it's face down on the table; or it's in **another seat's hand**, whichever way up, or standing facing it: a hand is never turned toward you, and which back it is, is real information at a table with several decks; or its deck isn't dealt yet; or a package this scene lists isn't loaded here |
| the **veil** (the stage's stand-in: a frosted, padlocked box the card's size) | it's turned toward you and not shown yet: yours or face up, its keys still on their way (a joint keeper); or face up behind something another package screens |

Nothing is ever written to hide a card: the veil is drawn by the stage from
the card's bounds, with no file and no doc write.

So drawing a card is moving it from the deck into your hand (D, or carry
it there), playing it is putting it down face up, and turning one over (F
over it, or while carrying it) reveals it.
A card carried into your own hand from outside it turns face up as it
arrives, so you see what you drew, and back over if you carry it out again
(F decides for yourself). A revealed name shows in the outline and inspector
and is never written back.

**Seats** are the scene's (scene/STAGE.md, "Conventions"; scene/README):
the picker at the top right, who sits where, the seat's view riding a table
aboard a ship, sitting down from first person and standing up. This package
tells the seats' owner where each seat's hands are (`seatPlaces`: each
`tabletop.zone`), which gets a name tag on each tray ("Player 1 · Ana
(away)") and makes a look at a tray a look at its seat; and it reads who
sits where from the `roster`. Shuffle and Draw aren't offered in first
person (S and D walk); play from your seat.

**Shuffle** (`S` over a card: the scene's use prompt shows it, with the
hand's Flip, under the pointer; or *Shuffle pile* in its right-click menu)
shuffles the pile it's in — the cards of the same container whose footprints
overlap it by half or more — through whatever keeps them (the `keeper`
convention: any running extension that says it keeps the card): a plain
keeper permutes its slots in one write, so two shuffles at the same moment
keep one of them whole rather than mixing them; a joint keeper has the
players reshuffle them. A card nothing keeps is only what it looks like, and
isn't offered Shuffle.

**Draw** (`D` over a pile out on the table, on the use prompt; or *Draw to
my hand* in its right-click menu; play only) takes the pile's top card into
the first free card slot of your seat's tray: a connector with one of the
card's tags (`card`; a domino's, `domino`) with nothing of those within half
its snap radius. The card glides there as a pose hold, so
everyone sees it travel, and lands face up, turned the slot's way, in one
write; the hand's rule then makes it yours alone to see (and a joint keeper's
other players hand your client its key). Watching, it's greyed out ("Sit down to draw"); with
every slot taken, "Your hand is full". (At a table where no hand has a card
slot, a TTS import say, Draw isn't offered at all, seated or not.) Draw only
takes cards out on the table: a card in someone's hand stays theirs even
where a pile overlaps it. If a peer takes hold of the top card
first, yours lets go and takes the card under it (once; then "Someone drew
that one"). A seat whose hand has no card slots doesn't offer it: carry
cards there instead. A card attached to something (a table aboard a ship)
glides in that thing's frame and lands square to the tray, worked out from
the doc, so every peer agrees whatever the ship is doing. Carried into your
tray by hand, it turns face up against the tray as you see it (drawn), not
where the doc last saved the ship. `probes/draw.mjs` checks it at a table
whose deck the joint keeper keeps.

**Washing** (`W` over a face-down tile spread out on the table, on the use
prompt and the menu; `src/table/wash.js`) mixes the pieces lying face down
round it, as hands sweep a boneyard about: it and every face-down piece of
the same container lying out on the table (in nobody's hand, attached to
the same thing, not stacked: a stack is Shuffle's, not held by a peer)
within one and a half of its own length of the next. Their keeper shuffles
what they are among themselves (a joint keeper: the seated players, so
whoever washes knows no more than anyone else), and they are laid out
again in one write, jumbled where they were: a grid of cells round their
middle, each at a turn of its own, the cells wide enough that no two can
touch however they're turned. Positions are public and say nothing.
Anyone playing may wash, seated or not, as anyone at a table can reach in
and stir the tiles (and as the hand lets anyone carry or flip them).
**Shuffle** is offered only where there's a pile (a card lying alone has
nothing to shuffle with).

Wash, Stand on edge / Lay flat, Lay my hand face up and Draw are play's:
in Edit they don't apply, by key or menu (Shuffle, as before, does in
both).

**Standing on edge** (`U`, use prompt, menu, inspector; `src/table/stand.js`)
is for a piece thick enough to stand (its thinnest side at least a fifth of
its middle one: a domino, never a card). Over one lying in your own hand it
stands it on its long edge, its face toward you (the hand's +Z), turned as
little as it can be from how it lay, resting where it was. Over one lying
out on the table, when you're seated, it stands it facing the middle of your
nearest hand, so it's yours to see and its back to the rest (the policy's
`facing`): what playing without a rack is. Never in someone else's hand.
Over one standing anywhere (yours, someone else's, or one knocked over on
the table) it's **Lay flat**: face up, resting where it was; anyone can knock
a tile over, and one in someone's hand stays in it, so stays theirs. A
rack's places hold tiles standing (below), so a
tile drawn with D arrives standing; one carried into your rack by hand turns
face up as it arrives, as a card does, and U stands it.

**Lay my hand face up** (the menu and inspector only, over your hand or
anything in it, or a tile standing facing it: no key, so a slip doesn't show
your hand) puts everything in that hand, and everything standing on the
table facing it, out in front of it, past its far edge (its −Z), face up, side by
side in the order it lay across the hand, in rows as wide as the hand,
resting on whatever is there (a ray down; else level with the hand's foot).
Outside every hand and face up, everyone sees it. Counting is the players'.

**Places that hold a tile standing.** A card slot whose connector gives a
whole frame (`snapPoints: [{ position, rotation: [x, y, z], tags }]`, Euler
XYZ) holds what's drawn into it in that frame: a domino rack's places are
a quarter turn about Y and then about X (face toward the rack's +Z, length
along it). Draw puts the piece's footprint middle on the place and its
underside on it, whatever its frame. The scene keeps only a connector's yaw
when it reads a GLB (its hand needs no more to snap), so pieces.js writes the
whole frames again under the GLB's extras `"tabletop.slots"`, and
`src/table/slots.js` reads those where they are. A slot takes a piece by its
tags: a domino's are `["domino"]`, a card's `["card"]`, so each fits only its
own places, and Draw looks for a free one for the piece being drawn.

**Telling the others.** When someone shuffles or draws, everyone else
gets a notice ("Ana shuffled “Lost Cities table: Deck” (44)"), sent with the
scene's `api.send`: only `shuffled { n, of }` (a count and the container's
title), `drew { n, noun? }`, `washed { n, of?, noun? }` and `showed { n,
noun? }` are heard, never which card is which (`noun` is the piece's public
name, "domino", where it isn't "card"). (Sitting down is told by the seats'
owner.)

What peers have to trust: these are a peer's word, and none is checked: "Ana
shuffled the deck" may be said without any change to the deck. Nothing a
message says ever changes the doc or what anyone sees.

**Dice** are not the table's. A die is a document of its own, with its own
package (`dice/`): its parts are under "Dice" in the bin, and it brings Roll,
Turn and Roll all to any scene, a table included. Nothing here knows a die.

**The hand, always, in play.** A tool picked while editing (G, R, the
toolbar's Move or Rotate) is the view's own local state and would outlive the
switch back to Play, where nothing offers a way back: the table could no
longer be carried or flipped. And a scene that became a table through a part
(Lost Cities set down in it) suggests no tool (`view.tool`), so the stage's default, Move,
is in force. So whenever a view is playing at a table and the tool in force
(the view's, else the doc's `view.tool`, else Move: the scene's
`effectiveTool`, copied) isn't the hand, the extension runs the hand's own
Hand command. This patches a stage-wide gap, an Edit tool outliving the
switch to Play, which belongs in `scene.activity` in time.

**Card slots.** A card slot is a connector tagged `"card"`, and every card on
a table is tagged `"card"` (its back's tags: one tag for every card, never one
of its own, since an object's tags are public). By the scene hand's rule, a
tagged connector takes only objects with one of its tags, so a pawn carried
over a Lost Cities tray stays off its slots. Santorini's spaces are untagged:
anything may stand on them.

**Decks and keepers.** A table can have any number of decks, each in a
container of its own that its cards name, kept by a *keeper*: an ordinary
`scene:extension` of another package (scene/STAGE.md, "Keepers"). This
package never opens a container. It meets keepers in two places:

- **setting a table up** (`src/table/made-with.js`): it looks in the
  `scene:extension` registry for a plugin whose metadata says
  `keeper: "joint"` (for a `secure` deck) or `keeper: "plain"`, and calls
  that module's `contain({ repo }, { title, items })`, which makes the
  container and returns `{ key, bind(slot) → traits }`; each card gets
  `tabletop.card` and `bind(slot)`. With no joint keeper installed a secure
  deck goes to a plain one and the maker is told; with no keeper at all
  nothing is laid out.
- **in play** (`api.collect("keeper")`): `of(id)` says which container a card
  is in (a pile is the overlapping cards of one container), `shuffle(ids)`
  shuffles them, `name(key)` is the container's title for a notice.

The seats are written the same way: the plugin with `roster: true` (the
scene's seats part) has a module `lay(d, seats)`.

A deck document dropped on a table is no longer laid out: a container isn't
something you drop; a table is made with its decks.

**What this protects against** is the keeper's to say (keep/README,
card-table/README). In short: with a plain keeper this is a table, not a
vault: the container is an ordinary document, and anyone who opens it can
read every card, as anyone at a real table can peek; the HUD says so. With
the joint keeper the seated players shuffle the deck between them (mental
poker): nobody knows which card is where, and a card can only be decrypted
by the players the table's policy lets see it. Either way the scene itself —
the outline, the inspector, ids, groups, order, the GLBs fetched — gives
nothing away.

## Documents

### `tabletop-game`

```ts
{
  title: string,
  about: string,                     // plain text: what the game is, how it's played
  pieces: { [kind]: Piece },
  order: string[],                   // kinds, in the order they're listed and set up
  seats?: { [seatId]: { name: string, camera?: { position, target } } },   // laid by whoever owns seats
  decks?: { [deckId]: Deck },
  camera?: { position, target },     // a fresh table's view (else one over the first player's shoulder)
  tables: AutomergeUrl[]             // scenes set up from this game
}

Deck = {
  name: string,
  at: [x, z], yaw?: number,          // where the undealt cards stack
  faceDown?: boolean,
  secure?: boolean,                  // ask for a keeper whose players shuffle it between them (a joint
                                     // keeper, where one is installed; else a plain one)
  deal?: { to: kind, count: number }[],  // dealt face up onto that piece's snap points, in order
  spread?: { cols: number, cell: number }  // the undealt cards spread out round `at`, not stacked: a jumble of
                                     // `cols` across, cells `cell` m apart, each at a turn of its own (a boneyard)
}

Piece = {
  name: string,
  count: number,                     // copies on a fresh table
  locked?: boolean,                  // set up locked in place (a board)
  zone?: { seat, min: [x,y,z], max: [x,y,z] },   // its copy is that seat's private zone (its own frame)
  hidden?: boolean,                  // copies are cards, kept by a keeper: shown as `back`, shuffled into `deck`
  back?: kind,                       // the piece hidden copies look like (same size; count 0)
  deck?: deckId,
  parts: Part[],                     // what it looks like: metres, Y up, standing on y = 0
  snapPoints?: ([x, y, z] | { position: [x, y, z], yaw?: number, rotation?: [x, y, z], tags?: string[] })[],
                                     // spaces on it other pieces snap to (its own frame); a yaw turns them;
                                     // a whole rotation (Euler XYZ) is the frame a drawn piece lies in there;
                                     // with tags, only pieces with one of them (["card"]: card slots)
  tags?: string[],                   // the tagged spaces its copies fit (["card"]); a hidden card has its back's
  snapRadius?: number,               // how close is close enough; absent = the scene's default
  supply: { at: [x, z], cols: number, gap: [dx, dz], yaw?: number },
                                     // where the copies start: a grid of `cols` from `at`
  glbUrl: AutomergeUrl | null,       // the drawn GLB file doc; kept for good
  glbKey: string | null,             // what it was drawn from (parts, snap points, radius)
  bounds?: { min, max }              // its box, from the last drawing (the scene's load hint)
}

Part =
  | { shape: "box", size: [w, h, d], at?: [x, y, z], color: "#rrggbb" }
  | { shape: "frustum", bottom: [w, d], top: [w, d], height: number, at?, color }  // a tapering box
  | { shape: "lathe", profile: [r, y][], segments?: number, at?, color }           // turned: a pawn, a dome
```

`at` is where the part's base centre goes. A lathe profile runs from the axis
at the bottom, up the outside and back to the axis at the top; corners sharper
than 35° stay sharp, gentler ones are shaded smooth. Parts of one colour become
one mesh.

The definition (pieces and order, without the drawing bookkeeping) is editable
as JSON at the bottom of the game page; applying it keeps each kind's GLB doc.

### A table

One writer makes every table (`src/setup.js`): `tableLayout(game, { fileOf,
newId, rng, gameUrl })` lays the game out without writing anything,
and `writeTable(d, layout, binds, { seats })` writes it into a scene doc in
one go. What it writes: one group per visible kind with more than one copy,
every copy at its supply spot, the board at the top level; each deck shuffled
into one group, dealt, and the rest stacked, every card a `tabletop.card`
bound to its slot of its deck's container (`binds[deckId](slot)`: the
keeper's own trait). Its seats, through their owner's `lay` (which writes
them only where the scene has none). The layout says what each deck's
container is to hold (`decks[id] = { title, secure, items }`, slot k being
what card k really is); the containers are made first, by a keeper
(`src/table/made-with.js` `containDecks`).
The game page's "Set up a table" writes it onto a fresh `scene` doc and
creates that: an empty scene as the scene's own datatype makes one
(`src/empty-scene.js`, a copy of its init: every map and list a scene has,
`assets` and `packages` among them), with the scene package as its
`@patchwork.suggestedImportUrl` when the registry has it from somewhere
another viewer can load (`src/scene-package.js`; scene/STAGE.md,
"Packages"), so someone with nothing installed is offered the scene tool.
The stage fills `packages` in when the table is opened: the scene's (seats
are its part), this package's (hands and cards) and the keeper's (its trait
on every card), so someone arriving by link with only the scene package is
offered the other two (`probes/arrive.mjs`). A template writes
the table into the empty scene it was started on, in one `ctx.change`.
Its view opens in the hand (`view.tool: "hand"`) with snapping on, the
grid and axes off, units in cm, looking from the game's `camera`
(`view.home`), and, when it has hands or cards, starts in
play (`view.activity: "play"`): a
table opens with no toolbar or sidebar, just the seat picker, the scene's
notices and its Play | Edit switch (where a viewer can step into the editor
for themselves). The table's verbs take part in both activities
(`activities: ["play", "edit"]`), its rule in every one, and it
`requires` what playing needs: the scene's hand, use prompt (listed before
the key map, so it hears its verbs' keys first), key map, right-click menu,
framing and notices.

A game with nothing for the extension to run on (no hands or cards:
Santorini) has no play on offer, so its layout writes no
`view.activity` (a doc that said "play" would show "Starts in: Play" over a
scene that can't), and its table opens in the editor, in the hand.

### Templates

An empty scene's start screen offers **Lost Cities**, **Santorini** and
**Draw Dominoes** for 2, 3 or 4 (`src/table/template.js`). How many play is
chosen there, since a table whose players shuffle between them (the joint
keeper) waits for every seat to be taken; the three share one set of files
(`tabletop/dominoes/<kind>@<hash>`). One click lays the game's table out in that scene:
the game is made in memory from its module's `fill()`, each kind's GLB is filed
with `ctx.file` (above), the deck docs are made, and then one change writes the
table; the stage then starts its maker where the doc says (play, at Lost
Cities), and a notice says to pick a seat.

A `secure` deck goes to a joint keeper (card-table's). Where none is
installed, the Lost Cities template has a plain keeper keep it instead and
says so: it plays the same, but anyone who opens the container can read
every hand. Everyone at such a table is told, every time they open it, by
the keeper's own HUD line.

The game page stays the editor for custom games; its tables keep the live
redraw. A template's table is a copy of the built-in game as it is now.

### Parts

The editor's parts bin has a **Tabletop** heading (`src/table/parts.js`):

- **Pawn** and **Token**: pieces to move about.
- **Card spot**: a small mat with one card slot (a connector tagged `"card"`,
  with a snap radius), so a card carried over it or a deck dropped on it
  squares onto it. Untagged pieces (pawns) don't snap there. It isn't a
  hand: a card spot that isn't in a seat's zone is somewhere public to lay
  cards, and Draw doesn't count it.
- **Card table**: a table to play at, 0.76 × 1.20 m, its top 0.70 m up on a
  pedestal, origin on the floor under its middle. Locked (nobody carries the
  table about in play), with one connector at the middle of its top tagged
  `"tabletop.game"`, which a game takes.
- **Lost Cities**: the whole game's table (the template's layout,
  `layOutTable`), set down on what it was put on: every piece under that
  object in its frame (on a Card table: squarely in the middle of the top),
  each seat's camera `in` it, its deck kept by a joint keeper where one is installed.
  It brings seats only to a scene that has none, and leaves the scene's
  view, home, units and title alone. So a game aboard a ship is three steps:
  start from *Ship at anchor* (sailing), drop a Card table in her cockpit,
  drop Lost Cities on the table; everything rides with her.
- **Draw Dominoes, 2 / 3 / 4 players**: the same for Draw Dominoes. Its
  table is about 1 m square (the felt is 0.74 m), wider than the Card
  table's 0.76 m: with three or four players the side racks hang over.

The Card table and Lost Cities square themselves to what they're put on:
upright in its frame, turned only about its +Y (on a heeling deck they stand
square to the deck, not plumb).

Each is filed once per scene with `ctx.file` (`src/table/files.js`, shared
with the templates) under `tabletop/<kind>@1`
(`pawn`, `token`, `card-spot`): ten pawns share one GLB. A part goes
where the bin puts it, under what it was dropped on (and in that one's
group), unlocked (the Card table locked); if what it was dropped on goes
while its file is made, it puts nothing. The pieces never make or change
seats; a game (Lost Cities) is the one part that does, and only where there
are none.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/datatype.js` | the datatype |
| `src/tool.js`, `src/styles.css` | the game page |
| `src/games/santorini.js`, `src/games/lost-cities.js`, `src/games/dominoes.js` | the games: pieces, seats, decks, a summary of the rules (`dominoes(players)` for 2, 3 or 4) |
| `src/glyphs.js` | numbers made of boxes, for card faces |
| `src/shapes.js` | parts → triangle meshes (pure) |
| `src/pieces.js` | pieces → GLB file docs, redrawn when they change |
| `src/empty-scene.js` | an empty scene doc, as the scene datatype's init makes it (a copy; scene/src/datatype.js is the source of truth): what the game page, the tests and the probe pages start a scene doc from |
| `src/scene-package.js` | where the scene package comes from, for a new table's `@patchwork.suggestedImportUrl` (read from the registry at run time; the same file as tts-import's) |
| `src/setup.js` | the one table writer: a game → a layout and what its decks hold (shuffle, deal, stack; pure), set down on something (`placeLayout`), and writing it into a scene doc |
| `src/table/made-with.js` | finding what a table is made with in the registry, by metadata: a keeper of a kind (its `contain`), whoever owns seats (its `lay`) |
| `src/table/template.js` | the Lost Cities and Santorini templates: the game's table in an empty scene, its art by `ctx.file` |
| `src/table/files.js` | the scene's own GLB files, for parts and templates: a piece's GLB for `ctx.file` |
| `src/table/extension.js` | the table's scene extension: Shuffle (through a card's keeper), Draw, a card turning face up over your own hand, the hand as the tool in play, where each seat's hands are, telling the others |
| `src/table/rule.js` | the table's policy as its own extension (`audience`), in every activity |
| `src/table/visibility.js` | who may see what: hands, cards, face up in the card's frame, as an `audience` answer (pure) |
| `src/table/parts.js` | the parts bin's pieces: pawn, token, card spot, card table (their art, and putting one in), and Lost Cities as a part |
| `src/table/frame.js` | 4 × 4 matrices for a table that sits on something (copied from the scene's transform.js) |
| `src/table/slots.js` | card slots: which connectors take a card (or a tile), in the world, with their whole frames where this package wrote them (the hand's rule, copied; pure) |
| `src/table/wash.js` | washing: which face-down pieces are swept together, and the jumble they're laid out in (pure) |
| `src/table/stand.js` | standing a piece on edge facing a way, laying it flat, resting where it was, and a hand laid out face up (pure) |
| `src/table/test-scene.js` | for tests: a scene snapshot like the extension api's, from a plain objects map |
| `probes/table-setup.js` | for the probe pages: a Lost Cities table set up as the game page does, and how a probe reads what the three packages put in the scene |
| `probes/arrive.mjs`, `probes/arrive-probe.html`, `probes/arrive-frame.html`, `probes/frame-repo.js` | arriving by link with only the scene package: A (scene, tabletop, card-table) makes a table; B (scene only, in its own iframe and so its own plugin registry) opens its URL, is offered tabletop and card-table on the one packages card, sits without them (the deck stays undealt and no key is handed over: fail closed), clicks Load, and the joint shuffle completes and deals 8 each |
| `probes/seats.mjs`, `probes/seats-probe.html` | two views at a Lost Cities table in headless Chrome (the seats are the scene's part): a present player's seat refused, an away one taken after a confirm (`cdp.mjs`, `fake-repo.js` and the stubs are copied from sailing's probes) |
| `probes/draw.mjs`, `probes/draw-probe.html` | two players at a Lost Cities table whose deck the joint keeper keeps: A hovers the deck and presses D; the card lands in A's hand, A sees its face, B sees it and A's whole hand as backs (and a close-up shot of it), B is told |
| `probes/privacy.mjs`, `probes/privacy-probe.html` | what a kept card looks like to each of two people (`--part secure` or `plain`): its back face down or in the other's hand, its face when it's theirs, the stage's veil while a card turned toward them has its keys on their way; that nothing is made or written to hide anything; the plain keeper's HUD line |
| `probes/stations.mjs`, `probes/stations-probe.html` | seats as stations on the use prompt, with a stand-in for something that walks in first person: Sit as Player 1, Stand up, Back to your seat, a present player's seat refused, an away one taken on a second F, a card still Flip |
| `probes/table.mjs`, `probes/table-probe.html` | two players at a Lost Cities table whose deck a plain keeper keeps: the use prompt over the pile (Flip, Shuffle) and S shuffling the container and telling B; a card squaring onto a tray slot and a pawn not; in Edit, the bin's Tabletop parts, a pawn dragged out of the bin; back in play with the hand |
| `probes/publish-table.mjs` | publish a Lost Cities table set up as the game page does to a real sync server (`--dry-run` to only check); with `--template lost-cities` (or `santorini`), start an empty scene from the template in headless Chrome (`template-probe.html`), check its files, play, seats and the jointly kept deck reaching play with 8 faces each, and publish the table it made |
| `probes/dominoes.mjs`, `probes/dominoes-probe.html`, `probes/real-repo.js` | Draw Dominoes for two on REAL Automerge docs (two peers, each its own replica, merged 25 ms late; `real-repo.js` a copy of bag's), with a real mouse and keys: A starts the template from the start screen, both sit, the joint keeper shuffles; A washes (W); each draws 7 (D) and each tile stands in its drawer's rack facing them; each sees their own faces and the other's backs, no veil; A lays two flat (U) and carries them into the line (the second turned a quarter with Q Q, then nudged by hand until it lies flush against the first's end, within 1 mm, on the felt), and B sees both faces; B draws again; A carries a standing tile out of the rack onto the felt and B stands a boneyard tile up with U, each facing its player: each sees their own and the other's back; both replicas hold the 28 tiles on 28 slots, every tile is accounted for, no face is seen twice and the views agree on every face; A lays their hand face up (right-click), the standing one with it, and B sees all five. `--players 3` or `4` checks only those tables' layout |
| `probes/chrome-guard.mjs`, `probes/chrome-guard-check.mjs` | Chrome never outlives the probe driver that started it (a watchdog; copied, the same in every package), and a finite check of it |
| `probes/scene-packages.mjs` | for the publish script: the suggested import and `packages` of a published scene, from each package's pushwork URL (copied, the same in every package) |
| `src/test/stand-ins.js` | for tests: stand-ins for whoever owns seats and for keepers, made the way the conventions say and naming no real package |
| `src/test/fakes.js` | a stand-in stage for tests: shared doc, presence, claims, sends, poses, loops; and a drop context for templates (`fakeDrop`) (copied from sailing's) |
| `src/glb.js` | the GLB encoder, copied from the scene package |

## Not yet

- A tile carried out of your rack standing goes down standing: the scene's
  `landing` can ask only for face up, so laying it flat to play it is U and
  then a carry (or a carry and then U). A stage-level "lay flat as it lands"
  would make it one move.
- Scoring, turns, who sets the first double, matching ends: the players'.

- `shows` and `screens` as separate switches on a hand (a screen that hides
  without showing). "Turned toward a seat" is geometric (`facing`: toward
  a hand), not a trait; a seat with no hand can't be faced.
- A deck document dropped on a table being laid out (gone with the deck
  plugin type; a keeper could offer it).
- Santorini's god powers, as face-up cards.
- Printed faces (textures): card faces are made of boxes for now.
- Rules. A move could be checked (or suggested) by reading where pieces are
  from the scene doc; nothing does yet. Nor turns.
