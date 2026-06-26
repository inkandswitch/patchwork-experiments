# Spatial Patchwork Host

A **host system tool** for camera/projector spatial setups. It owns the
camera↔projector **alignment, calibration, testing, and live AprilTag detection**,
defines an aligned bounding box on the projector, and **embeds an arbitrary
Patchwork tool inside that box**. The embedded tool knows nothing about cameras,
projectors, or homographies — it receives a web-native coordinate system and a
live AprilTag feed through the **providers** pattern.

It is the reusable factoring of `apriltag-projector`: the host does all the
spatial work; an embedded tool just consumes the data.

## Architecture

Mirrors `patchwork-tools/space`: the host doc is a **folder** that holds the list
of openable docs plus a URL to a **dedicated calibration doc** (the way `space`
keeps a folder doc + a separate tldraw doc).

```
Spatial Host doc (datatype: spatial-patchwork-host)
  { title, docs: DocLink[], calibrationUrl, activeIndex, hostMode }
            │
            ├─ calibrationUrl ──► Calibration doc (datatype: spatial-host-calibration)
            │                       cameraViewBox, homographyCamToBoard, pairs, …
            │                       (same schema as apriltag-projector)
            └─ docs[activeIndex] ─► the doc embedded in the aligned box (use mode)
```

Two top-level phases (toggled by `doc.hostMode`):

- **Calibrate** — mounts the copied apriltag-projector tool against the
  calibration doc: align the outline, capture targets, Solve the homography, test.
- **Use** — hides the calibration UI and renders the aligned box (the
  `cameraViewBox` sub-rectangle). The box is filled by an embedded
  `<patchwork-view>` of the active folder doc (default tool resolved by the
  registry), wrapped by the two spatial provider components. A camera + AprilTag
  detector run here and stream tag positions to the embedded tool via the providers.

## The providers (the data interface)

The host mounts one `patchwork:component` provider per data source as
`<patchwork-view component="…">` wrappers around the embedded view: the
host-owned `spatial:coordinate-system`, plus one provider per **recognition
layer** (AprilTags today; see Layers below). They are **independent** (distinct
selectors), so their nesting order is irrelevant. A tool inside the box
subscribes with the inlined `subscribe` helper from
`@inkandswitch/patchwork-providers`:

```js
// box dimensions (live CSS pixels), re-emitted on resize / re-align
subscribe(element, { type: "spatial:coordinate-system" }, ({ width, height }) => …)

// live AprilTags, normalized 0..1 within the box
subscribe(element, { type: "spatial:apriltags" }, ({ tags }) => …)
// tag = { id, nx, ny, angle, corners: [{nx,ny}×4] }
```

**Coordinate contract:** tag positions are **normalized 0..1 over the box**
(`nx,ny`), which is the lossless homography output and resolution-independent — a
tool places a label with `left: nx*100%; top: ny*100%`. A tool that wants CSS
pixels also subscribes to `spatial:coordinate-system` and multiplies by
`width/height`. The two are orthogonal facts; the apriltags payload carries no
pixel fields.

**Key coordinate insight:** the calibration corners A=[0,0]…D=[0,1] are drawn at
the corners of the aligned outline, so **board space [0..1]² is exactly the box
interior, which is exactly the embedded view.** `cameraPointToBoard()` already
returns box-normalized coordinates — there is no extra transform.

### Live data handoff (per instance, no globals)

The host builds, per instance, one `Emitter` per provider (coordinate-system +
one per layer) and a `SpatialRegistry` (`Map<selector, Emitter>`). It stamps that
registry on each provider wrapper via the `SPATIAL_REGISTRY_KEY` JS property; each
relay provider looks up its Emitter by selector (lazily, at subscribe time) and
relays it to subscribers via `accept`. Per-host-instance → multiple hosts on one
page never collide.

## Recognition layers

Recognition is **pluggable**. The host owns the camera, calibration, and a single
shared **frame loop** (`frame-loop.ts`) that each tick grabs the camera frame,
downscales it to grayscale, builds a `mapPointToBox(px)→[0..1]` mapper from the
calibration homography, and fans a `Frame` to every layer's recognizer. A layer
(`src/layers/<name>/`) provides a `Recognizer` (`ensure`/`process(frame)`/`stop`)
and publishes its results into an Emitter the host relays on the layer's selector.

