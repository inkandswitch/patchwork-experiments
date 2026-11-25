// A run through the real sync server: this process plays the study tool (its
// own repo, nothing shared with the daemon but the server), and a fead
// running elsewhere does the work. It does what a person does in the study,
// by the same functions (src/study-model.js): makes a study, links a part (a
// GLB file doc), adds a support and a load, chooses the server and runs.
// Then it watches the run doc come back with stages and results, and reads
// the results from its own repo as a scene would.
//
//   node probes/net-run.mjs --inbox automerge:… [--sync wss://…] [--shape plate|beam] [--mesh coarse|medium|fine|"1 mm"]
//                           [--analysis static|modal] [--cancel-after-ms N] [--timeout s]

import { Repo, initSubduction } from "@automerge/automerge-repo";
import { box, plateWithHole } from "../src/test/shapes.js";
import { encodeGLB } from "../src/glb.js";
import { isTerminal, daemonOnline, decodeLayer } from "../src/protocol.js";
import { internalize } from "../src/segments.js";
import { findWhenThere } from "../src/find.js";
import { figures } from "../src/results.js";
import { decodePart } from "../src/part/kept.js";
import { buildStudyGLB } from "../src/scene-build.js";
import { normalizeSetup, MESH_PRESETS } from "../src/setup.js";
import { parseQuantity } from "../src/units.js";
import * as model from "../src/study-model.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
if (!args.inbox) throw new Error("--inbox automerge:… (what fead printed)");
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const shape = args.shape ?? "plate";
const triangles = shape === "beam" ? box(0.1, 0.01, 0.01) : plateWithHole(0.1, 0.04, 0.005, 0.004, 48);
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out`)), ms))]);
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what}: ${r.error}`);
  return r;
};

await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const inbox = await within(60_000, repo.find(args.inbox), "loading the inbox");
const sv = inbox.doc();
console.log(`${at()} inbox "${sv.title}", daemon ${daemonOnline(sv, Date.now()) ? "online" : "OFFLINE"} on ${sv.daemon?.host} (CalculiX ${sv.daemon?.calculix}, gmsh ${sv.daemon?.gmsh}, ${sv.daemon?.cores} cores)`);

// as the tool does it
const file = await repo.create2({ "@patchwork": { type: "file" }, name: `${shape}.glb`, extension: "glb", mimeType: "model/gltf-binary", content: encodeGLB({ meshes: [{ name: shape, primitives: [{ positions: Float32Array.from(triangles) }] }] }) });
const study = await repo.create2(model.newStudy());
const ctx = { repo, handle: study, by: "net probe" };
const linked = must(await model.linkPart(ctx, file.url), "linking the part");
const part = linked.part;
const facing = (d) => [...part.faces].sort((a, b) => b.normal[0] * d - a.normal[0] * d)[0].id;
console.log(`${at()} part "${study.doc().part.title}": ${part.faces.length} faces, ${part.solid ? "solid" : "NOT solid"}`);
must(model.setAnalysis(ctx, args.analysis ?? "static"), "the analysis");
const size = args.mesh ?? "medium";
must(model.setMesh(ctx, { size: MESH_PRESETS.includes(size) ? size : parseQuantity(size, "length") }), "the mesh");
must(model.addSupport(ctx, part, { kind: "fixed", name: "Held end", faces: [facing(-1)] }), "the support");
if ((args.analysis ?? "static") === "static") must(model.addLoad(ctx, part, { kind: "force", name: "Pull", faces: [facing(1)], magnitude: { value: 1, unit: "kN" }, direction: [1, 0, 0] }), "the load");
must(await model.setServer(ctx, args.inbox), "the server");
const started = must(await model.runStudy(ctx), "running");
const run = await repo.find(started.url);
console.log(`${at()} filed ${run.url}`);

let last = "", asked = false;
const done = new Promise((resolveDone) => {
  const on = () => {
    const d = run.doc();
    const stage = d.stages.find((s) => s.status === "running")?.label ?? "";
    const line = `${d.status} ${stage}`;
    if (line !== last) console.log(`${at()} ${d.status.padEnd(9)} ${(last = line) && stage}`);
    if (args["cancel-after-ms"] && !asked && d.status !== "queued" && Date.now() - t0 > Number(args["cancel-after-ms"])) {
      asked = true;
      model.stopRun(ctx, run.url).then(() => console.log(`${at()} asked to cancel`));
    }
    if (isTerminal(d.status) && (d.status !== "done" || d.summary)) resolveDone(d.status);
  };
  run.on("change", on);
  on();
});
const status = await within(Number(args.timeout ?? 600) * 1000, done, "waiting for the run");
const d = run.doc();
console.log(`\n${at()} ${status}${d.error ? `: ${d.error}` : ""}`);
for (const s of d.stages) console.log(`  ${s.status.padEnd(8)} ${s.label}${s.note ? `: ${s.note}` : ""}`);
for (const f of figures(d)) console.log(`  ${f.group.padEnd(7)} ${f.label.padEnd(24)} ${f.value}`);
for (const n of d.notes ?? []) console.log(`  note: ${n}`);
let ok = status === "done" || (!!args["cancel-after-ms"] && status === "cancelled");
if (status === "done") {
  // what a scene does with it: the results, from this peer's own repo, built into a GLB
  const layer = decodeLayer(await internalize(repo, (await findWhenThere(repo, d.layers.skin)).doc()));
  const built = buildStudyGLB({ layer, part: decodePart(await internalize(repo, d.part)), setup: normalizeSetup(d.setup), params: { show: "auto", deform: "auto", marks: true } });
  console.log(`  results: ${layer.positions.length / 3} points, fields ${Object.keys(layer.fields).join(", ")}; as a GLB ${built.glb.byteLength.toLocaleString("en")} bytes (${built.meta.notes})`);
  ok &&= layer.positions.length > 0 && built.glb.byteLength > 1000;
}
const sv2 = inbox.doc();
console.log(`inbox: handled ${JSON.stringify(sv2.handled?.[run.url.replace("automerge:", "")])}, active ${JSON.stringify(sv2.active)}`);
console.log(`study ${study.url}\nrun   ${run.url}`);
await repo.flush?.();
process.exit(ok ? 0 : 1);
