# @shapeshift-labs/ink-studio

A JavaScript toolkit for sculpting signed-distance solids, baking them into pixel-art Gaussian splats, and making them move, react, break, grow and remember what happened to them. Use it from Node, drive it through the `ink-studio` command, or embed the source bundle in an Inkwell or browser application.

The package includes geometry, materials, lighting, animation, character controls, particles, physics, procedural generation, and retained authoring. Write scenes in JavaScript or JSON, render images through the CPU-based Node and CLI tools, or draw into a canvas with the default WebGL 2 browser renderer. Browser hosts supply the editor UI and advance the scene.

## Contents

- [Install and run](#install-and-run)
- [First sculpted scene](#first-sculpted-scene)
- [Using the library in Node](#using-the-library-in-node)
- [Scene lifecycle and splat data](#scene-lifecycle-and-splat-data)
- [Geometry and materials](#geometry-and-materials)
- [Scenes as JSON](#scenes-as-json)
- [Animation and puppets](#animation-and-puppets)
- [Particles and interaction](#particles-and-interaction)
- [Physics and persistent effects](#physics-and-persistent-effects)
- [Importing meshes](#importing-meshes)
- [Exporting GLB models](#exporting-glb-models)
- [Importing depth maps](#importing-depth-maps)
- [Procedural worlds](#procedural-worlds)
- [Retained authoring](#retained-authoring)
- [Editable 3D drawing](#editable-3d-drawing)
- [Headless world simulation](docs/headless-worlds.md)
- [Rendering and command reference](#rendering-and-command-reference)
- [View-dependent surface materials](#view-dependent-surface-materials)
- [Projected and procedural effects](#projected-and-procedural-effects)
- [Reflections, ripples and atmosphere](#reflections-ripples-and-atmosphere)
- [Embedding and custom scene collections](#embedding-and-custom-scene-collections)
- [Browser renderer](#browser-renderer)
- [Screen transitions](#screen-transitions)
- [Module reference](#module-reference)
- [Validation and development](#validation-and-development)

## Install and run

Requires **Node 18 or later**. There are no declared runtime dependencies. The package is available from GitHub.

From a checkout:

```sh
node cli/ink-studio.js help
node cli/ink-studio.js scenes
node cli/ink-studio.js render watcher --t 2.6
node cli/ink-studio.js render watcher --t 2.6 --colored
npm test
```

Install from GitHub:

```sh
npm install github:siliconjungle/shapeshift-labs-ink-studio
npx ink-studio help
```

To install a local checkout into another project:

```sh
npm install /absolute/path/to/ink-studio
npx ink-studio help
npx ink-studio render watcher --colored
```

The installed package is named `@shapeshift-labs/ink-studio`, and its executable is `ink-studio`. The `private` setting prevents accidental registry publication.

Generated pictures normally go into `studio/out/`. Image baselines go into `studio/snaps/`. Use `--out file.png` for an explicit output path, or configure the directories with `ink-studio.config.js`.

The examples below use `npx ink-studio` from a consuming project. In this checkout, replace that prefix with `node cli/ink-studio.js`.

## First sculpted scene

Save this as `model.js`. A JavaScript scene exports a function receiving the toolkit and returning `{ id, name, seed, build(seed) }`. `build` returns the finished world.

<!-- include: examples/sculpt.js -->

```js
module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'sculpt-example',
  name: 'Carved stone',
  seed: 7,
  build(seed) {
    const palette = [0x080b10, 0x26313d, 0x566778, 0x9baeb8, 0xe5e9dc, 0x387548, 0x8fc75e];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const stone = { r: [1, 2, 3, 4] };

    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.18 });
    S.box([0, 1.2, 0], [1, 1.2, 1], stone, { res: 0.12 });
    S.ball([0, 1.4, 0.9], 0.65, stone, { neg: true });
    S.ball([0, 2.7, 0], 0.5, { r: [1, 5, 6] }, { res: 0.1 });
    S.bake();

    return B.finish({
      cam: { target: [0, 1.4, 0], dist: 12, pitch: 0.2, yaw: 0.45 },
      detail: 14,
      dither: 0.25,
      radius: 5
    });
  }
});
```

Render it without opening a browser:

```sh
npx ink-studio render model.js --colored
npx ink-studio turn model.js --n 8
npx ink-studio stats model.js
```

The same runnable scene is included as [examples/sculpt.js](examples/sculpt.js). Position vectors use `[x, y, z]`, with Y up. `S.box` takes half-extents, so `[1, 1.2, 1]` makes a box 2 units wide, 2.4 high and 2 deep. `res` is the surface sampling spacing: smaller values generally create more splats and cost more to bake and render.

## Using the library in Node

```js
const studio = require('@shapeshift-labs/ink-studio');
const { makeBuilder, makeSculpt, KIT: K, SCENES } = studio.load();

const B = makeBuilder(7);
const S = K.sculpt(makeSculpt(B));
S.ball([0, 1, 0], 1, { r: [1, 2, 3, 4] }, { res: 0.15 });
S.bake();
const world = B.finish({
  cam: { target: [0, 1, 0], dist: 10, pitch: 0.2, yaw: 0.4 },
  detail: 14
});

console.log(world.count, world.data instanceof Float32Array);
console.log(SCENES.map(scene => scene.id));
```

`makeSculpt(B)` creates the base sculptor. `K.sculpt(...)` adds the toolkit's extended shape operations. `load()` compiles and caches a concatenated CommonJS bundle in the package's `dist/standalone.js`; it needs a writable package directory on first use or after source changes.

The package entry point exposes:

| Export | Result / purpose |
| --- | --- |
| `load()` | `{ makeBuilder, makeSculpt, KIT, SCENES, PixelLook, VOX, ... }` ready for Node. |
| `files()` | Absolute source paths in dependency order. |
| `demoFiles()` | Absolute demo source paths. |
| `bundle()` | Toolkit source as one script string, without demo scenes. |
| `demos()` | Demo source that appends to an existing `SCENES` array. |
| `readMesh(file, { attributes })` | Read an OBJ, glTF or GLB file and its supported companion files. Request UV and material attributes where the format supplies them. |
| `readAsset(file, options)` | Read a portable GLB with textures. PNG decoding is included. Supply a decoder for JPEGs. |
| `readRasterAsset(file)` | Load a raster JSON manifest, including layer frames backed by PNG files, into the procedural graph's raster interface. |
| `render(world, options)` | Return a CPU-rendered art frame with `w`, `h`, `rgb`, and `px`. Request named diagnostic buffers with `passes`. |
| `spriteAtlas(world, options)` | Render a directional RGBA atlas with metadata and optional related maps. |
| `exportGlb(modelOrFile, { out, ...options })` | Export indexed authoring geometry or an input mesh file as a self-contained GLB. |
| `lint(files)` | Return lines rejected by the source comment guard. |
| `EXPORTS` | Comma-separated names defined by the source bundle. |
| `version` | Package version string. |

`load()` also exports `basis`, `flame`, `motes`, `pondMat`, `lilies`, `courses`, `PALETTES` and `PAL_HEX`. Use the `KIT` namespace for the main authoring APIs.

## Scene lifecycle and splat data

1. Create the builder and sculptor with a stable seed and palette.
2. Install hooks such as a rig, light capture or deformation tags **before** baking the solids they must capture.
3. Add solids and call `S.bake()` to sample their surfaces, light them and write splats.
4. Allocate particle pools, cloth, hair and other systems that emit splats **before** `B.finish()` fixes the world's data span.
5. Finish with camera and rendering metadata.
6. Attach a stage, puppet or other animation driver to the finished world.

Bake static scenery before adding moving objects when scenery should not contain holes or baked shadows from those moving objects. The puppet example uses this pattern.

Use [art-directed shadows](docs/live-sun.md#art-directed-shadows) to step shadow ramps, select casters and receivers, and simplify shadows at small sizes.

Use [live splat relighting](docs/live-sun.md#relight-baked-color-and-detail) to move local lights or change the time of day while keeping authored surface detail.

A world includes `data`, `count`, `pal`, `seed`, rendering metadata, and optionally `anim`. `data` is a `Float32Array` with **16 floats per splat**:

```text
[x, y, z, density]
[c00, c01, c02, packedRGB]
[c11, c12, c22, kind]
[phase, speed, range, extra]
```

The `c` values encode a symmetric covariance matrix describing the splat's shape. Use toolkit systems to modify the data when possible so covariance, color and changed-row tracking stay consistent.

`K.stage(world)` installs `world.anim`. Systems run in the order added; painters combine color effects in their own addition order. A stage normalizes its clock to its first update and clamps individual simulation steps to 0.05 seconds. For reproducible simulation, initialize at zero and use fixed forward steps:

```js
const { KIT: K, SCENES } = require('@shapeshift-labs/ink-studio').load();
const scene = SCENES.find(scene => scene.id === 'burn');
const world = scene.build(scene.seed);
world.anim.update(0, 0);
for (let frame = 1; frame <= 120; frame++) {
  world.anim.update(1 / 60, frame / 60);
}
```

Stateful worlds need their intervening simulation steps. Rebuild them to return to an earlier time. Pure clips can be sampled directly at arbitrary times. The CLI handles forward stepping and bone projection for rendered animation.

## Geometry and materials

The core sculptor provides `ball`, `box`, `lathe`, `torus`, `tube`, `rock`, `ground` and vegetation helpers. The extended sculptor adds joins, folds, warps, shells, extrusion, revolution, text, grid operations and other modeling tools.

Use [adaptive sculpt sampling](docs/adaptive-sculpt-sampling.md) to concentrate splats on bevels, tight curves and chosen silhouettes while reducing density across broad faces.

This complete scene cuts a cylindrical opening through a box. `hold: true` creates operands without emitting them as separate visible solids; the join emits the combined result.

```js
module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'arch-example', name: 'Carved arch', seed: 1,
  build(seed) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    const material = { r: [1, 2, 3, 4] };
    const held = { hold: true };
    const block = S.box([0, 1, 0], [1.2, 1, 0.45], material, held);
    const opening = S.tube([[0, 0.7, -1], [0, 0.7, 1]], 0.65, 0.65, material, held);
    S.join('cut', block, opening, { res: 0.12 });
    S.bake();
    return B.finish({
      cam: { target: [0, 1, 0], dist: 10, pitch: 0.2, yaw: 0.4 },
      detail: 14
    });
  }
});
```

Useful options include `tag` for ownership, `neg` for subtraction, `ghost` for geometry that is drawn without ordinary solid occlusion, and `ax` for an orientation frame. Join kinds include `union`, `cut`, `common`, `round`, `chamfer`, `stairs`, `columns`, `pipe`, `engrave`, `groove` and `tongue`.

Materials normally use palette indices in a dark-to-light ramp:

```js
const stone = { r: [1, 2, 3, 4] };
const glow = { r: [5, 6, 7], em: true };
const bands = { r: [1, 2, 3, 4], mod: K.tex.range(K.tex.wave(5), 0, 1, -0.2, 0.2) };
const wax = K.look.wax([1, 2, 3, 4], { depth: 0.5 });
const jelly = K.look.jelly([5, 6, 7], { depth: 1.3, k: 0.85 });
const glass = K.look.glass([2, 3, 4], { a: 0.085 });
const fur = K.look.fur([1, 2, 3, 4], { len: 0.2, droop: 0.3 });
```

This fragment assumes an existing `K` namespace and a palette containing every referenced index. Material callbacks can choose ramps, shift tones or color individual surface points. Patterns include noise, Voronoi cells, waves, bricks, checkers and gradients. Surface attributes can drive wear, grime, root shading and coats of material.

See [lab/shapes.js](lab/shapes.js) and [lab/warps.js](lab/warps.js) for complete shape galleries. The [Night Cabinet demo](demos/labscenes.js) combines glass, translucency, fur and smoke.

## Scenes as JSON

JSON scenes describe materials by role, then a style maps each role to a palette. Built-in styles are `slate`, `moss` and `ember`.

<!-- include: examples/scene.json -->

```json
{
  "id": "json-example",
  "name": "Floating gem",
  "seed": 2,
  "style": "moss",
  "camera": { "target": [0, 1.5, 0], "dist": 12, "pitch": 0.2, "yaw": 0.4 },
  "solids": [
    { "kind": "ground", "mat": "earth", "rad": 4, "res": 0.2 },
    { "kind": "ball", "at": [0, 1.8, 0], "r": 0.7, "mat": "accent", "part": "gem", "res": 0.12 }
  ],
  "parts": { "gem": { "joint": [0, 1.8, 0] } },
  "motion": [
    { "do": "spin", "part": "gem", "axis": [0, 1, 0], "speed": 0.8 },
    { "do": "bob", "part": "gem", "amount": 0.2, "period": 3 }
  ],
  "tap": { "do": "sparks", "colours": "glow", "n": 12 }
}
```

```sh
npx ink-studio validate examples/scene.json
npx ink-studio render examples/scene.json --t 1.5
npx ink-studio render examples/scene.json --style ember --t 1.5
npx ink-studio clip examples/scene.json --from 0 --to 3 --fps 12
```

Programmatic validation returns all diagnosed problems rather than only the first one:

```js
const { KIT: K } = require('@shapeshift-labs/ink-studio').load();
const spec = {
  id: 'small-scene', name: 'Stone', seed: 1, style: 'slate',
  camera: { target: [0, 1, 0], dist: 10, pitch: 0.2, yaw: 0.4 },
  solids: [{ kind: 'ball', at: [0, 1, 0], r: 1, mat: 'stone', res: 0.15 }]
};
const problems = K.diorama.check(spec);
if (problems.some(problem => problem.level === 'error')) {
  throw new Error(K.diorama.report(problems));
}
const world = K.diorama.build(spec);
console.log(world.count);
```

`K.diorama.scene(spec)` wraps a specification as a scene with a `build` method. `K.diorama.kinds` exposes the supported solid fields, and `K.diorama.styles` exposes style definitions. Programmatic mesh assets go in the second argument as `{ assets: { name: mesh } }`.

Use the [headless scene editor](docs/scene-editor.md) to select solids, edit transforms and materials, and save the resulting diorama JSON.

Reuse unchanged bake inputs in the editor and pass `--asset-cache DIR` to retain diorama bake results across CLI runs. [Incremental baking](docs/scene-editor.md#incremental-baking)

Apply a [versioned complete look](docs/environment-packs.md#complete-looks) to a diorama with `--asset-pack` and `--environment-preset`. The Copperwind example compares three styles with the same camera, geometry, and animation.

The larger [lab/data-shrine.json](lab/data-shrine.json) demonstrates joins, folded and warped geometry, parented parts, lights, particles and tap effects.

## Animation and puppets

Named framing targets, rails, occlusion avoidance, and shot blends work across the CPU and WebGL renderers. [Camera rigs and staging](docs/camera-rigs.md)

Tables, spatial features, and time series can drive shared parameters and simulation queries with declared types, units, coordinate systems, and missing-value policies. [Typed data inputs](docs/typed-data-inputs.md)

Map rows and simulation fields to native marks with position, size, color, opacity, shape, and motion. Inspect the source record through a pick or query. [Data-bound visual marks](docs/data-bound-marks.md)

Draw crisp world and screen paths, arrows, polygons, grids, axes, and scale bars over the native scene. [Precise drawing primitives](docs/drawing-primitives.md)

Keep legends fixed while world labels reposition around anchors and thin out as the camera pulls back. [View-adaptive legends and labels](docs/view-annotations.md)

Synchronize records, filters, and time across charts, maps, tables, and WebGL scenes. [Linked views and selections](docs/linked-views.md)

Render scalar slices, contours, and isosurfaces alongside vector streamlines and glyphs. [Field and volume visualization](docs/field-visualization.md)

Evolve editable cells with seeded neighborhoods and associative recall, then paint the glyph atlas or emit splats. [Procedural glyph grids](docs/glyph-grids.md)

Accumulate moving deposits on surface charts or in world volumes, then render their decay and diffusion as color, contours, and splats. [Persistent spatial fields](docs/persistent-spatial-fields.md)

Move section planes, depth ranges, and spatial masks across a native render. [Interactive cutaways and clipping](docs/cutaways.md)

Compare synchronized scenes with side-by-side playback, a swipe divider, and signed overlays. [Comparison views](docs/comparison-views.md)

Capture independent cameras under a shared budget and compose their feeds into overlays and textured world panels. [Multi-camera render atlases](docs/camera-atlas.md)

Encode categories with patterns and shapes, label scale endpoints, and navigate linked records with a keyboard. [Accessible data encodings](docs/linked-views.md#accessible-encodings)

The [unified scene timeline](docs/scene-timeline.md) synchronizes camera motion, rig poses, lights, effects, audio cues, and world events through keyframes and nested sequences.

Use `K.rig` for tagged rigid parts, `K.creature` for a creature rig, and `K.puppet` for hierarchical parts with deformation. `K.anim` provides clips, easing, layers, state machines, constraints, facial controls and presentation cues. `K.acts` provides ready-made action and reaction clips.

Named clip markers can drive transitions, puppet contacts, sound cues, and presentation effects. [Animation events and state graphs](docs/animation-events.md)

Bind audio cues to scene emitters, material contacts, and simulation events with listener-relative attenuation and occlusion. [Spatial audio and event cues](docs/spatial-audio.md)

<!-- include: examples/puppet.js -->

```js
module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'puppet-example',
  name: 'Celebrating puppet',
  seed: 3,
  build(seed) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.2 });
    S.bake();

    const tags = K.deform.tags(S);
    S.ball([0, 1, 0], [0.55, 1, 0.55], { r: [1, 2, 3, 4] }, { tag: 'body', res: 0.12 });
    S.ball([0, 2.25, 0], 0.4, { r: [5, 6, 7] }, { tag: 'head', res: 0.1 });
    S.bake();

    const W = B.finish({
      cam: { target: [0, 1.5, 0], dist: 12, pitch: 0.15, yaw: 0.4 },
      detail: 14,
      dither: 0.25
    });
    const clip = K.acts.clip('victory', { part: 'body', unit: 0.01 });
    K.puppet(W, {
      react: true,
      parts: {
        body: { ids: tags.body, pivot: [0, 0, 0], slices: 6 },
        head: { ids: tags.head, pivot: [0, 2, 0], parent: 'body' }
      },
      pose(t, dt, puppet) {
        clip.sample(t % 2, puppet.pose);
        puppet.look('head', [3, 2, 2], { limit: 45 });
      }
    });
    return W;
  }
});
```

```sh
npx ink-studio render examples/puppet.js --t 0.6
npx ink-studio sheet examples/puppet.js --from 0 --to 2 --n 8
npx ink-studio ghost examples/puppet.js --t 0.6 --spacing 0.12 --n 2
npx ink-studio acts
```

Clips can also be sampled as plain pose data, independently of a world:

```js
const { KIT: K } = require('@shapeshift-labs/ink-studio').load();
const clip = K.anim.clip({
  dur: 2,
  loop: true,
  tracks: {
    'head.rot': [[0, [0, 0, 0]], [1, [0, 30, 0], 'out-back'], [2, [0, 0, 0]]]
  }
});
const pose = {};
clip.sample(0.5, pose);
console.log(pose.head.rot);
```

Clip pose rotations use degrees; matrix rotations and many geometry options use radians. Check the relevant module's opening API comment before combining the two.

Use [route followers and events](docs/route-followers.md) for loop-safe vehicle frames, banking, speed sections, station stops, arc-length train spacing and events scheduled ahead of a vehicle. `K.anim.route` consumes an arc-length path and returns poses and timestamps for any renderer or simulation.

Additional animation APIs include `K.anim.machine`, `K.anim.face`, `K.anim.path`, `K.anim.steer`, `K.anim.track` and `K.anim.support`. Deformation maps include body squash/stretch, noodles, folds, lattices, morphs, smears, reaction fields, foliage and line boil. Apply maps on the CPU with `K.deform.apply`, or use puppet/bone skinning with an appropriate host renderer.

Use [pose blocking and the pose shelf](docs/pose-blocking.md) to hold named story poses, draft in-betweens, and apply reusable poses to a puppet. The `pose-review` command checks the same landmarks as silhouettes at the size and angles of a directional sprite atlas.

Use [Motion Review](docs/motion-review.md) to inspect loop pops, spacing spikes, arc kinks, and foot drift on solved puppet motion. Audition one beat at a time and apply, mute, or remove corrective layers.

Use [clip sequencing](docs/clip-sequence.md) to trim and retime instances, inspect handoffs, and audition Once, Loop, or Travel loop playback. Keys and cues follow their clip instances through timing changes.

Use [authored contacts and prop handoffs](docs/authored-contacts.md) to pin a hand or foot, seat it on a captured scene surface, or key a prop between sockets. Bounded reach assistance and grip residuals are available on the headless timeline.

Use [Motion FX](docs/motion-fx.md) to time stretch, smear, trails, and solid splat sweeps independently. Each effect has its own intensity keys and part mask.

Use [Cloth Review](docs/cloth-review.md) to paint pin, free, and protected regions, preview the existing XPBD solver from a captured pose, and bake a settled take.

Use the [headless animation timeline](docs/animation-timeline.md) to put these tools on one shot clock. Switch between Block, Spline, and Polish, inspect all lanes, and preview a Motion Review beat at the current sprite direction.

Use [motion retargeting](docs/motion-retarget.md) to adapt a clip to another puppet's rest axes and proportions. Start with a biped, quadruped, avian, or serpentine profile, or define your own and bake editable Ink keys.

Use [Motion Layers](docs/motion-layers.md) to play a base performance with ordered, part-masked override clips and animate their weights on the headless timeline.

`K.character(B, spec, lane)` creates an input-driven character with movement, running, jumping, dashing, attacks, casting and crouching. Its specification supplies geometry and rig points; it is a toolkit for authoring a character, rather than a bundled cast of character assets. The API is documented at the top of [kk-character.js](src/kit/kk-character.js).

## Particles and interaction

Allocate a pool before finishing the world. Then attach particles and emission systems to a stage:

<!-- include: examples/particles.js -->

```js
module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'particles-example',
  name: 'Embers in a current',
  seed: 4,
  build(seed) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.2 });
    S.ball([0, 0.4, 0], 0.4, { r: [5, 6, 7], em: true }, { res: 0.12 });
    S.bake();

    const pool = K.pool(B, 160);
    const W = B.finish({
      cam: { target: [0, 1.2, 0], dist: 12, pitch: 0.2, yaw: 0.4 },
      detail: 14,
      dither: 0.25
    });
    const stage = K.stage(W);
    const particles = stage.add(K.particles(stage, pool, {
      flow: K.flow.sum(K.flow.wind([0.3, 1, 0]), K.flow.curl(1, 0.4)),
      ground: () => 0
    }));
    let next = 0;
    stage.add({
      update(dt, t) {
        if (t >= next) {
          particles.embers([0, 0.6, 0], 3, [6, 7, 5]);
          next = t + 0.1;
        }
      },
      poke(hit) {
        if (hit) particles.sparks(hit.p, 16, [7, 6, 5]);
      }
    });
    return W;
  }
});
```

```sh
npx ink-studio clip examples/particles.js --from 0 --to 2 --fps 12
npx ink-studio render examples/particles.js --t 1.2 --poke '1:0,0.4,0'
```

A stage's `poke(eye, direction)` picks the surface and dispatches the result to systems with a `poke` method. `--poke` scripts the same interaction for headless commands; separate multiple timed taps with semicolons and quote the entire value.

Particle helpers include `dust`, `sparks`, `embers`, `smoke`, `chips`, `ring`, `bolt` and `rain`. `emit` exposes velocity, lifetime, gravity, drag, size, palette colors and flow response. Flow fields can combine wind, curl, vortices and sinks; `K.flow.around(flow, sdf, margin)` turns a current along solid boundaries.

### Frame-local splat effects

Use `K.frameSplats(B, capacity, render)` for effects whose geometry is redrawn each frame. Reserve the splats before `B.finish()` and attach the system with `stage.add(frame)`. The stage calls `render(draw, dt, time)` each update, and the system hides any rows left over from the previous frame. It can share a stage with `K.particles`.

```js
const model = K.frameSplats.capture(modelWorld, [0, 0, 0]);
const frame = K.frameSplats(B, model.count + 48, (draw, dt, time) => {
  const stretch = 1 + 0.5 * K.wobble(time / 0.8);
  draw.model(model, [2, 1, 0], { matrix: K.M.stretch([0, 1, 0], stretch, true) });
  draw.vortex([0, 0, 0], { phase: time * 4, radius: [0.2, 1.2], color: 3 });
});
const W = B.finish({ /* scene metadata */ });
K.stage(W).add(frame);
```

- `capture(world, origin)` snapshots the visible splats around a local origin. Instances reuse the baked colors, densities and shapes. Surface material tables and shader motion are outside the snapshot.
- `draw.model(model, at, { matrix, opacity })` sends the local origin to `at` and transforms both centers and covariance with a row-major 3×3 matrix. Defaults are the identity matrix and opacity 1.
- `draw.streak(a, b, { width, color, density, emissive })` draws one splat. Width is a world-space half-width, and color is an index into the scene palette. Defaults are `0.04`, `1`, `2`, and `true`.
- `draw.vortex(center, options)` draws `arms * segments` streaks. It accepts the streak options plus `axis` (Y up), `radius` (one radius or a base and tip pair), `height`, `turns`, `phase` in radians, `arms` (3), and `segments` per arm (16). Animate `phase` for rotation or vary `radius`, `height`, and `density` for a transition.

Each draw call returns `false` and leaves the current frame intact if the whole effect can’t fit. `K.wobble(t, cycles = 2)` returns a signed, decaying offset over normalized time. Use `K.ease.back` for a single overshoot and `K.ease.elastic` for easing into a target with an oscillation.

The [splat effects example](examples/splat-effects.js) shows both effects together.

```sh
npx ink-studio clip examples/splat-effects.js --from 0 --to 1.5 --fps 12
```

## Physics and persistent effects

There are several simulation levels:

| API | Use |
| --- | --- |
| `K.breaker`, `K.rubble`, `K.debris` | Breaking, unsupported pieces, falling rubble and loose fragments. |
| [`K.destruction`](docs/destruction.md) | Breakable authored parts and terrain strokes, current-pose physics handoffs, swept impacts, support cascades and exact reset. |
| [`K.ecology`](docs/ecology.md) | Shared material channels, extensible processes and contacts, existing fire integration, splat/texture damage, local light and checkpoint replay. |
| `K.jelly`, `K.sand` | Lightweight shape deformation or granular motion. |
| `K.mpm` | A material-point solver for elastic jelly, yielding clay, granular sand and water. |
| `K.sandbox` | A cellular material simulation with fluid flow, heat, phase changes and reactions. |
| `K.inside` | Interior splats revealed by bites and cuts. |
| `K.xpbd.sim`, `K.cloth`, `K.hair` | Constraint-based points, cloth and groomed strands with pins, collisions and wind. |
| `K.xpbd.rope`, `K.xpbd.carry`, `K.xpbd.blades` | Ropes, chains, objects carried by simulated points, kelp and reeds. |
| `K.voxels` | Persistent per-cell channels, spreading fire/frost/growth, and support queries. |

Use `K.sandbox.grid({ at, size, cell })` to set up a material grid. Add volumes with `grid.box(lo, hi, material)` and assign sculpted surfaces with `grid.walls(S.sdf, { as: 'stone' })`. Pass `grid.spec()` as `sandbox` when finishing the world, then use `K.sandbox.attach(world)` to add the simulation to the scene. Browser hosts can supply a worker that runs `K.sandbox.serve(self)`.

A complete cloth scene:

<!-- include: examples/cloth.js -->

```js
module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'cloth-example',
  name: 'Cloth in the wind',
  seed: 1,
  build(seed) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.2 });
    S.bake();

    const cloth = K.cloth(B, {
      at: [-1, 3, 0],
      u: [2, 0, 0],
      v: [0, -2, 0],
      nu: 12,
      nv: 10,
      pins: (i, j) => j === 0,
      wind: K.xpbd.gust([2, 0, 1]),
      pattern: (u, v) => (Math.floor(u * 6) + Math.floor(v * 6)) % 2 ? [1, 2, 3] : [5, 6, 7],
      sdf: S.sdf
    });
    const W = B.finish({
      cam: { target: [0, 1.5, 0], dist: 12, pitch: 0.2, yaw: 0.5 },
      detail: 14,
      dither: 0.25
    });
    K.stage(W).add(cloth);
    return W;
  }
});
```

```sh
npx ink-studio render examples/cloth.js --t 1
npx ink-studio clip stuff --from 0 --to 3 --fps 12
npx ink-studio render idol --t 2 --poke '1:0,2,0'
```

For persistent effects, use an existing sculpted `S` and finished world's `stage`:

```js
const voxels = K.voxels(stage, { cell: 0.4, sdf: S.sdf });
stage.add(voxels.fire({ look: { flame: [6, 7], soot: [1] } }));
stage.add(voxels.frost({ look: { pale: [3, 4] } }));
voxels.brush('heat', [0, 1, 0], 0.8, 1);
const heat = voxels.get('heat', 0, 1, 0);
```

The channels are created on demand. Fire behavior depends on the sampled scene's fuel/material properties. See `burn` for fire and frost, `idol` for destruction, `bench` for the lightweight solvers, and `stuff` for the material-point solver.

## Optional textured surfaces

Use `TexturedSurface.heightfield`, `TexturedSurface.sweep` and `TexturedSurface.grid` to author optional pixel-textured patches alongside SDF solids and splats. Add patches with `SpriteSurface.make().mesh(...)` and attach the finished atlas as `world.spriteSurfaces`. Attachment samples use the same triangles as the visible patch. Both the software renderer and WebGL renderer accept mixed scenes and entirely textured scenes. See the [textured surface guide](docs/textured-surfaces.md) and [mixed example](examples/textured-surfaces.js).

## Importing meshes

```sh
npx ink-studio mesh lab/assets/totem.obj --size 5 --cells 64 --res 0.1
npx ink-studio turn lab/mesh.js --n 8
npx ink-studio render model.glb --size 6 --up z
```

Programmatic import:

```js
const studio = require('@shapeshift-labs/ink-studio');
const { makeBuilder, makeSculpt, KIT: K } = studio.load();
const mesh = K.mesh.fit(studio.readMesh('lab/assets/totem.obj'), { size: 5 });
const look = K.mesh.look(mesh, { hues: 5, shades: 4 });
const B = makeBuilder(1, look.pal);
const S = K.sculpt(makeSculpt(B));
S.mesh(mesh, look, { cells: 64, res: 0.1 });
S.bake();
const world = B.finish({
  cam: { target: [0, 2.5, 0], dist: 15, pitch: 0.2, yaw: 0.4 },
  detail: 14
});
console.log(world.count);
```

The file example assumes the current working directory is this repository. OBJ supports a companion MTL; glTF supports companion buffers; GLB is read from binary data. Material and vertex colors become palette ramps. Texture images are not imported. Open meshes become sheets with thickness. Imported geometry becomes a distance-field solid, so it can join, be carved, receive materials and break like authored geometry.

## Exporting GLB models

```sh
ink-studio export-glb examples/puppet.js --out celebrating-puppet.glb
ink-studio export-glb lab/data-shrine.json --out shrine.glb
ink-studio export-glb path/to/model.obj --out model.glb
```

The exporter uses Ink Studio and the Node standard library. It preserves self-contained GLBs byte-for-byte and embeds local companion buffers and textures when packing glTF. OBJ conversion retains authored corner UVs, normals, and basic PNG or JPEG diffuse maps. Authored geometry with missing UVs receives a packed unwrap.

- **Body topology.** `KIT.model.fromSculpt(S, options)` captures the finite rest field before `S.bake()`. It builds a dense source mesh and simplifies it with the built-in indexed edge-collapse tool. Part seams, geometric error and optional cross-section guides constrain simplification. Set `--res` to control the source pitch and `--triangles` to set a target. Protected features can keep the input above the target. In JavaScript, pass `guides: [{ center, axis, radius }]` to add edges around a section, or supply a fitted `topology: { points, faces, uvs }` to control the final edge flow and UV seams directly.
- **Rest fields.** `KIT.model.fromSdf(field, { bounds })` accepts a signed function or a bounded field object. The field must stay positive on the box boundary. Extraction tries a quad surface first, with indexed tetrahedra for ambiguous cases. The optional `--method` accepts `surfaceNets`, `dualContour`, `adaptive` or `tetrahedra`. Use `--bounds xmin,ymin,zmin,xmax,ymax,zmax` to tighten the static bounds of a JSON diorama.
- **Details and fur.** Give a torus or ellipsoid `model: { separate: true, name }` in its sculpt options to export it at its own resolution. This also works for emissive ellipsoids authored as ghost shapes. In JSON use `separate: true` on a ball or torus and put material channels under `mat.model`. Authored fur grows solid locks and curved cutout cards from the coat's length, comb direction, droop, clumping and palette. The optional `fur: { density, maxLocks }` controls its budget and `fur: false` produces a bare mesh.
- **Materials.** The baker places padded UV charts on the runtime mesh and samples the rest field per texel. It can embed base color, tangent-space normals, metallic/roughness, and emission. An authored material can set these channels through `model: { color, roughness, metallic, emission, normal }` or a `model(point, normal)` function. Color and emission use linear RGB. Texture sizes range from 256 to 4096 in powers of two. Set `--texture-size 0` to export palette materials. View-dependent splat lighting, particles and per-pixel decals are handled by the splat renderer.
- **Animation.** A JavaScript scene can return its indexed mesh or a `{ meshes, joints, animations }` model from `model(seed, options)`. Use `KIT.model.fromPuppet(mesh, puppet, { clips })` to sample a tagged puppet or `KIT.model.fromCreature(mesh, creature, { clips, parents, bones, weightZones })` with a bound creature. Creature splits provide per-region weights. Optional `weightZones: [{ center, radius, a, b, axis }]` blend adjacent regions around joints. Fur uses the weights at its roots. A model uses its authored rig for joint names, weights, and clips. JSON dioramas can export rigidly weighted parts from their motion data. `--duration` and `--fps` control sampling where the scene exposes those options.

A custom indexed mesh supplies `points` and triangle or quad `faces`. It may provide linear RGB `colors` per point, face-corner `uvs`, `materials: [{ name, color }]` and a material index per face in `faceMaterials`. A model joint has `{ name, parent, head, tail }` with the parent index preceding its children. Each skinned mesh supplies a list of `[jointIndex, weight]` pairs per vertex. Use `static: true` for scenery. The writer keeps and normalizes the four strongest weights. Each custom clip supplies `frames: [{ time, matrices }]` beginning at time zero. Matrices are rest-to-pose transforms in world space, with nine row-major linear components followed by XYZ translation. The export uses a pair of nodes when a sampled affine transform needs shear.

## Round-trip asset interchange

`ink-studio interchange <input> --out <output>` round-trips glTF 2.0, GLB, layered raster manifests, and sprite atlases. The [asset interchange guide](docs/asset-interchange.md) covers the retained data, file layouts, and JavaScript APIs.

## Importing depth maps

`ink-studio depth` converts a grayscale PNG or numeric depth map into Gaussian splats, a backed signed-distance field and an OBJ mesh. Add an aligned RGB or RGBA PNG with `--image` to project its colour onto the observed surface. `KIT.depth.fromMap()` gives scene authors the same conversion and accepts typed arrays directly. See the [depth import guide](docs/depth-maps.md) for camera calibration, output formats, and converting a signed field back into mesh geometry or splats.

## Procedural worlds

`KIT.procedural` runs in Node and in the plain-script browser bundle. Its tools work with signed fields, voxel grids, curves and placements. Feed those results into the sculptor, material pipeline or stage, or extract a mesh for preview or interchange. The [procedural API guide](docs/procedural.md) documents signatures, options and runnable examples.

| Area | Available tools | Guide |
| --- | --- | --- |
| Noise and scalar fields | Seeded simplex noise and analytic derivatives, ridged and billow noise, anisotropic noise, domain warps, periodic and looped noise, terraces, distance fields and serializable composition for displacement, masks and placement. | [Composable fields](docs/procedural.md#composable-procedural-fields) |
| Sampling and placement | Poisson disk with variable radius and anisotropy, chunk-stable spacing and species exclusion, progressive sample elimination, Lloyd relaxation, stratified surface sampling, geodesic spacing and curvature weighting. | [Stable spacing](docs/procedural.md#stable-spacing-and-finite-poisson-sampling), [Progressive samples](docs/procedural.md#progressive-samples-and-surface-detail) |
| Terrain, rivers and habitats | Depression filling and breaching, D8 and D-infinity drainage, catchments and stream order, channel incision, meanders and cutoffs, levees and floodplains, marching-squares shorelines, climate and habitat fields, and 3D biome and water queries. | [Watersheds](docs/procedural.md#watersheds-and-river-networks), [River editing](docs/procedural.md#river-editing-and-habitats), [Biome queries](docs/procedural.md#world-space-biome-queries) |
| Routes, networks and settlements | Terrain-aware A* with slope and clearance, visibility paths and clearance-tested splines, fast-marching travel times, Delaunay networks and minimum spanning trees, Steiner approximations, tensor and agent-grown streets, frontage parcels and medial paths. | [Terrain routes](docs/procedural.md#terrain-routes-between-pins), [Branching networks](docs/procedural.md#triangulation-and-branching-networks), [Street systems](docs/procedural.md#street-systems-parcels-and-medial-paths) |
| Buildings and construction | Split, repeat and inset grammars with pinned bays, fitted courses and ribbons, panel frames and attachment slots, dimensioned socket assemblies, load paths, damage rules, adjacency floor plans and packing, signed footprint offsets and weighted roofs with per-edge pitches. | [Shape grammar](docs/procedural.md#shape-grammar-and-pinned-bays), [Socket assemblies](docs/procedural.md#socket-assemblies-supports-and-damage), [Weighted roofs](docs/procedural.md#footprints-and-weighted-pitched-roofs) |
| Constraints and layouts | Socket-constrained and overlapping Wave Function Collapse, constraint propagation and backtracking with pins, Wang and hierarchical tiling, grid and graph rewrite rules, binary space partitioning and connected cellular caves. | [Socket tiling](docs/procedural.md#socket-tiling-and-learned-swatches), [Rewriting](docs/procedural.md#grid-and-graph-rewriting), [Rooms and caves](docs/procedural.md#rooms-caves-and-packing) |
| Growth and ecology | Stochastic, parametric L-systems with environmental inputs, branching across surfaces, leaf venation, moisture-aware roots, pipe-model taper, diffusion-limited aggregation, grid and surface Gray–Scott patterns, seed dispersal and succession. | [Vegetation](docs/procedural.md#vegetation-and-colony-patterns), [Surface growth](docs/procedural.md#surface-growth) |
| Sculptural forms and fracture | Superquadrics, profile lofts, medial skeletons, mirrored and radial grammars, gyroid and other periodic solids, variable shells, weighted anisotropic fracture, stress-guided cracks and progressive bond failure. Bake bounded forms with `S.implicitForm`. | [Implicit forms](docs/procedural.md#implicit-forms), [Fracture](docs/procedural.md#implicit-fracture-and-crack-paths) |
| Pixel materials | Curvature and occlusion wear, contact masks and runoff streaks, triplanar and tangent-aligned patterns, object-anchored thresholds with pixel-footprint filtering, perceptual ramps, distance outlines, swatch quilting, PatchMatch fills and void-and-cluster dither. | [Contact fields](docs/procedural.md#contact-fields-runoff-and-contours), [Material mapping](docs/procedural.md#material-mapping-ramps-and-distance-ink), [Swatch synthesis](docs/procedural.md#swatch-synthesis-and-threshold-ranks) |
| Geometry and level of detail | Euclidean distance transforms, signed-field reinitialization, polygon triangulation with holes and constrained Delaunay, Surface Nets, dual contouring, adaptive octrees and stitched voxel levels, quadric mesh simplification and guarded Gaussian splat merging. | [Dual surfaces](docs/procedural.md#dual-surface-samples-and-reinitialization), [Adaptive levels](docs/procedural.md#adaptive-voxel-levels), [Preview reduction](docs/procedural.md#preview-reduction) |
| Motion and persistent changes | Streamlines and signed-obstacle wakes, closed trajectories, splat advection on deforming surfaces, stable fluids and shallow water, wetness and drying, temperature and exposure, snow and frost, material state graphs and transport-based morphs. Ground traversal, ambient roaming and a scene clock support live worlds. | [Currents](docs/procedural.md#currents-and-surface-motion), [Fluids](docs/procedural.md#fluid-grids), [Weather and materials](docs/procedural.md#weather-and-retained-materials), [Splat transport](docs/procedural.md#splat-transport) |

Run [terrain routing](examples/terrain-route.js), [a weighted roof](examples/weighted-roof.js), [texture synthesis](examples/texture-synthesis.js), or [a transport morph](examples/transport-morph.js) from the checkout.

[Proportional subdivision](docs/proportional-layout.md) reuses a golden-ratio or custom hierarchy across façade parts, trim, and shot layouts.

[Surface phyllotaxis](docs/surface-phyllotaxis.md) grows golden-angle layouts on spheres and curved charts while preserving earlier placements.

[Wallpaper and frieze groups](docs/wallpaper-frieze.md) repeat a vector motif as seamless pigment, etched relief, or tiles.

[Quasiperiodic tilings](docs/quasiperiodic-tilings.md) generate Penrose and Ammann–Beenker pavement with stable tile addresses.

[Hyperbolic mosaics and circle packing](docs/hyperbolic-mosaics.md) generate Poincaré-disk tiles and Apollonian circles with bounded detail.

```sh
node cli/ink-studio.js render examples/weighted-roof.js --seed 1 --ortho --colored
```

Higher-level scene helpers include:

- `K.curve` and `K.sweep`: paths, ribbons, leaves, planks and swept profiles.
- `K.grow`: surface-aware scattering, branching, species variation, instancing, rocks, creepers and spreading patches.
- `K.form`: crystals, geodes, basalt columns, stalactites, flowstone, icicles, layered rock, plants and creature parts.
- `K.erode`: hydraulic erosion and thermal slides over a height field.
- `K.fracture`: Voronoi fracture cells with placement and settling helpers.
- `K.build`: fitted pillars, fences, stairs, arches and pipes; recipes and attachment sockets.
- `K.weather`: falling rain, snow and leaves; `K.form.drifts` and `K.form.frost` add accumulated snow and frost patterns.
- `K.flock`: birds, fish and fireflies; `K.morph` blends two splat shapes over time.

For example, in a scene with `K`, `S` and a suitable palette:

```js
const places = K.grow.scatter(S, { disc: [0, 0, 4], n: 12, gap: 0.6, seed: 8 });
const species = K.grow.species({
  name: 'stone',
  vary: { size: [0.15, 0.4] },
  make(S, at, values) {
    S.ball(at, values.size, { r: [1, 2, 3, 4] }, { res: 0.12 });
  }
});
species.sow(S, places);
S.bake();
```

Use `ink-studio catalog <words>` to search catalog entries and follow their `where` fields to the implementation.

## Editable 3D drawing

`KIT.sculpt(S)` adds `S.stroke(mark, mat, options)` and `S.fill(mark, mat, options)`. JSON dioramas accept the same fields as `kind: "stroke"` and `kind: "fill"` solids. Marks bake into splats with the same materials, rig parts, and detail budgets as other solids.

| Field | Behavior |
| --- | --- |
| `points` | Stroke control points as world XYZ triples or surface UV pairs. A single point makes a dab. |
| `width`, `depth`, `axis` | Stroke diameter and thickness in world units. Defaults are width 0.2, depth equal to width, and world Z as the depth axis. On a carrier, depth follows the surface normal. |
| `pressure`, `taper` | Pressure is one value per control point, and taper is a pair of start and end values. Both multiply the brush size, range from 0 to 1, and default to full size. |
| `rings`, `frame`, `depth` | A fill takes an outside ring and optional holes. Free-space rings are 2D world-unit coordinates in a frame with `origin`, `u`, and `v`. The frame defaults to world XY. Depth defaults to 0.08 and is centered on the frame. |
| `surface`, `offset` | A carrier uses the procedural plane or circular cylinder fields plus `kind`. Points and rings use chart UVs. A stroke straddles the offset and a fill extrudes outward from it. Use continuous U coordinates outside the unit interval to specify a winding across a closed cylinder's seam. |

Use `KIT.diorama.scene(spec).authoring(seed)` to open a drawing document. Top-level marks with an `id` become entities with editable `parameters`. The document supports creating, updating, deleting, undoing, and redoing marks. Call `realize(document.snapshot())` to rebuild the scene, or save the snapshot for a later build. The CLI can inspect and edit those parameters through `authoring inspect`, `authoring preview`, and `authoring apply`. Pass `--authoring` to render or export a saved drawing revision.

`createDrawingInput(element, { brush, project, preview, commit })` from `webgl.mjs` collects pointer samples and stylus pressure. The host supplies brush settings and maps each pointer event to the active drawing plane or surface chart. The optional preview callback receives the draft and clears when the gesture ends. The commit callback receives a stroke or a single closed fill ring ready for the drawing document. Set the drawing element's CSS `touch-action` to `none` when using touch and call `dispose()` when unmounting.

## Retained authoring

`KIT.authoring.document` stores scene intent as JSON with stable IDs, deterministic seeds, transactions, undo and redo, and an optional autosave adapter. Generated parts can keep hand edits across regeneration. They can also be suppressed or promoted to independent entities.

`KIT.authoring.context` adds spatial queries, raycasts, named surface anchors, transform resolution, and rules that respond to changes in related entities. `KIT.authoring.groups` supports batch transforms, copying, deletion and named selections. `KIT.procedural.chunks` rebuilds affected preview or final chunks and cancels superseded work. See the [retained authoring API](docs/procedural.md#optional-retained-authoring), [incremental realization](docs/procedural.md#incremental-realization) and [runnable example](examples/procedural/authoring-example.js).

Use `ink-studio authoring inspect` to list stable part IDs, bounds and anchors in a retained scene.
Preview a JSON edit with an optional PNG, then apply it to a new snapshot after the scene's checks pass.
The [editable passage walkthrough](docs/headless-authoring.md#edit-generated-parts-from-the-cli) moves a
doorway and landing while checking that a character can still walk through.

The [headless authoring guide](docs/headless-authoring.md) covers typed graphs,
cached simulation, attribute transfer, mesh paths, layered artwork, animation
state graphs and the retained Flooded Shrine recipe. The [procedural API guide](docs/procedural.md)
also covers chart batching, blind recesses, incremental visibility, and retained
sample withdrawal.

[Headless worlds](docs/headless-worlds.md) adds declarative simulation scenes,
shared world queries, timed actions, checkpoints, replay and branch comparison.
[System contracts](docs/headless-worlds.md#compose-system-contracts) expose
typed connections, state reads, event kinds, and execution dependencies.
[Spatial field coupling](docs/headless-worlds.md#spatial-field-coupling) shares
neighborhood values and gradients with solvers and entity queries.
[Interactive checkpoint branching](docs/simulation-checkpoints.md#interactive-checkpoint-branching)
retains named outcomes, queued edits, and shared starting points in one session.
[Causal inspection](docs/headless-worlds.md#inspect-a-selected-object-or-region)
links selected objects and regions to recorded actions, transfers, and prior states.
[Scheduled observations](docs/headless-worlds.md#scheduled-observations-and-parameter-sweeps)
reuse measurements across seeds and settings and report aligned results.
[Persistent simulation places](docs/portals.md#persistent-simulation-places)
keep terrain, surface, and object edits across saves, travel, and resumed region streams.

[Scene-aware streaming](docs/procedural.md#scene-aware-streaming) prioritizes nearby detail, selected subjects, and visible portal destinations within memory and frame budgets.

[Render pass quality](docs/scene-optics.md#render-pass-quality) scales background splats, particles, and secondary reflections while protecting focal subjects and data marks.

[The shared rendering contract](docs/browser-renderer.md#shared-rendering-contract) aligns cameras, clocks, palette inputs, and portable material stages across WebGL and the headless renderer.
[Editable water boundaries](docs/headless-worlds.md#editable-water-boundaries)
define regional sources, sinks, barriers, open edges, and exchange with spatial head fields.
[Simulation workers](docs/simulation-workers.md) run custom and built-in
solvers at independent rates on Node or browser worker threads.
[Reproducible run records](docs/simulation-checkpoints.md#reproducible-run-records)
verify scene revisions, command order, solver timing, and observations on replay.
[Modular scene and entity lifecycle](docs/portals.md#modular-scene-and-entity-lifecycle)
preserves a group's identity, attachments, and state through unloading, travel, and restoration.
[Reusable interaction components](docs/interaction-components.md)
combine triggers, handles, pickups, sockets, checkpoint markers, and timed switches in one saved state.
[Gameplay state and events](docs/gameplay-state.md) connects checkpointed
timers, objectives, and state transitions to headless scene behavior.
[Configurable movement controllers](docs/headless-worlds.md#configurable-movement-controllers)
switch one character between walking, climbing, swimming, flying, and vehicle steering.
The watershed and quarry examples run entirely from the CLI. The [puzzle recipes guide](docs/puzzles.md) shows how to wire ordered
switches to a physical gate, inspect blockers and verify a solution. The [agent decision guide](docs/agent-decisions.md)
covers reachable activity choices and confirmed arrivals.

## Rendering and command reference

The CLI and Node `render()` use the CPU renderer. Use the [browser renderer](docs/browser-renderer.md) for an interactive WebGL canvas. The two backends share scene data and several pixel-art controls. Use the same backend when recording and checking exact image baselines.

| Command | Purpose |
| --- | --- |
| `help` | Print supported commands and options. |
| `scenes` | List scenes from the default demos or configured collection. |
| `catalog [words] [--full]` | Search feature names, descriptions and tags. |
| `acts` | List action clips, reactions, easing names and cues. |
| `authoring inspect\|preview\|apply <scene>` | Inspect generated parts, preview JSON edits and save validated snapshots. |
| `render <scene> --t 1.5` | Render one PNG at a chosen time. |
| `data-inputs <scene-or-catalog> [dataset] [--sample JSON] [--rows]` | Inspect typed columns, sample values, or export normalized rows and spatial features. |
| `camera-rig <scene> [--at seconds] [--camera-shot id]` | Inspect the resolved shot, projection, blend, and occlusion clearance. |
| `camera-review <scene> --from 0 --to 2 --frames 5 --w 160 --h 96` | Check subject framing across a shot at the native export crop. |
| `passes <scene>` | Save art-pixel coverage, depth, normals, IDs and emission previews. |
| `export-layers <scene>` | Export transparent color, depth, normals, object IDs, and material mattes on one grid. |
| `export-scene <scene> --out directory` | Publish a high-resolution still, loop and PNG sequence, replay recording, and web embed. |
| `scene-replay <recording> --out frame.png` | Sample a recording or regenerate its web embed with `--embed`. |
| `project pack <scene.json> --out project.json` | Package an editable diorama and its dependencies for the editor, browser, and CLI. |
| `project inspect <project.json>` | Show project revisions, toolkit version, and retained files. |
| `atlas <scene> --directions 8` | Export an RGBA atlas with registered pivots and optional relighting maps. |
| `pose-review <scene> --directions 8` | Render named poses and breakdowns as color and silhouette tiles at sprite resolution. |
| `motion-review <scene> [--finding kind-or-id]` | Report motion findings, focus ranges, and evidence from a scene that exposes Motion Review. |
| `clip-sequence <scene> [--handoff 0]` | Report clip instances, retimed keys and cues, and measured handoffs. |
| `authored-contacts <scene> [--at seconds]` | Report authored contact ranges, transfer timing, and optional pose evidence. |
| `motion-fx <scene> [--at seconds]` | Report Motion FX timing, part masks, and sampled splat or deformation counts. |
| `cloth-review <scene> [--pose seconds] [--bake take.json]` | Run a captured cloth pose and optionally bake the settled simulation. |
| `animation-timeline <scene> [--stage stage] [--finding id] [--preview dir]` | Inspect and preview a shared shot timeline with saved transport context. |
| `retarget <source> <target> [--profile name] [--bake clip.json] [--preview dir]` | Transfer a clip using semantic puppet roles and inspect both directional sprite previews. |
| `variants <scene> --seeds 3,7,12` | Render a ranked seed contact sheet for a scene with variant metrics. |
| `sheet <scene> --from 0 --to 3 --n 12` | Make a labeled sheet of animation frames. |
| `turn <scene> --n 8` | Make a sheet from multiple viewing angles. |
| `clip <scene> --from 0 --to 3 --fps 12` | Save an animated PNG. Use `--text ascii\|symbols\|braille\|blocks` for animated text rendering. |
| `ghost <scene> --t 1 --spacing 0.12 --n 2` | Overlay neighboring animation poses. |
| `mesh <file.obj\|.gltf\|.glb>` | Import, inspect and render a mesh from multiple angles. |
| `depth <map.png or map.json> [--image color.png]` | Build a splat preview, signed field and OBJ from a depth map. |
| `validate <file.json>` | Report scene-data errors and suggestions. |
| `ramps <scene>` | Inspect the scene's color ramps. |
| `values <scene>` | Check readability in dark, middle and light tones. |
| `crisp <scene>` | Measure isolated pixels, fine detail, edges and palette use. |
| `lint <scene>` | Flag pixel-art artifacts such as jaggies, banding and pillow shading. |
| `review <scene>` | Save a contact sheet of fixed camera views and report lint for each. |
| `shimmer <scene> --mode orbit` | Measure pixels that change and quickly change back across frames, and save a GIF. |
| `compare <scene> <ref.png>` | Render the scene alongside a reference and measure both at the reference's pixel size. |
| `export-glb <scene or mesh>` | Export indexed mesh geometry, UVs, materials, and available skins and clips. |
| `interchange <asset>` | Repackage glTF, GLB, or PNG-backed raster assets with their editable asset data. |
| `paint export <scene> [--layer name]` | Export `paint.png` and the surface coordinates of the rendered view. |
| `paint absorb <scene> [--layer name]` | Convert edited pixels into permanent paint or a named view correction. |
| `paint layers|tune <scene>` | List corrections or adjust a named layer with `--layer name`. |
| `paint clear <scene> [--layer name]` | Clear one correction or all saved paint. |
| `stats <scene>` | Report splat counts, extents, palette use, build and animation costs. |
| `perf <scene> --secs 5 --fps 60` | Measure animation work and changed-data upload estimates. |
| `motion <scene> --from 0 --to 3` | Inspect speed, jumps, low points, still regions and loop error. |
| `snap <scene\|all> --t 0,2` | Save exact rendered baselines. |
| `check [scene ...]` | Re-render and compare to saved baselines. |
| `selftest` | Run numerical toolkit and demo checks. |

`<scene>` can be a built-in scene ID, a JavaScript scene file, a JSON scene file or a supported mesh file. The built-in IDs are `watcher`, `burn`, `idol`, `bench`, `stuff`, `cabinet` and `rehearsal`.

Common rendering controls:

| Option | Effect |
| --- | --- |
| `--t`, `--from`, `--to`, `--n`, `--fps` | Time, frame count and sampling rate, depending on command. |
| `--yaw`, `--pitch`, `--zoom`, `--target x,y,z` | Camera controls; angles are radians. |
| `--ortho` | Use a parallel projection. |
| `--edges off` | Hide the edge sprites attached to materials in a per-pixel scene. |
| `--surface off` | Render without the view-dependent finish layers. |
| `--transmission off` | Toggle thin-material transmission in surface finishes. |
| `--surface-detail-kits off` | Hide authored [surface detail kits](docs/surface-materials.md#surface-detail-kits). |
| `--reflection-probes off` | Toggle local reflection probes. |
| `--reflections off` / `--atmosphere off` | Toggle scene reflection captures or atmosphere volumes. |
| `--w`, `--h`, `--out` | Output viewport size and destination. The renderer resolves a lower-resolution pixel grid derived from the scene's detail settings. |
| `--px 2` | Use two screen pixels per art pixel. In `compare` and `review`, `--px` specifies the scale of the reference. |
| `--tone stipple\|off` | Enable the stipple preset or turn off the scene's tone settings. |
| `--ink on\|off\|file.json`, `--effects off` | Choose a [selective ink profile](docs/art-passes.md#selective-ink-and-stable-pixels) or disable art-pixel effects. |
| `--emissive-finishes off` | Disable authored emissive cores, shaped spill, and size-aware glow. |
| `--snap`, `--dither-space screen\|world\|object`, `--resolve native\|coverage\|clusters` | Configure camera snapping, dither coordinates, and pixel resolve. Use `--stable off` to disable the scene's stability profile. |
| `--splat-order center\|surface` | Choose global center ordering or local ordering using the sampled surface plane. |
| `--stable-transparency on\|off` | Stabilize close translucent layers through camera motion. |
| `--afterimages file.json\|off` | Set scene-space object and surface trails. See [motion-aware afterimages](docs/motion-afterimages.md). |
| `--reconstruction file.json\|off` | Animate fragmentation and reassembly of selected splats. See [world-space reveal and reconstruction](docs/world-reconstruction.md). |
| `--inspection file.json\|off` | Set reusable target brackets, labels, glyph ripples, visibility checks and magnifiers. See [target inspection](docs/target-inspection.md). |
| `--inspection-focus id` | Prioritize an inspection target without changing the camera. |
| `--composite file.json\|off` | Set independent world and screen-layer resolutions. See [mixed-resolution compositing](docs/mixed-resolution.md). |
| `--render-graph file.json\|off` | Order and scope screen-space passes. See [the render graph](docs/render-graph.md). |
| `--feedback-fps n` and `--feedback-cuts t1,t2` | Set a fixed feedback replay rate and explicit scene-time resets for clips and sheets. |
| `--volume-scale`, `--volume-steps`, `--volume-jitter` | Override the atmosphere volume's sampling settings. |
| `--seed` | Override the scene seed. |
| `--colored` | Use palette-aware smoothing of silhouettes and body-colored contours. |
| `--raw` | Bypass palette styling. |
| `--px1` | Write native art pixels with a scale of one in commands such as `render` and `passes`. |
| `--text ascii\|symbols\|braille\|blocks`, `--tg`, `--tcolour scene\|ink\|mono` | Draw a text pass in `render`, `sheet`, or `clip`. The still renderer can also save the characters as text. |
| `--fine` | Bake surface detail tiles for per-pixel color lookup. |
| `--bounce` | Bake indirect lighting. |
| `--focus x,y,z,near,far,coarse` | Concentrate surface detail around a point. |
| `--follow` | Align splat shapes along the surface form. |
| `--clean` | Remove isolated pixels in the final pass. |
| `--style slate\|moss\|ember` | Change a JSON scene's style. |
| `--poke '1:x,y,z;2:x,y,z'` | Script timed taps into a simulated scene. |

The default look uses palette quantization and dithering. `--colored` preserves native interior detail while smoothing silhouettes; it does not fit a new palette every frame. `PixelLook` exposes shared CPU and shader helpers for hosts implementing the same look.

Use `finish.look.tone` for a luminance-based palette with a black cutoff, ordered or seeded blue-noise dither, and explicit color stops. The [pixel look guide](docs/pixel-look.md) covers the stipple preset, art-pixel size and browser integration. The [stipple example](examples/stipple.json) pairs it with a keyframed surface light.

For per-pixel materials, set `S.pixel = true` before baking and finish the world with `look: { pixel: true }`. `K.pixel` provides surface patterns such as turf, masonry and shingles. Use `K.pixel.edge(material, { up: 'grass', every: 5, share: 0.55 })` to attach sprites that follow the surface as the camera moves. `K.sprite.art` accepts text art for custom sprites, and `K.props` can scatter small objects along paths and at wall bases.

`paint export` and `paint absorb` work with per-pixel scenes. By default, files live in `studio/paint/<scene-id>/`, where `<scene-id>` is the ID returned by the scene. Edit `paint.png` in the scene palette and use magenta (`#ff00ff`) to erase earlier paint. If you choose a custom folder with `--dir`, pass the same folder to `paint` and `render`.

Add `--layer name` to export and absorb an angle-specific correction. Each named layer has its own capture files in `layers/<name>/`, and its surface samples are saved alongside permanent decals in `decals.json`. Named exports use the unpainted view as the editing baseline. Re-exporting a layer from a new view or pose replaces its previous samples the next time you absorb it. Magenta erases samples within the layer being edited.

| Control | Behavior |
| --- | --- |
| `--angle` and `--feather` | Set the maximum deviation from the captured view and the width of the fade, in degrees. The defaults are 65° and 35°. |
| `--opacity` | Set layer opacity from zero to one. |
| `--region` | Limit the layer to world-space `min` and `max` coordinates with optional inward `feather` in world units. Accepts JSON, a JSON file, or `off`. |
| `--paint-mask` | During absorb, multiply each sample by the brightness and alpha of a PNG with the same size as the capture. |

Use the first three controls with `paint absorb` or `paint tune`. The CPU and WebGL renderers blend overlapping samples by their visibility from the current camera before resolving the scene palette. Corrections are pinned to the captured world-space surface positions. Use `--paint-corrections off` when rendering an uncorrected comparison.

For programmatic scenes, pass the saved paint document as `paint` in `B.finish()`, or embed it under `finish.paint` in a JSON diorama. Each layer retains `view.direction` toward the capture camera. Perspective captures also retain `view.eye`. A decal row contains its XYZ position, XYZ normal, palette index, and optional opacity. Pass `paintCorrections: false` to either renderer to hide the view corrections.

The [art-pixel rendering guide](docs/art-passes.md) describes the selectable
render passes, selective ink, camera snapping, stable dithering, art-pixel
effects, local fragment ordering and directional export.

## View-dependent surface materials

`KIT.surface` adds finishes to ordinary sculpt materials. The builder records which finish and surface normal a splat uses. The renderer evaluates the layers with the current camera and light direction, so orbiting needs no rebake. You can use the 40 named presets as supplied, override an individual layer, or compose your own finish. See the [surface material guide](docs/surface-materials.md) for the full preset list, options, JSON examples, and rendering commands.

## Projected and procedural effects

Use projected material layers to paint animated RGB or RGBA rasters and
procedural patterns onto splat surfaces. Shared fields let a moving object
reveal a surface, leave a wake, warp the surface pattern, or drive particle
emission. The CPU renderer also renders these effects through the ASCII and Braille passes.
See [projected splat effects](docs/projected-effects.md) for recipes and APIs.

## Reflections, ripples and atmosphere

Use `K.reflection` for planar captures of scene geometry, `K.ripple.field` for timed ring sources, and
`K.atmosphere` for height fog, local mist and light shafts. The [scene optics guide](docs/scene-optics.md)
shows the core APIs and a runnable pool scene. The [depth import guide](docs/depth-maps.md) covers
`K.sdf.toMesh`, `K.sdf.solid` and `K.sdf.toSplats`.

## Embedding and custom scene collections

Use [scene publishing](docs/scene-publishing.md) to export a self-contained web player for rendered scene frames.

Use a [portable project bundle](docs/project-bundles.md) to carry an editable diorama and its local dependencies into Node, WebGL, or the CLI.

The browser-facing toolkit sources are plain scripts concatenated in dependency order. Generate a bundle from Node:

```js
const fs = require('node:fs');
const studio = require('@shapeshift-labs/ink-studio');
fs.writeFileSync('ink-studio.browser.js', studio.bundle());
```

The bundle defines `makeBuilder`, `makeSculpt`, `KIT`, `PixelLook` and the other names in `studio.EXPORTS` in script scope. Pass that toolkit to the [browser renderer](#browser-renderer) or to your own rendering code. The host controls input and advances animation.

To append the demos to a browser script, write `const SCENES = [];` after the toolkit bundle and append `studio.demos()`. Keep source files in the order returned by `files()` when embedding individually.

For a consuming project's own scene collection, save `ink-studio.config.js` in that project's working directory:

```js
module.exports = {
  load() {
    const kit = require('@shapeshift-labs/ink-studio').load();
    return { ...kit, SCENES: [require('./model.js')(kit)] };
  },
  out: 'studio/out',
  snaps: 'studio/snaps'
};
```

Then `ink-studio scenes`, `render`, `snap` and other commands operate on that collection. The load callback returns the toolkit exports alongside `SCENES`.
Use [`ink-studio reel`](docs/reel.md) to share selected stills and motion captures from that collection in one offline HTML file.

## Browser renderer

In a browser bundler that resolves the package's `browser` entry, import `createRenderer` from `@shapeshift-labs/ink-studio`. This selects the WebGL 2 canvas renderer. For native browser modules, serve `webgl.mjs` and its relative `src/webgl/` files. Both forms create GPU resources when you call `createRenderer`.

The following module can run after `ink-studio.browser.js` loads as a classic script. Adjust the WebGL module URL to the package location your server exposes.

```html
<canvas id="view" width="320" height="200" style="image-rendering: pixelated"></canvas>
<script src="./ink-studio.browser.js"></script>
<script type="module">
  import { createRenderer } from './ink-studio/webgl.mjs';

  const builder = makeBuilder(7);
  const sculpt = KIT.sculpt(makeSculpt(builder));
  sculpt.ball([0, 1, 0], 1, { r: [1, 2, 3, 4] }, { res: 0.15 });
  sculpt.bake();
  const world = builder.finish({ cam: { target: [0, 1, 0], dist: 7, yaw: 0.4, pitch: 0.2 } });
  const renderer = createRenderer(document.querySelector('#view'), { toolkit: { KIT, PixelLook } });
  renderer.render(world);
</script>
```

See the [browser renderer guide](docs/browser-renderer.md) for supported effects,
frame options, texture updates, and the lower-level integration API.

## Screen transitions

The browser package includes 49 preset transitions, from blackouts and eyelid
reveals to encounter wipes and memory dissolves. Use the compositor with Ink
Studio render targets or your own images and textures. Presets expose timing,
shader parameters, and cue markers. Compose custom sequences and register GLSL
stages through the same API.

The [screen transition guide](docs/transitions.md) covers each preset, playing
sound cues, passing masks, and writing shaders. The [transition gallery](examples/transitions/index.html)
runs from a local server.

## Module reference

| File in `src/` | Main responsibilities |
| --- | --- |
| `builder.js` | Seeded generation, palettes, low-level splat emission and world buffers. |
| `sculpt.js` | Base distance-field solids, materials, surface attributes, sampling and baking. |
| `art-passes.js`, `art-ink.js`, `art-effects.js`, `art-stability.js` | Diagnostic channels, selective ink, temporal effects and stable art-pixel sampling. |
| `airflow.js`, `light-schedule.js`, `splat-effects.js` | Wind, scheduled light, projected layers and emitter inputs. |
| `pixel-look.js` | Palette-aware pixel resolve and shader helpers. |
| `surface-look.js` | Reusable view-dependent finish evaluation and splat metadata format. |
| `scene-optics.js` | Reflected camera transforms, normal slopes and ray integration through atmosphere. |
| `reflection-plane.js`, `ripple-field.js`, `volume-field.js`, `volume-light.js` | Scene optics data, sampling and lighting primitives. |
| `route-visibility.js`, `sample-coverage.js`, `sample-visibility.js`, `splat-order.js`, `swept-disc.js` | Route and splat culling, stable coverage, depth ordering, and swept-disc queries. |
| `webgl/` | Browser draw pipeline, camera and depth order, shaders, upload and framebuffer management. |
| `kit/k0-math.js` | Vectors, matrices, easing, keyed values and springs. |
| `kit/k1-stage.js` | Stage, painter stack, rigs, pools, selection, sockets and bones. |
| `kit/k2-motion.js` | Spines, IK, clips, state machines, ropes and gait. |
| `kit/k3-shapes.js` | Joins, folds, warps, outlines, extrusion and revolution. |
| `kit/k4-art.js` | SVG/pixel artwork on solid faces. |
| `kit/k5-fields.js` | Spatial fields, tint, displacement, reveal and grading. |
| `kit/k6-voxels.js` | Persistent channels, fire, frost, growth and support detection. |
| `kit/k7-particles.js` | Particles, emitters and flow fields. |
| `kit/k8-light.js` | Captured lighting, moving lamps, shadows and relighting. |
| `kit/k9-matter.js` | Support, rubble, debris, breaking, jelly and sand. |
| `kit/ka-build.js` | Fitted procedural construction and sockets. |
| `kit/kb-mesh.js` | Mesh readers, fitting, palette conversion and mesh solids. |
| `kit/kc-data.js` | JSON scene schema, validation, styles and building. |
| `kit/kd-mpm.js` | Material-point simulation and interior filling. |
| `kit/ke-volume.js` | Translucency, glass, fur, smoke, mist and light shafts. |
| `kit/kf-creature.js` | Creature rigging. |
| `kit/kg-play.js` | Gameplay particles, debris and ground ecology. |
| `kit/kh-animate.js` | Pose clips, layers, machines, controls, faces and presentation. |
| `kit/ki-deform.js` | Point maps, skinning, puppets and constraints. |
| `kit/kj-acts.js` | Action clips, reactions, impact timing and secondary motion. |
| `kit/kk-character.js` | Controllable characters, combat and animation overlays. |
| `kit/kl-vox.js` | Letter-grid model authoring. |
| `kit/km-ramp.js` | Palette ramp construction and hue shifts. |
| `kit/kn-effects.js` | Window light, reflections, shatter and dissolve. |
| `kit/kn-frame-splats.js` | Frame-local strokes, model instances and vortices. |
| `kit/ko-grow.js` | Scattering, species, branching, instancing and iterative growth. |
| `kit/kp-curve.js` | Curve construction, sampling and sweeping. |
| `kit/kpx-pixel.js` | Per-pixel material patterns and pixel-sized geometry. |
| `kit/kpy-props.js` | Seeded prop placement and reusable prop libraries. |
| `kit/kpz-sprite.js` | Text and procedural sprite art with surface anchors. |
| `kit/kq-surface-presets.js` | Named settings for brushed finishes, fabrics, coatings, and glints. |
| `kit/kq-sandbox.js` | Material grid simulation and worker integration. |
| `kit/kr-tex.js` | Procedural texture fields and remapping. |
| `kit/ks-xpbd.js` | Constraint solver, cloth, hair and wind. |
| `kit/kt-nodes.js` | Text, engraving, displacement and distance-grid processing. |
| `kit/ku-motion.js` | Simulated ropes, chains, carried objects, blades, flocks and morphing. |
| `kit/kv-form.js` | Crystals, geodes, columns and cave formations. |
| `kit/kw-erode.js` | Fracture, erosion, strata, mud and loose stone. |
| `kit/kx-life.js` | Plants, shells, horns, antlers, ribs, feathers, scales and tentacles. |
| `kit/ky-built.js` | Masonry walls, worn steps and fences. |
| `kit/kz-weather.js` | Falling weather, snowdrifts and frost. |
| `kit/p*.js` | [Procedural fields, geometry, layouts, materials, motion and retained authoring](docs/procedural.md). |

Other directories:

- `cli/`: command dispatch, software rendering, PNG/APNG encoding and self-tests.
- `demos/`: the seven bundled interactive dioramas.
- `examples/`: small runnable scenes corresponding to this guide.
- `lab/`: larger shape experiments, mesh examples and the data-driven shrine.
- `tests/`: unit tests for rendering, procedural tools, authoring and simulation.
- `scripts/`: source checks and formatting support.
- `catalog.json`: searchable descriptions of features available in this package.
- `storage-retention.json`: exact retained inputs and disposable generated outputs.

## Validation and development

```sh
npm test
npm run lint
node cli/ink-studio.js validate examples/scene.json
node cli/ink-studio.js render examples/sculpt.js --colored
node cli/ink-studio.js snap watcher --t 0,2
node cli/ink-studio.js check watcher
```

`npm test` runs the unit tests and the CLI self-checks for the toolkit and simulated demos. `npm run lint` checks for source-like statements after `//` that would be silently commented out. Put usage examples in block comments.

Visual baselines are created explicitly by `snap`; no baseline images are bundled. `check` compares rendered pixels against those baselines. Keep baselines when they provide useful regression evidence; generated previews and the compiled `dist/` bundle can be regenerated.

The package is currently version `0.1.0` and marked private.

## License

Licensed under the [MIT License](LICENSE).

Surface fragments can detach, follow shared wind, gather into live forms, and rejoin animated parts. See [surface materialisation](docs/materialisation.md) and the [interactive matter relay](examples/materialisation.html).

Named targets can drive shared brackets, labels, glyph ripples, depth visibility and optional magnified views. See [target inspection effects](docs/target-inspection.md) and the [interactive relay observatory](examples/target-inspection.html).

`KIT.palette` adds dependency-free two-color recipes, independent OKLCh channel curves, named material roles, reference-ramp transfer, and seekable palette paths. See [palette recipes](docs/palette-recipes.md) and the [interactive Chromatic garden](examples/palette-recipes.html). Export colors with `ink-studio palette examples/palette-recipe.json`.

`KIT.paint` adds dependency-free spectral paint mixing, reusable swatch recipes, tint/shade controls, gradients and baked RGB ramps or mixture lookup tables. See [paint mixing](docs/paint-mixing.md) and the [interactive Pigment atelier](examples/paint-mixing.html).

`KIT.curve` includes clothoid chains, torus knots, Lissajous curves, logarithmic, Archimedean and Fermat spirals, cycloids, spirographs, superellipses and flowers. They share arc-length paths for sweeps, route followers, particles, camera rails and curved text. See [curve families](docs/curve-families.md) and the [interactive Curve conservatory](examples/curve-families.html).

`KIT.curve` also supports cached closest-point queries, curvature estimates, adaptive sampling and periodic interpolation. `KIT.Q` supplies dependency-free quaternion SLERP/SQUAD, path-frame rotations and quaternion animation channels. See [curve analysis](docs/curve-analysis.md) and [Path observatory](examples/curve-analysis.html).

`KIT.sceneGraph` adds a dependency-free live affine hierarchy across rigged splats, sprite surfaces, point lamps, sockets and inspection/camera targets, with inherited visibility and world-preserving reparenting. See [live scene hierarchy](docs/live-scene-hierarchy.md) and the interactive [Lantern exchange](examples/live-scene-hierarchy.html). Inspect serialized graphs with `ink-studio hierarchy graph.json`.

`KIT.timeDomains` separates fixed simulation, sampled animation, continuous camera and interface time, with named child clocks, inherited rates, independent pause, wall-timed freeze/slow cues and checkpoints. See [shared time domains](docs/shared-time-domains.md) and the interactive [Clockwork pavilion](examples/shared-time-domains.html).

Camera rigs support dependency-free dolly zoom, tracked orbit, keyed crane moves, subject-height framing, composition, focus-driven lens breathing and smooth handoff to free controls. Shared `CameraLens` math unifies browser/headless FOV and millimeter lenses. See [cinematic camera rigs](docs/camera-rigs.md#cinematic-moves-and-live-control) and [Lantern passage](examples/cinematic-camera.html).

`KIT.lightEmitters` extends shaped area lights with lines, RGB/procedural cookies, animated sources and browser illumination of splats, textured surfaces and lit haze. The headless renderer reuses its existing area/spot systems; browser receiver and fog caches are reusable across camera movement. See [additional light emitters](docs/light-emitters.md) and [The prism court](examples/light-emitters.html).

`Typography` / `KIT.typography` adds dependency-free TrueType and portable outlines, kerning, transported curve text, per-glyph animation, contour write-on, seeded scrambling, native SDF extrusion, live bitmap sprites and existing surface materialisation. See [typography](docs/typography.md) and [The shape of words](examples/typography.html). Inspect the same frame data with `ink-studio typography type.json --at .6`.

`CameraImpulses` / `KIT.cameraImpulses` adds dependency-free directional translation/rotation, source-distance attenuation, propagation delay and layered handheld motion, with shared browser/headless pose application and compatibility with existing animation shake. See [directional camera impulses](docs/camera-impulses.md) and [Midnight midway](examples/directional-camera-impulses.html). Inspect portable motion with `ink-studio camera-impulses motion.json --at 1`.

`KIT.material` supplies shared roughness, metalness, IOR, transmission and coating descriptors, live binding edits and an inspector, backed by the existing stylized finishes and optics. See [material controls](docs/material-controls.md) and the [material atelier](examples/material-controls.html).

`KIT.renderGraph` adds scoped bloom, halation, depth outlines, restrained chromatic separation, block displacement, bounded pixel sorting and budgeted temporal feedback. Effects preserve full-resolution source images and accept object/depth masks. See [render effects and budgets](docs/render-graph.md#bounded-film-and-signal-effects) and the interactive [Signal House](examples/render-effects.html).

`KIT.procedural.mathFields` supplies finite complex-plane, polar and logarithmic charts; analytic deformation/flow/mask adapters; and bounded fixed-step attractor integration. It shares existing field-expression, streamline and trace tooling. See [procedural math fields](docs/math-fields.md) and the [strange garden](examples/math-fields.html).

`KIT.random` / `KIT.procedural.random` adds independent named streams, stable object/property keys, controlled distributions, correlated channels, coherent variation and replay checkpoints. See [randomness authoring](docs/randomness.md) and the interactive [seeded courtyard](examples/randomness.html).
