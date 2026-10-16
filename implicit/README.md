# implicit — Implicit Surface

Write a shape as a **signed distance function** in a tiny, safe expression
language, and see it rendered live and exactly on the GPU by sphere tracing —
no meshing in the editor. Drop the document into a **Scene** and the
`implicit-mesh` provider turns it into a watertight triangle mesh with surface
nets. It stands in for geometry exported from an f-rep / implicit CAD kernel.

```
pnpm install && pnpm build && pnpm test
```

## What this package registers

| type | id | for |
|---|---|---|
| `patchwork:datatype` | `implicit-surface` | the document (icon `Atom`) |
| `patchwork:tool` | `implicit-surface` | collaborative source editor + raymarched preview |
| `scene:source` | `implicit-mesh` | meshes an `implicit-surface` doc for the Scene tool |

## The document

```ts
{
  "@patchwork": { type: "implicit-surface" },  // stamped by the host after init()
  title: string,
  source: string,                              // the program; collaborative text
  bounds: { min: [x, y, z], max: [x, y, z] },  // metres, Y up
  notes: string
}
```

`init()` seeds the first example. The host's `createDocOfDatatype` writes
`@patchwork.type` itself after `init()`, which is what the Scene matches
providers on, so the datatype doesn't.

## The language

A program is some `let` definitions and one final expression. The final
expression's value at a point `(x, y, z)` is the signed distance to the
surface: negative inside, positive outside.

```
// a mooring cleat
let base = roundBox(0.17, 12mm, 55mm, 6mm)
let post(dx) = translate(dx, 30mm, 0, capsule(13mm, 40mm))
let horn = segment(-0.1, 62mm, 0, 0.1, 62mm, 0, 12mm - abs(x) * 0.05)
smoothUnion(14mm, base, post(-38mm), post(38mm), horn)
```

- **Y is up; lengths are metres.** Numbers take unit suffixes: `5mm`, `2.5cm`,
  `1in`, `3ft`, `2m`. Angles are radians; write `30deg` for degrees.
- Numbers, `+ - * / ^`, unary minus, parentheses, `//` and `/* */` comments.
- `let name = expr` and `let f(a, b) = expr`, ended by a new line or `;`. A line
  that starts with an operator continues the one above.
