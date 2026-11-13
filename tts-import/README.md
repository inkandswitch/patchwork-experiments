# tts-import

A translator: a **Tabletop Simulator** mod in, a **tabletop game** out. A
mod's starting table — its cards and decks, tiles, tokens, boards, models,
bags, dice and seats, every one where TTS had it — becomes a game in the
[tabletop-game format](../tabletop/GAME-FORMAT.md), and each of the mod's
images and models it uses becomes a `file` doc that says which of the mod's
URLs it came from. It writes no scene: a table is set up from the game by
the tabletop package, exactly as for a built-in game, so shuffling, drawing,
private hands, the secure deck (a deck ticked *secure* on the game page),
bags and dice work on an imported game with
no code here. Scripting is left behind on purpose: `LuaScript`,
`LuaScriptState` and `XmlUI` are never read.

```
pnpm install && pnpm build && pnpm test
```

## Using it

Make a **Tabletop Simulator import** and drop onto it the mod's `.json`
(`Mods/Workshop/<id>.json`, or a save from `Saves/`) together with its cached
assets — the files themselves, a folder (TTS's whole `Mods` folder is fine:
only the files this mod uses are ever read), or a `.zip`. It shows its
progress, then a report: how many objects, pieces, cards, bags, dice and
seats, which assets came from the cache, which were fetched, which are
missing and who uses them, what was left out or is a stand-in. **Open the
game** opens the game it made in the tabletop-game tool, which draws its
pieces and sets up tables.

Settings (on the import doc): metres per TTS unit, whether bags' contents
come along, whether to fetch what wasn't dropped, and whether OBJ models are
mirrored in x on load (as TTS does).

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `tts-import` | one import: settings, progress, report, the game it made (listed) |
| `patchwork:tool` | `tts-import` | drop zone, progress, report, *Open the game* |

It depends on no other package: it writes `file` docs and one
`tabletop-game` doc in the shapes their owners document (the format is
tabletop's; the importer's tests check against a copy of its validator,
`src/test/contract/`), and opens the game with the `tabletop-game` tool by id.

## Where it came from

Every document an import makes says which of the mod's URLs it came from, so
a game made from a publisher's module carries its provenance wherever it is
shared, and a withdrawn module's assets can be found and removed:

- each stored asset (`file` doc): `origin: { urls: [<the mod's URL>] }`;
- the game: `origin: { tts: { saveName, fileName, workshopId } }`, the
  Workshop id read from a `Mods/Workshop/<id>.json` file name, else null.

The tabletop package carries both on: each piece's GLB it draws from those
file docs says `origin: { urls }` (theirs), and every table set up from the
game carries the game's `origin`.

Importing copies the assets, as Tabletop Simulator's own cache does, but the
copies live in synced documents that anyone given the game can open. So
import a publisher's module only where the publisher has shared it (their own
Workshop upload), and keep what you import out of public example folders
unless the publisher has agreed.

## Getting the assets

TTS refers to every asset by URL and caches what it downloads in `Mods/`:
`Models/*.obj`, `Images/*.png|jpg`, `PDF/*.pdf`. A cached file is named after
its URL **with every character that isn't a letter or a digit removed**, plus
an extension — checked against a real cache (`src/cache.js`). Steam's retired
`http://cloud-3.steamusercontent.com/ugc/…` URLs are cached under the name of
the new host, `https://steamusercontent-a.akamaihd.net/ugc/…`, so that rewrite
(and http ↔ https) is tried too: in this machine's cache, one mod's 47 URLs
found 36 files by the plain rule and another's 30 found 17 only through the
rewrite. A hand-made folder works as well when files are named like the
URL's last segment (`abc.png` for `https://i.imgur.com/abc.png`).

