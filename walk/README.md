# walk

The walk body for scenes (scene/TOOLS.md §4): first person on whatever the
scene is made of, contributed to the stage's body stack as `bodies: [walk]`.
Built only from the scene's extension contract (scene/STAGE.md).

| | | |
|---|---|---|
| `scene:extension` | `walk` | general: the walk body, which says where its walker stands (`avatar`) on the channel of the doc it walks in |
| `scene:extension` | `walk.people` | a part of every doc (`traits: ["*"]`): everyone else who walks, drawn where `walk`'s `avatar` says, in every stage whatever the focus |
| `scene:extension` | `walk.spawn` | the spawn point's trait part: a doc with spawn points calls for this package by it (and lists it, as a `view.start` of `{ body: "walk", place: <a spawn point> }` needs); its verb, on a spawn point, is Walk from here (menu) |
| trait | `walk.spawn` | on an object: where people start walking, facing the way it faces (`{}`). Written by whatever lays a level out: arena's spawn pad part, doom's layout through it |

## The body

- **id** `walk`, **label** Walk. It declares the walking keys (W A S D, the
  arrows, Shift to run, Space to jump), so every other key goes on to the key
  map, and a verb whose key it takes shows without one (walking, Draw is a
  button, not D). It asks for pointer lock and reaches **2 m**.
- **Where it starts**: at the place it's given (a spawn point's object id),
  else at the eye (the camera: walking from where you were looking), else at
  a spawn point, else above the middle of the scene (`startOf`, pure).
- **Its floor is whatever the ray hits** (`walk.js`, pure: how far down, how
  far ahead). It **rides what it stands on**: when the object under the
  feet moves, the feet and the facing move with it (`carried`, pure).
- **Presses**: without the lock a drag looks round and a tap goes on as a
  click (walking has no default press); under it a press is nothing of the
  body's, so the held tool and the holders down the chain have it.
- **On touch** there is no lock: the stage's touch pad (scene's
  `scene.touch`) shows the walking keys from their labels (Forward, Back,
  Left, Right on the pad; Run and Jump as buttons), and a finger dragging on
  the world looks round, at the same time. The look is the eye's, as under
  lock (scene/TOOLS.md Decisions 14): the use prompt sits in the middle of
  the view, and a tap on its button uses what you look at; a held verb
  ("hold F") lasts as long as the finger is on its button (scene/TOOLS.md
  Decisions 15).
- **Under another body** (a seat): it waits, its keys up and the camera let
  go; when that body goes, it walks on from the eye.
- **Presence**: `avatar` `{ feet, yaw, pitch }` at 20 Hz while walking; the
  extension draws everyone else's, named from their contact docs.

## Files

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/extension.js` | the extension: the body, and the others' avatars |
| `src/body.js` | the walk body: `walkBody(api)`, and its pure parts `startOf`, `carried`, `aimOf` |
| `src/walk.js` | one step of a body against rays (pure; moved here from arena) |

## Tests

`pnpm test`: walking against boxes (`walk.test.js`), riding a moving floor
over every move × every place on it, where a walk starts, and the body on a
stand-in stage (entering at the eye and at a spawn, keys, riding, waiting
under a seat, leaving). In a browser, doom's `probes/doom.mjs` walks E1M1 in
it.

```
pnpm install && pnpm build && pnpm test
```
