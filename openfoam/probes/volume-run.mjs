// Keep a finished case's flow volume through the real sync server, as a
// run's code does after a run, then read some of it back into a fresh peer and
// check it against the files on disk.
//
//   node probes/volume-run.mjs keep --case ~/.patchwork-openfoam/runs/<id> [--sync wss://…]
//   node probes/volume-run.mjs read --url automerge:<volume> --case <same dir> [--fields p,U] [--pieces 0,1]
//
// Each prints one JSON line of timings at the end.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { keepVolume } from "../daemon/volume.mjs";
import { readVolume, volumeBytes, parseFoam } from "../src/volume.js";
import { serverWatch, freshPeer } from "../src/segments.js";
import { findWhenThere } from "../src/task-runs.js";

const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const MB = (n) => +(n / 1048576).toFixed(1);
const t0 = performance.now();
const s = () => +((performance.now() - t0) / 1000).toFixed(2);
const log = (...a) => console.error(`${String(s()).padStart(7)}s`, ...a);
const dir = args.case ? resolve(String(args.case).replace(/^~/, process.env.HOME)) : null;

await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
setTimeout(() => {
  log("TIMEOUT");
  console.log(JSON.stringify({ cmd, ok: false, timeout: true }));
  process.exit(1);
}, Number(args.timeout ?? 1200) * 1000).unref();

if (cmd === "keep") {
  const watch = serverWatch(repo);
  const checker = freshPeer(() => new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] }));
  const v = await keepVolume({
    verify: checker.verify,
    repo,
    dir,
    runUrl: "automerge:volume-probe",
    title: `volume probe · ${dir.split("/").pop()}`,
    watch,
    progress: ({ done, of }) => log(`${MB(done)}/${MB(of)} MB on the server`),
  });
  log(`volume ${v.url}`);
  console.log(JSON.stringify({ cmd, ok: !v.missing.length, ...v, MB: MB(v.bytes), seconds: s(), MBps: +(MB(v.bytes) / s()).toFixed(2) }));
  await repo.shutdown().catch(() => {});
  process.exit(v.missing.length ? 1 : 0);
} else if (cmd === "read") {
  const doc = (await findWhenThere(repo, args.url)).doc();
  const tIndex = s();
  const fields = String(args.fields ?? "p").split(",").filter(Boolean);
  const pieces = args.pieces ? String(args.pieces).split(",").map(Number) : null;
  const want = { mesh: true, fields, pieces };
  log(`volume: ${doc.pieces.length} pieces at time ${doc.time}, ${MB(doc.total)} MB in all; this read is ${MB(volumeBytes(doc, want))} MB`);
  const r = await readVolume(repo, doc, want);
  const tRead = s();
  // byte for byte against the case on disk, and parsed
  let same = true, cells = 0, values = 0;
  for (const [kind, by] of [["mesh", r.mesh], ["fields", r.fields]])
    for (const [name, arr] of Object.entries(by))
      arr.forEach((b, i) => {
        if (b == null) return;
        const where = kind === "mesh" ? join(r.pieces[i], "constant", "polyMesh", name) : join(r.pieces[i], r.time, name);
        if (Buffer.compare(Buffer.from(b), readFileSync(join(dir, where))) !== 0) {
          same = false;
          log(`DIFFERS: ${where}`);
        }
      });
  // cells: one past the highest cell either side of a face names (the last cell can own none)
  r.mesh.owner.forEach((b, i) => {
    if (!b) return;
    let n = 0;
    for (const f of [b, r.mesh.neighbour[i]]) if (f) for (const c of parseFoam(f).values) if (c >= n) n = c + 1;
    cells += n;
  });
  for (const f of fields) r.fields[f].forEach((b) => b && (values += parseFoam(b).values.length));
  log(`${same ? "every file matches the case on disk" : "SOME FILES DIFFER"}; ${cells} cells, ${values} ${fields.join("+")} values`);
  console.log(JSON.stringify({ cmd, ok: same, fields, pieces: pieces ?? "all", MB: MB(volumeBytes(doc, want)), cells, values, seconds: { index: tIndex, read: +(tRead - tIndex).toFixed(2) }, MBps: +(MB(volumeBytes(doc, want)) / (tRead - tIndex)).toFixed(2) }));
  await repo.shutdown().catch(() => {});
  process.exit(same ? 0 : 1);
} else {
  console.error("usage: volume-run.mjs keep --case <dir> | read --url automerge:<volume> --case <dir> [--fields p] [--pieces 0,1]");
  process.exit(2);
}
