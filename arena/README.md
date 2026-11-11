# arena

A little first-person arena as a kind of [scene](../scene/README.md): walk
the level, shoot the targets over. It is not a datatype or a tool. It is two
scene extensions, a template and three parts, so any scene can become a level:
a boat with a few targets on her deck is one too.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `scene:extension` | `arena` | playing (`activities: ["play"]`): first person, walking and shooting, in a scene with any of its traits (`src/play.js`) |
| `scene:extension` | `arena.edit` | editing (`activities: ["edit"]`): *Stand targets up* in the menu (`src/edit.js`) |
| `scene:template` | `arena-level` | "Arena level" on an empty scene's start screen: the sample arena, starting in play (`src/template.js`) |
| `scene:part` | `arena.target`, `arena.crate`, `arena.spawn` | the editor's parts bin, under "Arena" (`src/parts.js`) |

It doesn't depend on the scene package: it writes objects and traits in the
shapes the scene documents (scene/STAGE.md), and the scene finds it in the
plugin registry by its traits.

## Traits

| trait | on | |
|---|---|---|
| `arena.level` | the scene | `{ look?: "arena" }`: the scene is a level. `look: "arena"` gives it the arena's sky, haze and low sun in play (the stage's atmosphere); without it the scene keeps its own |
| `arena.target` | an object | `{}` standing. Knocked over: `{ down: { by: <viewer>, at: <ms> }, stand: { rotation } }` |
| `arena.spawn` | an object | `{}`: where players start, facing the way it faces |

The `arena` extension describes all three for the scene's inspector ("Add
behaviour…"), so a level can be made without a script. A level trait gives
play the whole scene's input; object traits alone offer it only what reaches
their objects, which is why the Target and Spawn point parts make the scene a
level if it isn't one yet.

**A knocked-over target.** A shot that hits a standing target turns it a
quarter about its foot (its origin), away from the shooter, in one change:
its fallen rotation, `stand` (the rotation it stood at) and `down` (who, and
when). The position isn't touched. Scores aren't stored: they are counted
from `down.by`, so two players hitting one target at once agree whose it is.
*Stand them up* (the lobby's button in play, *Stand targets up* in the
editor's menu; `standTargetsUp` in `src/level.js`) puts each back at its
`stand` rotation, where it is now, and clears both keys.

**Copies** (scene/STAGE.md, "Copying objects"). `down` is play state, marked
`runtime` in the trait's description, so a copy of a knocked-over target, in
another scene or a duplicate in this one, is nobody's point. `stand` goes
with it: the copy is still lying down, and standing targets up raises it
where it was put. (A copy landed turned keeps the facing it had in the scene
it came from.)

## Playing

Enter, the toolbar's Play, or the lobby's **▶ Play** starts: you're put on a
spawn point (a random one; with none, above the middle of what's there) and
the pointer is locked (where it can't be, drag to look). W A S D or the
arrows move, Shift runs, Space jumps,
a click shoots (12 in the magazine, R reloads), Esc stops. Falling out of the
world respawns you.

Nothing in play knows about floors or walls: walking is two questions asked
of the stage by ray (how far down to the ground, how far until something is
in the way: `src/walk.js`, pure), and a shot is one more ray. So the floor
can be a level's slab, a crate or the deck of a boat.

State lives where the scene's contract says:

- the doc: knocked-over targets (above);
- presence: where each player is (`avatar`: feet, yaw, pitch), at 20 Hz
  while playing; everyone else draws them;
- sends: `shot { from, to }`, so peers see the tracer; nobody keeps them;
- local: your body, keys and ammo.

The extension `requires` the key map (Enter), notices and the camera framing
the level as it loads. It brings no editor.

## The level

A level is ordinary scene objects, edited like any other scene. The blocks
are seven kinds (`KINDS` in `src/level.js`: floor, wall, crate, block, ramp,
target, spawn), each a flat-shaded GLB whose faces are cut into rectangles
with per-vertex colours from one palette, no textures. A kind is drawn once
per scene: its GLB is a `file` doc kept in the scene's `assets` under
`arena/<kind>@<ART>` (`ctx.file`; `src/layout.js`), and every block of that
kind is a passthrough object showing it (`providerId: "file-glb"`, no render
doc). `ART` is bumped when the art changes, so new art gets a new key.

The **Arena level** template lays out the sample arena (`sampleArena()`: 29
blocks: a floor, four walls, a tower with a ramp up to it, ten crates, eight
targets and four spawn points) in one change: a group "Arena" of locked
blocks, the level trait with `look: "arena"`, and `view.activity: "play"`,
so whoever opens it, its maker too, is in the game. The editor is one switch
away.

The parts put one unlocked block where the bin says, under what it was
dropped on (and in that one's group), from the scene's own file for its
kind. If what it was dropped on goes while the file is made, a part puts
nothing.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe), with the traits' descriptions |
| `src/play.js`, `src/play.css` | the play extension: the lobby and HUD, walking, shooting, avatars, tracers, the atmosphere |
| `src/walk.js` | one step of a first-person body against rays (pure) |
| `src/level.js` | the kinds' meshes, the sample arena, a target's fall and standing it up (pure) |
| `src/layout.js` | putting blocks into a scene doc: a kind's file, a block's object, the whole arena |
| `src/template.js`, `src/parts.js`, `src/edit.js` | the template, the parts, the edit extension |
| `src/glb.js` | the GLB encoder, copied from the scene package (the kit: `node scripts/check-kit.mjs` at the repo root) |
| `src/test/empty-scene.js` | an empty scene doc, as the scene datatype's init makes it (a copy; scene/src/datatype.js is the source of truth): what the tests and probes start a scene doc from |
| `probes/arena-run.mjs`, `probes/arena-probe.html` | the browser probe (below); `fake-repo.js` and the stubs are its in-memory repo and registry |
| `probes/publish-level.mjs` | publish an arena level to a real sync server (`--dry-run` to only check); `probes/scene-packages.mjs` gives the scene its suggested import and `packages` |
| `probes/chrome-guard.mjs`, `probes/chrome-guard-check.mjs` | Chrome never outlives the probe driver that started it (copied, the same in every package), and a finite check of it |

## Testing

`pnpm test` runs the unit tests against stand-ins for the scene's api:

- `src/arena.test.js`: the kinds' GLBs (through the encoder's own parser),
  the sample arena, walking (`step` on a floor, into a wall, up a step, a
  jump and a fall), a target's fall;
- `src/play.test.js`: what play asks of the stage when you start, walk,
  shoot and stop; a hit knocks a target over once, scores it and tells the
  others; the lobby's Stand them up;
- `src/edit.test.js`: the template (one file per kind, the group, the look,
  starting in play), the parts (where each goes, what makes a level, one
  file per kind per scene), the edit command, and a copied knocked-over
  target;
- `src/describes.test.js`: the traits' descriptions are plain data, and
  what of a target is `runtime`.

The browser probe plays it with a real mouse and keyboard in headless
Chrome, two views of one doc:

```
pnpm build && (cd ../scene && pnpm install && pnpm build)
node probes/arena-run.mjs [--show] [--shots <dir>]
```

A picks **Arena level** on an empty scene's start screen and is in the game;
B joins after. A switches to Edit and back, walks, runs into a wall, climbs
the ramp onto the tower, jumps, shoots a target over and stops; B must see
A's avatar move and A's tracer. Then a scene that knows nothing of arenas (a
tilted deck GLB): the inspector offers the arena's level, a target is put on
the deck from the parts bin, and the deck is walked and played on. It prints
a JSON report and exits non-zero if any check fails.
