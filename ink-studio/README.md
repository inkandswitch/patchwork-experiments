# ink-studio

[Ink Studio](https://github.com/siliconjungle/shapeshift-labs-ink-studio)
(shapeshift-labs, MIT) in Patchwork. It sculpts with signed distance, bakes the
result to pixel-art Gaussian splats, and draws them with upstream's own WebGL 2
renderer. An `ink-scene` doc holds one scene's source files. The tool builds the
scene in the page and plays it.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `ink-scene` | one scene: `{ title, kind, main, files, credit? }` |
| `patchwork:tool` | `ink-scene` | build, play, orbit and edit it |
| `scene:source` | `ink-scene` | the doc in a scene: a blocky stand-in GLB (`proxy.js`) the scene picks and frames |
| `scene:extension` | `ink` | trait `ink.scene`: draws the world in the scene with ink's own renderer; drop/paste of an ink-scene doc |

## The doc

```js
{ title,
  kind: "js" | "diorama" | "builtin",
  main,            // a name in files, or a built-in demo's id
  files,           // { [name]: text }: the scene's files, collaborative text
  credit? }        // where it came from
```

- **`js`**: `main` is a CommonJS scene file, called with the toolkit exactly as
  `ink-studio render file.js` calls it: `require(file)(kit)` →
  `{ id, name, seed, build(seed) }`. It may `require("./other.js")` and
  `require("./data.json")` from `files`. Node modules and upstream's Node API
  (`require("..")`) are refused, with a message naming them.
- **`diorama`**: `main` is a JSON diorama, built by `KIT.diorama.scene`.
- **`builtin`**: one of the toolkit's seven demos, by id (`watcher`, `burn`, …).

`files` is one folder: names, never paths. Automerge's `updateText` splits a
path on `/`, so a key with a slash can't be edited. Every upstream example
requires only files that sit beside it.

**The doc's code runs in the page** when it opens (the user's call,
2026-11-20): the same trust as installing a package.

## The tool

The bar shows the splat count, the build time and the scene's clock, with
Pause, Restart (rebuild and start the clock again), a pixel-size picker, and
Source: a CodeMirror editor on each file, synced through
automerge-codemirror. Any change to the files rebuilds the scene after
600 ms. The last good world stays on screen while the code has an error.

Dragging orbits the camera, Shift-drag pans and the wheel dollies. Until you
touch the camera, the scene's own camera plays (rails, staging, impulses).
**Scene camera** gives it back. Camera, clock and pixel size belong to each
viewer and are never written to the doc.

Building runs on the main thread, as in upstream's pages. Most examples build
in well under a second. A few take several seconds (`fractal-form-studies`
8 s, `interlacing-studies` 69 s).

## In a scene

Drop or paste an `ink-scene` doc into a scene. It becomes an object of the
source `ink-scene` with the trait `ink.scene`. For each such object the `ink`
extension builds the doc's world, runs its clock, and draws it **into the
stage's own WebGL context with depth** (`layer.js`). Just before three.js draws
a full-screen triangle, ink renders the world into a two-attachment target at
art resolution with the very camera of that pass (`layer-camera.js`: the
object's transform, uniform scale included). Attachment 0 holds ink's colour,
attachment 1 that pixel's depth. The triangle discards what isn't ink's and
writes `gl_FragDepth`, so splats and the scene's other objects hide each other
per pixel. Each splat has one depth, at its centre, so intersections step
splat by splat. The stand-in stays pickable but draws nothing.

**Open** (the object's Open: the inspector's button, the menu, Enter or a
double-click in Edit) docks the doc's source over the scene. The world stays in
its place and rebuilds there as the code changes, and the status line shows
the splat count or the error. The last good build stays in the scene. Each
edit is a step of the scene's undo (`hosted.js`, copied from openscad's).
Escape, Close, or Open again puts it down.

The trait's fields (inspector, Behaviours):

| Field | |
|---|---|
| `px` | screen pixels per art pixel (default 3) |
| `atmosphere` | give the scene this world's sky and sun (`atmosphere.js`): sampled as ink's renderer samples its sky environment, offered as the scene's `atmosphere` ambient and re-offered as it changes. A world without a sky offers its background colour. |
| `look` | give the **whole scene** this world's pixel-art look (`look-layer.js`, `look-pass.js`): after the stage draws, its picture is resolved, shrunk to art size, put through ink's own palette resolve (upstream's `POST_FS`: palette snap, Bayer dither, tone, grade) in this world's palette, and drawn back enlarged. No depth is passed, so outlines, part lines, contact shade and hole fill are off. |

**Water.** Inside the scene, ink's own water optics are off. On an ink object whose world has water, the menu's
**Add this world's water** writes one water-package object per water body
(`{ water: { size } }`, origin at the surface), attached to the ink object.
The water package then draws it and floats things on it. Without that package
the command is disabled. No example uses ink's simple fog (`world.fog`), so
there is nothing to give. Its fog volumes (`world.atmosphere`) aren't mapped.

Upstream's sky, water background, reflections, coloured contours, damping,
cleanup and per-splat fog are all off inside a scene (`transparent` mode,
`vendor/PATCHES.md`). The camera is the scene's.

## Upstream, vendored

`vendor/ink-studio/` is upstream at the commit in `UPSTREAM-COMMIT`, copied
with `git archive`, plus three opt-in edits for the scene layer, listed in
`vendor/PATCHES.md` (diff: `vendor/ink-studio.patch`, which reproduces the
vendored `src` from the pristine commit):
- `frame.viewMatrix`/`projectionMatrix`/`depthRange`: a host camera;
- `frame.transparent`: no background, colour plus packed depth out;
- `hostDepth`: every visible splat writes depth.

With none of these set, every shader and camera matches upstream byte for byte. `scripts/toolkit.mjs` writes
`src/generated/toolkit.js` with upstream's own
`bundle({ format: "module" })` and their seven demos. The tool imports
`vendor/ink-studio/src/webgl/renderer.mjs` directly. Vite warns that
`webgl/camera-lens.mjs` and `camera-impulses.mjs` import a missing `default`.
That's expected: upstream falls back to the global those scripts register
when loaded as browser ESM.

To update, re-run the `git archive` into `vendor/ink-studio` at a new commit,
then build and run `node scripts/survey.mjs`.

## Checks

- `pnpm test`: the file loader and the three kinds.
- `node scripts/survey.mjs`: loads and builds every upstream example through
  the browser loader under Node, one TSV row each. At c883375, 192 build; 27
  are helpers or Node scripts, not CLI scenes.
- `probes/stage-probe.html?example=<file>[&also=<file>][&water]`: the built
  scene tool with this package (and the water package), on real Automerge docs;
  each example is **pasted** into a new scene, so it takes the real drop path.
- `probes/publish-examples.mjs` publishes the examples folder;
  `probes/check-published.mjs <folder>` reads it back and builds a few.
- `probes/`: `node probes/probe-server.mjs 4790 --keep` serves the **built**
  `dist/` with an importmap for the host's externals.
  `probes/probe.html?example=<file>` mounts the tool on a real Automerge doc
  holding that example and the files it requires.
  `GPU=1 node probes/shoot.mjs <url> <png> "window.__ready"` screenshots it
  (`chrome-guard.mjs` and `shoot.mjs` are copied from `implicit`).
