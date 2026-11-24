# Conventions

The names by which packages that don't know each other meet: trait keys,
contributions, ambients, body ids, plugin ids looked up, GLB extras fields,
MIME types and events. Each is specified once, exactly, by the package that
owns it, under "Conventions" in its README (scene's own are below, and in
its README's "Content"); the table lists every one. The members, services
and contributions of the kernel, the natives and the editor are stated on
their own pages ([STAGE.md](STAGE.md), [NATIVE.md](NATIVE.md),
[EDITOR.md](EDITOR.md)), and none of scene names another package's. Depend
on the convention, never its provider: a package names another's only
through a name listed here. Traits are keyed `<extension>.<name>`. `node
scripts/check-conventions.mjs` fails on a name one package uses of
another's that isn't listed here or on those pages.

## Names

| Name | Kind | Owner | Means | Specified in |
|---|---|---|---|---|
| `walk.spawn` | trait | walk | where the walk body starts, facing the object's way | walk/README.md |
| `walk.support` | trait | walk | a floor that moves (a deck), walked in its own frame | walk/README.md |
| `walk.moves` | trait | walk | a moving part: swept, blocking where drawn, or passed through | walk/README.md |
| `walk.stand` | trait | walk | where someone stands to use the object | walk/README.md |
| `walk.ladder` | trait | walk | the climb out of the water onto the object's owner | walk/README.md |
| `walk` | body id, plugin id | walk | first person on the scene, entered at an object | walk/README.md |
| `avatar`, `stand` | contributions | walk | this viewer's walker in a stage; stand it at a stand spot | walk/README.md |
| `seats` | trait, plugin id | seats | the places people take, on the scene or an object | seats/README.md |
| `seat` | body id | seats | sitting in a seat, entered at a seat ref | seats/README.md |
| `roster` | contribution, metadata | seats | who sits where; `roster: true` marks the plugin with `lay` | seats/README.md |
| `seatPlaces` | contribution (collected) | seats | boxes that are a seat's places | seats/README.md |
| `joints.slide` | trait | joints | a part that slides between two stops | joints/README.md |
| `traversal.exit` | trait | traversal | an object that leads to another document | traversal/README.md |
| `arena.level` | trait | arena | the scene is a level, and its look | arena/README.md |
| `arena.spawn` | part id | arena | the spawn pad part, looked up by id | arena/README.md |
| `doom-map` | source id | doom | a part of a WAD's map, by params | doom/README.md |
| `doom` | GLB extras | doom | where a map part's frame is | doom/README.md |
| `door`, `line` | GLB node extras | doom | which door or exit switch a whole map's node is | doom/README.md |
| `water` | trait, ambient, contribution, plugin id | water | an object that is water; the world's open water; which water a point is in | water/README.md |
| `water.waves` | contribution (collected) | water | the waves on each water body | water/README.md |
| `water.shore` | contribution (collected) | water | the shore's shape round an eye, and shelter | water/README.md |
| `weather` | trait | weather | the world's weather, as plain data | weather/README.md |
| `wind` | ambient | weather | how the world's air moves | weather/README.md |
| `sailing.sea` | trait | sailing | waves on a water object, raised by the wind | sailing/README.md |
| `sailing.sail`, `sailing.jib`, `sailing.anchor` | traits | sailing | a ship's main, jib and anchor, as worked | sailing/README.md |
| `sailing.sloop` | part id | sailing | the rigged 12 m sloop, looked up by id | sailing/README.md |
| `ship`, `sail` | GLB extras | sailing | a hull's frame and size; a sail's plan, place and cloth | sailing/README.md |
| `rig` | GLB extras | naval | a rig's patchwork-rig v1 contract | naval/README.md |
| `scene.carry` | trait | scene | carried by anyone ("Carry") | CONVENTIONS.md |
| `carry`, `landing`, `carryable`, `landed` | contributions | scene | starting and answering a carry ("Carry") | CONVENTIONS.md |
| `inspect` | contribution | scene | an instance's state for the X-ray ("Inspect") | CONVENTIONS.md |
| `keeper` | contribution, metadata | scene | what holds objects away from the doc ("Keepers") | CONVENTIONS.md |
| `atmosphere` | ambient | scene | the world's sky, fog and sun ("World ambients") | CONVENTIONS.md |
| `scene:source`, `scene:extension`, `scene:view`, `scene:template`, `scene:part` | plugin types | scene | providers, extensions, view plugins, templates, parts | README.md |
| `file-glb` | source id | scene | a `.glb` file doc shown as it is | README.md |
| `scene-render` | datatype | scene | one built object's GLB and what it was built from | README.md |
| `units`, `layers`, `layer`, `connectors`, `snapRadius`, `legend`, `receiveShadow` | GLB extras | scene | units, layers, connectors, a colour bar, a one-sided sheet | README.md |
| `chartroom:source` | plugin type | Chartroom | a hull datatype's hydrostatic table | naval/README.md |
| `patchwork:datatype`, `patchwork:tool` | plugin types | Patchwork | datatypes and tools | Patchwork |
| `text/x-patchwork-dnd`, `text/x-patchwork-urls` | MIME types | Patchwork | documents dragged from Patchwork's sidebar | Patchwork |
| `patchwork:open-document` | DOM event | Patchwork | `{ url, toolId? }`, bubbling and composed: open a document | Patchwork |

## Docs

### Shared maps

Nothing writes a map or list at a key another peer might also create. Every
scene doc is made with `traits`, `view`, `dimensions`, `assets`, `packages` and
`clock` (`{ running: true, t: 0 }`), by the datatype's `init` and by every tool
that writes a scene doc whole. `view.start` is written whole only by what lays a
scene out. The one exception is an object's `claims` map, made by its first
claim; a claim lost to that merge is written again by its holder (NATIVE.md,
"Claims"). Every scene doc carries `@patchwork.suggestedImportUrl`, the scene
package.

### No migrations

Everything reads only the current doc shape. A doc made before a change is
remade, not migrated.

## Inspect

An instance may contribute `inspect()` → a snapshot of its state as plain
JSON: frozen, cheap to make, and nothing a viewer may not see (who holds what,
never what a kept thing is). The X-ray reads every one with
`collect("inspect")` and shows it as it is; four fields it links to objects
and extensions: `claims` (`[{ id, kind, ext?, viewer, session, … }]`), `holds`
(`[{ id, ext?, session, rank, … }]`), `processes` (`{ [ext]: count }`) and
`drives` (`[{ id, ext }]`: objects a process drives).
`snapshot(v)` (`src/native/inspect.js`) makes one. The natives publish
theirs (NATIVE.md, "Inspect").

## Keepers

An extension with its own trait that holds what objects are, away from the
scene doc. Its metadata says `keeper: "<kind>"` (the editor's undo reads it, to
say what a removal's undo can't bring back), and it contributes `keeper` (`{
kind, of, name, shuffle }`), read with `collect("keeper")`. What it shows
follows the audience (NATIVE.md, "Audience"): in it, the item's; shown only,
the veil; else the object's own.

## World ambients

A world's ambients are its outermost doc's (STAGE.md, "`api`", **Ambients**).
`atmosphere` is scene's; `wind` and `water` are their packages' (Names).

### Atmosphere

```js
{ sky?: { top, horizon, bottom }, fog?: { color?, near, far },
  sun?: { direction, color?, intensity?, shadows? }, exposure?, clouds?: { cover, contrast?, scale?, base? } }
```

Colours are sRGB `"#rgb"`/`"#rrggbb"` (or a 24-bit number); a sky missing a
colour takes a neighbour's, a fog without one the sky's horizon. `fog.near`
and `far` are metres (`far > near`, else no fog). `sun.direction` points
toward the sun in the outermost root frame (normalised; absent: the stage's
key light's), `intensity` ≥ 0 (absent: the key light's), `color` `#ffffff`
by default, `shadows` only when `true`. `exposure` > 0. `clouds` only over
a sky: `cover` in (0, 1], `contrast` ≤ 0.5 (0.1), `scale` and `base` metres
(600, 800). What can't be used is left out (`cleanAtmosphere`,
`stage/viewport.js`). The viewport draws it. One atmosphere wins whole; none
is the stage's own look. Ask a flush with `api.schedule` when it changes on
its own.

