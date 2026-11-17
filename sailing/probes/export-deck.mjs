// The stock sloop as walk sees her, for walk's own tests (walk/DESIGN.md,
// "The sloop's static checks without a build-time link"): her doc's objects
// (name, parent, transform, traits) as sloopObjects writes them, and each
// baked object's triangles in its own frame (ship.js partMeshes, as her GLBs
// carry them), float32 as a GLB holds them, base64. Moving parts but the
// swept wheel carry none (walk never bakes them). walk keeps a copy at
// walk/src/test/fixtures/deck-12m.json; scripts/check-fixtures.mjs (repo
// root) compares this export with it.
//
// And `claims`: what she says a right bake of her holds, from her own
// drawing (ship.js), in walk's words only (walk/src/deck-12m.test.js checks
// each), her hull's frame, metres:
//   floors [x, y, z, tol]   a kept cell stands over (x, z) within tol of y
//          [x, y, z, tol, near]   or none within `near` of y does (a fitting may stand there)
//   found   how many of the floors with a `near` must find their cell
//   rises { from, dir, kind, rise: [lo, hi] }   going `dir` ("-x" "+x" "-z" "+z")
//            from the cell at `from`, the first side that isn't level (a STEP
//            under 5 mm) is `kind` ("STEP" | "WALL"), rising lo..hi
//   keeps { add: [[min, max]…], stand, within }   with these boxes added to
//            her triangles, stand spot `stand`'s link moves no more than `within`
//
//   node probes/export-deck.mjs [out.json]     (stdout without an out)

import { writeFileSync } from "node:fs";
import { sloopObjects } from "../src/parts.js";
import { COCKPIT, FIT, deckAt, halfBreadthAt, partMeshes } from "../src/ship.js";
import { cockpitTableBoxes } from "./cockpit-table.js";

const files = new Proxy({}, { get: (_, kind) => ({ url: `kind:${String(kind)}`, hint: null }) });
let n = 0;
const objects = {};
const order = [];
const triangles = {};
for (const [id, o] of sloopObjects({ position: [0, 0, 0], yaw: 0 }, files, (p) => `${p}${++n}`)) {
  const kind = typeof o.sourceUrl === "string" ? o.sourceUrl.slice(5) : null;
  objects[id] = { name: o.name, parent: o.parent ?? null, transform: o.transform, ...(o.traits ? { traits: o.traits } : {}) };
  order.push(id);
  const moves = o.traits?.["walk.moves"];
  if (!kind || (moves && !moves.swept)) continue;
  const out = [];
  for (const mesh of partMeshes(kind))
    for (const p of mesh.primitives) {
      const pos = p.positions;
      const idx = p.indices ?? Array.from({ length: pos.length / 3 }, (_, i) => i);
      for (let t = 0; t + 2 < idx.length; t += 3) for (let k = 0; k < 3; k++) out.push(pos[idx[t + k] * 3], pos[idx[t + k] * 3 + 1], pos[idx[t + k] * 3 + 2]);
    }
  triangles[id] = Buffer.from(Float32Array.from(out).buffer).toString("base64");
}
// ─── claims ───────────────────────────────────────────────────────────────
const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
const named = (name) => Object.keys(objects).find((id) => objects[id].name === name);
const sheetZ = FIT.mainsheet.position[2];
const sole = COCKPIT.floor;
const bench = COCKPIT.floor + 0.36; // ship.js's benches: 0.42 in from the well's sides, aft to z 3.75
/**
 * Where a person stands clear of everything drawn (a body's radius and a
 * cell, 0.3 m, from every edge of a region): plain deck, the sole, the
 * benches. Each on a 20 cm grid.
 */
const M = 0.3;
const floors = [];
const grid = (x0, x1, z0, z1, f) => {
  for (let z = Math.ceil(z0 / 0.2) * 0.2 + 0.0125; z < z1; z += 0.2) for (let x = Math.ceil(x0 / 0.2) * 0.2 + 0.0125; x < x1; x += 0.2) f(r6(x), r6(z));
};
// the sole between the benches (their edges are STEPs: no room needed), but over the traveller (a low rise you step over: `rises`) and the wheel's pedestal
const E = 0.05; // a cell, beside a STEP
grid(-0.38 + E, 0.38 - E, COCKPIT.z0 + M, COCKPIT.z1 - M, (x, z) => {
  if (Math.abs(z - FIT.wheel.position[2]) < M + 0.2) return;
  if (Math.abs(z - sheetZ) < M + 0.05) return;
  floors.push([x, sole, z, 0.002]);
});
// the benches
for (const side of [-1, 1]) grid(side < 0 ? -COCKPIT.half + E : COCKPIT.half - 0.42 + E, side < 0 ? -COCKPIT.half + 0.42 - E : COCKPIT.half - E, COCKPIT.z0 + M, 3.75 - E, (x, z) => floors.push([x, bench, z, 0.002]));
// her plain deck: clear of the cabin, the well and its coamings, the jib's winches, the mast, the windlass and the toe rail
grid(-2, 2, -6, 6, (x, z) => {
  const ax = Math.abs(x);
  if (ax > halfBreadthAt(z) - 0.12 - M) return;
  if (ax < 1.0 + M && z > -1.4 - M && z < 2.05 + M) return;
  if (ax < 0.9 + M && z > COCKPIT.z0 - M && z < COCKPIT.z1 + M) return;
  if (Math.hypot(ax - Math.abs(FIT.winch.position[0]), z - FIT.winch.position[2]) < 0.085 + M) return;
  if (Math.hypot(x - FIT.windlass.position[0], z - FIT.windlass.position[2]) < 0.3 + M) return;
  floors.push([x, r6(deckAt(x, z)), z, 0.02, 0.1]);
});
// her deck is walkable: most of those points have a cell (her chainplates, pulpits, ladder and the like stand on the rest)
const found = Math.ceil(floors.filter((f) => f.length > 4).length * 0.6);
const step = (from, dir, kind, rise) => ({ from, dir, kind, rise });
const rises = [
  // aft of the wheel, the cockpit's sole steps straight up to her deck, to port, to starboard and aft (sailing DESIGN, "The cockpit is a STEP")
  step([0, sole, 4.775], "-x", "STEP", [0.5, 0.58]),
  step([0, sole, 4.775], "+x", "STEP", [0.5, 0.58]),
  step([-0.6, sole, 4.9], "+z", "STEP", [0.5, 0.58]),
  step([0.6, sole, 4.9], "+z", "STEP", [0.5, 0.58]),
  // the traveller across the sole: a STEP you cross (onto its track), not a WALL, from forward and from aft, either side of its block
  ...[-0.2, 0.2].flatMap((x) => [step([x, sole, sheetZ - 0.35], "+z", "STEP", [0.005, 0.1]), step([x, sole, sheetZ + 0.25], "-z", "STEP", [0.005, 0.1])]),
];
// the Card table where the aboard setup puts it, between the benches: the mainsheet's stand spot stays put (within a cell)
const keeps = [{ add: cockpitTableBoxes().map(([lo, hi]) => [lo.map(r6), hi.map(r6)]), stand: named("Mainsheet"), within: 0.051 }];
const claims = { floors, found, rises, keeps };

const json = JSON.stringify({ name: "the stock 12 m sloop (sailing/probes/export-deck.mjs)", objects, order, triangles, claims }, null, 1) + "\n";
if (process.argv[2]) writeFileSync(process.argv[2], json);
else process.stdout.write(json);
