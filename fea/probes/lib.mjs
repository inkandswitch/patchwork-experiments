// What the probes share: one run through the real runner (real gmsh, real
// CalculiX) on an in-memory repo, with no sync server; and the Tasks package
// they use. A probe is not a pool: it has no registry, and imports that
// package's Node build from beside TASKS_HOST, or from ../tasks.

import { mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { readPart } from "../src/part/faces.js";
import { encodePart, decodePart } from "../src/part/kept.js";
import { normalizeSetup, defaultSetup } from "../src/setup.js";
import { newRun, decodeLayer } from "../src/protocol.js";
import { internalize } from "../src/segments.js";
import { findGmsh, findCcx, gmshVersion, ccxVersion, defaultCores } from "../daemon/tools.mjs";
import { runJob } from "../daemon/runner.mjs";

/** The Tasks package's directory, and its client's Node build. */
export const TASKS = process.env.TASKS_HOST ? resolve(dirname(process.env.TASKS_HOST), "..") : fileURLToPath(new URL("../../tasks", import.meta.url));
export const tasksClient = () => import(pathToFileURL(join(TASKS, "dist-node/task-client.mjs")).href);

let repoPromise = null;
export function localRepo() {
  // the subduction build wants this before any Repo, even an offline one
  repoPromise ??= initSubduction().then(() => new Repo({ network: [] }));
  return repoPromise;
}

export function tools() {
  const t = { gmsh: findGmsh(), ccx: findCcx() };
  t.gmshVersion = gmshVersion(t.gmsh);
  t.ccxVersion = ccxVersion(t.ccx);
  return t;
}

/** The face of a part whose outward normal is nearest `direction` (and, of those alike, the one farthest that way). */
export function faceFacing(part, direction) {
  const l = Math.hypot(...direction);
  const d = direction.map((x) => x / l);
  const dot = (a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  return [...part.faces].sort((a, b) => dot(b.normal) - dot(a.normal) || dot(b.centroid) - dot(a.centroid))[0].id;
}

/**
 * @param {object} o
 * @param {Float64Array} [o.triangles]          the part as triangles, or
 * @param {object} [o.kept]                     a part as a study keeps it (src/part/kept.js): run as it is
 * @param {(part: object) => object} o.setup    the part → what differs from the default setup
 * @param {string} [o.title]
 * @param {AbortSignal} [o.signal]              stops it, as a task's signal would (its reason says why)
 * @param {object} [o.tasks]                    the Tasks package's client (its real Node build unless given)
 * @returns {Promise<{ run: object, part: object, layer: object|null, seconds: number, dir: string }>}
 */
export async function localRun({ tasks = null, triangles = null, kept: given = null, setup, title = "probe", work = null, cores = null, maxNodes = 250_000, onChange = null, say = () => {}, signal = null }) {
  const repo = await localRepo();
  tasks ??= await tasksClient();
  const part = given ? decodePart(given) : readPart(triangles);
  const full = normalizeSetup({ ...defaultSetup(), ...setup(part) });
  const kept = given ?? encodePart(part, { url: "automerge:local", title, readAt: Date.now() });
  const handle = await repo.create2(newRun({ studyUrl: "automerge:local", serverUrl: "automerge:local", setup: full, part: kept, now: Date.now(), by: "probe" }));
  if (onChange) handle.on("change", () => onChange(handle.doc(), handle));
  const workDir = work ?? join(tmpdir(), "fea-probe");
  mkdirSync(workDir, { recursive: true });
  const t0 = Date.now();
  await runJob({ repo, handle, tasks, tools: tools(), workDir, cores: cores ?? defaultCores(), maxNodes, daemon: { host: "local" }, say, signal });
  const run = handle.doc();
  let layer = null;
  if (run.layers?.skin) layer = decodeLayer(await internalize(repo, (await repo.find(run.layers.skin)).doc(), { find: tasks.findWhenThere }));
  return { run, part, layer, seconds: (Date.now() - t0) / 1000, dir: join(workDir, handle.url.replace("automerge:", "")), handle, repo };
}