Anything not dropped is fetched from its URL if *Fetch what wasn't dropped* is
on. Many hosts don't allow cross-origin reads (CORS), so expect misses there;
a missing asset never fails the import — the piece names no file, and is drawn
without it (in its colour, or a see-through stand-in box for a model) — and the
report lists the URL, who uses it and why (not dropped, fetch failed, couldn't
read, not an image / a dead link's web page). Only `.obj` and images are used;
Unity asset bundles (`Custom_Assetbundle`) are stand-ins. An image's size is
read from its header (`src/image-size.js`), for a tile cut to its picture;
nothing is decoded here.

## Units and axes

TTS is Unity: **left-handed, Y up**, lengths in "in-game units" that the TTS
knowledge base calls "about an inch", Euler angles in degrees applied Z, then
X, then Y. The format is the scene's: right-handed, Y up, metres, Euler XYZ
radians, no scale on a thing. `src/convert.js` mirrors z:

```
position (x, y, z)              → (x, y − tableY, −z) · u        u = 0.0254 m per unit (a setting)
rotation R = Ry(y)·Rx(x)·Rz(z)   → M·R·M = Ry(−y)·Rx(−x)·Rz(z), M = diag(1, 1, −1), as Euler XYZ
a mesh point p, scale S          → M·(S·p) · u                    a model part's matrix: diag(±Sx·u, Sy·u, −Sz·u)
```

A look is built in the format's frame (`src/translate.js`), the object's TTS
scale baked into its sizes, its TTS origin kept as its piece's origin, so a
TTS position is the thing's position. An image's top in TTS reads from TTS's
−Z, the format's +Z mirrored, so every slab image is `turn: 180`
(GAME-FORMAT.md §4). A face-down deck is written level with `faceDown: true`
(R·Rz(180°) and a half turn back), so its stack builds upward; a test checks
all 64 quarter-turn poses come out as TTS has them.

Mirroring z (not x) keeps TTS's seats — most mods put players' hands at −Z,
facing +Z — on the scene's near side, where its camera is. Non-uniform scale is
baked into each look, so a thing has no scale. `tableY`, the TTS height
of the table top, is the commonest resting height of the top-level flat things (cards, decks, tiles, tokens, boards: their feet from their known thicknesses)
(0.94–0.96 in the mods tried).

**Confidence.** The axis and rotation conversion is high: a test round-trips
every rotation of a 9 × 9 × 9 grid of TTS angles (the quarter turns, where
Euler triples are degenerate, among them) at the origin and the three unit
points of a non-uniformly scaled object (TTS world point, converted == scene
world point of the baked point; both are affine in the point, so those four
settle every point) and checks the Euler decomposition against three's on
the same grid; the browser probe shows text on boards, mats, cards and
models reading correctly (not mirrored, right way up from the near side). Unity's rotation order and matrices are from Unity's
documentation, matched by real saves (a d6's `RotationValues` give opposite
faces summing to 7). The unit is medium: "about an inch" is all TTS says; a
TTS card comes out 56 × 79 mm against a real 63 × 88 mm, so TTS tables are a
little under life size at 0.0254 — change *One TTS unit is* if you prefer
cards true to size (≈ 0.0286).

### Sizes

None of these is documented; each was read off real mods (this machine's TTS
cache), and they're constants in `src/translate.js`.

| object | at scale 1 | evidence | confidence |
|---|---|---|---|
| card | 2.2 × 3.1, 0.02 thick | the tightest spacing of rows of cards across 40 mods (2.2 / 3.3); cards land in their slots on real mats | medium |
| tile | 2 deep, 2 × aspect wide (Stretch on; 2 × 2 off); origin on its bottom face, `Thickness` thick | snap points on 2 × aspect mats reach past x = 1 but never z = 1; tiles lying on the table have posY = the table top and snap points at y = Thickness; stacked tiles step by Thickness | medium-high |
| token | as a tile, but centred | a 0.2 token on a mat rests 0.1 above it | medium |
| board | 18 deep, 18 × WidthScale wide; snap x before WidthScale | snap points of 25 boards fit ±8.2 in both axes whatever WidthScale is | low |
| d6 | 1 across | — | low |
| figurine | 2 × ImageScalar tall | — | low |

Tile `Type` 0 box, 1 hex, 2 circle, 3 rounded box is a guess (the KB names
the shapes but not their numbers). Custom_Dice `Type` 0–5 = d4, d6, d8, d10,
d12, d20 matches the saves seen (`Type: 1` on six-sided dice with six
`RotationValues`).

## What becomes what

| TTS | in the game |
|---|---|
| `Card`, `CardCustom` | a card: a slab, its cell of the face sheet on top, the back (or its cell, `UniqueBack`) underneath, naming its back piece (the back image on both sides, tagged `card`). Kept wherever it lies |
| `Deck`, `DeckCustom` | a deck listing its cards, top first (`ContainedObjects[0]`), where the deck is; face down: level and `faceDown`. Never `secure` (anyone at a TTS table can search a deck): ticking a deck *secure* on the game page is all it takes for its players to shuffle it between them |
| `Custom_Tile`, `Custom_Board` | a slab (rect, hex, circle or rounded by `Type`), `ImageURL` on top, `ImageSecondaryURL` underneath, else the top again; sides in `ColorDiffuse` |
| `Custom_Token` | a `cutout` slab: the tabletop's drawer makes a round image a disc, any other transparent shape alpha-masked faces without sides |
| `*_Stack` (`Number`) | one thing of that many copies, stacked by its thickness (`count` and `grid`) |
| `Custom_Model`, `Custom_Model_Bag`, … | a model part: the OBJ file doc through a matrix (scale, the x mirror, units, the z mirror), its diffuse texture, tinted `ColorDiffuse`; `MaterialIndex` → roughness / metalness |
| `Bag`, `Infinite_Bag` | a bag (`rule: "random"`; an infinite bag hands out copies, `"random-replace"`), a pouch unless it has a mesh, holding what TTS had in it |
| `Die_N`, `Custom_Dice` | a die document of its shape (`d4`…`d20`), numbered the usual way, sized from its scale, with the trait `dice.die`: the dice package draws and rolls it. A custom die's image isn't carried |
| `Figurine_Custom` | a standee: its image (and its back) on a slab stood up facing +Z, on a round base |
| `Custom_PDF` | a blank sheet (the PDF isn't stored) |
| chess / checkers / blocks / pawns | simple stand-in shapes |
| `HandTrigger` | a seat (with a camera from that hand), and its hand: a tray in the seat's colour with card slots across it (each reaching halfway to the next, its `snapRadius`), its zone the trigger's box, +Z toward its player |
| `AttachedSnapPoints`, `SnapPoints` | the pieces' snap points, and the table's: position, rotation (converted like any other) and tags |
| `Tags` | the piece's `tags`: a tagged snap point takes only objects with one of its tags, as in TTS |
| `Locked` | the piece's `locked` |
| other `States`, triggers, `3DText`, `Notecard` | left out (counted in the report) |
| the table | a locked slab under everything, the mod's `TableURL` on top, its top at y = 0 |
| `Note`, `Rules` | the game's `about`, after a line saying where it came from |

A piece is everything its look and behaviour depend on (images and cells,
shape, size, scale, colour, snap points, tags, locked) and nothing else, so
thirty identical tokens are one piece, and one GLB when drawn. Its id is a
hash of that (`p…`).

## Documents

### `tts-import`

```ts
{
  "@patchwork": { type: "tts-import" },
  title: string,
  status: "empty" | "importing" | "done" | "error",
  error: string | null,
  progress: { phase: string, done: number, total: number } | null,
  settings: { metresPerUnit, includeContents, fetchMissing, flipObjX, maxObjects, maxStoredBytes },
  gameUrl: AutomergeUrl | null,      // the latest game
  games: AutomergeUrl[],             // every game imported here
  report: {
    mod: { saveName, gameMode, fileName, table, objects },
    counts: { byName: { [Name]: n }, things, cards, decks, bags, dice, seats, pieces, placed, tableY,
              skipped: { [label]: n }, approximated: { [Name]: n },
              assets: { needed, cache, fetched, missing, referenced } },
    assets: { [key]: { url, role: "image" | "model", source: "cache" | "fetch" | null,
                       fileUrl: AutomergeUrl | null, bytes, mimeType, usedBy: string[], uses, error? } },
    warnings: string[], gameUrl, finishedAt
  } | null
}
```

### What an import writes

- a `file` doc per asset the game uses: `{ "@patchwork": { type: "file" }, name, extension, mimeType, content, origin: { urls: [<its URL>] } }`
  (an OBJ as text, images as bytes; one over `maxStoredBytes`, 32 MB, isn't kept, and what uses it is drawn without it);
- one `tabletop-game` doc: the game (GAME-FORMAT.md) at its top level, `origin: { tts }`, `drawn: {}`,
  `tables: []`, `"@patchwork": { type: "tabletop-game" }`.

Nothing else: no scene, no keeper's container, no bag doc. Those are made
when a table is set up, by whoever makes them.

## Not yet

- Lua, XML UI and everything scripted, by design.
- Unity asset bundles (`Custom_Assetbundle`): stand-in boxes.
- Normal maps (`NormalURL`), colliders, custom materials beyond `MaterialIndex`.
- Tokens are not traced: a non-round cut-out is alpha-masked faces without sides.
- Card shapes other than rectangles (CustomDeck `Type`), rounded card corners.
- Custom dice's images and `RotationValues` labels: a die is the dice package's numbered die.
- Other `States`, `3DText`, notecards, counters, calculators, PDFs' pages.
- Board size (18 at scale 1) and the board snap-point frame are the least certain guesses.
- Big mods: `maxObjects` (5,000) stops runaway mods (Frosthaven Enhanced reaches it).
- CORS: fetching is best-effort; the cache is the reliable route.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/datatype.js`, `src/settings.js` | the datatype and its default settings |
| `src/tool.js`, `src/styles.css` | the tool |
| `src/inputs.js` | drops, folders and zips → sources, read lazily |
| `src/importer.js` | the import: find the save, find and store the assets the game uses, translate, report |
| `src/translate.js` | a save → a tabletop-game (pure) |
| `src/tts.js` | reading a save (pure) |
| `src/cache.js` | URL → cache file name, the dropped files' index (pure) |
| `src/convert.js` | TTS → the format's transforms, units and axes (pure) |
| `src/cards.js` | CardID → sheet cell (pure) |
| `src/image-size.js`, `src/sniff.js` | an image's size from its header; file type sniffing (pure) |
| `src/test/` | a PNG codec, an in-memory repo, the fixture, and a copy of the format's validator (`contract/`) |
| `fixtures/make-tiny-mod.mjs`, `fixtures/tiny-mod/` | a synthetic mod in TTS's folder layout (regenerate with `node fixtures/make-tiny-mod.mjs`) |
| `probes/` | the browser probe |

Drawing pieces (slabs, OBJ models, image crops, the textured GLB encoder) moved
to the tabletop package (`tabletop/src/look/`), which draws any game's.

## Testing

`pnpm test` runs the unit tests: parsing, the cache naming rule, transforms
(the round trip above), card cells, every quarter-turn pose of a face-down
deck, each tile shape, die and bag kind, image headers, whole imports of the
fixture (also from a zip) against an in-memory repo, each game checked against
the format; and five real mods from this machine's TTS cache when it's there
(`src/real-mods.test.js`: the two Earthborne Rangers and Frosthaven Enhanced,
whose assets the cache holds, and Planet X and Mantis Falls, whose it
doesn't), each imported whole and its game checked. The fixture's game is
also checked to be, whole, the format's fixture of it (`src/test/contract/`),
which tabletop's tests set up and play: Shuffle, Draw into the seat's hand,
a deck ticked secure, the bag and the die, with nothing of the importer's.

The browser probe imports with the **built** tool in headless Chrome, as a drop
of real `File`s, presses *Open the game*, lets the **built** tabletop-game tool
draw every piece and set up a table, and mounts the **built** scene tool on it
(with seats, keep, bag and dice installed, each from its own `dist`, loaded at
runtime by URL for verification only), then plays it as anyone would: sits
in the game's first seat, hovers the top card of the biggest pile the pointer
can reach, presses D, and checks the card lands in that seat's hand where only
the one sitting there may see it. It screenshots each step:

```
pnpm build && for p in scene seats tabletop keep bag dice; do (cd ../$p && pnpm install && pnpm build); done
node probes/import-run.mjs                       # the fixture
node probes/import-run.mjs --mod "$HOME/Library/Tabletop Simulator/Mods/Workshop/<id>.json" \
  --cache "$HOME/Library/Tabletop Simulator/Mods" [--query contents=0] [--out dir] [--port 4493]
```

With `--mod` it drops the JSON and exactly the cache files the mod refers to.
Nothing is downloaded.
