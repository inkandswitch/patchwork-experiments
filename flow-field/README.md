# Flow Field

A stand-in for CFD results: an **analytic 3D potential flow** you can edit, and
render into a [scene](../scene) next to hulls and parts. The flow is a uniform
stream plus point sources, sinks and doublets and vertical line vortices,
superposed. It's exact, incompressible and irrotational, and fast enough to
recompute on every drag.

A new document starts as a **Rankine body**: a source and a sink of equal
strength in a 2 m/s stream. All of the source's fluid goes into the sink, and
the stream surface around it is a closed, streamlined body about 10 m long
(x ≈ 0 to 10) and 2.7 m across. Its waterplane z = 0 is a plane of symmetry,
which makes it a "double-body" flow, the usual first approximation of the
flow under a hull.

A flow can also be **linked to a hull** (or any doc whose geometry can be cut
into a section). The flow then goes round that hull's waterline, derived from
the hull every time it is drawn or built, so editing the hull updates the flow.
See [Linking a hull](#linking-a-hull).

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | what |
|---|---|---|
| `patchwork:datatype` | `flow-field` | the flow (icon `Wind`) |
| `patchwork:tool` | `flow-field` | top-down editor |
| `scene:source` | `flow-field-streamlines` | RK4 streamlines from a seed rake, as stream tubes or lines |
| `scene:source` | `flow-field-slice` | a horizontal plane coloured by Cp or speed |

## The editor

This is a plan view of the flow at one height (the **Height** slider, local
to you). It shows:

- a **heatmap** of the pressure coefficient Cp = 1 − (|V|/U)² or of speed, with a
  legend. Cp uses a cool–warm map centred on 0, so the undisturbed stream is
  grey, stagnation is red and suction is blue. Speed uses viridis.
- **streamlines** in that plane, seeded along the upstream face of the domain.
- **Mask bodies**, which blanks the inside of closed bodies (fluid that came
  out of a source rather than in with the stream). The test traces upstream
  in 3D, like the scene slice, so a body still shows below or above the plane
  its elements sit in. The drawn streamlines stay in the plane.

To edit, click an element to select it and drag to move it. Arrow keys nudge
it by 0.1 m (1 m with Shift) and Delete removes it. **+ Source / − Sink /
± Doublet / Line vortex** arm a kind, and the next click places it. Drag the
**dial** (top left) to turn the stream, holding Shift to snap to 15°. The
panel edits speed, heading, and the selected element's kind, strength and
position, plus the domain and seed count. **Load preset…** switches between a
Rankine body, a half-body, a sphere, a sphere with circulation (a doublet plus
a line vortex, which gives a lifting flow), and a catamaran.

Everything except the view settings is in the doc, so collaborators see each
other's drags live.

The **Body** section of the panel links a hull. See below.

## Document

```js
{
  title: "Flow past a Rankine body",
  freestream: { speed: 2, headingDeg: 0 },          // m/s; toward, CCW from +x (east)
  elements: {
    bow:   { kind: "source", position: [0.7, 0, 0], strength: 12.4 },
    stern: { kind: "sink",   position: [9.3, 0, 0], strength: 12.4 },
  },
  domain: { min: [-6, -6, -4], max: [16, 6, 4] },   // metres
  seeds: { count: 15, plane: "upstream" },
  body: null,                                        // or a link, see "Linking a hull"
}
```

The frame is **engineering Z-up**, with x east, y north, z up, in metres.
It is the scene contract's **floating frame**: a linked hull's bow points to
+x and its design waterline is at z = 0, so a boat going ahead sees the stream
heading 180°. Linking a hull to a doc still on the default heading of 0°
turns the stream to 180° (once), so the hull isn't modelled going astern.

| kind | strength | field |
|---|---|---|
| `source` | m³/s volume flux | +m / 4πr² radially |
| `sink` | m³/s | −m / 4πr² radially |
| `doublet` | m⁴/s, axis along the stream | a sphere of radius (S / 2πU)^⅓ in stream U |
| `vortex-line` | Γ, m²/s | infinite vertical line; Γ > 0 turns counter-clockwise from above |

Unknown kinds and non-finite numbers are ignored, not fatal. A doc with no
`body` key (made before linking existed) behaves exactly like `body: null`,
fingerprint included. `"@patchwork".type`
is stamped by the host when the doc is created, and the scene uses it to find
these providers.

## Scene providers

Both convert to glTF's **Y-up** frame with X = x, Y = z, Z = −y (a proper
rotation, so handedness survives; tested). Metres stay metres, so the Rankine
body sits at X 0…10 with its waterline at Y = 0, which is where a 10 m hull
with its bow at the origin would be.

