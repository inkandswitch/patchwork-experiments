// The stock sloop as walk sees her, for walk's own tests (walk/DESIGN.md,
// "The sloop's static checks without a build-time link"): her doc's objects
// (name, parent, transform, traits) as sloopObjects writes them, and each
// baked object's triangles in its own frame (ship.js partMeshes, as her GLBs
// carry them), float32 as a GLB holds them, base64. Moving parts but the
// swept wheel carry none (walk never bakes them). walk keeps a copy at
// walk/src/test/fixtures/deck-12m.json; scripts/check-fixtures.mjs (repo
// root) compares this export with it.
//
//   node probes/export-deck.mjs [out.json]     (stdout without an out)

import { writeFileSync } from "node:fs";
import { sloopObjects } from "../src/parts.js";
import { partMeshes } from "../src/ship.js";

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
const json = JSON.stringify({ name: "the stock 12 m sloop (sailing/probes/export-deck.mjs)", objects, order, triangles }, null, 1) + "\n";
if (process.argv[2]) writeFileSync(process.argv[2], json);
else process.stdout.write(json);