- Names are **call-by-name**: a definition stands for its expression and is
  evaluated wherever it is used, so `let s = sphere(1)` followed by
  `translate(1, 0, 0, s)` moves the sphere. Arguments may depend on `x, y, z`
  (the cleat's horn tapers that way).
- Built-ins (full list in the tool's **Reference** panel):
  - primitives `sphere(r)`, `box(sx, sy, sz)`, `roundBox(sx, sy, sz, r)`,
    `torus(R, r)`, `cylinder(r, h)`, `capsule(r, h)`, `segment(ax, ay, az, bx, by, bz, r)`,
    `ellipsoid(rx, ry, rz)`, `plane(nx, ny, nz, d)`; lattices `gyroid(period, thickness)`,
    `schwarzP(period, thickness)`. Sizes are full sizes, centred on the origin;
    round things run along Y.
  - combine `union`, `intersect`, `subtract`, `smoothUnion(k, …)`,
    `smoothIntersect(k, …)`, `smoothSubtract(k, a, …)`, `shell(t, s)`, `offset(d, s)`
  - transform `translate(dx, dy, dz, s)`, `rotateX/Y/Z(angle, s)`, `scale(f, s)` or
    `scale(sx, sy, sz, s)`, `mirrorX/Y/Z(s)`, `repeat(cx, cy, cz, s)`,
    `twist(rate, s)`, and `at(px, py, pz, s)` for any domain warp
  - math `abs min max clamp mix smoothstep length sqrt pow exp log sin cos tan
    asin acos atan floor ceil round fract mod sign step`, constants `pi`, `tau`

Errors carry a line and column and a suggestion where one helps
(`Unknown function "sphre". Did you mean sphere(…)?`). Every definition is
checked, including unused ones, and unused ones get a warning.

**NaN.** An expression that is a constant NaN or infinity (`acos(2)`,
`log(-1)`, `1/0`) is a compile error at that expression, since GLSL has no such
literal. A NaN that only appears at some points (`sqrt(x)` for `x < 0`) is
allowed. `min`/`max`, and so `union` and `intersect`, ignore a NaN operand in
both backends, in either order. Anywhere else a NaN counts as outside when
meshing.

### How it's compiled (and why it's safe)

Sources come from shared documents, so user text is never run: there is no
`eval` or `new Function` anywhere (a test checks). The pipeline is

    tokenize → parse (AST) → check → lower → IR → { JS interpreter, GLSL generator }

The **IR** is a flat SSA list of scalar operations from a fixed table, with
constant folding, a few identities and hash-consing (a definition used twice at
the same point is computed once). The **JS backend** interprets it, a chunk of
points at a time with one tight typed-array loop per instruction. The **GLSL
backend** emits `float isf_user(vec3 p)` from fixed templates, register numbers
and float literals it formats itself; no name, comment or other user text
reaches the shader. Lowering has an instruction cap and a step budget, so a
program that expands into far too much work fails with a message instead of
hanging.

## The tool

Left: a CodeMirror 6 editor synced through `@automerge/automerge-codemirror`,
highlighted by the language's own tokenizer, with inline error and warning
marks, completion of built-ins and your own names, an **Examples** menu (gyroid
block, mooring cleat, hull blend, twisted tower, chain links, rippled vase),
a **Reference** panel (click an entry to insert it), and bounds and notes.

Right: a WebGL2 sphere tracer. It traces `max(field, bounds box)` with soft
shadows, a little ambient occlusion and a shadow-catching grid at the bottom of
the bounds. There are five views: **Shaded**; **Normals**; **Curvature**, which
shows mean curvature from the field's Laplacian; **Zebra**, reflection lines
for judging how smooth a blend is; and **Slice**, which cuts the part open at
a height and paints the distance field with iso-lines on the cut. Drag to
orbit, right-drag or shift-drag to pan, scroll or pinch to zoom, and
double-click to reset.

Each edit, local or remote, recompiles after 120 ms. The shader compiles in the
background (`KHR_parallel_shader_compile`), and the last good picture stays up
while the source has an error. The canvas renders on demand, at half
resolution while you move the camera. Camera, view and slice height belong to
each viewer and are never written to the doc. Colours come from the theme. If
the browser takes the WebGL context away (it keeps about 16, and drops the
oldest), the preview says so. When the context comes back, it rebuilds and
recompiles. Notes are saved 250 ms after you stop typing, and at once on blur
or unmount.

## The scene provider: `implicit-mesh`

- Params: `resolution` (integer, 16–160, default 96, cells across the longest
  side of the bounds, `expensive`), `smoothNormals` (boolean, default true,
  `cheap`) and `finish` (`matte` | `satin` | `metal`, default `matte`, `cheap`).
  Matte writes no material, so the scene uses its theme colour as before;
  satin (roughness 0.42) and metal (metallic 1, roughness 0.32) write a white
  PBR material that the scene's object colour tints, so a bronze colour on a
  metal finish gives polished bronze. The ParamSpec is the source of truth for
  the resolution range: the scene host clamps to it before `build()`, and
  `mesh/job.js` repeats the same numbers as a defensive clamp for direct
  callers (`index.test.js` checks that they agree).
- Provider metadata: `cost: "expensive"` (a source edit remeshes from scratch)
  and `version: 2`. Bump `version` whenever `build()` would make different
  output for the same doc and params; the host then marks renders from older
  versions stale, and never ones from newer versions.
- Output: glTF 2.0, **Y-up, metres**. The language is already Y-up metres, so
  nothing is converted. There is one mesh, always named `Implicit surface` (the
  scene outline shows the object's own name), with
  `NORMAL` from the SDF gradient (or flat per-face normals, unwelded, when
  `smoothNormals` is off) and a per-vertex **`_CURVATURE`** (mean curvature in
  1/m, from the same central differences). three.js reads it as `_curvature`.
  `meta.bounds` is the mesh's bounds, and `meta.notes` gives the triangle
  count, GLB size, resolution, cell size and time (or "mesh reused" on a
  cache hit). The host keeps `meta.bounds` and shows it as a placeholder box
  while the GLB loads.
- **Surface nets**, streamed one z-slab at a time, so memory is O(n²). The
  field is clipped to the bounds, and the grid has one extra cell on every side,
  so the mesh is always closed; infinite fields like `gyroid` get capped. Where
  walls are thinner than about two cells, surface nets can pinch two sheets
  through one vertex. The mesh is still closed, but not strictly 2-manifold
  there. Raise the resolution to fix it. The shipped examples are sized to be
  clean at the default 96, which `examples.test.js` checks (no non-manifold
  edges, no normal against its face). The gyroid block is the exception: it
  keeps a few pinched vertices where its walls meet the box's rounded corners.
- `fingerprint(doc)` is `v1:` plus a hash of the source and the bounds, and
  nothing else: not the title (renaming never remeshes) and not the notes.
  Usable bounds are hashed as numbers. Invalid bounds are hashed as `invalid:`
  plus their raw value, so they never collide with the default box the mesher
  would otherwise substitute: going from valid to invalid bounds rebuilds (and
  reports the problem), and fixing them to exactly the default box retries.
  The `v1:` prefix is frozen. Signal a change in mesher output by bumping the
  provider's `version`, not the prefix.
- **Mesh cache.** A build has two stages. The expensive one (`meshSurface`:
  evaluate the field, surface nets, field normals and curvature) depends only
  on the fingerprint and the resolution. The cheap one (`finishMesh`: flat
  normals and the unweld, the finish's material, GLB encode, notes) depends on
  `smoothNormals` and `finish`. The provider keeps the last three surfaces
  (up to 128 MB; the newest is always kept) in an LRU keyed by
  `fingerprint|resolution`. So changing the finish or the normals, renaming
  the doc, or flipping back to a recent resolution only refinishes, and gives
  byte-identical GLBs. Two builds that need the same surface at once share one
  job.
- **Off the main thread:** the expensive stage, and the first finish, run in a
  module worker at `new URL("./mesh/worker.js", import.meta.url)`, one worker
  per job, terminated afterwards. The worker sends back the surface (for the
  cache) and the GLB, both transferred. Vite bundles the worker next to the
  chunk that spawns it, so it resolves wherever the bundle is served,
  including inside the Scene tool. The worker posts `ready` once its module
  has loaded, and progress about once a second while it works:
  - an error before `ready`, or no `ready` within 15 s, means it couldn't start
    (no `Worker`, a CSP, a 404). The job then runs on the main thread, yielding
    about every 12 ms: between slabs, between blocks of normals and between
    chunks of the unweld.
  - an error after `ready`, or 30 s without a message, means it crashed
    mid-job, for example out of memory at resolution 160. The build rejects
    and says so. It isn't rerun on the main thread; the scene host retries
    failed builds after 5 s, 30 s and 2 min.
  - a new build of the same source url with a **different fingerprint**
    supersedes a running one: its worker (or main-thread job) is stopped and
    its promise rejects with a `superseded` error. Builds of the same doc at
    another resolution, or of other docs, run side by side.

  Refinishing a cached surface runs on the main thread with the same yielding.
  Only `encodeGLB` runs in one piece: about 20 ms for the gyroid at 160 in
  node, and about 100 ms with flat normals.
- The mesh gets big quickly, and the Scene keeps every build as a new file doc.
  A gyroid block at 96 is about 420k triangles (~11 MB of GLB); at 160 it is
  about 1.2M (~30 MB). Flat normals unweld the mesh, which makes it about three
  times bigger. Smooth parts like the cleat are a few hundred KB. So resolution
  stops at 160, and a build whose GLB would be over 48 MB fails with a message
  that says what to lower.

`glb.js` is copied unchanged from `scene/src/glb.js`.

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe) |
| `src/datatype.js`, `src/doc.js` | the datatype; bounds validation, fingerprint hash |
| `src/lang/` | tokenizer, parser, checker/lowering, builtins, IR, JS evaluator, GLSL generator |
| `src/examples.js` | the example menu |
| `src/tool.js`, `src/editor.js`, `src/styles.css` | the tool and its CodeMirror setup |
| `src/preview/` | shader, WebGL2 host, orbit camera, theme colours |
| `src/mesh/` | surface nets, the two-stage mesh job, the worker, `glb.js`, `quality.js` (manifold and normal checks for tests) |
| `src/scene-source.js` | the `implicit-mesh` provider: surface cache, worker lifecycle, supersession |
| `probes/` | headless-Chrome probe of the built bundle |

### Browser probe

```
pnpm build
node probes/probe-server.mjs 4471 &           # prints the JSON report and exits
node probes/shoot.mjs "http://localhost:4471/probes/probe.html" out.png "window.__ready"
```

It mounts the built tool against a real Automerge doc. It loads every example
in every view and checks that each compiles on the GPU and draws. Then it
breaks the source and checks that the last good picture stays up. Last, it
builds a 160-resolution gyroid through the built provider and records whether
the worker started, how long the build took and the longest frame gap on the
main thread meanwhile. For screenshots, start the server with `--keep` and add
`?shot&example=cleat&mode=3&theme=gloom`.