Both bake **COLOR_0** (linear RGB), so they look right in any glTF viewer.
They also carry the raw fields as `_SPEED` (m/s) and `_CP` for a shader
colormap. The material is white so the vertex colours show as baked.
`fingerprint(doc)` hashes `freestream`, `elements`, `domain` and `seeds`, so
renaming the doc doesn't rebuild anything. When the flow is linked, it also
hashes the link (`url`, `plane`, `model`, `panels`), but not the hull's
contents. Both providers report `dependencies(doc) = [body.url]`, and the scene
host watches that doc's heads (contract v2 §1), so a hull edit rebuilds the
flow. The build notes say which body model was used and which path the section
came by, or why the body was left out.

When the hull can't be had **on this peer** (its doc hasn't loaded here, or
nothing installed here can cut a section of its datatype), the build throws
instead of writing a body-less GLB. Such a GLB would be recorded as up to date
against the hull's heads and every other peer would keep it. Throwing keeps the
last good render and leaves it stale, so a peer that has the provider rebuilds
it. A link that is unusable everywhere (a flow linked to itself or to another
flow) builds without the body and says so in the notes. The section provider's
own version isn't part of freshness (see the caveats).

**`flow-field-streamlines`**: a rake of `seedCount` seeds per row (0 means the
doc's `seeds.count`) across the upstream face, in `rakeRows` rows starting at
`seedHeight` and stepping down by `rowSpacing`. It works for any heading. Each
seed is integrated with classical RK4 in arc length (`step` m, up to
`maxSteps`). A streamline stops on the domain boundary (clipped onto it), at a
stagnation point, or at a singularity. Polylines are then thinned (a point
wherever the path turns 2° or runs 0.4 m) and meshed:

- `tubes` (default on), with `tubeRadius`: 6-sided tubes with parallel-transport
  frames and outward normals. WebGL draws lines 1 px wide, so tubes read much
  better, and they're what screenshots want.
- off: one `LINES` primitive.

`colorBy` is `speed` or `cp`, and `colormap` is `auto`, `viridis`, `coolwarm`
or `turbo`. The range is automatic (2nd–98th percentile, centred on 0 for Cp
on cool–warm) unless you turn `autoRange` off and set `colorMin`/`colorMax`.

**`flow-field-slice`**: a grid at `height` (clamped into the domain) with
`resolution` cells along the longer side, coloured like the streamlines,
default Cp. It is drawn **unlit** (`KHR_materials_unlit`), so the colours are
the colormap's, not shaded by the scene's lights. `fade` (0–1, default 0)
fades the undisturbed flow (Cp = 0, or free-stream speed) and the domain's
edges toward 1 − fade opacity with per-vertex alpha, leaving what the bodies
disturb; 0.9 or so reads well on light and dark backgrounds. With `mask` on,
cells inside a body are left out, and cells the outline passes through are
clipped along it (marching squares, each crossing found by bisecting the same
test to 1/32 of a cell), so the outline is smooth rather than a staircase. "Inside" means
that tracing upstream from the point ends at a source or a doublet, or it
reaches the rear stagnation point with a sink ahead. A trace that ends on a
vortex line gives no answer that way (near its axis a vortex only swirls the
fluid round), so the capture point is tested again in the flow with the
vortex lines taken out, and it takes that result. The mask is traced on a
coarser lattice and then filled in vertex by vertex along body edges. A
point right beside a source (inside its capture radius) counts as inside: a
trace that starts there heading into the singularity ends on it, rather than
overshooting it and reading as a stagnation point.

Both providers put a colour legend on their mesh as `extras.legend`
(`{ title, unit, min, max, stops }`, the scene's convention), which the scene
draws in the viewport's corner.

The default build is 45 tubes (about 0.7 MB) or a 110 × 60 slice (about
0.4 MB), each in well under 100 ms. The builds run synchronously on the
scene's main thread, and each result is stored as a doc, so their size is
capped. `resolution` goes up to 160 (about 0.8 MB and 60 ms). `seedCount` goes
up to 40 per row and `rakeRows` up to 8. Past 48,000 mesh vertices the tubes
drop to 4 sides and the lines are thinned (the build notes say so), which
keeps the largest streamline build under about 2.7 MB.

## Linking a hull

```js
body: {
  url: "automerge:…",                       // the linked doc, e.g. a camber hull
  plane: { kind: "waterline" },             // or { kind: "z", z: -0.4 } (m, floating frame)
  model: "waterplane-2d",                   // or "slender-body-3d"
  panels: 120,                              // resolution: panels, or line-source segments (16–400)
}
```

Only the link is stored. The body's singularities are derived from a
**section** of the linked doc whenever the flow is drawn or built, and they
are never written to the doc. The doc's own `elements` still apply and are
superposed on the body.

**Where the section comes from.** First choice is a `geometry:section`
provider for the linked doc's datatype (`getRegistry("geometry:section")`,
matched on `supportedDatatypes`). It gives the exact waterline. When none is
installed, or it throws, the fallback is a matching `scene:source` provider:
the doc is built in memory with the provider's default params (nothing is
stored), the GLB is mapped into the floating frame (x = X, y = −Z, z = Y) and
its triangles are cut with the plane. The cut treats a vertex on the plane as
above it and cuts every edge from the same end, so seams and on-plane vertices
don't break loops. Points are welded, chains are joined across small gaps, and
a chain that stays open is closed straight across its ends. A hull shell with
no transom face slices to a U, and closing it draws the transom. The editor's
chip says **exact section** or **mesh fallback**, and so do the build notes.
With no registry, no provider, or an unloadable doc, the flow is just the
stream and the elements, and the notes and the panel say why.

