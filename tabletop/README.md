# tabletop

Board games as documents. A **tabletop game** says what its pieces look like,
how many of each there are and where they start. **Set up a table** lays them
all out in a new [scene](../scene/README.md) and opens it in the scene's
**hand**, where everyone with the scene open can carry pieces around: they snap
to the board's spaces and stack on whatever is already there. Rules are a
description for the players, not enforced.

Make a Tabletop game and pick one to start from, or start an empty scene
from **Lost Cities** or **Santorini** on its start screen (Templates, below):

- **Santorini** (Gordon Hamilton): an island board of 5×5 spaces, 22 / 18 / 14
  building levels, 18 domes, and two workers each for three players.
  Everything is in plain sight.
- **Lost Cities** (Reiner Knizia): 60 cards in five expeditions, a board with a
  discard pile for each, and a hand tray for each of two players. The deck is
  shuffled face down and dealt, 8 to each tray; pick your seat in the scene and
  only you see your hand's faces. Cards are drawn with boxes (seven-segment
  numbers), no textures.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `tabletop-game` | a game (listed) |
| `patchwork:tool` | `tabletop-game` | its page: about, pieces, set up a table, the tables set up so far, the definition as JSON |
| `tabletop:game` | `santorini`, `lost-cities` | games an empty tabletop-game can start from |
| `scene:template` | `tabletop.lost-cities`, `tabletop.santorini` | an empty scene's start screen: the game's table, laid out in that scene with its own art (Templates, below) |
| `scene:extension` | `tabletop` | what makes a scene a table: seats, private zones, hidden cards and their decks, shuffling, dice (Tables, below) |
| `scene:part` | `tabletop.pawn`, `tabletop.token`, `tabletop.card-spot`, `tabletop.die`, `tabletop.table`, `tabletop.lost-cities` | the editor's parts bin, under "Tabletop" (Parts and dice, below) |
| `patchwork:datatype` | `plain-deck` | a deck anyone can read (unlisted: a table makes it) |

Other packages add kinds of deck as **`tabletop:deck`** plugins (card-table's
secure deck is one; Tables, below).

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
dealing, shuffling, seats, hiding — is generic. A new game needs no new code
here, unless its pieces need a shape the parts can't make.

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
- Seats, private zones and hidden cards are this package's own, added to the
  scene by its scene extension (Tables, below); the scene doesn't know about
  them.
- **Hidden pieces** (cards): in the scene each one is its `back` piece, called
  by the back's name; which card it really is goes only into its deck's doc.
  Cards are created in deck order and grouped by deck, not by kind, so ids,
  groups and order say nothing. A seat's hand tray is a piece with a `zone`,
  and becomes a private zone in the scene. For an ordinary deck the doc is a
  `plain-deck`, readable by anyone who opens it. For a `secure` deck
  it's a `secure-deck` (the card-table package's): setup lists the cards and
  which object is which position, and the seated players' clients shuffle it
  between them once every seat is taken, so nobody knows the order. Lost
  Cities uses one; the game page has a toggle.

## Tables

A table is a scene with this package's traits on it, which its scene
extension (`src/table/extension.js`) understands. The scene itself knows none
of this (scene/README, "Extensions"), and a scene without the tabletop
package installed shows a table's cards as their backs and nothing else.

| trait | on | |
|---|---|---|
| `tabletop.seats` | the scene | `{ [seatId]: { name, player: <contact url> \| null, camera?: { position, target, in? } } }`. `in`: an object id, the frame the camera is given in (a table aboard a ship); absent, the world |
| `tabletop.zone` | an object | `{ seat, min: [x,y,z], max: [x,y,z] }`: a seat's private area, a box in the object's own frame |
| `tabletop.hidden` | an object | `{ by: <deck url> }`: what it really is comes from that deck |
| `tabletop.die` | an object | `{ faces?: { "+y": n, … } }`: a die; gives it Roll (R) in play (Rolling, below) |

