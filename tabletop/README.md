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
| `tabletop:game` | `santorini` (2 or 3 players), `lost-cities`, `draw-dominoes` (2, 3 or 4), `liars-dice` | the games, as data (`games/*.json`): each loads to the game itself |
| `scene:template` | `tabletop.lost-cities`, `tabletop.santorini`, `tabletop.dominoes` (param `players`), `dice.liars-dice` | an empty scene's start screen: the game's table laid out in that scene, with its own art |
| `scene:part` | `tabletop.pawn`, `.token`, `.card-spot`, `.table`, `.lost-cities`, `.santorini`, `.dominoes-2`/`-3`/`-4` | the parts bin, under "Tabletop"; a game part makes a game doc of its own and links it where it's put (a Card table aboard a ship) |
| `scene:extension` | `tabletop` | hands, cards, Shuffle, Draw, Wash, Stand on edge, Lay my hand face up, and who may see what (the stage's `audience`) |
| `scene:extension` | `tabletop.start`, `tabletop.states` | Start game (a recipe's start steps); turning a piece to another of its states |
| `patchwork:datatype` / `tool`, `scene:source` | `die` | a die doc, its 2D panel, and its GLB at real size |
| `scene:extension` | `dice`, `dice.cup`, `dice.lots` | Roll, Turn, Roll all; dice cups; every roll's draw, by lots |
| `scene:part` | `dice.die`, `.d4` … `.d20`, `.coin`, `.percentile`, `.plus-minus`, `.doubling`, `.cup`, `.pool` | the parts bin, under "Dice" |
| `patchwork:datatype` / `tool`, `scene:source` | `bag`, `bag-sack` | a token bag doc, its panel, and a drawstring sack |
| `scene:extension`, `scene:part` | `bag`, `bag.token-bag` | the container verbs (trait `bag.container`); a new bag, under "Containers" |
| `scene:extension` | `keep.plain`, `card-table` | the plain keeper and the joint keeper (`keeper: "plain"`, `"joint"`) |
| `patchwork:datatype` | `keep-plain`, `secure-deck` (+ tool) | their containers (unlisted: a table's setup makes them) |
| `patchwork:datatype` / `tool` | `tts-import` | one import of a Tabletop Simulator mod |
| `patchwork:datatype` / `tool` | `game-library` | a library of games and sessions, and its launcher |

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
(`src/table/template.js`; its params are the game's options), a
part `gamePart(id, options?)` (`src/table/parts.js`). Or paste a game into a game page's definition: it is
checked against the format (`contract/v2/validate.js`) before it's kept.

The doc: the game at its top level (its `assets` too: each web asset it
has cached, by URL), `"@patchwork": { type: "tabletop-game" }`, `drawn: {
[kind]: { url, key, bounds, missing? } }` (each kind's GLB, once something
has needed it: `src/pieces.js`) and `tables` (the scenes set up from it).
`src/game.js` reads and writes it.

## The library

A **game library** (`src/library/`) is a folder-shaped doc, `{ title, docs }`
(`DocLink = { name, type, url }`), made holding two plain folder docs linked
as folders: **Games**, the game descriptions (tabletop-game docs), and
**Sessions**, the scenes played from them. The sidebar shows it as a folder,
and its default tool is the launcher; **Open as folder** shows it in the
folder tool (`folder-viewer`), which reads it as any folder.

The launcher (`tool.js`, every step in `actions.js`, the data in `model.js`):

- **New game** renders a description into a fresh scene as its recipe lays
  it out for the options chosen beside it (GAME-FORMAT.md §6: how many play,
  which memory bag to lay out…; `src/options-form.js`), through the game
  page's own path (`src/table/session.js`), links it in Sessions as the
  game, its options and the time ("Draw Dominoes (3 players),
  2026-11-18 21:30") and opens it. The description draws what the table lays
  out (`drawn`) and caches web assets (`assets`), so every session of it
  shares both. A game with seats is never set up without them: where nothing
  installed owns seats, it first loads the seats package (`PUBLISHED.seats`,
  as the scene loads a listed package: `src/table/load-package.js`), saying
  "Loading seats…", and sets nothing up if it can't, saying why.
- **Continue** opens a session; Sessions lists the newest first (each link
  a list insert: two people starting games at once both appear).
- **Fork** copies a session into a new scene doc by the scene's copy rule
  (`copy-rule.js`, a copy of scene/src/transfer.js's): every object under its
  id; the stage's runtime fields, runtime traits (a keeper's binding: a card
  is a bare back) and `copy: "drop"` fields left behind; each `entries`
  trait's entries set back to its `init` (the seats emptied). A built
  object's render doc is copied, as paste copies it, and each bag's doc (a
  plain bag's with what is inside it as the session reads it). The copy is
  linked as "<name> (copy)", says `forkedFrom: { url, heads }` and opens;
  it draws from the same description's `drawn` and `assets`.
- **Import a TTS mod…** takes the mod's `.json` with any cached assets (or a
  `.zip`) through the importer at its default (assets by URL, fetched when
  first drawn; **Fetch every asset now** for offline play) into Games.
- **Add the built-in games** makes a description of each registered
  `tabletop:game` the library hasn't one of (`origin.builtIn` says which),
  then takes out each link after the first to the same game: idempotent,
  even pressed on two peers at once.

The start screen keeps a `scene:template` per game (metadata only,
`template(id)`): an empty scene has no description to start from, and a
template's params are fixed in its metadata.

## A table

One writer makes every table (`src/setup.js`): `tableLayout` lays the game
out without writing (as its recipe lays it out for the options chosen:
`contract/v2/recipe.js` `applyRecipe`, and its start steps resolved to the
table's objects); `prepareTable` (`src/table/made-with.js`) makes its
keepers' containers and its bags and finds whoever owns seats; `writeTable`
writes the scene in one change, with a fresh scene's maps (`src/empty-scene.js`),
the packages it needs in `packages` (the scene's, the seats owner's, this
one's where it calls for it) and the scene package as its suggested import,
from the registry where it can say, else where each is published
(`src/scene-package.js` `PUBLISHED`, which must match each package's pushwork
`rootUrl`): so a viewer with only this package installed is offered the scene.

- **Pieces.** Each kind is drawn once as a GLB `file` doc (`src/look/`:
  boxes, turned shapes, slabs with images cropped from file docs, OBJ
  models; a piece given as a document, a die, by its `scene:source`). From
  the game page the game keeps it (`drawn`) and redraws it in place; from a
  template or part the scene keeps it (`ctx.file`, under a hash of what it's
  drawn from). A board's `snapPoints` are connectors in its GLB.
- **On demand** (`src/pieces.js` `pieceDrawer`). The game page's "Set up a
  table" draws only what the table lays out (`kindsLaid`: its things, a
  card as its back, what's in a bag); a card's face is named in its
  container by the game and its kind, and drawn the first time a keeper is
  to show it to someone (`src/table/faces.js`): with every face of its
  group (`groupsOf`: the cards it may share a container with, and those cut
  from the same sheets, closed over both), its sheets fetched in URL order,
  its docs created and recorded in kind order in one change, so the game
  says only that a card of that group was seen, which its container already
  says, never which. The viewer who draws it sees
  it at once (its bytes), then its doc. An asset named by its web URL is
  read from the file doc the game's `assets` caches it in, else fetched,
  stored and cached there; two viewers doing either at once each write
  theirs only where nothing is yet, and the merge keeps one. A viewer who
  can't write the game draws for themselves and writes nothing. An image
  over 32 MB (Sovereign's player decks are 7700 × 3174 PNGs of 33 MB) is
  halved until it fits, as the importer stores one (`tts/shrink.js`), and
  drawn from and stored at that size; where the page can't re-encode it, it's
  drawn from as it is and not stored. What a
  host won't give (no CORS) is drawn without, its URL in `drawn[kind].missing`
  and on the game page, and fetched again when next needed after ten minutes.
  A template's or part's table (built-in games, small) draws every kind up front.
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

**Turn to a state** (`src/table/states.js`): a piece with other looks
(GAME-FORMAT.md §4, "States": a damaged ship, a board's look for three)
turns to its next one with PgDn, the one before with PgUp, or the n-th with
a number key, as in TTS, for everyone: one write of the thing's trait
`tabletop.states` (`shown`), play rather than an edit. Its own file is the
look it was laid out in; the look it's turned to is shown over it by the
stage's display, drawn the first time anyone is shown it (as a card's face
is, `faces.js`) and kept in the game's `drawn` under its ref. Which look it
shows is runtime state, so a copy (a fork) shows the one it was laid out
in, and two people turning it at once leave the last write. A state is a
public look; a card has none. A piece in someone's hand is seen turned by
that seat alone (the hand's rule).

**Start game** is the table's, on the bar of tools in every body (and the
menu), where its game's recipe has start steps (GAME-FORMAT.md §6:
Draw Dominoes deals each rack 7 tiles, 6 with four). It is disabled, saying
whose seat is empty, until every seat is taken; then it asks the cards'
keeper to shuffle, moves the dealt cards into each seat's card slots (and
drawn ones face up onto their thing) in one change, and records that it
started. Who goes first is drawn by lots between the seated players'
clients (as a die's roll is: nobody chooses it, whoever pressed Start
included), and the HUD says it. Once started it says so and does nothing
again (`start.js`, an extension of its own); it's told as "Ann started the
game, dealing 7 to each seat". Like the other verbs it isn't the editor's undo.

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
pips, numbers, symbols, text; a name, a colour, a turn; and a picture,
`image: { file, rect? }`, a cell of an image covering the side, as a TTS
custom die's faces are), edited in its panel (all but the picture). The
`die` source builds it at real size (`die-glb.js`: a pictured face with its
picture where whoever builds it can crop images, as a game's drawer does,
else with its marks), and its GLB says what it
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
report (objects, pieces, assets from the cache, fetched, to be fetched
when first drawn, or missing; what was left out or is a stand-in); **Open
the game** opens the game it made. Settings: metres per TTS unit, bags'
contents, fetching every asset now (for playing offline), mirroring OBJ x.

It writes one `tabletop-game` (`origin: { tts: { saveName, fileName,
workshopId } }`), its pieces naming each asset by the mod's own URL, and a
`file` doc (`origin: { urls }`) for each asset that came with the mod,
cached under its URL in the game's `assets`; the rest are fetched when
something is first drawn from them. A tile or token is as wide as its
picture says (`aspect: "image"`), measured when it's drawn. No scene: a
table is set up from the game as from any other. Cards and decks
(never `secure`: tick it on the game page), tiles, tokens (cut out), boards,
`*_Stack`s, models, bags, dice (a die doc; a custom d6's faces cut from its
image, each named by its RotationValue), standees, hand triggers (a seat
and its tray), snap points, tags, `Locked` and other `States` (the piece's
states, each named by its Nickname; a thing saved in another state is laid
out in it) come across (`src/tts/translate.js`); Lua, XML UI, a card's
States, 3D text and notecards never. A custom d6's image is read as TTS's own
template (Modding/Dice Templates/D6.png): thirds, the top row unused, 2 4 5
then 1 3 6, each the side TTS's default RotationValue of that number turns up. What the mod's data says of its setup becomes the game's recipe:
how many play (a seat per hand, the last in TTS's colour order left out for
fewer, as few as its PlayerCounts says); each **memory bag** (a bag whose
script state saved where each thing in it goes, MrStump's and its copies:
Earthborne Rangers' ranger cards) a layout to choose, its things laid where
it saved them, out of the bag (bags laying out one spot are one choice);
and shuffling its face-down decks at the start, off unless chosen. A setup
done in plain Lua is left for later. Import a publisher's module only where they've shared it: the copies
live in synced documents.

## Layout

| path | what |
|---|---|
| `src/index.js` | every plugin's metadata (worker-safe: no imports) |
| `src/datatype.js`, `tool.js`, `game.js`, `pieces.js` | the game doc and its page |
| `src/setup.js`, `src/states.js`, `src/table/` | the table writer, a piece's looks by ref, what it's made with, the table extension, Start game, states, visibility, slots, wash, stand, parts, templates |
| `src/look/`, `src/shapes.js`, `src/glb.js` | a piece's GLB (the encoder: the scene's, forked with textures) |
| `src/dice/`, `src/bag/`, `src/keep/`, `src/tts/` | dice, cups and lots; bags; keepers; the importer |
| `src/library/` | the game library and its launcher |
| `src/kit/glb.js` | the scene's kit GLB encoder (a copy: `scripts/check-kit.mjs`), for dice and bags |
| `src/empty-scene.js`, `scene-package.js` | a fresh scene doc (a copy of the scene's init); a doc's suggested import |
| `src/test/` | the stage stand-in (`fakes.js`), the telling copy, stand-ins for seats, fake repos, a PNG codec |
| `GAME-FORMAT.md`, `contract/v2/` | the format: spec, schema, validator, the recipe (`recipe.js`), fixtures |
| `games/`, `fixtures/tiny-mod/` | the games; the TTS fixture mod (`make-tiny-mod.mjs`) |
| `scripts/bench.mjs` | the joint shuffle's cost |

## Probes

Headless Chrome against the BUILT scene, seats and this package (`pnpm build`
in each), each printing a checklist: `table.mjs`, `draw.mjs`, `privacy.mjs`,
`seats.mjs`, `stations.mjs`, `dominoes.mjs`, `arrive.mjs` (arriving by link
without this package: fail closed, then Load), `dice.mjs`, `liars-dice.mjs`,
`bag.mjs`, `import-run.mjs`, `library-run.mjs` (the launcher: built-in
games, New game, Fork, Import, in an in-memory repo), `setup-run.mjs` (a
real mod from this machine's TTS folder and cache, offline: Earthborne
Rangers Demo's memory bags as New game's options, for two, then Start),
`states-run.mjs` (Arcs from this machine's TTS folder, offline, its assets
the cache lacks answered by stand-ins of about their size: set up for four
by New game, a ship turned to Damaged and back with PgDn, a custom die
rolled showing its pictured face), `sovereign-run.mjs` (a mod with its
REAL art, Sovereign: Fall of Wormwood by default: its JSON alone imported,
New game for four, four views of the session each its own peer, each
seated, five drawn into each hand from a deck turned face down, each hand's
faces shown to its seat alone; the page's fetches answered from the files
`fetch-assets.mjs` fetched beforehand, with the CORS header each host sent,
which it also tabulates per host). `setup-bench.mjs` (Node, offline: a real
Automerge repo with no network) times importing a big mod, setting up a
table from it and showing a card's face, phase by phase, with stand-in
assets, counting the docs, changes, fetches and decodes each makes;
`decode-bench.mjs` (headless Chrome, the source unbuilt) times drawing what
that table lays out with the browser's own image backend, one decode at a
time against several. `publish-table.mjs`, `publish-office.mjs` and
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
  dice other than d6 (numbered plainly: their templates' faces are
  triangles, kites and pentagons, a d4's read at its corners, not cells), a card's States, card shapes other
  than rectangles.
