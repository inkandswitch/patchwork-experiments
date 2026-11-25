# fea

Finite element analysis for parts in Patchwork, with
[CalculiX](https://www.calculix.de) as the solver and [gmsh](https://gmsh.info)
as the mesher. Link a part from any tool that makes geometry, say how it is
held and what pushes on it by pointing at its faces, send it to a daemon
running anywhere, and see where it is stressed and how it moves: on the part
in the study, or in a scene.

```
pnpm install && pnpm build && pnpm test
```

## Quick start

1. **gmsh and CalculiX**, on the machine that will solve.
   - macOS: `brew install gmsh`, then `daemon/install-calculix.sh`, which
     builds `ccx` 2.23 from its published sources into
     `~/.patchwork-fea/calculix` (a few minutes; it needs `brew install gcc`
     for gfortran, and cmake).
   - Debian or Ubuntu: `apt install gmsh calculix-ccx`.
2. **The daemon**, on that machine: `daemon/start.sh` (from anywhere; it
   finds node 22+ on PATH or in nvm, and installs its dependencies the first
   time). It prints an **inbox** link.
3. **A study.** New document → "FEA study". On the left its panel, on the
   right the part.
   - **Part**: drop a model on it or paste its link. It is measured and split
     into faces.
   - **Material**: one from the list, or your own numbers.
   - **Supports** and **Loads**: click a face on the part, then *Fix it* or
     *Push on it*; or add one and click the faces it is on.
   - **Server**: paste the inbox link (the browser remembers the last one).
   - **Run**. The study turns to **Results**: the run's stages as they go,
     then its figures, and the part drawn moved and coloured by stress.
4. **In a scene.** Right-click any object while editing → *Analyse (FEA)*: a
   study of it appears beside it and opens there, its panel over the scene.
   Or drag a study into a scene: it draws the selected run's results.

## What it registers

| type | id | what |
|---|---|---|
| `patchwork:datatype` | `fea-study` | "FEA study": a part link, a setup, a server, the runs it has made |
| `patchwork:tool` | `fea-study` | the panel (setup, results) beside the part in 3D |
| `patchwork:datatype` | `fea-run` (unlisted) | one analysis, frozen when asked for; the daemon writes its progress and results |
| `patchwork:tool` | `fea-run` | how it went, what it found, what was asked |
| `patchwork:datatype` | `fea-part` (unlisted) | the part as a study keeps it: its surface and its faces |
| `patchwork:datatype` | `fea-server` (unlisted) | a daemon's inbox and status |
| `patchwork:tool` | `fea-server` | is it up, what runs, what waits, what it did |
| `scene:source` | `fea-results` | a study (or a run) as a GLB: the part moved and coloured, its supports and loads marked |
| `scene:view` | `fea-scene-edit` | *Analyse (FEA)* on an object, and a study's *Open*: its panel over the scene, the part in place |
| `agent:tool` | `fea_study`, `fea_setup`, `fea_run`, `fea_results`, `fea_stop` | the same study for an agent (below, *For agents*) |

## The part

Link the solid itself: an OpenSCAD model, a CAD model, an STL or GLB file,
any document a geometry reader can build, or an object's render from a scene
(`src/part/acquire.js`). Geometry readers are registered as `scene:source`,
the scene package's name for them; nothing here needs a scene beyond that
name. A part is read in its render's frame: **y is up, lengths are metres**,
so results lie exactly on the part wherever it is drawn. The analysis is SI
throughout.

`src/part/faces.js` welds the triangles, winds them all outward, takes the
largest closed shell as the solid (saying so if there are others), and
refuses, in words, a surface that isn't closed.

**Faces** are what you point at. The rule:

1. Triangles lying in one plane are one flat (grown from the largest
   triangle against its plane, so a gentle curve can't creep in facet by
   facet).
2. Flats and lone triangles meeting at under 30° are joined, except a flat
   with something six times smaller. So a cylinder's many equal strips are
   one face, and a fillet's, while the flat a fillet runs into stays its own
   face though no edge parts them.

Faces are numbered by where they are, so the same part read twice numbers
them the same. A round face knows its radius.

**Kept with the study** (`src/part/kept.js`). A support says "faces 3 and
7", so what face 7 is must not move under it. The split is made once, when
the part is linked or read again, and kept as data in a `fea-part` doc: the
welded surface (binary STL, Float32) and each triangle's face. A study opens
from that alone; a run freezes a copy; the daemon meshes exactly those
triangles under exactly those numbers. A later version of the rule changes
nothing already kept.

When the model changes, the study says so, and **Read again** splits it
afresh and carries each support's and load's faces over to the faces that
are still alike (flat or not, facing within 10°, within a fiftieth of the
part's size of the same place, within a tenth of the same area). What has no
like is dropped, and named.

## The setup

`src/setup.js`. **Every quantity is one value with its unit**, as given:
`{ "value": 2, "unit": "kN" }`. Nothing stores one converted and nothing
reads a bare number as one; choosing another unit in the form converts the
value, so the quantity stays what it was.

- **Material**: Young's modulus, Poisson's ratio, density, and a yield
  strength (or none). Linear, elastic and the same in every direction: that
  is all this models. `src/materials.js` has a starting list.
- **Supports**: *fixed* (held every way) or *sliding* (held along its flat
  face's normal only: also a mirror plane of a symmetric part).
- **Loads**: a *force* (a total, in a direction, spread evenly over its
  faces), a *pressure* (square onto its faces everywhere, round a curve
  too), *gravity*.
- **Mesh**: coarse, medium, fine or a length. A preset follows the part:
  about its thinnest dimension, never coarser than a twelfth of its length.
  Round faces get elements small enough to follow them (12, 16 or 24 round a
  full circle). Ten-node tetrahedra unless asked otherwise.
- **Analysis**: *static* (stress and deflection under the loads) or *modal*
  (the ways it rings, and their frequencies).

Both the tool and the daemon read a setup through `normalizeSetup`;
`readiness` says what stands between a setup and a run, each a sentence
saying what to do.

## A run

`daemon/runner.mjs`, in five stages, each shown as it goes:

1. **Read the part** frozen in the run.
2. **Mesh it** (`src/solver/gmsh.js`). The part's surface goes to gmsh as a
   mesh whose triangles carry their face's number, and gmsh builds its
   geometry from exactly those faces, so the volume mesh's skin is split
   along the part's faces by construction: a load on face 7 lands on the
   mesh triangles of gmsh's surface 7, with nothing matched up afterwards.
   A face gmsh can't lay out that way (one that closes on itself with no
   edge: a ball) makes it split the surface its own way instead, and the
   skin is matched back to the faces by position; the run says which
   happened. gmsh's surface mesher gives a slightly different mesh each time
   it runs (measured: node counts within 2%, the stress at a hole within 5%
   on a medium mesh), so the daemon keeps every mesh it makes, under a
   digest of the surface, the script and gmsh's version, and a run of the
   same part at the same size takes the kept one: two load cases on one part
   are compared on one mesh, and a study run twice gives the same figures.
3. **Supports, loads and the solver's input** (`src/solver/loads.js`,
   `deck.js`). Every face load becomes forces at nodes, integrated over each
   skin triangle (∫ Nᵢ t dA), so every kind of load takes one path and its
   total is exact: a force's nodal forces sum to the force asked for. A
   sliding support is a plain condition where its normal is an axis, else an
   equation n·u = 0 at each node.
4. **Solve** (CalculiX).
5. **Read the results** (`src/solver/frd.js`, `post.js`): the figures, and
   the mesh's skin with stress and displacement at its points, kept in a
   doc of its own (cut into segment docs above 4 MB, as openfoam's are).

### What the figures are

Highest von Mises stress and where; the stress all but the top 1% of nodes
are under (far below the highest: the peak is a small spot); the safety
factor (yield over the highest stress); the largest movement and where; what
each support carries; what each load applied, as it landed on the mesh; mass
and volume; the mesh; where and with what it ran. Each says how it was made
(`src/results.js` reads them for the agent's table too).

A support's reaction is everything it carries: CalculiX's total for its
nodes plus whatever load sits on those very nodes (a share of the weight),
which goes straight into the support and isn't in that total.

### Checks every static run makes

- **Forces balance**: the supports' forces against the loads.
- **Energy against work**: the strain energy CalculiX adds up from its
  stresses, against the work the loads did by its displacements. The same
  number two ways; a run where they differ by more than 0.1% **fails**
  rather than report figures. (They agree to 10⁻⁷ on every right answer
  measured.)

And it says, in the results, what a person should know before trusting
them: it moved more than a few percent of its size (the analysis assumes
small movements); it is past yield; the peak is at a support (where it
climbs without limit as the mesh refines); elements are badly shaped.

### Checked against theory

`node probes/validate.mjs`: through the real runner, gmsh and CalculiX
(2.23, this Mac, 2026-11-24), medium mesh:

| case | figure | got | theory | off |
|---|---|---|---|---|
| steel cantilever, 100 × 10 × 10 mm, 100 N across its tip | tip deflection | 200.63 µm | 201.53 µm (beam theory with shear) | 0.45% |
| | wall reaction | 100.0000 N | 100 N | 0 |
| plate with a hole, pulled | stress at the hole | 15.99 MPa | 15.67 MPa (Howland's finite-width factor) | 2.0% |
| block pressed on top, sliding on three faces | shortening, stress, floor reaction | exact | p H / E, p, p A | < 10⁻⁵ |
| the same block at an odd angle (sliding by equations) | the same | exact | the same | < 10⁻⁵ |
| bar hung under its own weight | stretch | 7.654 nm | ρ g L² / 2E = 7.698 nm | 0.57% |
| | support carries | 6.1586 N | its weight, 6.1586 N | 0 |
| cantilever, modal | first bending frequency | 812.97 Hz | 815.38 Hz (Euler–Bernoulli) | 0.30% |
| ball (one face with no edge) | meshed the second way; support carries its weight | 2.4673 N | 2.4673 N | 0 |

Timings, same machine, through the sync server: a 14,000-node plate in 2 s
from pressing Run to results on another peer; 71,000 nodes in 21 s; 89,000 in
23 s.

## The solver runs its equations on one thread

Measured here (`node probes/threads.mjs`, an M4): a ccx 2.23 built with
SPOOLES' multithreaded solver, as Homebrew's formula and CalculiX's own
`Makefile_MT` build it, gave **a wrong answer in 9 runs of 30** of one small
static job with the solver on 8 threads. Displacements were off by up to
98%, with no error. With the solver on one thread and the rest of ccx on 8:
0 of 30. So `daemon/install-calculix.sh` builds the serial solver only, the
daemon sets `CCX_NPROC_EQUATION_SOLVER=1` whatever ccx it is given, and the
energy check above stands behind both. Assembling the matrix and working out
the stresses still use every core. Run the probe on a new machine before
trusting more.

## The daemon

`daemon/fead.mjs` is an automerge peer, not a web service (the shape is
openfoam's `foamd`). It syncs with the same server Patchwork does and owns
one `fea-server` document, its inbox. Nothing listens on a port, so moving
it to a big machine is a matter of running it there and pasting the new
inbox link.

```
daemon/start.sh [--sync wss://…] [--state ~/.patchwork-fea] [--cores N] [--jobs N] [--max-nodes N]
                [--gmsh /path/to/gmsh] [--ccx /path/to/ccx] [--title "…"] [--new-server]
```

- **State** (`--state`): `config.json` (the inbox and the daemon's id, so a
  restart keeps its inbox), `automerge/` (a local copy of its docs) and
  `runs/<id>/`: each run's surface, mesh, solver input (`job.inp`) and
  CalculiX's own results (`job.frd`, which cgx and PrePoMax open), and
  `meshes/`, the meshes kept for reuse. About 10–30 MB a run; nothing
  clears either.
- **Largest mesh**: `--max-nodes` (250,000). CalculiX's direct solver holds
  the whole factorised matrix in memory. A run that would be far over is
  refused before meshing, with the size it would have been.
- **Runs at once**: `--jobs` (1), oldest request first. A run interrupted by
  a restart is marked failed, never run again behind your back.
- **Cancel** kills whichever program is running.
- It holds off idle sleep on macOS while a run is active, and only then.

### The protocol

`src/protocol.js`, shared by the tool and the daemon. Who writes what never
overlaps:

| doc | people write | the daemon writes |
|---|---|---|
| study | everything | nothing |
| part | whole, once, when it is read | nothing |
| run | `control.cancel` | status, stages, mesh, summary, layers, recipe, notes, error |
| server | `requests[id]` | `daemon` (heartbeat every 20 s), `handled[id]`, `active` |

A run doc is made when you press Run, with the setup and the kept part
frozen into it, so every run records exactly what was analysed. It also
keeps the tool that asked, where and with what it ran (host, CalculiX and
gmsh versions, the daemon's git commit), and its recipe: the gmsh script and
the solver's input with its long lists cut short, plus a digest of the whole.

## In a scene

- **The source** (`src/scene-source.js`, `scene-build.js`). A run shows
  itself; a study shows its selected run if that has finished, else its
  newest finished run, else the part it keeps with its supports and loads
  marked. Params: colour by stress or displacement (or plain), drawn moved
  (exaggerated, as it really moves, or not), which mode of a modal run, the
  marks. The result's mesh carries the scene's `extras.legend`; the marks
  are on their own layers.
- **Analyse and Open** (`src/scene/edit.js`), both the editor's verbs.
  *Analyse (FEA)* on any object makes a study whose part is the object's
  own render (exactly what the scene shows), stands it beside the object and
  opens it. A study's *Open* puts a hand on the scene's stack, hides the
  study's built GLB from this viewer, lays the study's panel over the scene
  and draws the part in place with the scene's own three.js; a click on the
  part there is the panel's (a face picked), everything else passes to the
  scene. Escape puts it down.

The panel is one piece of code (`src/tool/study-panel.js`) talking to a 3D
view through a small interface; the study's own viewport and the scene's
stage both implement it, and both draw with `src/view/part-view.js`.

## For agents

The package registers five `agent:tool` plugins (`src/agent-meta.js` holds
their descriptions and schemas; `src/agent-tools.js` the executors). They
call the same model the study tool's controls call (`src/study-model.js`), so
an agent never drives the page, and what it can do a person can do in the
study, and the other way round. Inputs are things other tools produce:
automerge: URLs, quantities with their units (`"250 N"`,
`{ "value": 2, "unit": "MPa" }`; a bare number is refused), and the face
numbers and ids `fea_study` lists. Directions are in the part's frame, where y
is up. A value out of range or unknown is refused with what's allowed, never
clamped; a refused call writes nothing. Every write is a change whose message
names the agent session.

| tool | does | a person does it with |
|---|---|---|
| `fea_study` | makes a study (filed in `folder`), links `part` (or unlinks it with null), `reread`s it, sets `server`, `select_run`, `forget_runs`. Every call reports the study: the part's size, volume, mass in the material, whether it is a closed solid and whether the model changed; every face by number with what it is (flat or round, its size, which way it faces, its area and centre; the largest 60, or `faces: "all"`, or those `facing` one way); the material, supports and loads with their ids, the mesh and about how many nodes, the server, and what blocks a run | the Part section (drop or paste a model, Read again, Unlink), pointing at a face, the Server box, the runs list (choose a run, ×) |
| `fea_setup` | `analysis`, `modes`, `material` (a list id or E, ν, density, yield with units), `mesh` (`size` a preset or a length, `order`), `add_support` / `update_support` / `remove_support`, `add_load` / `update_load` / `remove_load` on face numbers. Several changes in one call are checked first and written as one change, or not at all | the Material and Analysis sections, Supports and Loads (+ Fixed, + Sliding, + Force, + Pressure, + Gravity, Pick faces, Fix it / Push on it / Pressure on it, ×), the Mesh section |
| `fea_run` | freezes the setup and the part into a new run in the server's queue | Run |
| `fea_results` | one Markdown table of `runs` or a `study`'s runs (the latest 40), then each finished run's figures and notes, and why any failed | the Results tab: the runs list, the figures and notes |
| `fea_stop` | cancels runs that haven't finished | Cancel |

**Waiting.** A run's state is the small top-level field `status` of its
document: `queued` → `meshing` → `solving` → `post` → `done`, or `failed`, or
`cancelled`; only the daemon writes it. `fea_run` returns the run and the
exact watch, e.g. `doc_watch { url: "automerge:…", path: ["status"], match: "done|failed|cancelled" }`,
then `fea_results { runs: [...] }`. It says about how many nodes the mesh will
be; a run is refused, not queued, while the server's daemon isn't running.

`fea_study` is `where: "host"` (linking a part can take the page's geometry
readers); the other four need only documents (`where: "worker"`).

## Tests and probes

`pnpm test` (vitest): the units; the part (welding, winding, faces on boxes,
cylinders, a plate with a hole, a filleted block, a ball); what is kept and
how faces carry over; gmsh's input and output; the mesh (its skin closed,
outward and on the right faces, for four- and ten-node tetrahedra); the
loads (totals exact, nothing on a ten-node triangle's corners); the solver's
input; CalculiX's output, from real files; the figures and their notes; the
setup; the protocol; the drawing and the scene's GLB; the agent's tools over
a fake repo.

Probes (need gmsh and CalculiX, or Chrome):

- `node probes/validate.mjs`: the table above; exits 1 if any case is
  outside its tolerance.
- `node probes/threads.mjs`: is this ccx right on several threads.
- `node probes/local-run.mjs [--shape plate|beam|block|cylinder] [--analysis modal] [--dump run.json]`:
  one run through the real runner on an in-memory repo.
- `node probes/net-run.mjs --inbox automerge:…`: a study made, set up and
  run by the tool's own functions from a separate peer, through a real
  `fead` and the real sync server; `--cancel-after-ms` cancels it mid-run.
- `pnpm build && node probes/ui-run.mjs --done run.json --modal modal.json`:
  the built tool in headless Chrome on a fake repo: link a part, click
  faces on it, run, a run mid-solve, results on the part, a modal run's
  modes, a changed model, a part that isn't closed; light, dark and phone
  width.
- `pnpm build && node probes/scene-run.mjs --with <a checkout holding a built scene/>`:
  in the real scene tool: Analyse from an object's menu, pick a face of the
  part where it stands, fix it, Escape.
- `pnpm build && node probes/cad-run.mjs --with <a checkout holding a built openscad/>`:
  an OpenSCAD model (an angle bracket) linked as a part through OpenSCAD's
  own reader, read at its real size and split into its ten faces; the model
  changed and read again; then the kept part meshed and solved for real.

## Not yet

- **Faces named by the model.** A CAD model knows its own faces; a GLB of it
  could carry them (a vertex attribute), and they would be used as they are.
  Today every part's faces are found from its triangles.
- **Curved elements.** The mesh follows the part's facets, so its ten-node
  tetrahedra have straight edges. Meshing the model's true surfaces (a STEP
  file through gmsh's own CAD kernel) would bend them to the curve.
- **More than one body**, and contact between bodies.
- **Bolts, bearings, remote forces, moved supports**; loads on edges and at
  points.
- **Past linear**: yielding, large movement, buckling, heat. CalculiX does
  all of them; the setup and the checks here don't yet.
- **Looking inside**: only the skin's results are kept. Sections through
  the volume need the volume kept (openfoam keeps its own in segment docs
  the same way).
- **Bigger jobs**: a build of CalculiX with PaStiX or Pardiso, whose
  threaded solvers are the supported ones.
- **In the browser.** CalculiX is Fortran; nobody has published a
  WebAssembly build of it. A small part could be solved in the page with no
  daemon at all.
- **Comparing runs** side by side, and sweeping a load or a dimension.
- **Results over the part itself in a scene.** A study stands beside its
  part; drawn in the part's place it would need the part hidden for
  everyone, which is the scene doc's to say.
