# AprilTag Projector

Camera-projector tool for Patchwork. It calibrates a camera and a projector that
both point at the same surface, then **detects AprilTags placed in the camera
area and projects an editable label next to each one**.

It is built on the `spatial-calibration` tool and keeps its full calibration
flow, adding a fourth **Use** mode for live tag detection.

## What it does

- **Align** — move/resize the projected working rectangle (`cameraViewBox`).
- **Calibrate** — capture correspondences between projected board points and
  camera pixels (4 corners or 9 points).
- **Test** — click in the camera feed and project a marker on the same physical
  spot, to confirm the mapping.
- **Use** — run a live AprilTag detector (`tag36h11`) on the camera feed, map
  each detected tag through the solved camera→board homography, and project an
  editable label next to it on the surface.

## Usage

1. Load the module into your Patchwork module settings (after `pushwork sync`,
   add the resulting module URL to your module-settings document).
2. Create a new **AprilTag Projector** document.
3. Open the same document in two views, e.g. one laptop/editor view and one
   projector view of the same document (same two-view setup as
   `spatial-calibration`).
4. **Align**, then **Calibrate** (capture every target, then **Solve**), then
   optionally **Test**.
5. Switch to **Use** and click **Show camera** on the view attached to the
   camera. The detector loads, then tags placed in the camera area get a
   projected label. Rename any tag in the label editor (e.g. `#7` → "Coffee");
   the name persists and syncs to all views.

Print `tag36h11` tags from the official generator:
<https://github.com/AprilRobotics/apriltag-imgs> (family `tag36h11`).

## Two-view / multiplayer model

Stored in the document and shared across views:

- `cameraViewBox`, `mode` (`align` / `calibrate` / `test` / `use`), `gridSize`
- captured calibration `pairs`, solved homographies, `cameraCalibrationSize`
- `activeTargetId`, `testMarkers`
- `tagLabels` — the per-tag editable label map (`{ "7": "Coffee" }`)
- `hideCursor`

Local to each viewer:

- camera stream selection / permission, camera panel + toolbar positions
- clean project view / fullscreen state
- **the AprilTag detector and detection loop** — only the view whose camera is
  on runs detection

**Live detections are not persisted.** The camera-side view detects each frame
and `handle.broadcast(...)`s the current tag list (id + board coordinates) over
the DocHandle's ephemeral channel. Every view (including the projector) renders
projected labels from that ephemeral state. Only the label *names* live in the
document. This keeps the automerge history clean — no per-frame writes — while
labels still track tags live across machines.

## Detection pipeline

```text
camera frame -> downscale + grayscale -> apriltag wasm (worker) -> tag center (px)
  -> homographyCamToBoard -> board (0..1) -> cameraViewBox -> projected label
```

The detector is the [arenaxr/apriltag-js-standalone](https://github.com/arenaxr/apriltag-js-standalone)
WASM port of the official AprilTag C library (`tag36h11` family). It runs in a
Web Worker (via Comlink) so per-frame computer vision never blocks the projector
UI. Pose estimation is disabled — only 2D tag centers are needed.

### Vendored dependencies

To avoid any runtime CDN dependency, the detector and Comlink are vendored under
`vendor/`:

- `apriltag.js` — the worker entry (upstream wrapper, patched to load its two
  dependencies from local siblings instead of `unpkg`)
- `apriltag_wasm.js` / `apriltag_wasm.wasm` — the emscripten build
- `comlink.js` (UMD, for the worker) / `comlink.mjs` (ESM, for the main thread)

The main module loads them with `new Worker(new URL("./vendor/apriltag.js",
import.meta.url))` and a dynamic `import()` of `comlink.mjs`, matching the
bundleless asset pattern (`import.meta.url`).

## Tuning

Constants at the top of `apriltag-projector.js`:

- `DETECT_INTERVAL_MS` (90) — how often a detection pass runs
- `DETECT_MAX_DIM` (640) — longest edge frames are downscaled to before detection
- `TAG_STALE_MS` (600) — drop a tag whose detections stop arriving
- `BOARD_MARGIN` (0.05) — how far outside the board a detected center may map

## Development

```bash
pushwork sync
pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"
```

or `pnpm push` / `pnpm register`. This is a bundleless tool — there is no build
step; the vendored files ship as-is.

## Current scope

Included: manual alignment, 4/9-point calibration, solved camera/board mapping,
test projection, live `tag36h11` detection, projected editable labels, two-view
broadcast.

Not included: lens distortion correction, other tag families, tag pose/size,
persisted tag placements (labels follow live detections only).
