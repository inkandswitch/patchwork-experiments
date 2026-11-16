// Run one analysis through the real runner and real OpenFOAM, on an
// in-memory repo (no sync server): what the daemon does for a request,
// without the network. Prints the run doc's progress as it changes, then
// the summary and the layers.
//
//   node probes/local-run.mjs [--glb path] [--mode double-body|free-surface] [--mesh coarse|medium|fine]
//                             [--iterations N] [--knots 6] [--cores N] [--finish-after N] [--cancel-after N]
//                             [--sinkage m] [--trim deg] [--work dir] [--json out.json] [--dump run.json] [--keep-volume]
//                             [--stop settled|iterations] [--warm automerge:<a run whose case is in --work>]
//
// --dump writes the finished run doc and its layer docs (bytes as base64), for
// probes/ui-run.mjs to show without running OpenFOAM again.
//
// --finish-after N asks for "finish now" once the solver passes iteration N;
// --cancel-after N cancels then. Default hull: naval's camber fixture
// narrow-transom.glb (a 12 m sloop hull, open transom).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { glbTriangles } from "../src/hull/mesh-read.js";
import { prepareHull } from "../src/hull/prepare.js";
import { defaultSetup, normalizeSetup, KNOT, DEFAULT_ITERATIONS } from "../src/setup.js";
import { newRun, requestStop, unpackChunks, decodeLayer } from "../src/protocol.js";
import { internalize } from "../src/segments.js";
import { foamEnvironment, defaultCores } from "../daemon/foam.mjs";
import { runJob } from "../daemon/runner.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const glb = resolve(args.glb ?? join(HERE, "../../naval/src/test/fixtures/camber/narrow-transom.glb"));
const mode = args.mode ?? "double-body";
const mesh = args.mesh ?? "coarse";
const setup = normalizeSetup({
  ...defaultSetup(),
  mode,
  mesh,
  speed: Number(args.knots ?? 6) * KNOT,
  iterations: Number(args.iterations ?? DEFAULT_ITERATIONS[mode][mesh]),
  attitude: { sinkage: Number(args.sinkage ?? 0), trim: Number(args.trim ?? 0), heel: Number(args.heel ?? 0) },
  cores: Number(args.cores ?? 0),
  stop: args.stop ?? "settled",
  ...(args.warm ? { warmStart: args.warm } : {}),
  keepVolume: !!args["keep-volume"],
});
const { triangles } = glbTriangles(readFileSync(glb));
const prep = prepareHull(triangles, setup.attitude);
console.log("hull", { loa: prep.info.loa.toFixed(2), lwl: prep.info.lwl.toFixed(2), S: prep.info.wettedArea.toFixed(2), V: prep.info.volume.toFixed(3), symmetric: prep.info.symmetric }, prep.warnings);

