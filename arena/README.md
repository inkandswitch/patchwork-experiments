# arena

A little first-person arena as a kind of [scene](../scene/README.md): walk
the level (the [walk](../walk/README.md) package's body), shoot the targets
over. It is not a datatype or a tool. It is two
scene extensions, a template and three parts, so any scene can become a level:
a boat with a few targets on her deck is one too.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `scene:extension` | `arena` | *Play* and *Stand targets up* (world commands: buttons on the stage's bar of tools in every body, and in the menu), the gun (a held tool), the targets and the HUD, in a scene with any of its traits, whatever anyone is doing (`src/play.js`, `src/reset.js`) |
| `scene:template` | `arena-level` | "Arena level" on an empty scene's start screen: the sample arena, starting people walking at a spawn point (`src/template.js`) |
| `scene:part` | `arena.target`, `arena.crate`, `arena.spawn` | the editor's parts bin, under "Arena" (`src/parts.js`) |

It doesn't depend on the scene package: it writes objects and traits in the
shapes the scene documents (scene/STAGE.md), and the scene finds it in the
plugin registry by its traits.

## Traits

| trait | on | |
|---|---|---|
| `arena.level` | the scene | `{ look?: "arena" \| "sky" }`: the scene is a level. `look: "arena"` gives it the arena's sky, haze and low sun in play (the stage's atmosphere); `look: "sky"` the sky alone, for a level whose light is its own (an imported map with its light baked in: a sun would light nothing, and haze would only fade it); without either the scene keeps its own |
| `arena.target` | an object | `{}` standing. Knocked over: `{ down: { by: <viewer>, at: <ms> }, stand: { rotation } }` |
A spawn point is the walk package's trait, `walk.spawn` (where the walk body
starts); arena's spawn part is a pad that carries it.

The `arena` extension describes both for the scene's inspector ("Add
behaviour…"), so a level can be made without a script. A level trait gives
play the whole scene's input; object traits alone offer it only what reaches
their objects, which is why the Target and Spawn point parts make the scene a
level if it isn't one yet.

**A knocked-over target.** A shot that hits a standing target turns it a
quarter about its foot (its origin), away from the shooter, in one change:
its fallen rotation, `stand` (the rotation it stood at) and `down` (who, and
when). The position isn't touched. Scores aren't stored: they are counted
from `down.by`, so two players hitting one target at once agree whose it is.
*Stand targets up* (a button on the bar of tools whenever a target is down,
in any body, and in the menu; `standTargetsUp` in `src/level.js`) puts each
back at its `stand` rotation, where it is now, and clears both keys. It is
listed before Play, so on the bar it comes and goes to Play's left and Play,
the cluster's last, never moves under a pending click: a click meant for
Play that landed on it would wipe the scores, with no undo outside Edit.

**Copies** (scene/STAGE.md, "Copying objects"). `down` is play state, marked
`runtime` in the trait's description, so a copy of a knocked-over target, in
another scene or a duplicate in this one, is nobody's point. `stand` goes
with it: the copy is still lying down, and standing targets up raises it
where it was put. (A copy landed turned keeps the facing it had in the scene
it came from.)

## Playing

