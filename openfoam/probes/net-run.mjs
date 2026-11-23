// A run through the real sync server: this process plays the case tool (its
// own repo, nothing shared with the daemon but the server), and a foamd
// running elsewhere does the work. It makes a run doc as the tool does,
// files it in the daemon's inbox, then watches the run doc arrive back with
// progress and results, and reads every layer from its own repo.
//
//   node probes/net-run.mjs --inbox automerge:… [--sync wss://…] [--knots 6] [--mode double-body] [--glb path]
//                           [--cancel-after N] [--finish-after N] [--iterations N] [--timeout s] [--dump run.json]
//                           [--sinkage m] [--trim deg] [--stop settled|iterations] [--warm automerge:<run>]

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { glbTriangles } from "../src/hull/mesh-read.js";
import { prepareHull } from "../src/hull/prepare.js";
import { defaultSetup, normalizeSetup, DEFAULT_ITERATIONS } from "../src/setup.js";
import { newRun, enqueue, requestStop, unpackChunks, decodeLayer, isTerminal, daemonOnline } from "../src/protocol.js";
import { internalize } from "../src/segments.js";
import { findWhenThere } from "../src/find.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
if (!args.inbox) throw new Error("--inbox automerge:… (what foamd printed)");
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const glb = resolve(args.glb ?? join(HERE, "../../naval/src/test/fixtures/camber/narrow-transom.glb"));
const mode = args.mode ?? "double-body";
const setup = normalizeSetup({
  ...defaultSetup(),
  mode,
  speed: { value: Number(args.knots ?? 6), unit: "kn" },
  iterations: Number(args.iterations ?? DEFAULT_ITERATIONS[mode].coarse),
  attitude: { sinkage: Number(args.sinkage ?? 0), trim: Number(args.trim ?? 0), heel: Number(args.heel ?? 0) },
  stop: args.stop ?? "settled",
  ...(args.warm ? { warmStart: args.warm } : {}),
});
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out`)), ms))]);

await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const inbox = await within(60_000, repo.find(args.inbox), "loading the inbox");
const sv = inbox.doc();
console.log(`${at()} inbox "${sv.title}", daemon ${daemonOnline(sv, Date.now()) ? "online" : "OFFLINE"} on ${sv.daemon?.host} (OpenFOAM ${sv.daemon?.openfoam}, ${sv.daemon?.cores} cores)`);

const { triangles } = glbTriangles(readFileSync(glb));
const prep = prepareHull(triangles, setup.attitude);
const run = await repo.create2(newRun({ caseUrl: "automerge:net-probe", serverUrl: args.inbox, setup, hull: { stl: prep.stl, info: prep.info, warnings: prep.warnings, source: { title: glb.split("/").pop() } }, by: "net probe", now: Date.now() }));
inbox.change((d) => enqueue(d, run.url, { now: Date.now(), by: "net probe" }));
console.log(`${at()} filed ${run.url}`);

const seen = [];
let asked = false;
const done = new Promise((resolveDone) => {
  const on = () => {
    const d = run.doc();
    const stage = d.stages.find((s) => s.status === "running")?.id ?? "";
    const line = `${d.status} ${stage} ${d.progress.iteration}`;
    if (seen[seen.length - 1]?.line !== line) {
      seen.push({ t: Date.now() - t0, line });
      console.log(`${at()} ${d.status.padEnd(9)} ${stage.padEnd(20)} it ${d.progress.iteration}/${d.progress.of}  (${d.progress.forces.length} force chunks)`);
    }
    const n = Number(args["finish-after"] ?? args["cancel-after"]);
    if (!asked && Number.isFinite(n) && d.progress.iteration >= n) {
      asked = true;
      run.change((x) => requestStop(x, { keep: !!args["finish-after"] }));
      console.log(`${at()} asked to ${args["finish-after"] ? "finish now" : "cancel"}`);
    }
    if (isTerminal(d.status) && (d.status !== "done" || d.summary)) resolveDone(d.status);
  };
  run.on("change", on);
  on();
});
const status = await within(Number(args.timeout ?? 1800) * 1000, done, "waiting for the run");
const d = run.doc();
console.log(`\n${at()} ${status}${d.error ? `: ${d.error}` : ""}`);
if (d.summary) console.log(`Rt ${d.summary.Rt.toFixed(1)} N, Rp ${d.summary.Rp.toFixed(1)}, Rv ${d.summary.Rv.toFixed(1)}, Fz ${d.summary.Fz.toFixed(0)}, My ${d.summary.My?.toFixed(0)}, ${d.summary.iterations} iterations (stopped by ${d.summary.stoppedBy}${d.summary.settledNote ? `: ${d.summary.settledNote}` : ""}), ${unpackChunks(d.progress.forces).rows.length} force rows synced`);
console.log(`run ${run.url}`);
for (const [name, url] of Object.entries(d.layers ?? {})) {
  const L = decodeLayer(await internalize(repo, (await findWhenThere(repo, url)).doc()));
  console.log(`  layer ${name.padEnd(12)} ${L.positions.length / 3} points, fields ${Object.keys(L.fields).join(",")}`);
}
if (args.dump) {
  const plain = (v) => {
    if (ArrayBuffer.isView(v)) return { $bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64") };
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    return v;
  };
  const layers = {};
  for (const url of Object.values(d.layers ?? {})) layers[url] = plain((await findWhenThere(repo, url)).doc());
  writeFileSync(args.dump, JSON.stringify({ run: plain(d), layers }));
  console.log(`dumped to ${args.dump}`);
}
const sv2 = inbox.doc();
console.log(`inbox: handled ${JSON.stringify(sv2.handled[run.url.replace("automerge:", "")])}, active ${JSON.stringify(sv2.active)}`);
await repo.flush?.();
process.exit(status === "done" || (args["cancel-after"] && status === "cancelled") ? 0 : 1);