## Carry

`scene.carry` (`src/parts/carry.js`) runs where an object has the `scene.carry`
trait; the input chain offers it a press as a holder (a press that doesn't move
is a tap it gives back), and other extensions start one with `carry(id, ev,
opts)` → session (`collect("carry")`). A carried piece is a pose hold
(NATIVE.md, "Holding a pose"), written once where it lands. A carry never
changes an object's doc or parent. Every running extension may answer:

| Contribution | |
|---|---|
| `landing(id, worldPoint, hitId)` → `{ faceUp?, flat? }` | every move: how it would lie there; the last word wins per field |
| `carryable(id)` → `false` | a veto, for passing states |
| `landed(id, on)` | once after a put's write, on the carrier's client: an event, not a claim |

### Landing

Where a carried piece goes down, how it lies is `landedPose`
(`src/parts/carry-math.js`): how it is held (Q/E turn 45°, F turns it over), the
snap, then the merged `landing` answer. `flat` lays it on its broadest face;
`faceUp` turns it face up unless F has turned it since; the snap (`intoSnap`,
`src/carry-rules.js`) applies a connector's frame or yaw. Up, down and on edge
are one 45° test (`sideOf`). Paste and the parts bin use the snap step.

### How a carry ends

A carry session's `ended` promise settles once to `{ how, on }`: `"put"`
(written once, `landed` called), `"back"` (cancelled, nowhere to land,
read-only, gone), `"yielded"` (a peer's hold ranks ahead) or `"refused"`
(something here holds it). Only a put writes.

## Invariants

| | Invariant |
|---|---|
| H11 | Carry only with `scene.carry`, no veto, no hold ahead, in its own doc's stage. |
