# Local patches to vendored ink-studio

Upstream: `shapeshift-labs-ink-studio` at `c883375` (see `ink-studio/UPSTREAM-COMMIT`).
Full diff: `ink-studio.patch` (src only, 4 files).

Both features are opt-in. With neither `frame.viewMatrix` nor `frame.transparent`
set, every path is unchanged: every `pixelShaderSources` option combination
and every `splatShaderSources` feature combination generate byte-identical GLSL, and `makeCamera` returns
deep-equal cameras for the orbit, pose and ortho cases.

## Frame fields

- `viewMatrix`: 16 numbers, column-major, a rigid world→view transform (-Z forward).
- `projectionMatrix`: 16 numbers, column-major, perspective (`P[11] = -1`, `P[15] = 0`).
- `depthRange`: `[r0, r1]`, axial view depths in world units. **Required** with `viewMatrix`.
- `transparent: true`: renders into `frame.target` with two RGBA8 attachments:
  - location 0: straight colour, alpha 0 or 1;
  - location 1: packed depth in rgb, alpha = valid.

Depth decode: `n = dot(round(rgb*255), vec3(1,256,65536)) / 16777215`, then `viewZ = -(r0 + n*(r1 - r0))`.

## Edits

### `src/webgl/view.mjs`

- **:25–49** `hostCamera()`. It builds the camera from `viewMatrix`/`projectionMatrix`/`depthRange` exactly as given:
  - eye from `cameraLens.fromView`, which also rejects a non-orthonormal view;
  - near/far from P; aspect = `P[5]/P[0]`; tangent = `1/P[5]`;
  - dist = `(r0+r1)/2`; radius = `(r1-r0)/2`, so the outline, AO and line thresholds stay calibrated.

  Why: the host owns the camera, and orbit, `clipNear`, `depthRange` and footprint were all tied to orbit `dist`.
- **:52** `makeCamera` returns `hostCamera()` first when `frame.viewMatrix` is set. Why: staging, impulses, `anim.zoom`, art-view snapping, `cameraSnapshot` and orbit fields can't move the host camera.

### `src/webgl/renderer.mjs`

- **:681** `const transparent = frame.transparent === true`. Why: one flag that the edits below key off.
- **:754** Owner = `graphOwnership` (target(3)) when transparent. Why: that is the 24-bit packed owner depth (`oa`) the second output samples.
- **:782** No layered glass when transparent. Why: the layered-glass splat variant doesn't emit `oa`, which would lose the owner depth.
- **:809** No scoped cleanup when transparent. Why: `CLEAN_FS` writes alpha 1 and has no depth output; `POST_FS` must be the final writer.
- **:825** `ownsPixels` is forced on when transparent. Why: the owner/index pass has to run.
- **:918** `fog = {}` when transparent. Why: no per-splat fog (`max` 0); the host does fog.
- **:1005** Background clear `[0,0,0,0]` when transparent. Why: geometry alpha becomes premultiplied coverage.
- **:977** `programFor({..., hostDepth: transparent})`. Why: selects the splat variant whose index pass covers every coloured pixel (see `shaders.mjs`).
- **:1032** `graphDepth` is on for surfaces in the owner pass when transparent. Why: sprite surfaces also write owner depth.
- **:1083–1091** The resolve goes through the variant cache with `transparent` (mode bit 2048). Why: it compiles the two-output `POST_FS`.
- **:1101, :1132** Owner depth is bound to **texture unit 17** as `u_ownerDepth`. Why: unit 17 is the environment's data unit, which is unused because the environment is off in this mode.
- **:1285–1289** `presentFrame` sends a transparent frame straight to `render`, with `water`/`reflections`/`environment`/`colored`/`damp`/`clean` false. Why: the frame does a single pass, so there is no sky, water, reflection captures, 2× contours, damping or cleanup. The inspection, render graph, mixed composite and portal/fade wrappers are skipped, because they would draw through one-attachment targets.
- **:1369–1376** `describeFrame` replaces its `camera` with the host camera when `viewMatrix` is set. Why: the shared contract describes the orbit camera.

