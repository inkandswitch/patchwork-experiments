# Physical Colors

A bundleless demo tool that runs **inside `physical-frame`**. It outlines each
detected AprilTag in a hardcoded color (tag `0` → red, `1` → green, `2` → blue)
and paints a light-mixing color field between them.

Each tag's quad is framed by a thick colored outline ring. The background is an
inverse-distance-weighted RGB blend in which each tag also acts as an opaque
_wall_ that casts a hard-edged shadow cone of its own color behind it.

## Providers it subscribes to

| Selector                     | Why                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `physical:apriltags`         | the tags to color (`{ id, nx, ny, angle, corners }`, all box-normalized 0..1) |
| `physical:coordinate-system` | the box's live size `{ width, height }` in CSS pixels                         |

### Why it subscribes to `physical:coordinate-system` (and most tools don't)

This is the key thing to know if you're reading or copying this tool.

The recognition layers publish everything in **box-normalized 0..1** (`nx`,
`ny`). Most consumer tools (`physical-marks-test`, `physical-sand`) never need
anything else: they either draw into an SVG with `viewBox="0 0 100 100"` +
`preserveAspectRatio="none"` and let the browser stretch normalized points to
fill the box, or they rasterize into a grid sized from their own
`getBoundingClientRect()`. For them, subscribing to the coordinate system would
add complexity and **zero** accuracy — the data is identical either way.

Physical Colors is different because it does **isotropic pixel-space geometry**
that must look uniform even when the aligned box is **non-square**:

- **Euclidean distances** for the inverse-distance light blend
  (`weight = 1 / dist^POWER`). Distances are only meaningful in real pixels; in a
  stretched normalized space a "circle" of equal influence becomes an ellipse.
- **`expandPolygon(corners, BORDER_PX / 2)`** — the tag's blocker quad is outset
  by a fixed _pixel_ amount. Under anisotropic (non-square) scaling, a normalized
  outset grows unevenly per axis; a pixel outset stays uniform.
- The **occlusion field** is rasterized on an offscreen canvas (~`FIELD_MAX` px
  on its long edge) whose dimensions come from the box size.

So it converts the normalized tag corners to box pixels (`x = nx * width`,
`y = ny * height`) using the subscribed `{ width, height }`, and recomputes when
the box resizes.

### Rule of thumb for new physical tools

Default to **normalized 0..1** and let SVG (`preserveAspectRatio="none"` +
`vector-effect="non-scaling-stroke"`) or self-measurement handle scaling — it's
simpler and scale-free. Subscribe to `physical:coordinate-system` **only** when
you need isotropic pixel-space geometry on a possibly non-square box (Euclidean
distances, fixed-pixel insets/outsets, true circles, a pixel raster field).

## Tunables (in `physical-colors.js`)

- `POWER` / `GAIN` — falloff and intensity of the inverse-distance blend.
- `FIELD_MAX` — longest-edge resolution of the offscreen color field.
- `BORDER_PX` — outline ring thickness (and the blocker outset, `BORDER_PX / 2`).
- `rgbForTag(id)` — the hardcoded tag → color map.

## Use

Register the tool's module URL in your module-settings doc, then in a
`physical-frame` doc: Use mode → **Create new ▾ → Physical Colors**. Place
AprilTags 0/1/2 on the surface.
