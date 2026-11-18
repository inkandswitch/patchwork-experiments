# tabletop

Board games as data, and the physical things they are played with. A
**tabletop game** is one JSON document in the [tabletop-game
format](GAME-FORMAT.md): what each piece looks like and is, and where
everything starts. **Set up a table** lays it out in a new
[scene](../scene/README.md), where everyone can carry pieces about (the
scene's `scene.carry`): they snap to a board's spaces and stack. Rules are a
description for the players, never enforced: every piece here (cards, tiles,
dice, cups, bags) behaves like a physical one, and nothing knows a turn, a
bid or a legal move.

Built in: **Santorini**, **Lost Cities** (a secure deck, a private hand
each), **Draw Dominoes** for 2, 3 or 4 (tiles that stand in a rack facing
their player) and **Liar's dice** (six cups, thirty dice). A Tabletop
Simulator mod becomes a game through the importer. Laying any of them out is
the same code: none has code of its own.

```
pnpm install && pnpm build && pnpm test
pnpm bench [cards] [players]     # what a joint shuffle costs on this machine
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` / `tool` | `tabletop-game` | a game, and its page: about, pieces, Set up a table, its tables, the game as JSON (checked before it's kept) |
| `tabletop:game` | `santorini`, `lost-cities`, `draw-dominoes-2`, `-3`, `-4`, `liars-dice` | the games, as data (`games/*.json`): each loads to the game itself |
| `scene:template` | `tabletop.lost-cities`, `tabletop.santorini`, `tabletop.dominoes` (param `players`), `dice.liars-dice` | an empty scene's start screen: the game's table laid out in that scene, with its own art |
| `scene:part` | `tabletop.pawn`, `.token`, `.card-spot`, `.table`, `.lost-cities`, `.santorini`, `.dominoes-2`/`-3`/`-4` | the parts bin, under "Tabletop"; a game part makes a game doc of its own and links it where it's put (a Card table aboard a ship) |
| `scene:extension` | `tabletop` | hands, cards, Shuffle, Draw, Wash, Stand on edge, Lay my hand face up, and who may see what (the stage's `audience`) |
| `patchwork:datatype` / `tool`, `scene:source` | `die` | a die doc, its 2D panel, and its GLB at real size |
| `scene:extension` | `dice`, `dice.cup`, `dice.lots` | Roll, Turn, Roll all; dice cups; every roll's draw, by lots |
| `scene:part` | `dice.die`, `.d4` … `.d20`, `.coin`, `.percentile`, `.plus-minus`, `.doubling`, `.cup`, `.pool` | the parts bin, under "Dice" |
| `patchwork:datatype` / `tool`, `scene:source` | `bag`, `bag-sack` | a token bag doc, its panel, and a drawstring sack |
| `scene:extension`, `scene:part` | `bag`, `bag.token-bag` | the container verbs (trait `bag.container`); a new bag, under "Containers" |
| `scene:extension` | `keep.plain`, `card-table` | the plain keeper and the joint keeper (`keeper: "plain"`, `"joint"`) |
| `patchwork:datatype` | `keep-plain`, `secure-deck` (+ tool) | their containers (unlisted: a table's setup makes them) |
| `patchwork:datatype` / `tool` | `tts-import` | one import of a Tabletop Simulator mod |

**Seats** are the seats package's, met only through the stage: this package
tells it where each seat's hands are (`seatPlaces`), reads who sits where
from its `roster`, and lays a table's seats through the plugin with
`roster: true` (its module's `lay(d, seats)`). Without seats installed a
table is laid out with none, and the maker is told.

## Games

A game is registered as a `tabletop:game` plugin, from here or any other
package: `{ id, name, icon, players, blurb, load() }`, `load` resolving to
the game. The game page lists every registered game; starting from one
copies it into the doc. A template for it is `template(id)`
(`src/table/template.js`; or `template(params => id)`), a part `gamePart(id)`
(`src/table/parts.js`). Or paste a game into a game page's definition: it is
checked against the format (`contract/v1/validate.js`) before it's kept.

The doc: the game at its top level, `"@patchwork": { type: "tabletop-game" }`,
`drawn: { [kind]: { url, key, bounds } }` (each kind's GLB, `src/pieces.js`)
and `tables` (the scenes set up from it). `src/game.js` reads and writes it.

## A table

One writer makes every table (`src/setup.js`): `tableLayout` lays the game
out without writing; `prepareTable` (`src/table/made-with.js`) makes its
keepers' containers and its bags and finds whoever owns seats; `writeTable`
writes the scene in one change, with a fresh scene's maps (`src/empty-scene.js`)
and the scene package as its suggested import (`src/scene-package.js`).

- **Pieces.** Each kind is drawn once as a GLB `file` doc (`src/look/`:
  boxes, turned shapes, slabs with images cropped from file docs, OBJ
  models; a piece given as a document, a die, by its `scene:source`). From
  the game page the game keeps it (`drawn`) and redraws it in place; from a
  template or part the scene keeps it (`ctx.file`, under a hash of what it's
  drawn from). A board's `snapPoints` are connectors in its GLB.
- **Cards** (pieces with a `back`) are, in the scene, their back with the
  trait `tabletop.card`; what each really is goes only into a keeper's
  container (one per deck, one for loose cards), bound by the keeper's own
  trait to a slot. A `secure` deck goes to the joint keeper, any other to
  the plain one. Containers are titled by game and deck ("Lost Cities: Deck").
- **Hands**: a piece with a `zone` placed for a seat is that seat's hand,
  trait `tabletop.zone` `{ seat, min, max }`, +Z toward its player.
- **Bags**: what a bag's `contents` lists goes into a bag doc, never the scene.

**Who may see what** (`src/table/visibility.js`, the stage's `audience`):
anything in a hand is turned toward that seat's player and screened from
the rest; a card standing on edge facing a hand, likewise; a card face up
outside every hand (its +Y up in its parent's frame, judged from the doc, so
a table aboard a heeling ship agrees on every peer), everyone; anything else,
nothing. A keeper then draws each kept card by one rule (`src/keep/rule.js`):
its face if you're in the audience and your client knows it; the stage's veil
if it's turned toward you and not known yet; else its back.

**The verbs**, on the use prompt and the right-click menu: **Shuffle** (S, a
pile: the cards of one container overlapping by half, through their keeper),
**Draw** (D, the pile's top card into the first free card slot of your
seat's tray, gliding there as everyone watches), **Wash** (W, the face-down
tiles round it jumbled where they lie, `wash.js`), **Stand on edge / Lay
flat** (U, a piece thick enough, facing your hand, `stand.js`) and **Lay my
hand face up** (menu only). Wash, Stand, Draw and Lay are play's, not Edit's.
Each is told to everyone (`use("tell").tell`) as counts only, never which card; a
told message is a peer's word and changes nothing. A slot takes a piece by
its tags (`card`, `domino`); a rack's places hold a tile standing (a
connector with a whole frame, `slots.js`).

A copied card leaves its keeper's binding behind (the trait is `runtime`): a
bare back. A copied hand keeps its seat's id.

## Keepers

A keeper holds what objects are, away from the scene, and shows each only to
whoever the scene's policies say may see it (scene/CONVENTIONS.md, "Keepers"). It
is an ordinary extension, attached by its own trait `{ by: <container>, slot }`,
and contributes `keeper` (`of`, `shuffle`, `name`), which the table's Shuffle
and Wash use. Two objects naming one slot: the lower id keeps it.

**The plain keeper** (`keep.plain`, a `keep-plain` doc) is a table, not a
vault: anyone who opens the container reads every item, and anyone can write
it; what keeps a card from a viewer is their own client following the rule.
The HUD says so at every table that uses one. A shuffle permutes its slots in
one write.

**The joint keeper** (`card-table`, a `secure-deck` doc; `deck.js`) is mental
poker (Shamir, Rivest and Adleman) with commutative encryption in the
quadratic residues of RFC 3526's 2048-bit safe prime. Every key is derived
with HKDF from the player's one secret, linked from their account
(`player-secret.js`), so any device signed in plays the same seat. Once every
seat is taken the seated players' clients deal by a first shuffle of every
card; a shuffle (unify, mix, rekey) passes through every player in turn, and
a card's face is decrypted only with every other player's key, handed over
only when the holder's own reading of the scene says the reader may see it.

Its threat model: someone who opens the documents sees the multiset of
items and who handed keys for which position, never which item is where; a
cheating client can stall a shuffle, corrupt its pass unproven, withhold a
key or forge unsigned writes, but can't read a card alone; anyone who can
write the scene can change an audience (sit, carry a card into their hand,
turn it over), which everyone sees; a key handed over stays handed over (a
reshuffle voids old ones). Not yet: it needs every player's client in turn
(the HUD says whom it waits for), runs on the main thread, proves nothing,
and fixes its players at the deal.

In both, the scene itself (objects, names, ids, order, groups, the files a
view fetches) says nothing of what anything is, and with the audience
unknown (a package the scene lists missing here) nothing is shown.

## Dice

A die is a document (`src/dice/die.js`): `shape` (d4, d6, d8, d10, d12, d20,
coin), `size` in metres, `body` and `ink`, `turnOnly`, and `faces` (marks:
pips, numbers, symbols, text; a name, a colour, a turn), edited in its panel. The
`die` source builds it at real size (`die-glb.js`), and its GLB says what it
is in `extras.dice` (each face's up direction, rest height, label): the
extension reads a die only from there, so anything with that and the
`dice.die` trait is a die. A die lies on its parent: rolled, turned and read
against its parent's +Y.

Every roll's face is drawn **by lots** (`lots.js`, pure; `lots-run.js`;
`lots-ext.js` in a scene, `panel-lots.js` in the panel): a seed the clients
of those present (the seated, else everyone here) commit to and open, so
nobody chooses it. A thrown group is one draw. Turning a die by hand is not a
roll.

A **dice cup** (trait `dice.cup` `{ holder, up, blind, roll, round }`,
`cup.js`) is 9 cm tall; down, it covers the dice within 38 mm of it. **Shake**
(S) draws a roll whose seed is sealed to its holder (or, blind, to everyone
else), so only they see the dice under it; **Peek** (hold P), **Lift** (L)
turns them up for all; **Knock over** likewise. A cup down over dice can't
be carried.

## Bags

A token bag is a container document (`src/bag/`): `{ title, look: { color,
size }, rule: "random" | "random-replace" | "top", items }`. Things dropped
on it go in, **Draw** (D) takes one out into your hand, a label shows how
many. An item is its whole object record but for where it was, so what comes
out is what went in, under its own id; a draw with replacement makes a copy.
`contents.js` alone reads and writes `items`: each put is a new entry nobody
else can write, and a take marks only the puts it saw, so no merge of two
peers' puts and draws loses an item (`moves.test.js` searches every
interleaving). It is out of sight, not secret: anyone who opens the bag doc
reads it, and the panel says so. Its limits: a stray (an item both in the
scene and listed) stays listed; a peer's edit made while it goes in is lost;
a drawer knows it won only after the merge, and the loser draws again.

## Importing a TTS mod

Make a **Tabletop Simulator import** and drop on it a mod's `.json`
(`Mods/Workshop/<id>.json`, or a save) with its cached assets: files, a
folder (the whole `Mods` folder is fine) or a `.zip`. It shows progress and a
report (objects, pieces, assets from the cache or fetched or missing, what
was left out or is a stand-in); **Open the game** opens the game it made.
Settings: metres per TTS unit, bags' contents, fetching, mirroring OBJ x.

It writes a `file` doc per asset (`origin: { urls }`) and one
`tabletop-game` (`origin: { tts: { saveName, fileName, workshopId } }`), no
scene: a table is set up from the game as from any other. Cards and decks
(never `secure`: tick it on the game page), tiles, tokens (cut out), boards,
`*_Stack`s, models, bags, dice (a die doc), standees, hand triggers (a seat
and its tray), snap points, tags and `Locked` come across
(`src/tts/translate.js`); Lua, XML UI, other `States`, 3D text and notecards
never. Import a publisher's module only where they've shared it: the copies
live in synced documents.

## Layout

| path | what |
|---|---|
| `src/index.js` | every plugin's metadata (worker-safe: no imports) |
| `src/datatype.js`, `tool.js`, `game.js`, `pieces.js` | the game doc and its page |
| `src/setup.js`, `src/table/` | the table writer, what it's made with, the table extension, visibility, slots, wash, stand, parts, templates |
| `src/look/`, `src/shapes.js`, `src/glb.js` | a piece's GLB (the encoder: the scene's, forked with textures) |
| `src/dice/`, `src/bag/`, `src/keep/`, `src/tts/` | dice, cups and lots; bags; keepers; the importer |
| `src/kit/glb.js` | the scene's kit GLB encoder (a copy: `scripts/check-kit.mjs`), for dice and bags |
| `src/empty-scene.js`, `scene-package.js` | a fresh scene doc (a copy of the scene's init); a doc's suggested import |
| `src/test/` | the stage stand-in (`fakes.js`), the telling copy, stand-ins for seats, fake repos, a PNG codec |
| `GAME-FORMAT.md`, `contract/v1/` | the format: spec, schema, validator, fixtures |
| `games/`, `fixtures/tiny-mod/` | the games; the TTS fixture mod (`make-tiny-mod.mjs`) |
| `scripts/bench.mjs` | the joint shuffle's cost |

## Probes

Headless Chrome against the BUILT scene, seats and this package (`pnpm build`
in each), each printing a checklist: `table.mjs`, `draw.mjs`, `privacy.mjs`,
`seats.mjs`, `stations.mjs`, `dominoes.mjs`, `arrive.mjs` (arriving by link
without this package: fail closed, then Load), `dice.mjs`, `liars-dice.mjs`,
`bag.mjs`, `import-run.mjs`. `publish-table.mjs`, `publish-office.mjs` and
`publish-liars.mjs` publish examples to a sync server (`--dry-run` to only
check). `chrome-guard.mjs` makes sure Chrome never outlives its driver.

## Not yet

- Rules, turns, scoring: the players'. A move could be checked from the doc;
  nothing does.
- Printed faces for the built-in card games; Santorini's god powers.
- A sealed keeper (an authored secret opened later): it needs a private
  place in the stage.
- A fair, jointly drawn value for a bag's draw (`draw.js drawIndex`).
- From TTS: Lua and XML UI (by design), asset bundles, normal maps, custom
  dice images, card shapes other than rectangles.
