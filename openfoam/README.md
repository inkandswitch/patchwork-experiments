# openfoam

A frontend to [OpenFOAM](https://www.openfoam.com) for hulls in a scene. Link
a hull, describe a resistance analysis, send it to an OpenFOAM daemon running
anywhere, watch it converge, read the figures, and drop the results into the
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
2. **The daemon**, where OpenFOAM is: `daemon/start.sh` (from anywhere; it
   finds node 22+ on PATH or in nvm, and installs its dependencies the first
   time). On a server: `daemon/start.sh --bashrc /usr/lib/openfoam/openfoam2606/etc/bashrc`.
   It prints an **inbox** link.
3. **A case.** New document → "OpenFOAM case". Drag a hull in from a scene's
   outline (or paste its link), paste the inbox link into **Server**, press
   **Run**.
4. **The scene.** Drag the case into the scene with the hull. It draws the
   hull coloured by pressure, the waterplane or the wave pattern, and
   streamlines (the selected run if it's finished, else the newest finished one).

## What it registers

| type | id | what |
|---|---|---|
| `patchwork:datatype` | `openfoam-case` | "OpenFOAM case": a hull link, a setup, a server, the runs it has made |
| `patchwork:tool` | `openfoam-case` | set up, pre-flight, run, progress, results |
| `patchwork:datatype` | `openfoam-run` (unlisted) | one analysis, frozen when asked for; the daemon writes its progress and results |
| `patchwork:tool` | `openfoam-run` | the same run view, on its own |
| `patchwork:datatype` | `openfoam-server` (unlisted) | a daemon's inbox and status |
| `patchwork:tool` | `openfoam-server` | is it up, what runs, what waits, what it did |
| `scene:source` | `openfoam-results` | a case (or a run) as a GLB: hull by Cp or Cf, the water surface, wake and centre planes, streamlines |

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

### What the figures are

Each force is the mean over the last tenth of the iterations (at least 20),
doubled for a half model, as resistance (the stream runs toward −x). The run
view shows R<sub>T</sub> and its parts (pressure, viscous), C<sub>T</sub> on
the wetted area at rest, ITTC-57 C<sub>F0</sub>, the form factor (double
body) or C<sub>R</sub> = C<sub>T</sub> − C<sub>F0</sub> (free surface), the
vertical force (the squat of a double body; for a free surface, what weight
and buoyancy would answer), y⁺, the mesh, and whether it converged. Each
figure says how it was made.

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

## The daemon

`daemon/foamd.mjs` is an automerge peer, not a web service. It syncs with
the same server Patchwork does and owns one `openfoam-server` document, its
inbox. Nothing listens on a port, so moving it to a big machine is a matter
of running it there and pasting the new inbox link.

```
daemon/start.sh [--sync wss://…] [--state ~/.patchwork-openfoam] [--cores N] [--jobs N]
                [--launcher /path/to/openfoam] [--bashrc /path/to/etc/bashrc]
                [--mpirun-args "…"] [--title "…"] [--new-server]
```

- **State** (`--state`): `config.json` (the inbox and the daemon's id, so a
  restart keeps its inbox), `automerge/` (a local copy of its docs) and
  `runs/<id>/`, each run's OpenFOAM case, kept for ParaView.
- **Runs at once**: `--jobs` (1 by default), oldest request first. A run
  interrupted by a restart is marked failed, never re-run behind your back.
- **Cores a run**: all but two, at most 8, unless `--cores` or the case says
  otherwise. Meshing and solving both run on them (snappyHexMesh in
  parallel: the free-surface coarse mesh in 27 s on 8 cores, 51 s on one).
- **Why --jobs.** CFD is limited by memory bandwidth, not arithmetic. On this
  M4 (4 performance + 6 efficiency cores, ~120 GB/s) 100 double-body
  iterations took 28 s on 1 core, 17 on 2, 15 on 4, 15 on 6 and 10 on 8: under
  3× for 8 cores. A server with 4–8× the bandwidth runs a coarse free-surface
  run 4–8× faster (an estimate), and does best as several runs of a few dozen
  cores each (192 cores: `--jobs 6 --cores 32`).
- **Sleep.** On macOS it holds off idle sleep (`caffeinate -i`) while a run is
  active, and only then: a Mac that idles to sleep stops the solver and drops
  the sync connection.
- **Cancel** kills the running command and everything under it. Not its
  process group: OpenMPI's `prterun` makes its own, and gives every rank
  another, so a group kill leaves the solver running
  (`daemon/foam.test.mjs` reproduces that shape). **Finish now** sets
  `stopAt writeNow`: the solver writes and stops, and the results are read
  as usual.

### Starting and stopping runs sooner

- **Stop when settled** (the default). A run stops once the mean resistance
  over the last tenth of its iterations (at least 100) agrees with the tenth
  before within 1%, and scatters within 1% (`src/convergence.js`), after at
  least 500. The iteration count is then a ceiling. Steady runs also stop on
  their residuals, which usually comes first. The 1500-iteration coarse
  free-surface run above was still 72% apart between its last two windows, so
  the rule would have kept going.
- **Start from a past run** ("Start from" in the case). The daemon maps that
  run's last solution onto the new mesh (`mapFields -consistent`, decomposed
  to decomposed) and puts the inlet back to the new speed (`changeDictionary`:
  mapFields carries boundary values over too, and an early try ran the
  6 kn case at 4.5 kn). Only on the daemon that ran the source. What it buys:
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

`src/protocol.js`, shared by the tool and the daemon. Who writes what
never overlaps:

| doc | people write | the daemon writes |
|---|---|---|
| case | everything | nothing |
| run | `control.cancel`, `control.finish` | status, stages, progress, mesh, summary, layers, error |
| server | `requests[id]` | `daemon` (heartbeat every 20 s), `handled[id]`, `active` |

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

`src/hull/prepare.js` then places it at its attitude, welds, winds every
face consistently, closes up to four openings (camber draws some transoms as
no face at all, and an open shell fills with water in the mesher), measures
it below the waterline (volume, LCB, waterplane area, LCF and longitudinal
inertia, wetted area, LWL, BWL, draft) and writes binary STL. A model of
many separate surfaces (more openings than that: hull pieces, seams) is left
open: the mesher copes, and the displacement and wetted area are flagged as
unreliable instead of being made up. "Float at" solves the sinkage for a
displacement by bisection.

## Tests and probes

`pnpm test` (vitest): the setup and domain (invariants for every mode, preset
and half/full: the hull, every box and the seed point inside the domain, the
waterline on a grid plane), the hull preparation on a box with known answers
(volume 2, wetted area 9, LCB 2, an open end closed), the protocol, the case
files, the parsers and results against **real OpenFOAM output**
(`daemon/test/fixtures`, from the narrow-transom run above), the scene GLB,
and the process-tree kill.

Probes (need OpenFOAM, or Chrome):

- `node probes/local-run.mjs [--mode free-surface] [--dump run.json]`: one
  run through the real runner and OpenFOAM, on an in-memory repo.
- `node probes/net-run.mjs --inbox automerge:…`: one run through a real
  `foamd` and the real sync server, from a separate peer.
- `node probes/converge-experiment.mjs --inbox automerge:…`: free-surface
  runs from rest, at a double body's predicted attitude, and warm-started from
  a nearby speed, each to the settled rule; reports when each settled. Hours
  on a laptop: run it plugged in, or on a server.
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
- **Results as VTK, and the volume solution in documents** (deferred,
  2026-11-14). Store surfaces as VTK XML (`.vtp`) with every array,
  dimensional, point and cell data, plus a sidecar (frame, units, reference
  V/ρ/L, which array is pressure, velocity or wall shear), and derive Cp and
  the rest when viewing: nothing lost, ParaView opens it, other solvers can
  feed the same importer. The volume solution could live in documents too,
  one per field so a viewer pays only for what it opens: the coarse
  free-surface run is 49 MB of fields and 52 MB of mesh in OpenFOAM's binary
  format (maybe 25–40 MB as compressed `.vtu`, unmeasured). It grows with the
  cell count, so it's 10–100× that for server-sized runs. To settle it with
  numbers: push the coarse run's `.vtu` through the sync server and time a
  fresh browser opening it. It only pays off once the browser can slice
  OpenFOAM's polyhedral cells (our own cutter, or vtk.js). Warm starts from
  past runs (below) want the same data.
