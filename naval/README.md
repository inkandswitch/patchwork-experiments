# naval

A naval architecture workbench, a companion to camber: lay a rig out over a
hull, and screen hulls and designs side by side (hydrostatics, stability,
resistance, balance, a VPP polar) before paying for CFD. Every number is
recomputed from the documents; nothing derived is stored. It never writes
the hull's document.

It was `rig/`, and its ids still say so (`rig-design`).

## What it registers

`src/index.js` (metadata only; everything else is behind a `load()`):

| Plugin | id | What |
|---|---|---|
| `patchwork:datatype` | `rig-design` | "Rig": a rig design over a hull, seeded as a stock 12 m sloop (`src/doc.js`) |
| `patchwork:tool` | `rig-design` | The Rig tool (`src/tool.js`) |
| `scene:source` | `rig-design` | Builds the rig GLB, whose scene extras carry the contract as `extras.rig` (`src/scene-build.js`) |
| `patchwork:datatype` | `naval-study` | "Naval study": which hulls and designs are compared, and which is the baseline (`src/study/doc.js`) |
| `patchwork:tool` | `naval-study` | The study view (`src/study/tool.js`) |

## The Rig tool

Fields for the hull, rig, sails, keel, rudder and loading on the left; the
profile drawing and the numbers on the right. Units (m / ft) are per viewer.

- **The hull.** Link the hull's own document (a camber hull, or anything a
  `scene:source` can build, built with its default params, so at its own
  size) or a GLB file. A scene's render of a hull is refused: "link the
  hull itself". With no link, a synthetic hull is fitted to the principal
  dimensions. The hull is floated at the stated displacement, or at its own
  design waterline.
- **The drawing.** Handles drag the mast, rake, I, P, E, BAS, the forestay
  tack, the headsail's clew and the keel's and rudder's corners.
- **The numbers.** Sail plan and ratios, the hull as floated, mass roll-up,
  GM and the righting curve, reef winds, loads, geometric balance (the
  lead, against a secondhand band), and the performance model: the helm
  and speed at a reference point on every change, and a polar from a worker
  once the design has been still. Each row says where it came from, and
  what was estimated is marked "est.".
- **New from…** loads one of four fixture boats (`src/fixtures/`: the
  Catalina 30, the J/24 and the Laser from their published figures, and
  sailing's stock sloop), or a **first guess from this hull** (`src/firstguess.js`): a whole boat by rules of thumb, with P
  solved for SA/D and the mast placed for the middle of the lead band. It
  refuses, with the reason, a hull no mast position balances or that is too
  heavy to rig by the rules.
- **Helpers** (`src/helpers.js`): move the rig for a helm angle or a lead,
  scale it to an SA/D. Each is one change.
- **Export contract JSON** builds and validates the contract below.

## The naval study

Drop or paste hulls (camber hulls, GLB files) and rig designs; read them in
columns with each figure's difference from the baseline. A design alone is
screened on the hull it links (read from the design each time, never
copied); "Pin this version" pins every document a subject reads, or
nothing. Screening runs in the worker.

Every number is a Figure (`src/study/figures.js`): a value with its method,
its source, its provenance (given, measured, estimated) and an envelope
badge. Only the resistance and the VPP's points are graded against a fitted
range (DSYHS, Savitsky); everything else says "not graded". The lead also
shows where it sits on its design band. "What the screen can't tell you"
lists every figure that is unavailable or outside its method's range, and
what no screen here does (waves, STIX, scantlings, mesh convergence).
Export JSON writes the study, the versions read and every figure.

## The contract: patchwork-rig v1

`contract/v1/` is how anything downstream learns about a design:
[specification.md](contract/v1/specification.md) (the authority),
`schema.json`, `types.js`, `validate.js` (both stages), `reference/compose.js`
(§6, the force rules, against the contract alone), an example, and valid
and invalid fixtures with a manifest. The fixtures are built by this
package and checked against a fresh build by `src/contract-fixtures.test.js`
(rewrite with `RIG_WRITE_CONTRACT_FIXTURES=1`).

Sailing reads `extras.rig` off the rig GLB and keeps test copies of
`schema.json`, `validate.js`, `reference/compose.js` and five valid
fixtures (`sailing/src/test/rig-contract/`). No package imports another:
when any of those change here, they are copied again there.

## The Chartroom boundary

Hydrostatics cross between packages as Rising Tide's Chartroom
`hydrostatic-table` v1, and only that:

- A hull whose package registers a `chartroom:source` for its datatype
  (camber does) is floated and read by its own table, once the table
  validates; one whose fingerprint differs from its GLB's is refused
  (`src/link/chartroom-link.js`, `src/link/hull-link.js`). The mesh then gives only what a table has no
  field for (LWL, BWL, Tc, sections, the profile). The provider computes
  that table on the thread that asks, which here is the main thread.
- Any other hull gets a table built from its floated mesh, in the worker
  (`src/naval/statics.js`).

The format's types are copied from Chartroom v0.2.0
(`src/naval/chartroom-types.js`); nothing here depends on Chartroom or on
camber.

## Layout

- `src/naval/` — the analysis, pure: mesh hydrostatics, the floated hull,
  statics tables, stability, foils, sail plan and sail forces, resistance
  (ITTC-57, DSYHS, Savitsky), the VPP, balance, ratios, units. Each module
  states its formulas and cites its sources.
- `src/link/` — getting a hull from another document (see its README).
- `src/study/` — the study: doc, subjects, screen, figures, compare, view.
- `src/` — the Rig doc, tool, drawing, numbers, contract and GLB builders,
  and the worker (`worker.js`, `statics-job.js`, `statics-runner.js`).

## Tests and probes

`pnpm test` runs the unit tests (vitest, happy-dom), which include the
published boats against their sources (`src/validation.test.js`, with its
known gaps stated in `src/fixtures/README.md`) and the contract fixtures.

The probes drive the built package in headless Chrome (`pnpm build` first;
they borrow camber's built plugins from `~/dev/camber` at dev time):

- `node probes/rig-run.mjs` — the Rig tool on a real camber hull.
- `node probes/study-run.mjs` — the study, and the agreement between
  camber's own table and this package's mesh hydrostatics.
- `node probes/publish-examples.mjs --dry-run` — makes the example docs
  (Catalina 30, Laser, a camber hull with a first-guess rig) and checks
  them; without `--dry-run` it publishes them to a sync server.
- `node probes/chrome-guard-check.mjs` — checks that a probe never leaves
  a Chrome behind (`probes/chrome-guard.mjs`).

`PROBE_PORT` and `PROBE_CDP` move `rig-run`'s and `publish-examples`' ports
(4790 / 9790 and 4791 / 9791); `study-run` uses 4830 / 9830.
