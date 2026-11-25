// Does a better start make a free-surface run settle sooner? Runs the arms
// through a live OpenFOAM host (its task queue), one after another, each to the settled
// rule (src/convergence.js) with a ceiling, and reports when each settled.
//
//   node probes/converge-experiment.mjs --queue automerge:… [--out dir] [--knots 6] [--source-knots 5.5]
//                                       [--ceiling 5000] [--glb path] [--only cold,warm,…]
//
// Arms (free surface, coarse, the same hull):
//   source    at --source-knots, cold: the warm start's source
//   cold      at --knots, from rest, at the hull's drawn attitude
//   attitude  at --knots, from rest, at the running attitude a double body
//             predicts (src/attitude.js); a different hull position, so a
//             different answer: compare how soon it settles, not the drag
//   warm      at --knots, started from the source's solution (same machine)
// plus one double body at --knots, for the attitude.
//
// Each run is dumped (--out) as it finishes, so a stopped experiment keeps
// what it had; rerun with --only to finish the rest. Iteration counts don't
// depend on how busy the machine is; wall-clock does.
//
// It takes hours on a laptop (about 45 min an arm on an M4, 8 cores): run
// it plugged in, or on a server (several runs at once gain nothing here: the
// arms go one at a time because the warm arm needs the source finished).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unpackChunks } from "../src/protocol.js";
import { settled, settledAt } from "../src/convergence.js";
import { runningAttitude } from "../src/attitude.js";
import { formatSpeed } from "../src/setup.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
if (!args.queue) throw new Error("--queue automerge:… (one a running OpenFOAM host serves)");
const OUT = resolve(args.out ?? "converge-experiment");
mkdirSync(OUT, { recursive: true });
const KN = Number(args.knots ?? 6);
const SRC_KN = Number(args["source-knots"] ?? 5.5);
const CEIL = Number(args.ceiling ?? 5000);
const only = args.only ? new Set(String(args.only).split(",")) : null;
const want = (arm) => !only || only.has(arm);

if (process.platform === "darwin") {
  try {
    if (/Battery Power/.test(execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" }))) console.warn("on battery: this takes hours of every core; plug in");
  } catch {}
}

const b64 = (v) =>
  v && typeof v === "object" && typeof v.$bytes === "string"
    ? Uint8Array.from(Buffer.from(v.$bytes, "base64"))
    : Array.isArray(v)
      ? v.map(b64)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, b64(x)]))
        : v;
const load = (arm) => (existsSync(join(OUT, `${arm}.json`)) ? b64(JSON.parse(readFileSync(join(OUT, `${arm}.json`), "utf8")).run) : null);
const runUrl = (arm) => (existsSync(join(OUT, `${arm}.url`)) ? readFileSync(join(OUT, `${arm}.url`), "utf8").trim() : null);

/** An arm's run: its dump if it has one and wasn't asked for again (--only), else run it now. */
function run(arm, extra) {
  if (load(arm) && !(only && only.has(arm))) return load(arm);
  const t0 = Date.now();
  console.log(`\n=== ${arm}: ${extra.join(" ")}`);
  const r = spawnSync(process.execPath, [join(HERE, "net-run.mjs"), "--queue", args.queue, "--dump", join(OUT, `${arm}.json`), "--timeout", String(6 * 3600), ...(args.glb ? ["--glb", args.glb] : []), ...extra], { encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  writeFileSync(join(OUT, `${arm}.log`), out);
  const url = out.match(/^run (automerge:\S+)/m)?.[1];
  if (url) writeFileSync(join(OUT, `${arm}.url`), url);
  console.log(out.split("\n").filter((l) => /^ *\d+\.\ds (done|failed|cancelled)$|^Rt |^run /.test(l)).join("\n"));
  console.log(`(${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  return load(arm);
}

const fs = (kn, more = []) => ["--mode", "free-surface", "--knots", String(kn), "--iterations", String(CEIL), "--stop", "settled", ...more];
const source = want("warm") || want("source") ? run("source", fs(SRC_KN)) : null;
const cold = want("cold") ? run("cold", fs(KN)) : load("cold");
let attitudeArm = null;
if (want("attitude")) {
  const db = run("double-body", ["--mode", "double-body", "--knots", String(KN)]);
  const a = db && runningAttitude(db.summary, db.hull?.info, db.setup);
  if (a) {
    console.log(`running attitude from the double body: sinkage ${(a.sinkage * 1000).toFixed(0)} mm, trim ${a.trimDeg.toFixed(2)}° → hull inputs ${JSON.stringify(a.attitude)}`);
    attitudeArm = run("attitude", fs(KN, ["--sinkage", String(a.attitude.sinkage), "--trim", String(a.attitude.trim)]));
  } else console.log("no attitude from the double body (no waterplane in its hull info?)");
}
const warm = want("warm") && runUrl("source") ? run("warm", fs(KN, ["--warm", runUrl("source")])) : null;

// ---------------------------------------------------------------- report
const rows = [];
for (const [arm, r] of Object.entries({ source, cold, attitude: attitudeArm, warm })) {
  if (!r?.progress) continue;
  const t = unpackChunks(r.progress.forces);
  const Rt = t.rows.map((x) => x[t.cols.indexOf("Rt")]);
  const at = settledAt(Rt);
  const wall = r.finishedAt && r.startedAt ? (r.finishedAt - r.startedAt) / 60000 : NaN;
  rows.push({ arm, speed: formatSpeed(r.setup.speed), iterations: Rt.length, settledAt: at, stoppedBy: r.summary?.stoppedBy, Rt: +r.summary?.Rt?.toFixed(1), now: settled(Rt).why, minutes: +wall.toFixed(1) });
}
console.table(rows);
writeFileSync(join(OUT, "report.json"), JSON.stringify(rows, null, 2));
console.log(`\nreport: ${join(OUT, "report.json")}`);