await initSubduction(); // the subduction build wants this before any Repo, even an offline one
const repo = new Repo({ network: [] });
const handle = repo.create2(
  newRun({
    caseUrl: "automerge:local",
    serverUrl: "automerge:local",
    setup,
    hull: { stl: prep.stl, info: prep.info, source: { title: glb.split("/").pop() }, warnings: prep.warnings },
    now: Date.now(),
    by: "probe",
  }),
);
const h = await handle;
let lastLine = "";
const t0 = Date.now();
let asked = false;
h.on("change", () => {
  const d = h.doc();
  const running = d.stages.find((s) => s.status === "running");
  const line = `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${d.status.padEnd(9)} ${running?.id ?? ""} it ${d.progress.iteration}/${d.progress.of}`;
  if (line !== lastLine) console.log(line);
  lastLine = line;
  const at = Number(args["finish-after"] ?? args["cancel-after"]);
  if (!asked && Number.isFinite(at) && d.progress.iteration >= at) {
    asked = true;
    h.change((x) => requestStop(x, { keep: !!args["finish-after"] }));
    console.log(`asked to ${args["finish-after"] ? "finish now" : "cancel"} at iteration ${d.progress.iteration}`);
  }
});
const work = resolve(args.work ?? join(tmpdir(), "foamd-probe"));
mkdirSync(work, { recursive: true });
const env = foamEnvironment({});
const status = await runJob({ repo, handle: h, env, workDir: work, cores: defaultCores(), daemon: { id: "probe", host: "local" }, say: (m) => console.log("  ·", m) });
const d = h.doc();
console.log("\nstatus", status, d.error ?? "");
for (const s of d.stages) console.log(`  ${s.status.padEnd(8)} ${s.id.padEnd(22)} ${s.startedAt && s.endedAt ? `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : ""}  ${s.note ?? ""}`);
console.log("mesh", d.mesh);
const forces = unpackChunks(d.progress.forces);
const res = unpackChunks(d.progress.residuals);
console.log(`progress: ${forces.rows.length} force rows in ${d.progress.forces.length} chunks; ${res.rows.length} residual rows, cols ${res.cols.join(",")}`);
if (d.summary) {
  const s = d.summary;
  console.log("summary", {
    Rt: s.Rt.toFixed(1), RtStd: s.RtStd.toFixed(2), Rp: s.Rp.toFixed(1), Rv: s.Rv.toFixed(1), Fz: s.Fz.toFixed(0),
    Ct: s.Ct.toExponential(3), Cf0: s.Cf0.toExponential(3), Cv: s.Cv.toExponential(3), formFactor: s.formFactor?.toFixed(3), Cr: s.Cr?.toExponential(3),
    Re: s.Re.toExponential(3), Fn: s.Fn.toFixed(3), yPlus: s.yPlus, iterations: s.iterations, power: (s.power / 1000).toFixed(2) + " kW",
  });
  for (const [name, url] of Object.entries(d.layers)) {
    const L = decodeLayer(await internalize(repo, (await repo.find(url)).doc()));
    const sizes = Object.entries(L.fields).map(([k, v]) => `${k}[${L.ranges[k]?.map((x) => x.toPrecision(3)).join("…")}]`);
    console.log(`  layer ${name.padEnd(12)} ${L.kind} ${L.positions.length / 3} pts ${L.indices ? L.indices.length / 3 + " tris" : L.counts.length + " lines"} ${sizes.join(" ")}`);
  }
}
if (d.volume) {
  // the kept volume, read back: the mesh and pressure, parsed, against checkMesh's cell count
  const { readVolume, parseFoam } = await import("../src/volume.js");
  const vd = (await repo.find(d.volume.url)).doc();
  const r = await readVolume(repo, vd, { mesh: ["owner", "neighbour"], fields: ["p"], find: (rp, u) => rp.find(u) });
  let cells = 0, ps = 0;
  r.mesh.owner.forEach((b, i) => {
    let n = 0;
    for (const f of [b, r.mesh.neighbour[i]]) if (f) for (const c of parseFoam(f).values) if (c >= n) n = c + 1;
    cells += n;
    ps += parseFoam(r.fields.p[i]).values.length;
  });
  console.log(`volume ${d.volume.status}: ${(d.volume.bytes / 1048576).toFixed(1)} MB, ${d.volume.files} files in ${d.volume.docs} docs, ${vd.pieces.length} pieces at ${vd.time}; read back ${cells} cells, ${ps} p values (checkMesh: ${d.mesh?.cells})`);
}
if (args.dump) {
  const plain = (v) => {
    if (ArrayBuffer.isView(v)) return { $bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64") };
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    return v;
  };
  const layers = {};
  for (const [name, url] of Object.entries(d.layers ?? {})) layers[url] = plain((await repo.find(url)).doc());
  writeFileSync(args.dump, JSON.stringify({ run: plain(d), layers }));
  console.log(`dumped to ${args.dump}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify({ status, summary: d.summary, mesh: d.mesh, stages: d.stages }, null, 2));
process.exit(status === "done" ? 0 : 1);
