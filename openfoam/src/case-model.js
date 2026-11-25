// The case as a model, without a page: reading its hull, floating it, and
// asking for runs. The case tool's buttons and the agent's tools
// (src/agent-tools.js) both call these, so a person and an agent can't
// disagree about what "Float at" or "Run" does.
//
// Needs a repo (find / create2) and, to read a hull from its original model
// rather than the copy kept with the case, the host's plugin registry
// (src/hull/acquire.js). No DOM.

import { normalizeSetup, waterProperties, metresPerSecond, froude, reynolds, frictionEstimate, waveLength, domainForHull, estimateCells, estimateSeconds } from "./setup.js";
import { newRun, RUN_CODE } from "./protocol.js";
import { askRun, isQueue, codeUrl, findWhenThere } from "./task-runs.js";
import { acquireHull } from "./hull/acquire.js";
import { prepareHull, sinkageForVolume, weld, edgeStats, boundsOf } from "./hull/prepare.js";
import { partsOf, waterPlanes, defaultParts, hullTriangles } from "./hull/parts.js";
import { makeStash, fromStash, stashCovers } from "./hull/stash.js";
import { putBytes, externalize, internalize, isRef, SEGMENT_BYTES } from "./segments.js";
import { geometryDigest } from "./inputs.js";

// ---------------------------------------------------------------- the hull

/**
 * The model a case's hull link names, as read: from the copy kept with the
 * case when it holds the parts wanted, else from the original.
 * @param {object} hullField  the case's `hull`: { url, stash?, parts?, bow? }
 * @param {{ fromSource?: boolean, getRegistry?: Function }} [o]  fromSource: skip the kept copy (Re-read)
 * @returns {Promise<object>}  acquireHull()'s result ({ ok, triangles, ranges, parts?, path, title, … } or { ok: false, error }),
 *   with `stashUrl` when it came from the kept copy
 */
export async function readHull(repo, hullField, { fromSource = false, getRegistry } = {}) {
  const url = hullField?.url ?? null;
  if (!url) return { ok: false, error: "no hull linked" };
  if (hullField.stash && !fromSource) {
    let r = null;
    try {
      r = fromStash(await internalize(repo, (await findWhenThere(repo, hullField.stash, { tries: 4 })).doc()));
    } catch {
      r = null;
    }
    if (r && stashCovers(r.kept, wantedParts(r, hullField))) return Object.assign(r, { stashUrl: hullField.stash });
  }
  return acquireHull(repo, url, { getRegistry }).catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
}

/** The parts the case wants from a model as read: its choice, else the default. */
export function wantedParts(result, hullField) {
  const chosen = hullField?.parts;
  if (Array.isArray(chosen)) return chosen;
  const parts = result.parts ?? partsOf(result.triangles, result.ranges ?? []);
  const water = waterPlanes(parts)[0] ?? null;
  return defaultParts(parts, water ? water.min[2] : 0);
}

const partsCache = new WeakMap();

/**
 * The model as read, and what of it is the hull: its parts (a GLB's named
 * meshes: a Rhino file's layers), the ones chosen (the case's, else those
 * reaching the waterline), the water plane if it draws one (its z is the
 * waterline), and which way its bow points.
 * @returns {{ ranges: object[], parts: object[], water: object|null, names: string[], frame: { bow: "+x"|"-x", waterZ: number } }}
 */
export function hullModel(result, hullField) {
  const r = result;
  const ranges = r?.ranges?.length ? r.ranges : [{ name: "hull", from: 0, to: (r?.triangles?.length ?? 0) / 9 }];
  let parts = r?.parts ?? (r ? partsCache.get(r) : null);
  if (!parts) {
    parts = r ? partsOf(r.triangles, ranges) : [];
    if (r) partsCache.set(r, parts);
  }
  const water = waterPlanes(parts)[0] ?? null;
  const waterZ = water ? water.min[2] : 0;
  const chosen = hullField?.parts;
  const names = Array.isArray(chosen) ? chosen.filter((n) => parts.some((p) => p.name === n)) : defaultParts(parts, waterZ);
  const bow = hullField?.bow === "-x" ? "-x" : "+x";
  return { ranges, parts, water, names, frame: { bow, waterZ } };
}

/** The chosen parts' triangles in the analysis frame (bow to +x, waterline at z = 0), not yet floated. */
export const modelTriangles = (result, model) => hullTriangles(result.triangles, model.ranges, model.names, model.frame);

