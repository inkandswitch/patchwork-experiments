# tts-import

Brings a **Tabletop Simulator** mod's game assets into Patchwork: its models,
card sheets, tiles, tokens, boards and dice become documents, and its starting
table becomes a [scene](../scene/README.md) that opens in the scene's hand.
Scripting is left behind on purpose: `LuaScript`, `LuaScriptState` and `XmlUI`
are never read.

```
pnpm install && pnpm build && pnpm test
```

## Using it

Make a **Tabletop Simulator import** and drop onto it the mod's `.json`
(`Mods/Workshop/<id>.json`, or a save from `Saves/`) together with its cached
assets — the files themselves, a folder (TTS's whole `Mods` folder is fine:
only the files this mod uses are ever read), or a `.zip`. It shows its
progress, then a report: how many objects, what was drawn, which assets came
from the cache, which were fetched, which are missing and who uses them, what
was left out or drawn as a stand-in. **Open the table** opens the scene.

Settings (on the import doc): metres per TTS unit, whether bags' contents come
along, whether face-down cards are hidden, whether to fetch what wasn't
dropped, whether OBJ models are mirrored in x on load (as TTS does), and the
card-face texture size.

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `tts-import` | one import: settings, progress, report (listed) |
| `patchwork:tool` | `tts-import` | drop zone, progress, report, *Open the table* |

