# Spatial Sand

A falling-sand tool for the [`spatial-patchwork-host`](../spatial-patchwork-host). Sand rains from
the top of the box and collides with the **walls** the host's recognition layer detects (black marker
drawings on the surface), treating them as physical barriers.

- Draw a **U** under the rain → sand piles inside it and overflows once full.
- Draw a **slanted line** → sand hits it and pours off along the slope.
- **Erase** a wall → sand resting on it falls immediately. **Reshape** it → the sand resettles.

## How it works

- Inlines the dependency-free `subscribe` helper and subscribes to `spatial:walls`
  (`{ shapes: [{ id, points: [{nx,ny}] }] }`, normalized 0..1 box coords).
- Runs a classic **cellular falling-sand** simulation on a grid in the box's coordinate space
  (`GRID_LONG` cells on the long edge). Each step: seed rain across the top row, then each sand cell
  falls down, else slides diagonally down, else rests.
- **Walls are rasterized into solid grid cells every frame** from the polygons, so live drawing
  changes take effect immediately. A grain a wall grows into is dropped (rain replenishes).
- **Bottom edge is a floor; left/right are open** — grains flowing off the sides disappear (the box
  can still fill if you run it long enough).
- **Sand-only rendering:** sand cells drawn on a transparent `<canvas>` (`image-rendering: pixelated`);
  the walls are not drawn here (the host blacks out the physical drawing; your real lines are visible).
- State is **ephemeral** — Reset clears it, reload starts empty.

## Controls

A small bar with **Start/Pause** (toggles the whole sim — rain + falling) and **Reset** (clears the
sand).

## Usage

1. `pushwork sync` (bundleless — no build) and register the module.
2. In a Spatial Host (walls layer active, background sampled), Use mode → **Create new ▾** →
   Spatial Sand; set it active and start the camera.
3. Press **Start**, then draw on the surface and watch the sand react.

## Tunables (top of `spatial-sand.js`)

- `GRID_LONG` (160) — grid resolution on the long edge (flow detail vs CPU).
- `RAIN_RATE` (0.15) — fraction of top-row cells seeded per step.
- `SAND_RGB` — sand color.

## Data model

```js
{ title: "Spatial Sand" }
```