**Copies.** The scene copies objects between scenes (and duplicates them in
one); the traits' descriptions say what a copy takes (scene/STAGE.md,
"Copying objects"). A copied hidden card leaves its deck behind
(`tabletop.hidden.by` is `copy: "drop"`): a deck knows its cards by object
id and the copy has a new one, so it's a bare back in no deck, and the scene
it lands in is never set to reading (or, for a secure deck, shuffling)
another table's deck. A copied zone keeps its seat only where that scene has
a seat by that id (an `entry` field). Putting a card into the deck of the
table it lands on isn't done.

**Who sees what** (`src/table/visibility.js`). A hidden object is drawn as
itself — its public look, a card back — except:

- inside a **private zone** (its origin is), it's shown as what it really is
  only to whoever sits in that seat, whichever way up it is;
- otherwise, **face up**, it's shown as what it is to everyone.

Face up (`faceUpIn`) means its own +Y points the way the up of the frame it
lies in does: its parent's +Y, the world's at the root. So a card on a table
aboard a ship is face up or down as it lies on the table, whatever she does
(heeling, pitching, even upside down in a knockdown), and it's judged from
the doc, not the pose drawn this frame, so every peer agrees and nothing
flickers as she moves.

**Three looks** (`src/table/privacy.js`). To each viewer a hidden card is one
of:

| | shown as |
|---|---|
| face down (and not in your own hand) | its **back** (the object's own look) |
| any card, while its deck isn't dealt yet (a secure deck waiting for its players: `dealt()` false) | its **back**: nothing is anyone's yet, and the HUD says what it waits for |
| one you may see, whose face your client knows | its **face** |
| face up, but not for you: in another seat's hand, or yours to see and its face not here yet once the deck is dealt (a secure deck's keys still on their way), or a deck nothing installed can read | the **privacy face** |

(A deck whose resolver has no `dealt()` is taken at its word only for what
the zone rule keeps from you: a face-up card of yours with no face yet shows
its back.)

