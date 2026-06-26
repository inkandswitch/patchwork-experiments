# Spatial Walls

A tiny **demo tool** for the [`spatial-patchwork-host`](../spatial-patchwork-host),
testing the **walls** recognition layer (drawings / physical objects).

It subscribes to the host's `spatial:walls` provider and echoes every recognized
shape as a **black polygon with a white border** on a black background — mirroring
the captured geometry back onto the surface. (Analogous to how `spatial-colors`
echoes AprilTags.)

## How it works

- Inlines the small dependency-free `subscribe` helper from
  `@inkandswitch/patchwork-providers` (stays a bundleless single-file tool).
- `subscribe(element, { type: "spatial:walls" }, ({ shapes }) => …)` — each shape
  is `{ id, points: [{nx,ny}…] }`, a polygon of normalized 0..1 box coords.
- Renders each as an SVG `<polygon>` (points `nx*100,ny*100` in a `0 0 100 100`
  viewBox, `preserveAspectRatio="none"`), black fill + white non-scaling stroke.

The walls layer recognizes **dark-on-light** marks/objects (marker lines, dark or
colored objects on a bright whiteboard), traces each outline, and publishes a
simplified polygon. The host blacks out recognized shapes above everything, so on
the projection the white border's outer half reads as an outline around the shape.

## Usage

1. `pushwork sync` (bundleless — no build) and register the module.
2. In a **Spatial Host** doc, Use mode → **Create new ▾** → Spatial Walls; set it
   active and turn on the camera.
3. Draw a squiggle or place a dark/colored object on the surface → its outline is
   echoed as a black shape with a white border.

## Data model

```js
{ title: "Spatial Walls" }
```
