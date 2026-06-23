# Spatial Calibration

Manual camera-projector calibration tool for Patchwork.

This tool lets you:

- align a projected working rectangle (`cameraViewBox`)
- capture correspondences between projected board points and camera pixels
- solve a homography from camera space to normalized board space
- click in the camera feed and project a marker onto the same physical spot

It is a standalone bundleless tool, modeled after `spatial-alignment`, with its
own datatype and its own persisted calibration state.

## Usage

1. Load the module into your Patchwork module settings.
   After syncing this folder with `pushwork`, add the resulting module URL to
   your module-settings document.

2. Create a new `Spatial Calibration` document.
   Once the module is loaded, the datatype and tool will appear in Patchwork.

3. Open the same document in two views if needed.
   A common setup is:
   - one editor/computer view
   - one projector view of the same document

4. Align the usable area.
   In `Align`, move and resize the outer white rectangle until it matches the
   usable board area.

5. Capture calibration points.
   In `Calibrate`, choose `4 corners` or `9 points`, then click each projected
   target in the live camera feed.

6. Solve the mapping.
   After all targets are captured, click `Solve` to compute the camera-to-board
   and board-to-camera homographies.

7. Test the result.
   In `Test`, click anywhere in the camera feed. The tool maps that camera point
   to board coordinates and projects a marker at the corresponding physical
   location.

## Shared vs local state

Stored in the document and shared across views:

- `cameraViewBox`
- `mode` (`align`, `calibrate`, `test`)
- `gridSize`
- captured calibration `pairs`
- solved homographies
- calibration camera size
- active target id
- test markers
- `hideCursor`

Local to each viewer:

- camera stream selection and permission state
- camera panel position
- toolbar position
- clean project view / fullscreen state

That means the projector and laptop stay on the same document mode, while each
viewer can still place its own floating UI where it is convenient.

## Data model

The datatype initializes the document roughly like this:

```js
{
  title: "Spatial Calibration",
  cameraViewBox: { x: 0, y: 0, w: 1, h: 1 },
  mode: "align",
  gridSize: 4,
  pairs: {},
  homographyCamToBoard: null,
  homographyBoardToCam: null,
  cameraCalibrationSize: null,
  activeTargetId: "A",
  testMarkers: [],
  hideCursor: false,
}
```

Calibration targets use normalized board coordinates:

- 4-point mode: the four corners of the board
- 9-point mode: corners, edge midpoints, and center

Captured camera points are stored in intrinsic video pixels, not CSS pixels, so
the calibration stays stable regardless of preview panel size.

## Math

The mapping pipeline is:

```text
camera pixel -> homographyCamToBoard -> board (0..1) -> cameraViewBox -> projector
```

The tool includes a small pure-JS homography solver and inverse:

- `solveHomography`
- `applyHomography`
- `invertHomography`
- `gaussianSolve`

The solver uses an 8-parameter least-squares formulation with `h33 = 1`.

## Development

Sync the module with:

```bash
pushwork sync
```

Register the synced module into a module-settings document with:

```bash
pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"
```

Or use the package scripts:

```bash
pnpm push
pnpm register
```

## Current scope

Included:

- manual alignment
- manual point capture
- 4-point and 9-point calibration
- solved camera/board mapping
- manual test projection

Not included:

- lens distortion correction
- automatic dot detection
- outlier rejection / RANSAC
- downstream consumption by other tools