It doesn't depend on the scene or tabletop packages: it writes `scene` and
`file` docs in the shapes they document (the scene's, with the tabletop's
`tabletop.card` trait on face-down cards) and opens the result with the
`scene` tool by id. Two things on a table aren't written here but through
whoever owns them, found in the plugin registry by their metadata
(`src/made-with.js`; scene/STAGE.md, "Keepers" and "Seats"): what a
face-down card really is goes to a keeper that keeps things in the open
(`keeper: "plain"`; the `keep` package's), and the seats are laid by
whoever owns seats (`roster: true`; the scene's own part). Where one isn't
installed the import still finishes: the cards are only their backs, or the
table has no seats, and the report says so. The scene doc names the scene
package as its suggested import (below), so a viewer with nothing installed
is offered the scene tool; the stage lists the tabletop and keeper packages
in the scene's `packages` the first time someone who has them opens the
table, and offers them to viewers who don't (scene/STAGE.md, "Packages").

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
a missing asset never fails the import — whatever uses it is drawn without it
(in its colour, or a see-through stand-in box for a model) and the report lists
the URL, who uses it and why (not dropped, fetch failed, couldn't read, not an
image / a dead link's web page, couldn't decode). Only `.obj`, images and PDFs
are used; Unity asset bundles (`Custom_Assetbundle`) are stand-ins.

## Units and axes

TTS is Unity: **left-handed, Y up**, lengths in "in-game units" that the TTS
knowledge base calls "about an inch", Euler angles in degrees applied Z, then
X, then Y. The scene is glTF: right-handed, Y up, metres, Euler XYZ radians,
uniform scale only. `src/convert.js` mirrors z:

```
position (x, y, z)              → (x, y − tableY, −z) · u        u = 0.0254 m per unit (a setting)
rotation R = Ry(y)·Rx(x)·Rz(z)   → M·R·M = Ry(−y)·Rx(−x)·Rz(z), M = diag(1, 1, −1), as Euler XYZ
a mesh point p, scale S          → M·(S·p) · u                    baked into the GLB, triangles re-wound
```

Mirroring z (not x) keeps TTS's seats — most mods put players' hands at −Z,
facing +Z — on the scene's near side, where its camera is. Non-uniform scale is
baked into each GLB, so the scene's scale is always 1. `tableY`, the TTS height
of the table top, is the commonest resting height of the top-level objects
(0.94–0.96 in the mods tried).

**Confidence.** The axis and rotation conversion is high: a test round-trips
every rotation of a 9 × 9 × 9 grid of TTS angles (the quarter turns, where
Euler triples are degenerate, among them) at the origin and the three unit
points of a non-uniformly scaled object (TTS world point, converted == scene
world point of the baked point; both are affine in the point, so those four
settle every point) and checks the Euler decomposition against three's on
the same grid; the browser probe shows text on boards, mats, cards and
models reading correctly (not mirrored, right way up from the near side) on
two real mods. Unity's rotation order and matrices are from Unity's
documentation, matched by real saves (a d6's `RotationValues` give opposite
faces summing to 7). The unit is medium: "about an inch" is all TTS says; a
TTS card comes out 56 × 79 mm against a real 63 × 88 mm, so TTS tables are a
little under life size at 0.0254 — change *One TTS unit is* if you prefer
cards true to size (≈ 0.0286).

### Sizes

None of these is documented; each was read off real mods (this machine's TTS
cache), and they're constants in `src/kinds.js`.

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

| TTS | drawn as |
|---|---|
| `Card`, `CardCustom` | a thin card: its cell of the face sheet on top, the back (or its cell, `UniqueBack`) underneath |
| `Deck`, `DeckCustom` | a group of its cards, stacked where the deck is, the first card on top |
| `Custom_Tile`, `Custom_Board` | a textured slab (box, hex, circle or rounded); `ImageSecondaryURL` underneath, else the top image again; sides in `ColorDiffuse` |
| `Custom_Token` | a slab; a round transparent image makes a disc, any other transparent shape alpha-masked faces without sides |
| `*_Stack` (`Number`) | a group of that many, stacked |
| `Custom_Model`, `Custom_Model_Bag`, … | the OBJ with its diffuse texture, tinted `ColorDiffuse`; `MaterialIndex` → roughness / metalness |
| `Bag`, `Infinite_Bag` | a pouch in `ColorDiffuse` |
| a bag's contents | a hidden group beside the bag, laid out in a grid on the table |
| other `States` | a hidden group where the object is |
| `Die_N`, `Custom_Dice` | a d6 with pips (faces from `RotationValues`), or textured from a custom die's image; other dice as plain solids |
| `Figurine_Custom` | a standee: the image (and its back) on a base |
| `Custom_PDF` | a sheet whose About is the PDF's file doc |
| chess / checkers / blocks / pawns | simple stand-in shapes |
| `HandTrigger` | a seat (with a camera from that hand) |
| `AttachedSnapPoints`, `SnapPoints` | the scene's connectors (`extras.connectors`) in the object's GLB, and in the table's for the free ones: position, rotation (converted like any other) and tags |
| `Tags` | `tags` on the object: a tagged snap point takes only objects with one of its tags, as in Tabletop Simulator |
| `Locked` | `locked` |
| triggers, `3DText`, `Notecard` | left out (listed in the report) |
| the table | a locked slab under everything, the mod's `TableURL` on top |

Every copy of a look shares one GLB: the kind (`src/kinds.js`) is everything
the look depends on — images and cells, shape, size, scale, colour, snap
points — and nothing else, so thirty identical tokens are one file.

**Card sheets are cropped**, not UV-mapped: a passthrough scene object is one
self-contained GLB, so a UV-mapped card would carry its whole sheet (up to 70
cards, often 4096² px) in every card's file. A cropped face is a few tens of kB
(512 px on its long side by default).

**Hidden cards.** A face-down deck's cards (and face-down loose cards) are the
scene's hidden objects: each shows the deck's back on both sides and is named
"Card", with the trait `tabletop.card` (a card: two-sided, shown to everyone when it
lies face up) and its keeper's own trait binding it to a slot of a container made for
that TTS deck (one per deck, one more for loose cards) that holds what each
really is. `hideObject()` in `src/layout.js` is the one place that writes that
shape.

## Documents

### `tts-import`

```ts
{
  "@patchwork": { type: "tts-import" },
  title: string,
  status: "empty" | "importing" | "done" | "error",
  error: string | null,
  progress: { phase: string, done: number, total: number } | null,
  settings: { metresPerUnit, includeContents, hideFaceDown, fetchMissing, flipObjX, cardTexture, maxObjects, maxStoredBytes },
  sceneUrl: AutomergeUrl | null,     // the latest table
  scenes: AutomergeUrl[],            // every table imported here
  report: {
    mod: { saveName, gameMode, fileName, table, objects },
    counts: { byName: { [Name]: n }, placed, hidden, groups, kinds, glbBytes, seats, secrets, tableY,
              skipped: { [label]: n }, approximated: { [Name]: n },
              assets: { needed, cache, fetched, missing, referenced } },
    assets: { [key]: { url, role: "image" | "model" | "pdf", source: "cache" | "fetch" | null,
                       fileUrl: AutomergeUrl | null, bytes, mimeType, usedBy: string[], uses, error? } },
    kinds: { [hash]: { name, type, copies, glbUrl, bytes, triangles, notes?, error? } },
    notes: { [note]: count }, warnings: string[], sceneUrl, finishedAt
  } | null
}
```

### What an import writes

- a `file` doc per raw asset found: `{ "@patchwork": { type: "file" }, name, extension, mimeType, content }`
  (an OBJ as text, images and PDFs as bytes; one over `maxStoredBytes`, 32 MB, is used but not kept);
- a `file` doc per kind: the GLB (`extension: "glb"`, `mimeType: "model/gltf-binary"`);
- a keeper's container per face-down TTS deck, holding `{ sourceUrl, name }` per card (made by the keeper's `contain`; its shape is the keeper's);
- the `scene`: an empty scene as the scene's own datatype makes one (`src/empty-scene.js`, a copy of its
  init: `dimensions: {}`, `assets: {}`, `packages: []` and the rest), with passthrough objects
  (`providerId: "file-glb"`, `renderUrl: null`) at their transforms with `hint.bounds`, groups for decks /
  stacks / bag contents / states, `locked`, `tags`, traits (`tabletop.card` and the keeper's binding on hidden cards;
  the seats, laid by their owner, on the scene), `infoUrl` = the import doc (the PDF's file doc for a `Custom_PDF`), and
  `view: { units: "cm", grid: false, axes: false, bounds: false, snap: true, tool: "hand", activity?, home }`:
  `home` is a view over the table from the near side, and `activity: "play"` is written when the mod has
  seats (a table with seats is for playing: it opens in play, and the scene's activity switcher gets
  anyone into editing); without seats there is no `activity`, and it opens in the editor.
  `packages` is left empty for the stage to fill in. Its `@patchwork` is `{ type: "scene",
  suggestedImportUrl }`: the scene package's own import URL, read from the plugin registry at import
  time (`src/scene-package.js`) and written only when another viewer could load it (a bare
  `automerge:` URL, or `https:` on a public host; not localhost, `http:`, `blob:`). With no scene
  package registered it is just `{ type: "scene" }`, and the stage adds the suggestion when someone
  who has the package opens the table.

## Not yet

- Lua, XML UI and everything scripted, by design.
- Unity asset bundles (`Custom_Assetbundle`): stand-in boxes.
- Normal maps (`NormalURL`), colliders, custom materials beyond `MaterialIndex`.
- Tokens are not traced: a non-round cut-out is alpha-masked faces without sides.
- Card shapes other than rectangles (CustomDeck `Type`), rounded card corners.
- Dice other than d6 have no numbers; a custom d6's numbers may be turned on their face.
- `3DText`, notecards, counters, calculators; infinite bags are drawn once.
- Board size (18 at scale 1) and the board snap-point frame are the least certain guesses.
- Big mods: everything goes into the repo (a 9,700-object Frosthaven save, bags left out, made 635
  docs / 290 MB in 7.4 s); bag contents are hidden groups, so they cost nothing to show until opened,
  but they are still imported. `maxObjects` (5,000) stops runaway mods.
- CORS: fetching is best-effort; the cache is the reliable route.
- A `tabletop-game` doc (the stretch goal) is not made.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/datatype.js`, `src/settings.js` | the datatype and its default settings |
| `src/tool.js`, `src/styles.css` | the tool |
| `src/inputs.js` | drops, folders and zips → sources, read lazily |
| `src/importer.js` | the import: find the save, resolve assets, store them, draw kinds, lay out, report |
| `src/tts.js` | reading a save (pure) |
| `src/cache.js` | URL → cache file name, the dropped files' index (pure) |
| `src/convert.js` | TTS → scene transforms, units and axes (pure) |
| `src/cards.js` | CardID → sheet cell (pure) |
| `src/kinds.js` | an object → its kind, the sizes, dedupe keys (pure) |
| `src/shapes.js` | slabs, boxes, lathes, dice in the TTS frame; baking into the scene's (pure) |
| `src/build.js` | a kind → a GLB |
| `src/layout.js` | the plan, the secrets docs and the scene doc (pure) |
| `src/empty-scene.js` | an empty scene doc, as the scene datatype's init makes it (a copy; scene/src/datatype.js is the source of truth): what the scene doc starts from |
| `src/scene-package.js` | where the scene package comes from, for the scene doc's `@patchwork.suggestedImportUrl` (read from the registry at run time; the same file as tabletop's) |
| `src/obj.js`, `src/sniff.js`, `src/alpha.js` | OBJ parsing, file type sniffing, token outlines (pure) |
| `src/images.js` | the browser's image backend (decode, crop, resize, encode on a canvas) |
| `src/glb.js` | the scene's GLB encoder, copied, with textures added |
| `src/test/` | a PNG codec and a node image backend, an in-memory repo (copied from the scene), the fixture |
| `fixtures/make-tiny-mod.mjs`, `fixtures/tiny-mod/` | a synthetic mod in TTS's folder layout (regenerate with `node fixtures/make-tiny-mod.mjs`) |
| `probes/` | the browser probe |

## Testing

`pnpm test` runs the unit tests: parsing, the cache naming rule, transforms
(the round trip above), card cells, OBJ parsing, shapes' winding and texture
orientation, the textured GLB round trip through three's `GLTFLoader` (with a
stand-in `createImageBitmap` that decodes the embedded PNG), building each
kind, and whole imports of the fixture (also from a zip) against an in-memory
repo with a PNG-only image backend.

The browser probe imports with the **built** tool in headless Chrome, as a drop
of real `File`s, then mounts the **built** scene tool (`../scene/dist`, loaded
at runtime by URL for verification only) on the result and screenshots it:

```
pnpm build && (cd ../scene && pnpm install && pnpm build)
node probes/import-run.mjs                       # the fixture
node probes/import-run.mjs --mod "$HOME/Library/Tabletop Simulator/Mods/Workshop/<id>.json" \
  --cache "$HOME/Library/Tabletop Simulator/Mods" [--query contents=0] [--out dir]
```

With `--mod` it drops the JSON and exactly the cache files the mod refers to.
Nothing is downloaded.