The privacy face is one generic picture for every card of a size: a dark
card with a mid-grey frosted, reeded field and a big pale padlock, on both
sides (so a private card being turned over never shows a bare underside),
the padlock turned to read from across the table, since a hand's cards face
their own seat. Its grey is no suit's and no back's, so an opponent's hand
laid face up in its tray reads as "kept from you", not "face down" or a
white card, and says nothing about which cards they are. Its look carries no
name. It's a GLB the scene keeps as a `file` doc at
`doc.assets["tabletop/private-card@3:<bounds>"]` (the version bumps when the
art changes; a scene keeps the old file under the old key, unused)
(bounds in tenths of a mm: the cards' hint, which every card of a deck shares,
its back's; a Lost Cities card's when there's none), made by the first view
that needs one: setting a table up never writes it, so it comes the first
time someone sees a card they mayn't. That's the only write it makes: never
anything per card. Two views needing it at once each make a file doc and
write the key only if it's still empty; the merge keeps one, and the other
file is a spare nothing names (the stage's `ctx.file` rule). Until it's
there, a private card shows its back. A deck still loading shows backs
throughout. A plain deck behaves the same (its faces are seen only by the
zone rule; the HUD still says anyone can read it), and a secure deck's
secrets never reach the privacy face (card-table/README).

So drawing a card is moving it from the deck into your zone (D, or carry
it there), playing it is
putting it down face up, and turning one over (F over it, or while carrying
it) reveals it.
A hidden card carried into your own zone from outside it turns face up as it
arrives, so you see what you drew, and back over if you carry it out again
(F decides for yourself). A revealed name shows in the outline and inspector
and is never written back.

**The seat picker**, at the top right of the table: pick your seat (or
watch; a seat with a `camera` moves your view there).

 A seat camera `in` an
object is put through that object as it's drawn now, and then rides it
(the stage's `camera.ride`), so a table aboard a ship stays in front of you
as she swings and bobs (her roll and pitch aren't followed: the view keeps
the world's up, and the table heels in it). In first person (walking her
deck) the walker has the camera: your seat's view waits until you stop, and
whenever you stop walking while seated you're put back in your seat. A
seat whose camera is `in` an object that's gone (its table deleted) leaves
your view where it is, and a game's table laid down later in a scene whose
seats look at a table that's gone gives those seats its own views. Shuffle
and Draw aren't offered in first person (S and D walk); play from your seat. What each deck is doing
shows as a line in the scene's notices, at the top left. A name tag on each
hand tray, at the edge nearest its seat, on the tray's surface, says whose seat it is: "Player 1 · Ana", "Player 1 · Ana (away)",
"Player 2 · free".

Sitting writes you into the seat (`tabletop.seats[id].player`, which is all
that decides whose hand you see) and takes a claim on the scene,
`tabletop.seat:<id>` (the scene's claims: STAGE.md), which says you're here.
So:
- a seat whose player is here (their claim is live) can't be taken: "Ana is
  sitting there". A view that has just opened sees that from its first frame,
  as the stage counts a claim by someone not yet heard from for its first 6 s;
- a seat whose player has gone (no live claim) can be taken, after a confirm
  ("Ana is away. Take their seat? You'll see their hand.");
- two people picking one seat at once: the merge keeps one claim, and the
  other is told "Ana sat in Player 1 first; you're watching" (and writes
  nothing);
- the same person in two tabs is seated in both; a reload claims its seat
  again; Watching lets go of it. Moving to another seat, or to Watching, in
  either tab moves that person: the tab holding the old seat's claim lets go
  of it rather than writing itself back;
- if a merge gives the claim to one and the player to the other, the claim's
  holder writes itself back in (that seat's player only).
Claims decide who may take a seat, never who sees what: card visibility (and
card-table's key delivery) reads only the doc's player, the same on every
peer. `probes/seats.mjs` checks this in headless Chrome with two views.

**A seat as a station** (`src/table/seat-verbs.js`). Walking in first person
(`local.immersive`: aboard a ship, say), look at a seat's place within 2 m —
its tray, the table just past the tray's edge, or its bench (under where the
seat's camera puts its player's eye, across the camera's frame) — and the use
prompt offers **Sit as Player 1** (F). It sits you exactly as the picker
does: the same claim, notices and messages; a present player's seat greyed
out ("Ana is sitting there"); an away player's seat asking first, by a second
F within 5 s rather than a dialog, as the pointer is locked ("Ana is away.
Press F again to take their seat; you'll see their hand."); a race lost to
the merge told as ever, and you're put back on your feet. Your own seat, if
you got up from it, offers **Back to your seat**. Only a tray, something
locked (the table, the board) or the thing a seat's camera rides (the table,
the ship whose bench it is) counts as a seat's place, never a loose piece, so
F over a card is still the hand's Flip; and only the use prompt offers it
(it needs the eye), never the key map or the menu. Then the view is handed
over: whatever walks is asked to leave first person, and the seat's view
takes the camera as it does. Seated (not walking), a look at your own place
offers **Stand up** (F) when something here walks: you're put on your feet
at the seat in first person and the seat stays yours, as getting up any
other way does (Esc, or F at it, sits you back down; Watching in the picker
gives it up). Where nothing walks, there's no Stand up: the picker is the
way.

What walks is whatever running extension has a `firstPerson` field (the
stage's `api.collect`; sailing's crew is the one there is), a late-bound
hand-off that is nothing when it isn't there:

```js
firstPerson: {
  // first person, standing at seat `seat`: eye is where its player's eye is
  // (world, as drawn), target what its view looks at, frame the object its
  // camera is in (or null). false if it can't (the seat's view is kept).
  enter({ seat, eye, target, frame }) → boolean,
  // end first person: the seat's view, waiting for it, takes the camera
  leave(),
}
```

With nothing to leave first person by, sitting down says "Leave first
person (Esc) to take your seat."

**Shuffle** (`S` over a card: the scene's use prompt shows it, with the
hand's Flip, under the pointer; or *Shuffle pile* in its right-click menu)
shuffles the pile it's in — the cards of the same deck whose footprints
overlap it by half or more — through its deck: a plain deck permutes its
entries, writing the whole map at once so two shuffles at the same moment
keep one of them whole rather than mixing them; a secure deck has the players
reshuffle them.

**Draw** (`D` over a pile out on the table, on the use prompt; or *Draw to
my hand* in its right-click menu; play only) takes the pile's top card into
the first free card slot of your seat's tray: a connector tagged `card` with
no card within half its snap radius. The card glides there as a pose hold, so
everyone sees it travel, and lands face up, turned the slot's way, in one
write; the zone rule then shows its face to you alone (and card-table hands
your client its key). Watching, it's greyed out ("Sit down to draw"); with
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
where the doc last saved the ship. `probes/draw.mjs` checks it at a secure
table.

**Telling the others.** When someone shuffles, sits down, draws or rolls, everyone else
gets a notice ("Player 1 shuffled the deck (44)"), sent with the scene's
`api.send`: only `shuffled { deck, n }`, `sat { seat }`, `drew { n }` and
`rolled { die, value }` are heard, and only counts and ids are ever sent,
never which card is which.

What peers have to trust: these are a peer's word. A roll is checked: it's
told only when the doc moved that die (within a few seconds either side of
the message) and the side it landed on shows that number; otherwise nothing
is said, so a die put down by hand on a 6 and "announced" isn't told as a
roll. (It can't tell a fair seed from a chosen one: a modified client can
still pick its outcome and roll it.) A shuffle isn't checked: "Ana shuffled
the deck" may be said without any change to the deck. Nothing a message says
ever changes the doc or what anyone sees.

**Rolling.** An object with the trait `tabletop.die` (the inspector's "Add
behaviour… Die", or the Die part) offers **R Roll** on the use prompt and the
menu, in play only (R is the gizmo's Rotate while editing). The whole roll is
worked out from one random seed first (`src/table/dice.js`): which side lands
up, how it's turned, how far it skids. For about 0.6 s it's tossed and
tumbled about the middle of its box as a pose hold, so everyone sees it in
the air; then one write puts it where it landed, a landed release, and
"You rolled 5" here and "Ana rolled 5" for everyone else. A peer who takes
hold of it or moves it meanwhile has it: the roll writes nothing. The trait's
`faces` says which number each side shows, by the local axis out of that
side; the default is a d6's (`+y` 1, `-y` 6, `+x` 3, `-x` 4, `+z` 2, `-z`
5), which the Die part is drawn to. Set it for a die modelled elsewhere.

**The hand, always, in play.** A tool picked while editing (G, R, the
toolbar's Move or Rotate) is the view's own local state and would outlive the
switch back to Play, where nothing offers a way back: the table could no
longer be carried or flipped. And a scene that became a table through a part
(a die, a pawn) suggests no tool (`view.tool`), so the stage's default, Move,
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

**Decks.** A table can have any number, each a document of its own that its
cards name. A plain deck is read here:

```ts
{ "@patchwork": { type: "plain-deck" }, title, objects: { [objectId]: { sourceUrl: AutomergeUrl, name: string } } }
```

Any other kind through the `tabletop:deck` plugin whose `supportedDatatypes`
include its type (a late-bound lookup):

```js
{ type: "tabletop:deck", id, name, supportedDatatypes: ["secure-deck"],
  async load() { return { createResolver, placement?, bind? } } }

createResolver({ repo, handle /* the deck doc */, viewer, onChange }) → {
  update(ctx),        // on every scene change, with
                      //   { objects, seats, viewer, players /* seated, in seat order */,
                      //     openSeats /* names of seats nobody has taken */,
                      //     visibleTo(player | null) → Set of object ids that player
                      //       (null: everyone) may see, by the rule above,
                      //     nameOf(player) → their seat's name }
  looks(),            // → Map objectId → { sourceUrl, name } for what this viewer may see now
                      //   (only the deck's own objects are taken from it)
  status(),           // → a line for the HUD (the scene's notices), or null
  dealt?(),           // → whether any card can be shown to anyone yet (optional; false: the
                      //   table shows backs, not privacy faces). Public data only.
  shuffle(ids),       // shuffle these objects' cards among themselves → how many (0: nothing to do)
  dispose(),
}
placement(doc) → { name, count, look: { sourceUrl, name }, bounds? } | null   // to lay a dropped deck out
bind(handle, ids)   // the objects made for it, in deck order
```

Call `onChange` when `looks()` or `status()` changes. A deck with
`placement` can be dropped (or pasted) onto any scene that isn't already
showing it: its cards are laid out face down, tagged `"card"`, in a group
named for it, stacked where it was dropped, or squared onto the nearest card
slot of what it was dropped on, if one is within reach. It goes into the
frame of what it was dropped on: that object, if anything is attached to it
(a table, a hull), else whatever that object is attached to (a board on a
table: onto the table), else the root, so a deck dropped at a table aboard a
ship rides with her and one dropped at a table on the floor stays at the
root, where it is seen. Never in a hand (the hands as they're drawn, as the
drop point is: aboard a moving ship the doc's are elsewhere): a
slot in a seat's private zone is passed over, and a deck dropped into one is
refused ("Drop the deck on the table, not in a hand"), since every card in
it would be that seat's to see.

**What this protects against.** With a plain deck: this is a table, not a
vault. Its doc is an ordinary document, and anyone who opens it (or the
inspector) can read every card, as anyone at a real table can peek. What is
guaranteed is that the scene itself — the outline, the inspector, ids, groups,
order, the GLBs fetched — gives nothing away. With a `secure-deck` from the
card-table package, the seated players shuffle the deck between them (mental
poker), with keys from their accounts: nobody knows which card is where, and a
card's face can only be decrypted by the players the rule above lets see it.
See card-table's README for how, and for what it doesn't do yet.

## Documents

### `tabletop-game`

```ts
{
  title: string,
  about: string,                     // plain text: what the game is, how it's played
  pieces: { [kind]: Piece },
  order: string[],                   // kinds, in the order they're listed and set up
  seats?: { [seatId]: { name: string, camera?: { position, target } } },
  decks?: { [deckId]: Deck },
  camera?: { position, target },     // a fresh table's view (else one over the first player's shoulder)
  tables: AutomergeUrl[]             // scenes set up from this game
}

Deck = {
  name: string,
  at: [x, z], yaw?: number,          // where the undealt cards stack
  faceDown?: boolean,
  secure?: boolean,                  // the players shuffle it between them (card-table's secure deck);
                                     // one per table, and no other decks with it, for now
  deal?: { to: kind, count: number }[]   // dealt face up onto that piece's snap points, in order
}

Piece = {
  name: string,
  count: number,                     // copies on a fresh table
  locked?: boolean,                  // set up locked in place (a board)
  zone?: { seat, min: [x,y,z], max: [x,y,z] },   // its copy is that seat's private zone (its own frame)
  hidden?: boolean,                  // copies are secret: shown as `back`, shuffled into `deck`
  back?: kind,                       // the piece hidden copies look like (same size; count 0)
  deck?: deckId,
  parts: Part[],                     // what it looks like: metres, Y up, standing on y = 0
  snapPoints?: ([x, y, z] | { position: [x, y, z], yaw?: number, tags?: string[] })[],
                                     // spaces on it other pieces snap to (its own frame); a yaw turns them;
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
newId, rng, gameUrl, secure })` lays the game out without writing anything,
and `writeTable(d, layout, deckUrls)` writes it into a scene doc in one go.
What it writes: one group per visible kind with more than one copy, every copy
at its supply spot, the board at the top level; each deck shuffled into one
group, dealt, and the rest stacked. Its seats, empty (`tabletop.seats`; only if
the scene has none yet, as a shared map is made once). If anything is hidden,
a doc per deck, made first, which its cards name (`tabletop.hidden`).
The game page's "Set up a table" writes it onto a fresh `scene` doc and
creates that: an empty scene as the scene's own datatype makes one
(`src/empty-scene.js`, a copy of its init: every map and list a scene has,
`assets` and `packages` among them), with the scene package as its
`@patchwork.suggestedImportUrl` when the registry has it from somewhere
another viewer can load (`src/scene-package.js`; scene/STAGE.md,
"Packages"), so someone with nothing installed is offered the scene tool.
The stage fills `packages` in when the table is opened. A template writes
the table into the empty scene it was started on, in one `ctx.change`.
Its view opens in the hand (`view.tool: "hand"`) with snapping on, the
grid and axes off, units in cm, looking from the game's `camera`
(`view.home`), and, when it has seats, zones or hidden cards, starts in
play (`view.activity: "play"`): a
table opens with no toolbar or sidebar, just the seat picker, the scene's
notices and its Play | Edit switch (where a viewer can step into the editor
for themselves). The extension takes part in both activities (`activities:
["play", "edit"]`), so hidden cards stay hidden while someone edits, and it
`requires` what playing needs: the scene's hand, use prompt (listed before
the key map, so it hears its verbs' keys first), key map, right-click menu,
framing and notices.

A game with nothing for the extension to run on (no seats, zones or hidden
cards: Santorini) has no play on offer, so its layout writes no
`view.activity` (a doc that said "play" would show "Starts in: Play" over a
scene that can't), and its table opens in the editor, in the hand.

### Templates

An empty scene's start screen offers **Lost Cities** and **Santorini**
(`src/table/template.js`). One click lays the game's table out in that scene:
the game is made in memory from its module's `fill()`, each kind's GLB is filed
with `ctx.file` (above), the deck docs are made, and then one change writes the
table; the stage then starts its maker where the doc says (play, at Lost
Cities), and a notice says to pick a seat.

A secure deck needs a `tabletop:deck` plugin for `secure-deck` (card-table).
Where none is installed, the Lost Cities template makes a plain deck instead
and says so: it plays the same, but anyone who opens the deck doc can read
every hand. Everyone at such a table is told, every time they open it: at
any table with hands (zones with seats) and a plain deck, the HUD says
"This table's deck is a plain one: anyone who opens it can read every card,
hands included." (A table without hands, a TTS import, stays quiet.)

The game page stays the editor for custom games; its tables keep the live
redraw. A template's table is a copy of the built-in game as it is now.

### Parts and dice

The editor's parts bin has a **Tabletop** heading (`src/table/parts.js`):

- **Pawn** and **Token**: pieces to move about.
- **Card spot**: a small mat with one card slot (a connector tagged `"card"`,
  with a snap radius), so a card carried over it or a deck dropped on it
  squares onto it. Untagged pieces (pawns, dice) don't snap there. It isn't a
  hand: a card spot that isn't in a seat's zone is somewhere public to lay
  cards, and Draw doesn't count it.
- **Die**: a d6, with the trait `tabletop.die` (Rolling, above). A scene with
  only a die in it is a table too, and offers play.
- **Card table**: a table to play at, 0.76 × 1.20 m, its top 0.70 m up on a
  pedestal, origin on the floor under its middle. Locked (nobody carries the
  table about in play), with one connector at the middle of its top tagged
  `"tabletop.game"`, which a game takes.
- **Lost Cities**: the whole game's table (the template's layout,
  `layOutTable`), set down on what it was put on: every piece under that
  object in its frame (on a Card table: squarely in the middle of the top),
  each seat's camera `in` it, a secure deck where card-table is installed.
  It brings seats only to a scene that has none, and leaves the scene's
  view, home, units and title alone. So a game aboard a ship is three steps:
  start from *Ship at anchor* (sailing), drop a Card table in her cockpit,
  drop Lost Cities on the table; everything rides with her.

The Card table and Lost Cities square themselves to what they're put on:
upright in its frame, turned only about its +Y (on a heeling deck they stand
square to the deck, not plumb).

Each is filed once per scene with `ctx.file` (`src/table/files.js`, shared
with the templates) under `tabletop/<kind>@1`
(`pawn`, `token`, `card-spot`, `d6`): ten pawns share one GLB. A part goes
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
| `src/games/santorini.js`, `src/games/lost-cities.js` | the games: pieces, seats, decks, a summary of the rules |
| `src/glyphs.js` | numbers made of boxes, for card faces |
| `src/shapes.js` | parts → triangle meshes (pure) |
| `src/pieces.js` | pieces → GLB file docs, redrawn when they change |
| `src/empty-scene.js` | an empty scene doc, as the scene datatype's init makes it (a copy; scene/src/datatype.js is the source of truth): what the game page, the tests and the probe pages start a scene doc from |
| `src/scene-package.js` | where the scene package comes from, for a new table's `@patchwork.suggestedImportUrl` (read from the registry at run time; the same file as tts-import's) |
| `src/setup.js` | the one table writer: a game → a layout and its decks (shuffle, deal, stack; pure), set down on something (`placeLayout`), and writing it into a scene doc |
| `src/table/template.js` | the Lost Cities and Santorini templates: the game's table in an empty scene, its art by `ctx.file` |
| `src/table/files.js` | the scene's own GLB files, for parts and templates: a piece's GLB for `ctx.file` |
| `src/table/extension.js` | the scene extension: decks and the three looks, the seat picker and seats as stations, Shuffle, Draw, Roll, telling the others, laying out a dropped deck, drawing face up |
| `src/table/visibility.js` | who may see what: zones, seats, face up in the card's frame (pure) |
| `src/table/privacy.js` | the three looks of a hidden card, and the privacy face's art and assets key (pure) |
| `src/table/seat-verbs.js` | a seat as a station: which seat a look is at, and the verb it offers (pure) |
| `src/table/plain-deck.js` | the plain deck: its datatype and resolver |
| `src/table/parts.js` | the parts bin's pieces: pawn, token, card spot, die, card table (their art, and putting one in), and Lost Cities as a part |
| `src/table/frame.js` | 4 × 4 matrices for a table that sits on something (copied from the scene's transform.js) |
| `src/table/dice.js` | dice: which side is up, and a roll worked out from its seed (pure) |
| `src/table/slots.js` | card slots: which connectors take a card, in the world (the hand's rule, copied; pure) |
| `src/table/test-scene.js` | for tests: a scene snapshot like the extension api's, from a plain objects map |
| `probes/seats.mjs`, `probes/seats-probe.html` | two views at a Lost Cities table in headless Chrome: a present player's seat refused, an away one taken after a confirm (`cdp.mjs`, `fake-repo.js` and the stubs are copied from sailing's probes) |
| `probes/draw.mjs`, `probes/draw-probe.html` | two players at a secure Lost Cities table (card-table's built plugins too): A hovers the deck and presses D; the card lands in A's hand, A sees its face, B sees it and A's whole hand as the privacy face (and a close-up shot of it), B is told |
| `probes/privacy.mjs`, `probes/privacy-probe.html` | what a hidden card looks like to each of two people (`--part secure` or `plain`): its back face down, its face when it's theirs, the privacy face when it's face up but not theirs; one privacy file per scene; a card whose key is still on its way; the plain-deck HUD warning |
| `probes/stations.mjs`, `probes/stations-probe.html` | seats as stations on the use prompt, with a stand-in for something that walks in first person: Sit as Player 1, Stand up, Back to your seat, a present player's seat refused, an away one taken on a second F, a card still Flip |
| `probes/table.mjs`, `probes/table-probe.html` | two players at a plain-deck Lost Cities table (card-table's built plugins loaded for a dropped secure deck): the use prompt over the pile (Flip, Shuffle) and S telling B; a card squaring onto a tray slot and a pawn not; in Edit, the bin's Tabletop parts, R as the gizmo's Rotate, a dropped deck stacking at the point and squaring onto a discard slot; back in play with the hand, R rolling the die to the same face in both views |
| `probes/publish-table.mjs` | publish a Lost Cities table set up as the game page does to a real sync server (`--dry-run` to only check); with `--template lost-cities` (or `santorini`), start an empty scene from the template in headless Chrome (`template-probe.html`), check its files, play, seats and the secure deck reaching play, and publish the table it made |
| `probes/chrome-guard.mjs`, `probes/chrome-guard-check.mjs` | Chrome never outlives the probe driver that started it (a watchdog; copied, the same in every package), and a finite check of it |
| `probes/scene-packages.mjs` | for the publish script: the suggested import and `packages` of a published scene, from each package's pushwork URL (copied, the same in every package) |
| `src/test/fakes.js` | a stand-in stage for tests: shared doc, presence, claims, sends, poses, loops; and a drop context for templates (`fakeDrop`) (copied from sailing's) |
| `src/glb.js` | the GLB encoder, copied from the scene package |

## Not yet

- Signed docs (keyhive) for the secure deck, so a turn or a key can't be
  forged; see card-table's README for its other limits.
- A bag to draw from (tiles, chits).
- Santorini's god powers, as face-up cards.
- Printed faces (textures): card faces are made of boxes for now.
- Rules. A move could be checked (or suggested) by reading where pieces are
  from the scene doc; nothing does yet. Nor turns.