The fallback depends on the provider's default params putting the hull in the
floating frame. For camber that is `origin = "waterline"` and `rake = true`,
which contract v2 §3 makes its defaults.

**In the editor**, **Link hull…** takes a pasted URL (`automerge:…`, a
Patchwork `#doc=` link, or a bare id), or you can drop a document from the
sidebar onto the view. The linked body is drawn as a locked outline, and a chip
names the doc and the section path. The panel sets the plane, the model and the
resolution. **Fit domain** puts the domain round the body. The editor
subscribes to the linked doc and cuts the section again 250 ms after its edits
settle. **Unlink** keeps what it can. A slender body becomes ordinary point
sources and sinks (at most 32 per loop, each carrying its run's total flux),
so the flow barely changes. A waterplane body has no element equivalent, so
the editor warns first and then drops it.

### The two models

**`waterplane-2d`** (the default) is a Hess–Smith panel method. The waterline
is resampled to exactly `panels` constant-strength **source** panels in all
(shared among the loops by perimeter, at least 6 each; the smallest loops are
dropped, with a note, when there are more than the budget allows, and a loop
with more sharp corners than half its share keeps only the sharpest), with
cosine spacing that bunches them at the stem, the stern and both sides of each
sharp corner. Corners are kept exactly as panel ends, so no control point
sits on one. A dense solve (partial-pivot Gaussian elimination, about a
millisecond at 120 panels) makes the normal velocity exactly zero at every
panel midpoint, counting the freestream and the doc's own elements, so the
body stays impermeable with them superposed. The doc's point elements are 3D,
so with any of them present the panels are solved again for each height the
flow is sampled at (to the millimetre, the last 16 kept), and the prism stays
impermeable at every rake row, not only at the section plane.

Only the **outermost** loops are panelled: a loop inside another (the inner
skin of a shelled hull, a cockpit) isn't wetted, so it is dropped with a note,
and the whole outline is masked. Loops that touch or overlap (two parts
meeting at the waterline) are merged: panels lying inside or on another loop
are dropped, so the rest outline the union. If a solve still comes out
singular or ill-conditioned (a strength over 1000× the largest inflow), the
body is left out and the notes say why; the flow carries on without it. The field is then the freestream,
the panels and the elements. Panels more than four lengths away are evaluated
as point sources.

Source panels alone, with no vortex panels and no Kutta condition, are the
right choice for a closed, non-lifting body. Going straight ahead, a hull's
waterplane makes no lift, and a blunt transom has no sharp trailing edge where
a Kutta condition could go. The source-only system is always uniquely
solvable, and its net source comes out zero to discretisation error. On a
cylinder it gives the analytic surface speed 2U sin θ and Cp = 1 − 4 sin²θ
(tested).

This is **2D flow**, past an infinitely deep prism with the waterline's shape.
The editor and slice show the same field at every height, and masking is exact
point-in-polygon on the section. Streamlines are traced flat in each rake
row's plane. At a transom's convex corners potential flow is genuinely
singular. The panel ends are clamped a hair off zero distance, the body's own
induced speed is capped at 10× the reference speed, and NaNs are dropped, so
nothing non-finite reaches a GLB. Expect a strong local speed-up round the
corners. Because the flow stays attached (see caveats), expect a rear
stagnation region behind the transom too.

**`slender-body-3d`** uses slender-body theory. Each loop becomes a body of
revolution about its centreline in the section plane, with radius equal to the
local half-breadth b(x). It is represented by a line of source segments with
strength q(x) = Ux · dS/dx, where S = π b², so it is a double body
symmetric about the section plane. Stations are cosine-spaced along x, and
each segment's velocity is the exact field of a constant-strength line source.
A blunt end is closed smoothly (S tapers as (1 + cos πs)/2). Downstream of a
transom, that closure is a **dead-water** region 3 half-breadths long, about
1.5 transom beams, standing in for the separated wake. A blunt end facing
upstream gets a short cap of 0.5 half-breadths. The net flux is exactly zero,
and the body's interior (dead water included) is masked at the model's own
**dividing stream surface**, found per station where the Stokes stream
function ψ = ½Ux ρ² + Σ q/4π (R_b − R_a) is zero. That lies a little inside the
nominal half-breadth (about 1% at L/B = 10, 9% at L/B = 2.5), and it is the
surface streamlines actually hug, so they no longer stop short beside the hull.
Holes are dropped as for the panels, and at most 8 loops (hulls) are kept. On an
elliptical waterline it gives a closed spheroid with nearly tangent surface
flow and a peak speed just over U (tested).

### Physics caveats

- Both models are **potential flow**: inviscid, attached and without a free
  surface. There are no waves, no wave resistance, no boundary layer and no
  real separation. The dead-water closure is a modelling device, not a
  computed wake.
- `waterplane-2d` is 2D. It overstates the blockage of a real hull, which has
  finite draft and lets the flow pass under the keel, so its speed-ups and
  suctions are larger than a 3D hull's. It is the accurate model for the
  waterline slice's *shape* and for the flow right at the waterline.
- `slender-body-3d` models only the flow along the hull axis, using Ux.
  Leeway and cross-flow (the doublet term of slender-body theory) are left
  out, and a hull at an angle makes no side force in either model. It trades
  the real section shape for an equivalent body of revolution: good for how
  the flow is displaced overall, poor right against a flat side or a chine.
- Freshness follows the hull doc's heads, not the section provider's code.
  If camber changes how it cuts a section (or a section provider is installed
  after a render was built from the mesh fallback), linked flow renders don't
  go stale until the hull or the flow doc changes. The notes say which path and
  provider built each render.
- Neither model makes lift or circulation. If you add line vortices of your
  own, they are superposed (and the panels stay impermeable to them), but no
  Kutta condition sets their strength.

## Files

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe, no imports) |
| `src/datatype.js` | the doc and its Rankine seed (`body: null`) |
| `src/field.js` | velocity, Cp, potential: the physics (pure); adds a linked body's velocity |
| `src/body.js` | a linked body: loops, resampling, Hess–Smith source panels, slender-body line sources, the unlink snapshot (pure) |
| `src/flow.js` | `compileFlow(doc, section)`: the doc's field plus its derived body, cached (pure) |
| `src/mesh-section.js` | the fallback section: GLB triangles → floating frame → plane cut → loops (pure) |
| `src/section.js` | finding the linked doc and its section: exact provider, else mesh fallback (main thread) |
| `src/registry.js` | the host's plugin registry, late-bound |
| `src/body-notes.js` | the build notes' line about the body |
| `src/dnd.js` | copy of `scene/src/dnd.js`: dropped docs and pasted URLs |
| `src/integrate.js` | RK4 streamlines, the seed rake, the inside-a-body test (pure) |
| `src/geometry.js` | polyline thinning, tubes, lines, slice grid (pure) |
| `src/colormap.js` | viridis / cool–warm / turbo, robust ranges, baking (pure) |
| `src/coords.js` | Z-up → Y-up |
| `src/fingerprint.js` | stable hash of what the builds read; `dependencies` |
| `src/build-streamlines.js`, `src/build-slice.js` | doc + params → GLB (pure) |
| `src/scene-streamlines.js`, `src/scene-slice.js` | the `SourceImpl`s |
| `src/glb.js` | copy of `scene/src/glb.js`, **extended** with a `colors` → `COLOR_0` field |
| `src/view2d.js` | the editor's geometry: view fit, hit tests, dial, heatmap sampling |
| `src/presets.js` | the preset flows |
| `src/tool.js`, `src/styles.css` | the editor |
| `probes/tool-probe.html` | mounts the built editor against an in-memory handle (`python3 -m http.server`, then open it; `?preset=spinning&color=speed`) |
| `probes/body-probe.html` | the editor with a hull linked through a stub registry (`?model=slender-body-3d`, `?path=mesh`, `?z=`) |
| `src/test/` | test fixtures: a stub `@inkandswitch/patchwork-plugins` (aliased in `vitest.config.ts`) and prism hull GLBs |

Tests cover the physics: uniform stream, source radial symmetry and flux,
divergence and curl ≈ 0 away from singularities, V = ∇φ, the doublet's
sphere, and a vortex's circulation. They also check that a Rankine streamline
keeps its Stokes stream function and stays off the body, the rake for any
heading, masking, tube normals and winding, the axis conversion, GLB contents,
the fingerprint, and the editor mounted in happy-dom. For linked bodies, they
check the panel method against the analytic cylinder (surface speed, Cp, zero
normal velocity at every control point, zero net source), the analytic field
off the surface, a transom's corners (finite everywhere, capped), impermeability
with elements superposed, the slender spheroid (closed, nearly tangent, peak
speed), the dead-water closure, the unlink snapshot's flux, determinism, and the
mesh slicer (on-plane vertices, seams, node transforms, open shells, two
hulls). They also check the exact and fallback paths and graceful failure,
`dependencies` and the fingerprint (unchanged for body-less docs), the builds'
masking and notes, and the editor's link, live update, plane and model
controls, both kinds of unlink, and drop.