The only layer today is **AprilTags** (`src/layers/apriltags/`): a `tag36h11` WASM
detector in a Comlink Web Worker. Per frame it maps each tag's **center and four
corners** to normalized box coords, derives `angle`, culls out-of-board tags, and
publishes `{ tags }` on `spatial:apriltags`. (Autofocus/zoom are locked and 4K
capture kept while the loop downscales to `DETECT_MAX_DIM` — see `apriltag-core.js`.)

**Adding a layer** (line drawings, words, …): create `src/layers/<name>/` with a
recognizer + a `SpatialLayer` descriptor, and add it to `LAYERS` in
`src/layers/index.ts`. `index.ts`, `providers.ts`, and `UseStage.tsx` all derive
from `LAYERS`, so nothing else changes. Layers never touch the camera directly.

## Files

A **bundled SolidJS (TypeScript/JSX)** tool — the host renders the entire
align/calibrate/test/use UI itself. It reuses only the *pure logic* of the
`apriltag-projector` proof-of-concept (homography math + the detector worker),
not its DOM.

```
src/
  index.ts             plugins[]: host datatype + tool, calibration datatype,
                       coord-system provider + one provider per layer (from LAYERS)
  main.tsx             render contract: mounts <App> in RepoContext, returns disposer
  App.tsx              phase switch; ensures calibration doc; reactive host/cal docs
  ControlPanel.tsx     ONE unified draggable/collapsible bar (Setup/Use + mode controls)
  CreateNew.tsx        kobalte dropdown of listed datatypes → child doc
  camera.ts            shared reactive camera controller (one getUserMedia stream)
  frame-loop.ts        shared per-tick grab→downscale→grayscale + mapPointToBox;
                       fans the Frame to every layer's recognizer
  setup/
    SetupPhase.tsx     stage: align view-box, target dots, test markers + arrow-key nudge
    AlignBox.tsx       draggable/resizable alignment outline
    CameraPanel.tsx    large draggable click-to-capture camera + overlay crosshairs
    calibrate-logic.ts solveSetup / calibrationStatus / captureCount (wrap core math)
  use/
    UseStage.tsx       box sub-rect + N+1 provider wrappers + embedded view + frame loop
  layers/
    types.ts           Frame / Recognizer / SpatialLayer contract
    index.ts           LAYERS[] — the one place to register a layer
    apriltags/
      types.ts         SpatialTag(s) + "spatial:apriltags" selector
      recognizer.ts    tag36h11 Comlink WASM worker; maps center+corners; publishes
      index.ts         apriltagsLayer descriptor
  spatial-source.ts    Emitter + CoordinateSystem + SPATIAL_REGISTRY_KEY (generic)
  providers.ts         makeRelayProvider(selector) + coord provider + per-layer providers
  apriltag-core.js     copied apriltag-projector, used as a MATH/DETECTOR LIBRARY
  apriltag-core.d.ts   type declarations for the reused exports
vendor/                apriltag.js (worker), apriltag_wasm.js/.wasm, comlink.js/.mjs
```

`vite.config.js` uses `vite-plugin-solid`, externalizes the patchwork + automerge
packages (provided by the host importmap), bundles `@inkandswitch/patchwork-providers`
+ Solid + kobalte, and copies the worker's `importScripts` siblings
(`apriltag_wasm.js`, `apriltag_wasm.wasm`, `comlink.js`) next to the emitted worker
chunk in `dist/assets/`.

## Control panel

A single draggable, collapsible panel (position + collapsed state persisted in the
host doc, so it's the same on every screen). First control is the **Setup / Use**
switch; mode-specific controls follow in the same bar. **Fullscreen** is available in
both phases. In **Setup**: Align / Calibrate / Test sub-modes, Grid 4/9, Solve, Show
camera. In **Use**: active-doc picker, **Create new ▾**, Start/Stop camera.

## Build & sync

```bash
pnpm install
pnpm build          # vite → dist/index.js
pushwork sync
pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"   # or: pnpm register
```

## Demo

`patchwork-tools/spatial-tag-labeler` is a tiny bundleless tool that subscribes to
`spatial:apriltags` and drops a label on each tag — the worked example proving the
host replaces apriltag-projector's bespoke "use" mode. Add it to a Spatial Host's
docs, set it active, calibrate, then switch to Use.

## Not included

Lens distortion correction, multiple simultaneous embedded docs, other tag
families, persisted tag placements (labels follow live detections only).
