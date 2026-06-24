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

The host registers two `patchwork:component` providers and mounts them as
`<patchwork-view component="…">` wrappers around the embedded view. They are
**independent** (distinct selectors, no inter-dependency), so their nesting order
is irrelevant. A tool inside the box subscribes with the inlined `subscribe`
helper from `@inkandswitch/patchwork-providers`:

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

The host owns one `SpatialSource` (two `Emitter`s). It stamps it on each provider
wrapper element via the `SPATIAL_SOURCE_KEY` JS property; each provider reads that
property off its own element (lazily, at subscribe time) and relays its emitter to
subscribers via `accept`. Because the source is per-host-instance, multiple hosts
on one page never collide.

## Detection

The camera + detector subsystem is ported from `apriltag-projector` (`tag36h11`
WASM detector in a Comlink Web Worker). Each pass maps the tag **center and all
four corners** through the camera→board homography into normalized box coords,
derives `angle` from corner0→corner1, and pushes the tag list into
`source.apriltags`. Autofocus/zoom are locked (`applyConstraints`) so the image
stays geometrically stable, and 4K capture is kept while the detector downscales
to `DETECT_MAX_DIM` (1280) — see `apriltag-core.js` constants.

## Files

```
src/
  index.ts/.js         plugins[]: host datatype + tool, calibration datatype, 2 providers
  folder-datatype.js   SpatialHostFolderDatatype + SpatialCalibrationDatatype
  host.js              HostTool orchestrator (phases, box, provider wrappers, detector)
  detection.js         camera + Comlink worker; maps center+corners; feeds SpatialSource
  spatial-source.js    Emitter + SpatialSource + SPATIAL_SOURCE_KEY + selector constants
  providers.js         the two relay provider components
  apriltag-core.js     verbatim copy of apriltag-projector (math, Tool, detection consts)
vendor/                apriltag.js (worker), apriltag_wasm.js/.wasm, comlink.js/.mjs
```

This is a **bundled (vite)** tool. `vite.config.js` externalizes the patchwork +
automerge packages (provided by the host importmap), bundles
`@inkandswitch/patchwork-providers`, and copies the worker's `importScripts`
siblings (`apriltag_wasm.js`, `apriltag_wasm.wasm`, `comlink.js`) next to the
emitted worker chunk in `dist/assets/`.

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
