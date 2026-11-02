# tabletop

Board games as documents. A **tabletop game** says what its pieces look like,
how many of each there are and where they start. **Set up a table** lays them
all out in a new [scene](../scene/README.md) and opens it in the scene's
**hand**, where everyone with the scene open can carry pieces around: they snap
to the board's spaces and stack on whatever is already there. Rules are a
description for the players, not enforced.

Make a Tabletop game and pick one to start from:

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

- Each kind of piece is drawn once, as a GLB `file` doc the game keeps
  (`glbUrl`). Every copy of it, on every table, is a **passthrough** object
  showing that doc (provider `file-glb`, no render doc). The game page redraws
  a kind's GLB in place when its parts change, so tables already set up change
  with it.
- A board's spaces are **snap points** in its GLB (`extras.snapPoints`, see the
  scene's GLB conventions). The scene's hand does the snapping and stacking;
  nothing here is specific to Santorini.
- The board is set up **locked**, so dragging it orbits instead.
- Each copy's About (`infoUrl`) is the game, so selecting a piece in the scene
  shows the rules.
- **Hidden pieces** (cards) use the scene's hidden objects. In the scene each
  one is its `back` piece, called by the back's name; which card it really is
  goes only into the table's `scene-secrets` doc. Cards are created in deck
  order and grouped by deck, not by kind, so ids, groups and order say
  nothing. A seat's hand tray is a piece with a `zone`, and becomes a private
  zone in the scene. For an ordinary deck the secrets doc is a plain
  `scene-secrets` doc, readable by anyone who opens it. For a `secure` deck
  it's a `secure-deck` (the card-table package's): setup lists the cards and
  which object is which position, and the seated players' clients shuffle it
  between them once every seat is taken, so nobody knows the order. Lost
  Cities uses one; the game page has a toggle.

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
  snapPoints?: ([x, y, z] | { position: [x, y, z], yaw?: number })[],
                                     // spaces on it other pieces snap to (its own frame); a yaw turns them
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

A `scene` doc, made fresh each time: one group per visible kind with more than
one copy, every copy at its supply spot, the board at the top level; each deck
shuffled into one group, dealt, and the rest stacked. Its seats, empty. If
anything is hidden, a `scene-secrets` doc made first (the scene's `secretsUrl`).
Its view opens in the hand (`view.defaultGizmo: "hand"`) with snapping on, the
grid and axes off and units in cm.

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
| `src/setup.js` | a game → a fresh scene doc and its secrets: shuffle, deal, stack (pure) |
| `src/glb.js` | the GLB encoder, copied from the scene package |

## Not yet

- Signed docs (keyhive) for the secure deck, so a turn or a key can't be
  forged; see card-table's README for its other limits.
- Shuffling a pile during play, and a bag to draw from (tiles, chits).
- Santorini's god powers, as face-up cards.
- Printed faces (textures): card faces are made of boxes for now.
- Rules. A move could be checked (or suggested) by reading where pieces are
  from the scene doc; nothing does yet. Nor turns.
