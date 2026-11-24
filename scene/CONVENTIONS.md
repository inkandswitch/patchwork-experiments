# Conventions

Contributions, traits and module exports by which packages that don't know each
other meet. The kernel ([STAGE.md](STAGE.md)) and the editor
([EDITOR.md](EDITOR.md)) never read them, but for the atmosphere, which the
kernel draws. Depend on the convention, never its provider. Traits are keyed `<extension>.<name>`.

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

## Seats

From the `seats` package (its README). Trait `seats`: `{
[seatId]: { name, player, lasting?, camera? } }` on the scene or an object.
Contributions: `roster` (`seats`, `viewers`, `open`, `nameOf`, pure in the
snapshot; `who`, `sitting`, `stateOf`, `sit`) and `seatPlaces` (`(scene) → [{
seat, of?, id, min, max }]`). The plugin with `roster: true` exports `lay(d,
seats, of?)` for setup code. The seat body (`here: false`) tilts with its
table.

## Keepers

An extension with its own trait that holds what objects are, away from the
scene doc. Its metadata says `keeper: "<kind>"` (the editor's undo reads it, to
say what a removal's undo can't bring back), and it contributes `keeper` (`{
kind, of, name, shuffle }`), read with `collect("keeper")`. What it shows
follows the audience (NATIVE.md, "Audience"): in it, the item's; shown only,
the veil; else the object's own.

## World ambients

A world's ambients are its outermost doc's (STAGE.md, "`api`", **Ambients**).
The names packages share:

### Atmosphere

```js
{ sky?: { top?, horizon?, bottom? }, fog?: { color?, near?, far },
  sun?: { direction?, color?, intensity?, shadows? }, exposure?, clouds?: { cover, contrast?, scale?, base? } }
```

The viewport draws it (`src/stage/atmosphere.js`). One atmosphere wins whole;
none is the stage's own look. A colour is `"#rgb"`, `"#rrggbb"` or an integer
up to `0xffffff`, sRGB. A field that can't be used is its default; a part
(sky, fog, clouds) without what the table says it needs is left out; none
left is no atmosphere.

| Field | Default | Range, and what it does |
|---|---|---|
| `sky.top`, `.horizon`, `.bottom` | horizon: top, else bottom; top and bottom: the horizon | none of them: no sky |
| `fog.color` | `sky.horizon` | no colour and no sky: no fog |
| `fog.near`, `fog.far` | near 0 | metres, 0 ≤ near < far; no far: no fog |
| `sun.direction` | the stage's key light, `[0.45, 1, 0.6]` | toward the sun, made unit |
| `sun.color`, `sun.intensity` | `#ffffff`, 1.5 | intensity ≥ 0 |
| `sun.shadows` | off | only `true` casts |
| `exposure` | 1 | > 0, scales every light |
| `clouds.cover` | none | over a sky only, > 0; above 1 is 1 (overcast) |
| `clouds.contrast` | 0.1 | > 0 (else the default); above 0.5 is 0.5 |
| `clouds.scale`, `clouds.base` | 600, 800 | metres, > 0 (else the default): the cells' size, the deck's height |

A sun replaces the stage's key light and dims its headlight to a third; a sky
tints the sky/ground light with its top and bottom; with fog and no sky the
background is the fog's colour. Ask a flush with `api.schedule` when it changes on its own.

### Water and wind

**Water**: trait, ambient and contributions `water` and `water.waves` (the
`water` package's WATER.md). **Wind**: the ambient `wind`, from the `weather`
trait (the `weather` package's WEATHER.md).

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
`src/carry-rules.js`) applies a connector's frame or yaw. A connector reaches
its content's `extras.snapRadius`, else `defaultSnapRadius` of its connectors
(0.71 × the closest spacing; one alone doesn't snap). Up, down and on edge
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
