# openfoam

A frontend to [OpenFOAM](https://www.openfoam.com) for hulls in a scene. Link
a hull, describe a resistance analysis, ask any machine with OpenFOAM to run
it, watch it converge, read the figures, and drop the results into the
scene next to the hull.

It is the real thing [flow-field](../flow-field) stands in for: viscous,
turbulent, and (if you ask) with waves.

```
pnpm install && pnpm build && pnpm test
```

## Quick start

1. **OpenFOAM.** On a Mac (Apple Silicon), the native app:
   `brew install --cask gerlero/openfoam/openfoam` (Homebrew 7 asks you to
   `brew trust --cask gerlero/openfoam/openfoam` first). It installs
   `OpenFOAM-v2606.app` and an `openfoam` launcher. On Linux, any ESI
   OpenFOAM (v2306 or later) with its `etc/bashrc`.
2. **The host**, where OpenFOAM is: `daemon/start.sh --new-queue "OpenFOAM on
   my Mac"`, with `TASKS_HOST` naming the tasks package's Node host and
   `OPENFOAM_PACKAGE` this package's automerge url (below, *Running it*). On a
   server add `--bashrc /usr/lib/openfoam/openfoam2606/etc/bashrc`. It prints
   a **task queue** link; later starts serve it with `--queue <that link>`.
3. **A case.** New document → "OpenFOAM case". It has two tabs:
   - **Model setup**: the **Model** (drop in a 3D file or hull, or paste
     its link; choose its parts, each listed with its size and, once the
     list is open, whether it's a closed shell; which way its bow points;
     see it drawn with its waterline, length, beam, draft, displacement and
     wetted area) and the **Run setup** (how it floats: sinkage, trim, heel,
     or a mass to float at; the flow; the solver; the server, where you paste
     the queue link). Beside the setup, what to expect: Froude and Reynolds
     numbers, the friction floor, cells and time. Then **Run**, or a sweep of
     speeds (in the speed's unit).
   - **Runs**: what's **Running** (stages, convergence, Finish now, Cancel)
     and the **Results**: the finished runs with their resistance, the curve
     against speed, and the one you pick, in tabs: Figures, each plot,
     Inputs, How it ran.
4. **The scene.** Drag the case into the scene with the hull. It draws the
   hull coloured by pressure, the waterplane or the wave pattern, and
   streamlines (the selected run if it's finished, else the newest finished one).

## What it registers

| type | id | what |
|---|---|---|
| `patchwork:datatype` | `openfoam-case` | "OpenFOAM case": a hull link, a setup, a server, the runs it has made |
| `patchwork:tool` | `openfoam-case` | model setup (model, run setup) and runs (running, results, inputs and comparison) |
| `patchwork:datatype` | `openfoam-run` (unlisted) | one analysis, frozen when asked for; its code writes its progress and results |
| `patchwork:tool` | `openfoam-run` | the same run view, on its own |
| `scene:source` | `openfoam-results` | a case (or a run) as a GLB: hull by Cp or Cf, the water surface, wake and centre planes, streamlines |
| `agent:tool` | `openfoam_case`, `openfoam_setup`, `openfoam_run`, `openfoam_results`, `openfoam_stop` | the same case for an agent (below, *For agents*) |

## The setup, and its speed

A case's `setup` (`src/setup.js`) is what its next run will be: the
analysis, the speed, the attitude, the water, the mesh and solver. **The
speed is one value with its unit**, as it was given: 8 kn is
`{ "value": 8, "unit": "kn" }`, and 4.1 m/s is `{ "value": 4.1, "unit": "m/s" }`.
Nothing stores it converted and nothing reads a bare number as a speed: m/s
is computed where the physics needs it (`metresPerSecond`). Choosing the
other unit in the form converts the value, so the boat's speed stays what it
was; a sweep's speeds are in the unit shown.

Both the tool and the run's code read a setup through `normalizeSetup`, which
fills and clamps. What it had to change (a bare-number speed, a trim out of
range, a field a setup doesn't have) is listed by `setupProblems`: the case
shows it under the run setup, and the next change from the form writes the
setup as shown.

## For agents

The package registers five `agent:tool` plugins (`src/agent-meta.js` holds
their descriptions and schemas; `src/agent-tools.js` the executors). They
call the same model the case tool's buttons call (`src/case-model.js`), so an
agent never drives the page, and what it can do a person can do in the case.
Inputs are things other tools produce: automerge: URLs, numbers with their
units (`"8 kn"`, `{ "value": 11984, "unit": "kg" }`), part names as listed.
A value out of range or unknown is refused with what's allowed, never
clamped; a refused call writes nothing. Every write is one change whose
message names the agent session.

| tool | does | a person does it with |
|---|---|---|
| `openfoam_case` | makes a case (filed in `folder`), links `hull`, `parts`, `bow`, `server`; `reread` reads the original model again. Every call reports the case: each part's extent in the model's frame and whether it's a closed shell, the hull as floated (displacement, draft, waterline, wetted area, LCB) and how sinkage is measured, the setup, what a run will cost, the server, and whether it can run | the Model section, the parts list, Re-read, the server box |
| `openfoam_setup` | `analysis`, `speed` (with its unit), `attitude`, `float` (`mass` with its unit, or `keep_displacement`), `water`, `temperature`, `mesh`, `iterations`, `stop`, `domain`, `cores`, `keep_volume`, `start_from` | the Run setup form, Float at, Keep displacement |
| `openfoam_run` | one run at the setup's speed, or `speeds` (a sweep, each with its unit, at most 20) | Run, and Sweep |
| `openfoam_results` | one Markdown table of `runs` or a `case`'s runs (the latest 40) | the Results table and each run's Figures |
| `openfoam_stop` | `keep: true` finishes now (while solving), `keep: false` cancels | Finish now, Cancel |

**Floating.** `float` solves the sinkage at the trim and heel the same call
ends with: `openfoam_setup { case, attitude: { trim: 1.5 }, float: { mass: "11984 kg" } }`
sets the trim and floats at it in one change. Floating twice at one mass
gives one sinkage (it's a position, not an increment).

**Waiting.** A run's state is the small top-level field `status` of its
document: `queued` → `meshing` → `solving` → `post` → `done`, or `failed`, or
`cancelled`; only the run's code writes it. `openfoam_run` returns each run and
the exact watch, e.g. `doc_watch { url: "automerge:…", path: ["status"], match: "done|failed|cancelled" }`,
then `openfoam_results { runs: [...] }`. A double body takes about a minute
once it starts, a free surface tens of minutes; a queue is run oldest first.
A run cancelled before it started has nobody to write its document, so its
`status` stays `queued`; `openfoam_results` and the case tool read it from
the run's task and show it cancelled.

**Results.** One row a run: status (with the iteration while solving),
speed, analysis, mesh, sinkage / trim / heel, R<sub>T</sub> (± its scatter
over the averaging window), its pressure and viscous parts, F<sub>z</sub>,
the weight the hull floats at (displaced volume at rest × ρg) and
F<sub>z</sub>/W (free surface only: a double body's F<sub>z</sub> is squat
suction), convergence (converged, settled, stopped early, not converged),
cells, iterations and time. Under it, a line for each run that failed (where,
and its error cut to 240 characters), was cancelled, or hasn't finished.

`openfoam_case`, `openfoam_setup` and `openfoam_run` are `where: "host"`
(reading a model can take the page's geometry readers); `openfoam_results`
and `openfoam_stop` need only documents (`where: "worker"`).

## What a run keeps, and comparing runs

A run doc keeps everything it was made from, so it can be made again and
set against another:

- **the setup**, as it was;
- **the hull**: the closed STL it ran (in the analysis frame, floated), its
  measurements, and where it came from: the doc, its **heads** (the version
  read), the reader, the parts, the bow, the waterline;
- **the hull's geometry digest**: SHA-256 of its triangles in the analysis
  frame *before* it's floated, rounded to float32. The same hull at another
  sinkage, trim or heel has the same digest; a changed model, or other parts,
  has another. Each digest is a **variation** of the hull, lettered A, B, …
  in the order the case first ran it. The runs table and the speed curve
  split by variation once there's more than one;
- **the tool that asked** (`made`: this package's version);
- from the run's code: **where and with what it ran** (host, OpenFOAM version,
  cores, this package's version and git commit, marked when it has changes)
  and the **recipe**: every file it wrote for the OpenFOAM case (dictionaries
  and initial fields, 15–20 KB), with a digest over them and the STL. Two
  runs with one recipe digest were the same OpenFOAM case.

A finished run's **Inputs** tab lists all of this, grouped as the setup is.
**Compare with** sets another finished run beside it: the inputs that
differ are marked, and the headline results are side by side with the
change. **Set up the case from this run** puts its setup and hull link back
into the case (to change one thing and run again); **Run again exactly**
makes a new run with its setup and its frozen STL.

## The flow volume, and big bytes in segments

**Keep volume** (Solver) asks the run to keep every cell's flow after the
run: the mesh and the last time's fields, as OpenFOAM wrote them (binary,
with their headers). It is big, about 200 bytes a cell: 31 MB for a coarse
double body (154k cells), 228 MB for a medium one (1.08M), so it's off unless
asked for, and the estimate says how big it would be. The run keeps it
after the run is done (the results don't wait for it), as the run's last
stage, and links it as `run.volume` (`{ status, url, bytes, docs, missing }`).

It is split **by meaning**, so a reader fetches only what it shows: one
`openfoam-volume` doc indexes `mesh.points[piece]`, `mesh.faces[piece]`, … and
`fields.p[piece]`, `fields.U[piece]`, …, where a piece is a processor's part of
a parallel run. `src/volume.js` reads some of it (`readVolume(repo, doc, {
mesh, fields, pieces })`, `volumeBytes` for what that costs) and parses
OpenFOAM's binary files into typed arrays (`parseFoam`: points, compact faces,
owner/neighbour, scalar and vector fields; checked against checkMesh's counts
on real runs). The mesh and pressure of one piece of the coarse run is 2.3 MB.

Anything big is then cut into **segment docs** of at most 4 MB
(`src/segments.js`): a ref (`{ "@segments": [url…], size, sha256 }`) stands
where the bytes would be. The same goes for a big kept hull, a big run STL
(once for a whole sweep; a rerun reuses the segments) and a big result layer.
Readers take inline bytes or a ref alike and check the digest. This is a
**workaround**, dated 2026-11-15, for what `probes/bulk-bench.mjs` measured on
the sync server: a 34 MB doc never arrived; fetching runs at 0.8–2 MB/s; a doc
that takes over 60 s to arrive is called unavailable; acknowledgements
sometimes never come for docs that did arrive. The note at the top of
`src/segments.js` says how to check whether it's still needed. **If it is
December 2026 or later, check.**

The run waits for the server to acknowledge each doc it makes; where an
acknowledgement doesn't come within a minute, a second peer in the run
(nothing stored) fetches the doc the way a reader would. Only what that can't
get either is reported missing, in the stage's note and `run.volume.missing`.

Measured through the sync server (2026-11-15): keeping the coarse volume
took 23.5 s (128 files, 81 docs, all acknowledged); a fresh peer read its
mesh and pressure (18.8 MB) in 28 s, every file identical to the case on
disk.

## The analyses

Both hold the hull fixed at its attitude (sinkage and trim are inputs; it is
not free to heave and pitch), use kOmegaSST with Spalding's wall function
(valid at any y⁺, so the presets don't have to land in a y⁺ band), and mesh
with blockMesh + snappyHexMesh. A symmetric hull is cut at y = 0 and solved
as a half model.

- **Double body** (`simpleFoam`, steady). The waterplane is a symmetry plane:
  no waves. Gives viscous and form drag and the flow round the hull, in
  under a minute on a laptop. Its total over the ITTC-57 friction line is the
  form factor 1 + k (the double-body method). The recipe is ESI's motorBike
  tutorial.
- **Free surface** (`interFoam` with local time stepping, to a steady
  state). Waves and their drag; the wave pattern. Twenty minutes and up on a
  laptop. The recipe is ESI's DTCHull tutorial.

Everything scales with the hull's length L: the domain runs 1.25 L ahead
and 2.5 L behind, 1.5 L out and 1.25 L down. Presets (`src/setup.js`,
`MESH_SIZING`) set the background cell (L/8, L/10, L/12), the hull's surface
refinement, nested boxes round it, wall layers, and for a free surface a
band round z = 0 refined until the boat's own wave gets 16, 24 or 32 cells,
plus a band one level coarser across the whole domain.

**The waterline is a grid plane.** The background mesh is snapped so z = 0
is a cell boundary. Without that, the inlet face straddling the waterline is
all water or all air (setFields goes by its centre). The inflow's depth is
then off by up to half a cell, and the domain drains to that level. The first
coarse free-surface run lost 0.23 m of depth this way, and with it 35 kN of
buoyancy and the sign of its drag (`src/setup.test.js` holds the invariant).

Water is seawater (35 g/kg) or fresh, 0–30 °C: EOS-80 density, Vogel and
Sharqawy (2010) viscosity, within 0.5% of ITTC 7.5-02-01-03 at 15 °C.

### Heel

`attitude.heel` heels the hull about the waterline's centreline (starboard
down positive) before trim and sinkage. A heeled hull has no symmetry plane,
so it always runs the full domain (about twice the cells), whatever the
domain setting says. Heeling changes what's under water: **Keep
displacement** solves the sinkage that restores the upright displacement.
Both analyses work heeled (a double body's symmetry plane is still the
waterplane). The run adds the side force (to port positive), and the roll
and yaw moments about the waterline at mid-length (starboard down and bow
to port positive). No leeway yet: the stream stays along x.

Measured, narrow-transom at 6 kn, double body, the same displacement:
upright 770 N on a half model of 123k cells; heeled 20° to starboard (the
hull rises 6 cm to keep its displacement) 934 N on a full model of 267k
cells, the extra almost all pressure drag, with a 562 N side force to
starboard and a 5.2 kN·m yaw moment, bow to port.

The symmetry check that decides "half if symmetric" compares the hull's
extent, its area centroid and its area's y·z and y·x products (exact over
each triangle, so a symmetric surface split into triangles one way still
reads as symmetric). A shape turned about the centreline can keep its extent
and centroid, but not those products.

### The wave profile along the hull

A free-surface run's results include **Wave profile**: the height of the
water where it meets the hull, along its length, for each side (one line for
a half model). It is read from the water surface the run keeps: where that
surface meets the hull it stops, and within the hull's length that edge is
the only one it has (`src/waveprofile.js`). The edge is averaged into
stations along the length, about six edges each, so a coarse mesh's
zig-zag along its cells doesn't show as spikes. On the coarse 6 kn
narrow-transom run: a 0.25 m crest at the bow (about half of V²/2g), a
0.25 m trough aft of amidships, a rise at the stern, climbing both
overhangs.

### What the figures are

Each force is the mean over the last tenth of the iterations (at least 20),
doubled for a half model, as resistance (the stream runs toward −x). The run
view shows R<sub>T</sub> and its parts (pressure, viscous), C<sub>T</sub> on
the wetted area at rest, ITTC-57 C<sub>F0</sub>, the form factor (double
body) or C<sub>R</sub> = C<sub>T</sub> − C<sub>F0</sub> (free surface), the
vertical force (the squat of a double body; for a free surface, what weight
and buoyancy would answer, beside the weight the hull floats at: its
displaced volume at rest × ρg, and their ratio), y⁺, the mesh, and whether it
converged. Each figure says how it was made (`src/results.js` reads them out
of a run for the agent's table too).

### Measured (this Mac, M-series, 8 ranks, 2026-11-14)

camber's `narrow-transom` (naval's fixture: 11.9 m LOA, 9.91 m LWL, 21 t) at
6 kn, coarse mesh, half model:

| | cells | time | R<sub>T</sub> | notes |
|---|---|---|---|---|
| double body | 122,840 | 40 s | 770 N | viscous 469 N vs ITTC-57 456 N; 1 + k = 1.69; converged in 274 iterations |
| free surface, 1500 iterations | 359,953 | 19 min | 1,112 N, **not converged** | still falling 675 N over its last 150 iterations; far-field water level within ±2 cm; waves ±0.25 m |

The double body through the real sync server gives the same 769.7 N, and
5 kn pressed from the real Patchwork came back as 543 N in 39 s (4.5 kn:
444 N). The free-surface run is why the free-surface defaults are now
4000 to 6000 iterations (as DTCHull runs). Whether the coarse preset settles at
a credible value at 4000 hasn't been checked yet.

## Running it

A run is a **task** asked of a **task queue** (the case's Server field): a
document keyed by the run doc's url, naming this package's
`daemon/run-task.mjs` as its code. A **tasks host** (the tasks package's Node
host, `TASKS_HOST`) on a machine with OpenFOAM serves the queue: it takes the
queue's tasks oldest first and runs each one's code from this package's
directory. Nothing listens on a port, so moving it to a big machine is a
matter of running it there and serving the same queue (or pasting a new
queue's link).

```
TASKS_HOST=…/tasks/dist-node/host.mjs OPENFOAM_PACKAGE=automerge:… \
daemon/start.sh --new-queue "title" | --queue automerge:… [--jobs N] [--cores N] [--name "…"]
                [--launcher /path/to/openfoam] [--bashrc /path/to/etc/bashrc]
                [--mpirun-args "…"] [--state ~/.patchwork-openfoam] [--sync wss://…]
```

- **State** (`--state`): `host/` (the host's documents) and `runs/<id>/`,
  each run's OpenFOAM case, kept for ParaView. The machine's settings reach
  each run as `FOAMD_*` environment variables (`daemon/run-task.mjs` lists them).
- **Who serves it.** Each host says so on the queue every two seconds; the
  case tool shows who is heard ("served by …") and what runs and waits. Runs
  asked of a queue nobody serves wait in it.
- **Never re-run behind your back.** Tasks run at least once: when a host
  stops mid-run (SIGTERM gives the run 5 s, and its document says the machine
  stopped), its task is taken again when the host is back. A run's code that
  finds an earlier run of its task doesn't solve; it marks the run failed
  ("interrupted and not started again"), and the task fails.
- **Runs at once**: `--jobs` (1 by default), oldest first.
- **Cores a run**: all but two, at most 8, unless `--cores` or the case says
  otherwise. Meshing and solving both run on them (snappyHexMesh in
  parallel: the free-surface coarse mesh in 27 s on 8 cores, 51 s on one).
- **Why --jobs.** CFD is limited by memory bandwidth, not arithmetic. On this
  M4 (4 performance + 6 efficiency cores, ~120 GB/s) 100 double-body
  iterations took 28 s on 1 core, 17 on 2, 15 on 4, 15 on 6 and 10 on 8: under
  3× for 8 cores. A server with 4–8× the bandwidth runs a coarse free-surface
  run 4–8× faster (an estimate), and does best as several runs of a few dozen
  cores each (192 cores: `--jobs 6 --cores 32`).
- **Sleep.** On macOS each run holds off idle sleep (`caffeinate -i`) while it
  goes, and only then: a Mac that idles to sleep stops the solver and drops
  the sync connection.
- **Cancel** flags the run's task. A run that hasn't started never does; a
  running one has the command and everything under it killed at once (SIGTERM,
  then SIGKILL 3 s later), and its document says cancelled. Not its process
  group: OpenMPI's `prterun` makes its own, and gives every rank another, so a
  group kill leaves the solver running (`daemon/foam.test.mjs` reproduces
  that shape). **Finish now** is the run doc's `control.finish`: it sets
  `stopAt writeNow`, the solver writes and stops, and the results are read as
  usual.

### Starting and stopping runs sooner

- **Stop when settled** (the default). A run stops once the mean resistance
  over the last tenth of its iterations (at least 100) agrees with the tenth
  before within 1%, and scatters within 1% (`src/convergence.js`), after at
  least 500. The iteration count is then a ceiling. Steady runs also stop on
  their residuals, which usually comes first. The 1500-iteration coarse
  free-surface run above was still 72% apart between its last two windows, so
  the rule would have kept going.
- **Start from a past run** ("Start from" in the case). The run maps that
  run's last solution onto the new mesh (`mapFields -consistent`, decomposed
  to decomposed) and puts the inlet back to the new speed (`changeDictionary`:
  mapFields carries boundary values over too, and an early try ran the
  6 kn case at 4.5 kn). Only on the machine that ran the source. What it buys:
  - double body, 6 kn from 4.5 kn: **nothing**, 297 iterations against 263
    cold, the same drag to 0.2%. The boundary layer re-forms either way.
  - free surface: the source's waves arrive intact (a 6 kn start from a 6 kn
    run begins at its source's vertical force and drag, not a 9 kN spike).
    Whether it settles sooner is what `probes/converge-experiment.mjs` measures.
- **Not potentialFoam.** Initialising a double body with potential flow made
  no difference (264 iterations against 263). A free-surface run already
  starts with the water moving everywhere, and potentialFoam's outflow there
  would be the atmosphere. Nor an inlet ramp: the outlet's mean velocity is a
  constant in v2606, so a ramp would drain the domain.
- **Running attitude.** A double-body run's squat force and pitching moment,
  against the waterplane's stiffness, give a first estimate of the sinkage
  and trim it would run at (`src/attitude.js`, linear, no waves). The run view
  shows it, and offers to set up a free-surface run there.

### The protocol

`src/protocol.js`, shared by the tool and the run's code. Who writes what
never overlaps:

| doc | people write | the run's code writes |
|---|---|---|
| case | everything | nothing |
| run | `control.finish`, `task` (once, when it is asked for) | status, stages, progress, mesh, summary, layers, volume, error |

The task and the queue are the tasks package's documents, written through
`src/task-client.js` and read through `src/task-rules.js` (verbatim copies
of the tasks package's kit files; `node scripts/check-kit.mjs` at the
experiments root checks them). The status a person sees is the run doc's,
or, where nobody wrote it (cancelled before it started, a machine that
stopped for good), its task's (`shownRun`).

A run doc is made when you press Run, with the setup and the hull (as a
closed binary STL in the floating frame) frozen into it, so every run
records exactly what was analysed. Progress is appended as packed Float32
chunks (one per two seconds), not numbers, so the doc's history stays about
the size of its data. Results are separate docs, one per layer: positions,
indices and dimensionless fields (Cp, Cf, u/V, |U|/V, wave height), written
once.

## The hull

Link the hull itself: a 3D file (GLB, or anything a loaded package reads:
a Rhino `.3dm` through [model-viewer](../model-viewer)'s `file-3dm` reader,
an STL through the scene's), a camber hull, any doc a geometry reader can
build, or a scene's render of one. No scene is needed; a scene is just
another place the same hull is shown. (Geometry readers are registered as
`scene:source`, the scene package's name for them; nothing here needs a
scene beyond that name.) `src/hull/acquire.js` gets triangles and the
model's named parts (`model-viewer` gives one per Rhino layer and colour).

**Parts** (`src/hull/parts.js`). A real model is the whole boat: Jim's
37 ft Daysailor is 29 parts and 1.4 million triangles, with the rig, the
sails, a dodger and 630,000 triangles of deck hardware. The hull is, by
default, every part that isn't a water plane or tall (more than half the
wet length above the waterline: the rig), and either meets the waterline
band (its lowest point within 2% of the wet length above it) or is long and
low (80% of the length, within 10% above the waterline: topsides, a deck).
For the Daysailor that is Hull Bottom (with its keel, bulb and rudder),
Topsides and Deck. The case lists every part and lets you choose. A part
that looks like a water plane (flat, three times the rest's length) is
never hull; its height is the waterline.

**Bow direction.** The analysis wants the bow to +x; a model drawn the other
way (Jim's, bow at x = 0) is turned a half-turn about z. The run keeps the
turn and the waterline datum, so the scene draws results back in the
model's own frame.

**Kept with the case** (`src/hull/stash.js`). A model can be huge (the
Daysailor is a 92 MB file that takes seconds to convert, and too big to reach
a fresh browser at all) while the hull a case uses is small. So linking a
hull, choosing parts it doesn't already hold, Re-read and Keep write one small
`openfoam-hull` doc: the chosen parts' triangles in the model's own frame
(11,000 triangles, under half a megabyte, for the Daysailor), every part's
summary, and what it was read from (heads, reader, params). Opening the case
reads only that: ready in 0.2 s with 75 ms of main-thread work, the original
never loaded, nothing converted (`probes/stash-run.mjs`). The bow and dropping
parts need nothing more; adding a part the stash lacks reads the original
once and keeps a new one. Nothing is written just because someone opened a
case. Whether the original has changed isn't checked on open (that would
load it): the case says when its hull was read, and "Re-read the model" reads
it again.

`src/hull/prepare.js` then places it at its attitude, welds, winds every
face consistently, closes up to four openings (camber draws some transoms as
no face at all, and an open shell fills with water in the mesher), measures
it below the waterline (volume, LCB, waterplane area, LCF and longitudinal
inertia, wetted area, LWL, BWL, draft) and writes binary STL. A model of
many separate surfaces (more openings than that: hull pieces, seams) is left
open: the mesher copes, and the displacement and wetted area are flagged as
unreliable instead of being made up. "Float at" solves the sinkage for a
displacement by bisection, at the trim and heel the setup has then.

**What sinkage means.** The hull is heeled about the waterline's centreline,
trimmed about the point half-way along its length on the waterline, then
lowered by the sinkage. So sinkage is where the hull floats, measured at
that point (the case says its x), from as drawn: not a change from the last
sinkage. Trimming moves that point's height not at all, but it changes what
is under water, so a trim set after floating needs floating again (the case
says the trim and heel it floated at).

## Tests and probes

`pnpm test` (vitest): the setup and domain (invariants for every mode, preset
and half/full: the hull, every box and the seed point inside the domain, the
waterline on a grid plane), the hull preparation on a box with known answers
(volume 2, wetted area 9, LCB 2, an open end closed), the protocol, the case
files, the parsers and results against **real OpenFOAM output**
(`daemon/test/fixtures`, from the narrow-transom run above), the scene GLB,
the process-tree kill, a run told to stop for each reason (cancelled,
stopping, yielded) with a stand-in solver, the run's task code (its guard
against solving twice, what it tells a task view), the status read from a
run doc and its task, the speed and its units, the agent's tools over a fake
repo (a GLB of a closed box hull, an open cabin and a water plane: every
part's report, floating at a mass and trim against the box's exact answer,
one run and a sweep, the results table, every refusal), and the case tool in
a page (happy-dom) doing the same through its form.

Probes (need OpenFOAM, or Chrome):

- `node probes/local-run.mjs [--mode free-surface] [--dump run.json]`: one
  run through the real runner and OpenFOAM, on an in-memory repo.
- `node probes/net-run.mjs`: the whole arrangement on this machine: a tasks
  host serving a new queue, runs asked from a separate peer through the real
  sync server; a run end to end, finish now, cancel mid-solve (no solver
  process left), the host stopped mid-run and started again (the run is not
  solved twice), a solver error (fails once), and who is heard serving.
- `node probes/converge-experiment.mjs --queue automerge:…`: free-surface
  runs from rest, at a double body's predicted attitude, and warm-started from
  a nearby speed, each to the settled rule; reports when each settled. Hours
  on a laptop: run it plugged in, or on a server.
- `node probes/bulk-bench.mjs post --case <run dir> [--chunk-mb 8]`, then
  `get --url automerge:…`: how long a run's whole volume takes to post through
  the sync server and to fetch into a fresh peer, in chunks of a given size
  (`--chunk-mb 0`: one doc). What `src/segments.js`'s workaround rests on.
- `node probes/volume-run.mjs keep --case <run dir>`, then `read --url
  automerge:… --case <run dir> [--fields p] [--pieces 0]`: keep a finished
  case's flow volume as a run does, then read part of it into a fresh
  peer and compare it byte for byte with the case on disk.
- `pnpm build && node probes/ui-run.mjs --done run.json --done2 run2.json`:
  the built tool in headless Chrome on a fake repo, with real dumped runs:
  pre-flight, Run, a run mid-solve, results and every plot, the resistance
  curve, the scene build, light, dark and phone width.

## Not yet

- Free heave and pitch (sinkage and trim by 6DoF, as DTCHullMoving does).
  For now they are inputs, and the vertical force says which way it would go.
- Heel and leeway (no symmetry plane then; the full domain works, the setup
  just doesn't rotate the hull about x yet).
- Restarting a stopped run.
- A wave field to start a free-surface run from thin-ship theory (Michell's
  amplitude function gives the far-field Kelvin pattern); boatmath may already
  compute it.
- Results are kept at coarse precision as Float32 layers of up to a few MB; a
  fine mesh's hull surface wants decimating before it's stored.
- **Exploring the flow volume.** It's kept (above) and parsed, but nothing
  draws it yet: slicing OpenFOAM's polyhedral cells in the browser (our own
  cutter, or vtk.js), and a compact resampled copy near the hull for a quick
  look (5–20 MB), are next. Surfaces as VTK XML (`.vtp`) with every array and
  a sidecar (frame, units, reference V/ρ/L) are still deferred. Warm starts
  from another machine's runs want the same data.