### `src/webgl/pipeline.mjs`

- **:45, :55, :58** New `hostDepth` feature: it forces the variant path, takes key bit 65536 and is passed to `splatShaderSources`. Why: a separate compiled variant, so the default splat programs are untouched.

### `src/webgl/shaders.mjs` (`splatShaderSources`)

- **:32** New `hostDepth` option, default false.
- **:78, :291, :357** Under `hostDepth`, the varying `v_hostDepth = dn` is always the normalized axial depth. `v_depth` is -1 for flag-bit-1, soft and optical splats. Why: those splats need a depth too.
- **:448** Under `hostDepth`, the upstream index-pass block (`u_idx 1`) is compiled out.
- **:466–472** Under `hostDepth`, a new index-pass block runs after the colour pass's own alpha `a` is computed (materials, stable detail and optical opacity included). It keeps any splat with `a >= 0.25` and writes index, mask owner, and packed `v_hostDepth` (`sectionDepth` under cutaways) to `oa`. Blending is off and the draw order is back to front, so the frontmost such splat wins. Why: host depth must cover every pixel ink colours, including ground (flag bit 1), soft and translucent splats. Ownership for pixel looks changes in this mode, which is accepted.

### `src/webgl/shaders.mjs` (`pixelShaderSources`, `POST_FS`)

- **:697–700** New `transparent` option and `sceneRGB()` template helper. With the option off the helper emits the original `texelFetch(...).rgb`. Why: keeps the default GLSL byte-identical.
- **:734–750** The transparent variant declares `layout(location=0) out vec4 o`, `layout(location=1) out vec4 o_depth`, `u_ownerDepth`, `g_line`, `sceneRGB` (un-premultiply) and `hostDepth` (owner depth, else the nearest valid of the 3×3 neighbours). Why: the two-output contract.
- **:1154, :1172, :1194** Scene reads go through `sceneRGB`. Why: the scene is premultiplied over alpha 0; the colour is un-premultiplied before the palette snap and dither.
- **:1212** `g_line = true` where the depth outline is drawn. Why: outlines fall on the far-side (background) pixel, so they still count as ink's.
- **:1250, :1252–1256** `main` writes:
  - `o = (colour, mine ? 1 : 0)`, where `mine` = coverage ≥ .5 at `holeFill(p)`, or edge sprite, or outline;
  - `o_depth = mine ? hostDepth(p) : 0`;
  - letterbox bars write `o_depth = 0`.

  Why: the two-output contract.

## Re-applying after an upstream update

1. Replace `vendor/ink-studio` with the new upstream tree and update `UPSTREAM-COMMIT`.
2. Run `cd vendor && patch -p1 --dry-run < ink-studio.patch`, then apply it for real. If hunks fail, re-make each edit by hand using the list above. The anchors are textual (`const owner =`, `const background =`, `out vec4 o;` in `POST_FS`, the `u_bypass` line in `POST_FS`'s `main`).
3. Check that the default GLSL is unchanged. Generate `pixelShaderSources(PixelLook, opts).*` for all option combinations and `splatShaderSources(undefined, undefined, opts)` for all feature combinations, with and without a cutaway, from the pristine and patched trees, and compare them. They must be identical.
4. Regenerate the patch:
   ```sh
   git -C <upstream> archive <commit> | tar x -C /tmp/pristine
   diff -ru /tmp/pristine/src ink-studio/src > ink-studio.patch
   ```
   Then fix the header paths to `a/ink-studio/src` and `b/ink-studio/src`.
5. Run upstream's camera and render node tests against the patched `src`: `camera-impulses`, `camera-rigs`, `cinematic-camera`, `render-contract`, `time-domains`, `view-annotations`, `webgl-instances`, `webgl`.
