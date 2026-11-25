// One analysis through the real runner, gmsh and CalculiX, on an in-memory
// repo (no sync server): what the daemon does for a request, without the
// network. Prints the stages as they go, then the figures.
//
//   node probes/local-run.mjs [--shape plate|beam|block|cylinder] [--analysis static|modal] [--mesh coarse|medium|fine]
//                             [--order 1|2] [--cores N] [--cancel-after-ms N] [--dump run.json]
//
// --dump writes the finished run doc and its results doc (bytes as base64),
// for probes/ui-run.mjs to show without solving again.

import { writeFileSync } from "node:fs";
import { box, plateWithHole, cylinder } from "../src/test/shapes.js";
import { figures } from "../src/results.js";
import { requestStop } from "../src/protocol.js";
import { localRun, faceFacing } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const shape = args.shape ?? "plate";
const analysis = args.analysis ?? "static";
const SHAPES = {
  // a plate pulled along its length, held at one end
  plate: { triangles: () => plateWithHole(0.1, 0.04, 0.005, 0.004, 48), hold: [-1, 0, 0], push: [1, 0, 0], force: [1, 0, 0], newtons: 1000 },
  // a bar held at one end, pushed down at the other
  beam: { triangles: () => box(0.1, 0.01, 0.01), hold: [-1, 0, 0], push: [1, 0, 0], force: [0, -1, 0], newtons: 100 },
  block: { triangles: () => box(0.03, 0.05, 0.02), hold: [0, -1, 0], push: [0, 1, 0], force: [0, -1, 0], newtons: 1200 },
  cylinder: { triangles: () => cylinder(0.01, 0.06, 40), hold: [0, 0, -1], push: [0, 0, 1], force: [1, 0, 0], newtons: 200 },
};
const S = SHAPES[shape];
if (!S) throw new Error(`--shape is one of ${Object.keys(SHAPES).join(", ")}`);

let last = "";
const t0 = Date.now();
const r = await localRun({
  title: shape,
  triangles: S.triangles(),
  cores: args.cores ? Number(args.cores) : null,
  say: (m) => console.error(`  ${m}`),
  setup: (part) => ({
    analysis,
    modes: 6,
    mesh: { size: args.mesh ?? "medium", order: Number(args.order ?? 2) },
    supports: { a: { name: "Held", kind: "fixed", faces: [faceFacing(part, S.hold)] } },
    loads: analysis === "modal" ? {} : { a: { name: "Push", kind: "force", faces: [faceFacing(part, S.push)], magnitude: { value: S.newtons, unit: "N" }, direction: S.force } },
  }),
  onChange(run, handle) {
    const stage = run.stages.find((s) => s.status === "running");
    const line = `${run.status}${stage ? ` · ${stage.label}` : ""}`;
    if (line !== last) console.error(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${(last = line)}`);
    if (args["cancel-after-ms"] && Date.now() - t0 > Number(args["cancel-after-ms"]) && !run.control.cancel) handle.change((d) => requestStop(d));
  },
});
const run = r.run;
console.log(`\n${run.title}: ${run.status}${run.error ? `\n${run.error}` : ""}`);
for (const s of run.stages) console.log(`  ${s.status.padEnd(8)} ${s.label}${s.note ? `: ${s.note}` : ""}`);
for (const f of figures(run)) console.log(`  ${f.group.padEnd(7)} ${f.label.padEnd(24)} ${f.value}`);
for (const n of run.notes ?? []) console.log(`  note: ${n}`);
if (typeof args.dump === "string" && run.status === "done") {
  const b64 = (v) => (v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString("base64") } : Array.isArray(v) ? v.map(b64) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, b64(x)])) : v);
  const layers = {};
  for (const url of Object.values(run.layers)) layers[url] = b64((await r.repo.find(url)).doc());
  writeFileSync(args.dump, JSON.stringify({ run: b64(run), layers }));
  console.log(`dumped to ${args.dump}`);
}
process.exit(run.status === "done" || (args["cancel-after-ms"] && run.status === "cancelled") ? 0 : 1);
