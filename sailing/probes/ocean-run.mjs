// The sea on its own in headless Chrome, for looking at: a low eye (2 m, a
// person on deck) and a high one (30 m, up the mast or a gull), in a moderate
// breeze (5 m/s) and a strong one (12 m/s), looking across the wind and
// toward the sun. Writes screenshots; prints a JSON report.
//
//   node probes/ocean-run.mjs [--shots <dir>] [--port 4651] [--cdp 9651] [--three <three/build dir>]
//
// three.js isn't a dependency of this package (the stage hands extensions
// its own), so the probe borrows one: this package's node_modules if it has
// one, else the scene package's beside it, else --three.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser } from "./ocean-cdp.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const PORT = Number(arg("port", 4651));
const CDP = Number(arg("cdp", 9651));
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "ocean-shots")));
const only = arg("only", null);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const three = [arg("three", null), join(root, "node_modules/three/build"), join(root, "../scene/node_modules/three/build")].find((d) => d && existsSync(join(d, "three.module.js")));
if (!three) throw new Error("no three.js found: pass --three <dir holding three.module.js>");

const SKY = { top: "#4a7fbf", horizon: "#c7d8e6", bottom: "#c7d8e6" };
const SUN = { direction: [0.45, 0.3, -0.84], color: "#fff1dc", intensity: 1.5 };
const FOG = { near: 400, far: 12000 };
// yaw: 0 looks down −Z (north); the sun stands north-east, low
const VIEWS = [
  { name: "low-5", wind: { speed: 5, from: 270 }, eye: [0, 2, 0], yaw: 60, pitch: -4 },
  { name: "low-12", wind: { speed: 12, from: 270 }, eye: [0, 2, 0], yaw: 60, pitch: -4 },
  { name: "high-5", wind: { speed: 5, from: 270 }, eye: [0, 30, 0], yaw: 60, pitch: -18 },
  { name: "high-12", wind: { speed: 12, from: 270 }, eye: [0, 30, 0], yaw: 60, pitch: -18 },
  { name: "sun-12", wind: { speed: 12, from: 270 }, eye: [0, 4, 0], yaw: 28, pitch: -3 },
  { name: "crests-12", wind: { speed: 12, from: 270 }, eye: [0, 3, 0], yaw: 20, pitch: -9 },
  { name: "away-12", wind: { speed: 12, from: 270 }, eye: [0, 4, 0], yaw: 200, pitch: -6 },
  { name: "down-12", wind: { speed: 12, from: 270 }, eye: [0, 30, 0], yaw: 120, pitch: -50 },
].filter((v) => !only || String(only).split(",").includes(v.name));

const b = await browser({ root, mounts: { "/three/": three }, port: PORT, cdp: CDP, page: "/probes/ocean.html" });
const report = { three, shots: [], views: {} };
let code = 0;
try {
  if (!(await b.waitFor("window.__ready"))) throw new Error(`page never ready: ${b.logs.join("\n")}`);
  for (const v of VIEWS) {
    const view = { seed: 7, t: 40, sky: SKY, sun: SUN, fog: { color: SKY.horizon, ...FOG }, ...v };
    const r = await b.js(`window.__render(${JSON.stringify(view)})`);
    report.views[v.name] = r;
    report.shots.push(await b.shot(join(SHOTS, `ocean-${v.name}.png`)));
    if (r.errors.length) code = 1;
  }
} catch (err) {
  report.error = String(err?.stack ?? err);
  code = 1;
}
report.logs = b.logs.filter((l) => !/GPU stall|Automatic fallback/.test(l));
console.log(JSON.stringify(report, null, 2));
b.stop(code);