/**
 * The hull floated at an attitude, measured and closed, ready to run.
 * @returns {{ mesh, stl, info, warnings, model }}  throws when no part is chosen
 */
export function prepareModel(result, model, attitude) {
  if (!model.names.length) throw new Error("no parts chosen for the hull");
  return { ...prepareHull(modelTriangles(result, model), attitude), model };
}

/** Parts bigger than this aren't checked for being closed (it costs a weld). */
export const SHELL_CHECK_MAX = 300_000;
const shellCache = new WeakMap();

/**
 * Whether each part whose triangles the model holds is a closed shell:
 * { name → { closed, openEdges } }, or { checked: false, why } for a part too
 * big to check or not held (a kept copy holds only the chosen parts).
 */
export function partShells(result, model) {
  let cache = shellCache.get(result);
  if (!cache) shellCache.set(result, (cache = new Map()));
  const out = {};
  for (const p of model.parts) {
    if (cache.has(p.name)) {
      out[p.name] = cache.get(p.name);
      continue;
    }
    const held = model.ranges.filter((r) => r.name === p.name);
    const n = held.reduce((a, r) => a + r.to - r.from, 0);
    let v;
    if (!n) v = { checked: false, why: "not held here (only the chosen parts are kept with the case): re-read the model to check it" };
    else if (n > SHELL_CHECK_MAX) v = { checked: false, why: `${n.toLocaleString("en")} triangles: too many to check here` };
    else {
      const tris = hullTriangles(result.triangles, model.ranges, [p.name], { bow: "+x", waterZ: 0 });
      const b = boundsOf(tris);
      const diag = Math.hypot(...b.max.map((x, k) => x - b.min[k]));
      const stats = edgeStats(weld(tris, Math.max(1e-9, 1e-6 * diag)));
      v = { checked: true, closed: stats.boundary === 0, openEdges: stats.boundary };
    }
    cache.set(p.name, v);
    out[p.name] = v;
  }
  return out;
}

/** Unknown part names in a list, against a model's parts. */
export function unknownParts(model, names) {
  const have = new Set(model.parts.map((p) => p.name));
  return names.filter((n) => !have.has(n));
}

// ---------------------------------------------------------------- floating

/**
 * How sinkage is measured, in words a person or an agent can quote.
 * `pivotX`: prepareHull's info.attitude.pivotX.
 */
export function sinkageMeaning(pivotX) {
  return `sinkage is how far the hull is lowered from as drawn (waterline at the model's z = 0, or its water plane), measured at x = ${pivotX.toFixed(3)} m (half-way along the chosen parts' length, bow to +x) after trimming about that point; it is where the hull floats, not a change from the last sinkage`;
}

/**
 * The sinkage that floats the hull at a mass, at a given trim and heel (the
 * trim and heel are part of the answer: change either and the sinkage
 * changes). null when the whole hull displaces less than that.
 * @param {{ mass: number, water: string, temperature: number, trim: number, heel: number }} o  mass in kg
 * @returns {{ sinkage: number, volume: number, rho: number } | null}
 */
export function floatAt(result, model, { mass, water, temperature, trim = 0, heel = 0 }) {
  if (!(mass > 0)) throw new Error(`a mass to float at must be more than zero (got ${mass})`);
  const { rho } = waterProperties(water, temperature);
  const sink = sinkageForVolume(modelTriangles(result, model), mass / rho, { trim, heel });
  return sink == null ? null : { sinkage: +sink.toFixed(4), volume: mass / rho, rho };
}

/** The sinkage that keeps a heeled hull's upright displacement (at this sinkage and trim). null when it can't. */
export function keepDisplacement(result, model, attitude) {
  const tris = modelTriangles(result, model);
  const upright = prepareHull(tris, { ...attitude, heel: 0 }).info.volume;
  const sink = sinkageForVolume(tris, upright, { trim: attitude.trim, heel: attitude.heel });
  return sink == null ? null : +sink.toFixed(4);
}

const MASS_UNITS = Object.freeze({ kg: 1, t: 1000 });
const MASS_WORDS = Object.freeze({ kg: "kg", kilogram: "kg", kilograms: "kg", t: "t", tonne: "t", tonnes: "t" });

/**
 * A mass from what a person or a tool wrote: { value, unit } or text such as
 * "11984 kg" or "11.98 t". A bare number is refused: kilograms or tonnes?
 * @returns {number}  kg
 */