Enter, or **Play** on the bar of tools (scene/TOOLS.md §6: a world command,
`show: ["world", "menu"]`, so it is at the bar's right end looking, walking
or editing) walks you in: the walk body (scene/TOOLS.md §4, the walk
package's) entered at a spawn point (a random one; with none, at the eye),
with the gun in hand. The pointer is locked (where it can't be, drag to
look). W A S D or the arrows move, Shift runs, Space jumps: those keys are
the walk body's.

The **gun** is a held tool (`gun`, G; scene/TOOLS.md §4): a click shoots
(12 in the magazine, reloading when it's empty), R or a right-click reloads
sooner, and Escape (the stage's ladder) puts it down; walking goes on, and
Play on the bar says **Pick up the gun** (it only hands you the gun then).
Leave walking with the body chip. Falling out of the world respawns you. The
lobby and the HUD count the targets standing only in a level that has some:
an imported map with none shows no count. The HUD only reads (the count,
the scores, the crosshair, the ammo, the keys): it holds no button and
takes no press, so nothing of the arena's sits over the canvas to catch a
click meant for the level.

Every other key goes on to the key map, so whatever in the level has a verb
can be used while walking: look at a door within reach and press F to open
it (the joints package's slide), at a die and press R to roll it (R is the
gun's while you hold it). The use prompt shows the verbs for what's in the
middle of the view; a verb on one of the walking keys (a bag's Draw on D, a
pile's Shuffle on S) shows without its key and is in the menu.

Nothing in play knows about floors or walls: walking is two questions asked
of the stage by ray (how far down to the ground, how far until something is
in the way: the walk package's `walk.js`), and a shot is one more ray. So the floor
can be a level's slab, a crate or the deck of a boat.

State lives where the scene's contract says:

- the doc: knocked-over targets (above);
- presence: where each player is (`avatar`: feet, yaw, pitch), at 20 Hz
  while playing; everyone else draws them;
- sends: `shot { from, to }`, so peers see the tracer; nobody keeps them;
- local: your body, keys and ammo.

The use prompt (the verbs of what you look at), the key map (Enter), notices
and the camera framing the level as it loads are the scene's general parts,
in every scene; the editor's are too, following attention (scene/TOOLS.md
§1).

## The level

A level is ordinary scene objects, edited like any other scene. The blocks
are seven kinds (`KINDS` in `src/level.js`: floor, wall, crate, block, ramp,
target, spawn), each a flat-shaded GLB whose faces are cut into rectangles
with per-vertex colours from one palette, no textures. A kind is drawn once
per scene: its GLB is a `file` doc kept in the scene's `assets` under
`arena/<kind>@<ART>` (`ctx.file`; `src/layout.js`), and every block of that
kind is a file object showing it (`providerId: "file-glb"`, no render
doc). `ART` is bumped when the art changes, so new art gets a new key.

The **Arena level** template lays out the sample arena (`sampleArena()`: 29
blocks: a floor, four walls, a tower with a ramp up to it, ten crates, eight
targets and four spawn points) in one change: a group "Arena" of locked
blocks, the level trait with `look: "arena"`, and `view.start` walking at
its first spawn point, so whoever opens it, its maker too, arrives in the
game. Editing is selecting something; there is nothing to switch.

The parts put one unlocked block where the bin says, under what it was
dropped on (and in that one's group), from the scene's own file for its
kind. If what it was dropped on goes while the file is made, a part puts
nothing.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe), with the traits' descriptions |
| `src/play.js`, `src/play.css` | the play extension: Play, the lobby and HUD, the gun, tracers, the atmosphere |
| `src/level.js` | the kinds' meshes, the sample arena, a target's fall and standing it up (pure) |
| `src/layout.js` | putting blocks into a scene doc: a kind's file, a block's object, the whole arena |
| `src/template.js`, `src/parts.js`, `src/reset.js` | the template, the parts, Stand targets up |
| `src/glb.js` | the GLB encoder, copied from the scene package (the kit: `node scripts/check-kit.mjs` at the repo root) |
| `src/test/empty-scene.js` | an empty scene doc, as the scene datatype's init makes it (a copy; scene/src/datatype.js is the source of truth): what the tests and probes start a scene doc from |
| `probes/arena-run.mjs`, `probes/arena-probe.html` | the browser probe (below); `fake-repo.js` and the stubs are its in-memory repo and registry |
| `probes/publish-level.mjs` | publish an arena level to a real sync server (`--dry-run` to only check); `probes/scene-packages.mjs` gives the scene its suggested import and `packages` |
| `probes/chrome-guard.mjs`, `probes/chrome-guard-check.mjs` | Chrome never outlives the probe driver that started it (copied, the same in every package), and a finite check of it |

## Testing

`pnpm test` runs the unit tests against stand-ins for the scene's api:

- `src/arena.test.js`: the kinds' GLBs (through the encoder's own parser),
  the sample arena, a target's fall (walking's tests moved to `walk/`);
- `src/play.test.js`: what play asks of the stage when you walk in, pick
  up the gun, shoot and put it down; a hit knocks a target over once,
  scores it and tells the others; Play's state (holding × walking × target,
  every row), Stand targets up's (no targets, all standing, one down), the
  commands' surfaces and their order (Play the last world command), and a
  HUD with no button looking, walking or holding;
- `src/edit.test.js`: the template (one file per kind, the group, the look,
  starting people walking at a spawn point), the parts (where each goes,
  what makes a level, one file per kind per scene), Stand targets up, a
  copied knocked-over target, and one extension run by its traits alone;
- `src/describes.test.js`: the traits' descriptions are plain data, and
  what of a target is `runtime`.

The browser probe plays it with a real mouse and keyboard in headless
Chrome, two views of one doc:

```
pnpm build && (cd ../scene && pnpm install && pnpm build) && (cd ../walk && pnpm install && pnpm build)
node probes/arena-run.mjs [--show] [--shots <dir>]
```

A picks **Arena level** on an empty scene's start screen and is in the game;
B joins after. A switches to Edit and back, presses Play on the bar of
tools (the walk body at a spawn point, the gun in hand; the bar holds only
world commands outside Edit, and the canvas stays put looking, walking and
holding the gun), walks, runs into a wall, climbs the ramp onto
the tower, jumps and shoots a target over; Escape puts the gun down and the
body chip's Leave stops walking; B must see A's avatar move and A's tracer.
Then a scene that knows nothing of arenas (a tilted deck GLB): the inspector
offers the arena's level, a target is put on the deck from the parts bin, and
the deck is walked (from the eye: it has no spawn point) and played on; under
a simulated lock (headless Chrome refuses one) the mouse turns and a press
shoots, and after the browser's Escape releases it the next press only
relocks. It prints
a JSON report and exits non-zero if any check fails.