export function parseMass(input) {
  let value, unit;
  if (typeof input === "string") {
    const m = input.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]+)$/i);
    unit = m ? MASS_WORDS[m[2].toLowerCase()] : null;
    if (!unit) throw new Error(`mass ${JSON.stringify(input)}: give a number and its unit, e.g. "11984 kg" or "11.98 t"`);
    value = Number(m[1]);
  } else if (input && typeof input === "object") {
    unit = MASS_WORDS[String(input.unit ?? "").toLowerCase()];
    if (!unit) throw new Error(`mass ${JSON.stringify(input)}: its unit must be kg or t`);
    value = Number(input.value);
  } else throw new Error(`mass ${JSON.stringify(input)}: give a number with its unit, e.g. "11984 kg" — a bare number has no unit`);
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`mass ${JSON.stringify(input)}: must be more than zero`);
  return value * MASS_UNITS[unit];
}

/** Write an attitude into a case doc's setup (inside a change), only the fields given. */
export function writeAttitude(doc, attitude) {
  if (!doc.setup) doc.setup = normalizeSetup(null);
  if (!doc.setup.attitude) doc.setup.attitude = { sinkage: 0, trim: 0, heel: 0 };
  for (const k of ["sinkage", "trim", "heel"]) if (Number.isFinite(attitude[k])) doc.setup.attitude[k] = attitude[k];
}

// ---------------------------------------------------------------- what a run will cost

/** Bytes a cell of kept flow volume takes: measured on double-body runs, 200 B/cell (154k cells) to 210 (1.08M). */
export const VOLUME_BYTES_PER_CELL = 205;

/**
 * What to expect of a run of this setup on this hull, before it's asked for:
 * the flow's numbers, the friction floor, the domain, cells and time.
 * Without cores in the setup, a run gets what its machine gives it; the
 * estimate assumes 8.
 */
export function preflight(setupIn, info) {
  const s = normalizeSetup(setupIn);
  const { rho, nu, source } = waterProperties(s.water, s.temperature);
  const L = info.lwl > 0 ? info.lwl : info.loa;
  const V = metresPerSecond(s.speed);
  const fr = frictionEstimate({ V, S: info.wettedArea, L, rho, nu });
  const pv = domainForHull(s, info);
  const cells = estimateCells(pv.dom, info.wettedArea);
  const cores = s.cores || 8;
  return {
    L,
    V,
    rho,
    nu,
    water: source,
    Fn: froude(V, L),
    Re: reynolds(V, L, nu),
    friction: fr,
    lambda: s.mode === "free-surface" ? waveLength(V) : null,
    half: pv.half,
    dom: pv.dom,
    cells,
    cores,
    seconds: estimateSeconds(s, cells, cores),
    upTo: s.stop === "settled" || s.mode === "double-body",
    volumeBytes: s.keepVolume ? cells * VOLUME_BYTES_PER_CELL : 0,
  };
}

// ---------------------------------------------------------------- keeping the hull with the case

/**
 * Keep the chosen parts of a model just read from its original with the case:
 * a small `openfoam-hull` doc (src/hull/stash.js). Returns its url, or null
 * when the parts are too big to keep (then the case reads the model each time).
 */
export async function keepHull(repo, result, model, url, { now = Date.now() } = {}) {
  const stash = makeStash({
    triangles: result.triangles,
    ranges: model.ranges,
    parts: model.parts,
    chosen: model.names,
    source: { url, heads: result.heads ?? null, path: result.path, providerId: result.providerId ?? null, providerName: result.providerName ?? null, title: result.title },
    now,
  });
  if (!stash) return null;
  // a big hull's triangles go in segment docs (src/segments.js)
  const h = await repo.create2((await externalize(repo, stash, { title: stash.title })).value);
  return h.url;
}

// ---------------------------------------------------------------- running

/**
 * Why a run can't be asked for yet, or null. The server is a found handle
 * (or null while it loads); `serverError` what went wrong finding it.
 */
export function runBlocker({ hullUrl, result, loading = false, prepared, serverUrl, serverDoc, serverError = null }) {
  if (!hullUrl) return "Link a hull first.";
  if (!result?.ok) return loading ? "Loading the hull…" : `The hull can't be read here${result?.error ? `: ${result.error}` : "."}`;
  if (prepared?.error) return `The hull can't be prepared: ${prepared.error}`;
  if (!prepared?.info) return "Measuring the hull…";
  if (!prepared.info.pierces) return "The hull doesn't cross the waterline: set its sinkage.";
  if (!serverUrl) return "Choose a server.";
  if (serverError) return serverError;
  if (!serverDoc) return "Loading the server…";
  if (!isQueue(serverDoc)) return "That link isn't a task queue: paste the queue link the OpenFOAM host printed (daemon/start.sh).";
  return null;
}

/**
 * Ask for runs: one run doc per setup, each with the hull frozen into it as
 * prepared, listed in the case and asked of the server (a task queue) as a
 * task keyed by the run doc's url.
 * @param {object} o
 * @param {object} o.caseHandle
 * @param {object} o.serverHandle  the task queue
 * @param {object} o.result     the model as read (readHull)
 * @param {object} o.prepared   prepareModel() at the setups' attitude
 * @param {object[]} o.setups   normalised setups (one attitude: the prepared one)
 * @param {string|null} [o.by]  who asked
 * @param {object} [o.made]     { tool, version }
 * @param {string} [o.message]  the change message on the case and run docs
 * @returns {Promise<object[]>}  the run handles, in order
 */
export async function queueRuns(repo, { caseHandle, serverHandle, result, prepared, setups, by = null, made = null, message, now = () => Date.now() }) {
  const r = result;
  const p = prepared;
  const d = caseHandle.doc();
  // the hull's geometry before it's floated: which variation of the model this is (src/inputs.js)
  const tris = modelTriangles(r, p.model);
  const geometry = { digest: await geometryDigest(tris), triangles: tris.length / 9 };
  const heads = r.heads ?? r.stash?.source?.heads ?? null;
  // a big STL goes in segment docs, once for the whole batch (src/segments.js)
  const stl = p.stl.byteLength > SEGMENT_BYTES / 2 ? (await putBytes(repo, p.stl, { title: `${r.title} · hull.stl` })).ref : p.stl;
  const handles = [];
  for (const setup of setups) {
    const run = newRun({
      caseUrl: caseHandle.url,
      serverUrl: serverHandle.url,
      setup: normalizeSetup(setup),
      hull: {
        stl,
        info: JSON.parse(JSON.stringify(p.info)),
        warnings: [...p.warnings],
        source: {
          url: d.hull.url,
          heads: Array.isArray(heads) ? [...heads].map(String).sort() : null,
          path: r.path,
          title: r.title,
          providerId: r.providerId ?? null,
          providerName: r.providerName ?? null,
          parts: [...p.model.names],
          stash: r.stashUrl ?? null,
        },
        // how the analysis frame sits in the model's (the scene draws results back in the model's)
        frame: { ...p.model.frame },
        geometry,
      },
      by,
      now: now(),
      made,
    });
    const suggested = d["@patchwork"]?.suggestedImportUrl;
    if (suggested) run["@patchwork"].suggestedImportUrl = suggested;
    handles.push(await addRun(repo, { caseHandle, serverHandle, run, message }));
  }
  return handles;
}

/** A new run with a finished one's setup and its frozen hull, exactly. */
export async function queueRerun(repo, { caseHandle, serverHandle, run, by = null, made = null, message, now = () => Date.now() }) {
  const copy = JSON.parse(JSON.stringify({ setup: run.setup, hull: { ...run.hull, stl: null } }));
  // segments never change, so a ref is copied as it is
  copy.hull.stl = isRef(run.hull.stl) ? JSON.parse(JSON.stringify(run.hull.stl)) : new Uint8Array(run.hull.stl);
  const doc = newRun({ caseUrl: caseHandle.url, serverUrl: serverHandle.url, setup: copy.setup, hull: copy.hull, by, now: now(), title: `${run.title} (again)`, made });
  return addRun(repo, { caseHandle, serverHandle, run: doc, message });
}

async function addRun(repo, { caseHandle, serverHandle, run, message }) {
  codeUrl(RUN_CODE); // a tool that can't name the run's code says so before it makes anything
  const rh = await repo.create2(run);
  const opts = message ? { message } : undefined;
  caseHandle.change((x) => {
    if (!Array.isArray(x.runs)) x.runs = [];
    x.runs.push(rh.url);
    x.selected = rh.url;
  }, opts);
  await askRun(repo, serverHandle.url, rh, RUN_CODE, opts);
  return rh;
}
