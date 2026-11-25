// What can be done to a study: every action the study tool's controls take
// and every action an agent's tools take, as one set of functions over the
// documents. The page and the agent call the same code, so neither can do
// what the other can't, and both get the same refusals in the same words.
//
// Each takes a context `ctx`:
//   { repo, handle,            the study's handle
//     now?: () => number,      (Date.now)
//     by?: string|null,        who is acting, for the run and change messages
//     getRegistry?,            the host's plugin registry (acquirePart finds it otherwise)
//     message?: string }       the change message (an agent's names its session)
// and answers `{ ok: true, … }` or `{ ok: false, error }`, the error a
// sentence a person can act on. A refused action writes nothing.
//
// The setup's actions (everything under "the setup" below) read and write the
// study only through `ctx.handle.doc()` and `ctx.handle.change()`. So several
// can be tried on a stand-in handle over a copy and written as one change, or
// not at all: how an agent's one call makes several changes (agent-tools.js).

import { normalizeSetup, newSupport, newLoad, newId, readiness, listOf, SUPPORT_KINDS, LOAD_KINDS, ANALYSES, MESH_PRESETS, MAX_MODES } from "./setup.js";
import { materialFromList } from "./materials.js";
import { isQuantity } from "./units.js";
import { acquirePart, pathLabel } from "./part/acquire.js";
import { readPart } from "./part/faces.js";
import { encodePart, decodePart, carryFaces, carrySetup, PART_TYPE } from "./part/kept.js";
import { newRun, isTerminal, STUDY_TYPE, RUN_TYPE, RUN_CODE } from "./protocol.js";
import { askRun, cancelRun, hearServing, isQueue, lookAtTask, codeUrl, shownRun, findWhenThere } from "./task-runs.js";
import { externalize, internalize } from "./segments.js";
import { renderKey, isRenderDoc } from "./render-read.js";

export const TOOL = Object.freeze({ tool: "@tiny-patchwork/fea", version: "0.1.0" });

const typeOf = (doc) => doc?.["@patchwork"]?.type;

/** A doc's value as plain objects, arrays and bytes of its own (nothing shared with the doc). */
function plain(v) {
  if (v instanceof Uint8Array) return Uint8Array.from(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}
const nowOf = (ctx) => (ctx.now ? ctx.now() : Date.now());
const refuse = (error) => ({ ok: false, error });

/** One change to the study, with the context's message. */
function write(ctx, fn) {
  ctx.handle.change(fn, ctx.message ? { message: ctx.message } : undefined);
}

/** Write the setup's one field, making the setup whole first if it was missing a part. */
function writeSetup(ctx, fn) {
  write(ctx, (d) => {
    if (!d.setup || typeof d.setup !== "object") d.setup = normalizeSetup(null);
    for (const key of ["supports", "loads"]) if (!d.setup[key] || typeof d.setup[key] !== "object") d.setup[key] = {};
    if (!d.setup.mesh || typeof d.setup.mesh !== "object") d.setup.mesh = { size: "coarse", order: 2 };
    fn(d.setup, d);
  });
}

// ---------------------------------------------------------------- the part

const partCache = new Map(); // kept url → Promise<part>

/** The study's kept part, decoded (cached by its doc, which never changes), or null if it has none. */
export async function keptPart(repo, study) {
  const url = study?.part?.kept;
  if (!url) return null;
  if (!partCache.has(url)) {
    const p = (async () => {
      const h = await findWhenThere(repo, url, { tries: 5 });
      const doc = h.doc();
      if (typeOf(doc) !== PART_TYPE) throw new Error("the study's kept part isn't a part");
      return decodePart(await internalize(repo, doc));
    })();
    partCache.set(url, p);
    p.catch(() => partCache.delete(url));
  }
  return partCache.get(url);
}

/**
 * Link a part (or read the linked one again): read its geometry, split it
 * into faces, keep that with the study, and carry the setup's faces over
 * from the part kept before.
 * @param {string} [url]  the part's document; none: the one already linked
 * @returns {Promise<{ ok: true, part: object, lost: object[], carried: number, how: string } | { ok: false, error: string }>}
 */
export async function linkPart(ctx, url = null) {
  const study = ctx.handle.doc();
  const target = url ?? study?.part?.url;
  if (!target) return refuse("no part to read: give its document");
  if (target === ctx.handle.url) return refuse("a study can't be its own part");
  const got = await acquirePart(ctx.repo, target, { getRegistry: ctx.getRegistry });
  if (!got.ok) return refuse(got.error);
  // a file's name without its ending is the part's name
  got.title = String(got.title).replace(/\.(glb|gltf|stl|3dm|step|stp|obj|scad)$/i, "") || "part";
  const part = readPart(got.triangles);
  if (!part.tris.length) return refuse(`“${got.title}” has no surface to analyse`);
  let before = null;
  try {
    before = await keptPart(ctx.repo, study);
  } catch {
    before = null; // the old kept part is unreachable: nothing to carry from
  }
  const readAt = nowOf(ctx);
  const kept = encodePart(part, { url: target, title: got.title, heads: got.heads, path: got.path, providerId: got.providerId, providerName: got.providerName ?? null, readAt });
  if (got.renderKey) kept.source.renderKey = got.renderKey;
  const title = `${got.title} · part`;
  const { value } = await externalize(ctx.repo, { "@patchwork": { type: PART_TYPE }, ...kept, title, study: ctx.handle.url }, { title });
  const keptHandle = await ctx.repo.create2(value);
  const setup = normalizeSetup(study.setup);
  const moved = before ? carrySetup(setup, carryFaces(before, part)) : null;
  write(ctx, (d) => {
    d.part = { url: target, kept: keptHandle.url, title: got.title, readAt, heads: got.heads ?? null, renderKey: got.renderKey ?? null, how: pathLabel(got) };
    if (!d.title || d.title === "FEA study") d.title = `${got.title} · FEA`;
    if (moved) {
      // only the face lists change: everything else about a support or load is as it was
      for (const [key, map] of [["supports", moved.supports], ["loads", moved.loads]])
        for (const [id, item] of Object.entries(map)) {
          const at = d.setup?.[key]?.[id];
          if (at && Array.isArray(item.faces) && JSON.stringify(at.faces) !== JSON.stringify(item.faces)) at.faces = item.faces;
        }
    }
  });
  const decoded = { ...part, source: kept.source, title: got.title };
  partCache.set(keptHandle.url, Promise.resolve(decoded));
  // how many supports and loads had faces and kept every one of them
  const lostSome = new Set((moved?.lost ?? []).map((l) => l.id));
  const carried = moved ? [...listOf(setup.supports), ...listOf(setup.loads)].filter((x) => x.faces?.length && !lostSome.has(x.id)).length : 0;
  return { ok: true, part: decoded, lost: moved?.lost ?? [], carried, how: pathLabel(got) };
}

/**
 * Has the linked model changed since the part was read? Loads the model's
 * document (not its geometry). `null`: can't tell (it isn't reachable).
 */
export async function partChanged(repo, study) {
  const p = study?.part;
  if (!p?.url) return null;
  try {
    const h = await repo.find(p.url);
    const doc = h.doc();
    if (isRenderDoc(doc)) return p.renderKey ? renderKey(doc) !== p.renderKey : null;
    const heads = h.heads?.();
    if (!heads || !p.heads) return null;
    return [...heads].sort().join() !== [...p.heads].sort().join();
  } catch {
    return null;
  }
}

/** Unlink the part. The setup's faces stay as numbers of a part that is gone; a new part's reading says what they matched. */
export function unlinkPart(ctx) {
  write(ctx, (d) => {
    d.part = null;
  });
  return { ok: true };
}

// ---------------------------------------------------------------- the setup

export function setAnalysis(ctx, analysis) {
  if (!ANALYSES.some((a) => a.id === analysis)) return refuse(`the analysis must be one of ${ANALYSES.map((a) => a.id).join(", ")}`);
  writeSetup(ctx, (s) => {
    s.analysis = analysis;
  });
  return { ok: true };
}

/** A material from the list (`{ id }`), or its fields: any of name, E, nu, density, yield (a quantity, or null for none). */
export function setMaterial(ctx, m) {
  if (m?.id !== undefined) {
    const from = materialFromList(m.id);
    if (!from) return refuse(`no material “${m.id}” in the list`);
    writeSetup(ctx, (s) => {
      s.material = from;
    });
    return { ok: true };
  }
  const patch = {};
  if (m.name !== undefined) patch.name = String(m.name).trim().slice(0, 80) || "Custom material";
  if (m.E !== undefined) {
    if (!isQuantity(m.E, "pressure") || !(m.E.value > 0)) return refuse("Young's modulus must be a positive value with its unit, like 70 GPa");
    patch.E = { value: m.E.value, unit: m.E.unit };
  }
  if (m.nu !== undefined) {
    if (!(Number.isFinite(m.nu) && m.nu > -1 && m.nu < 0.5)) return refuse("Poisson's ratio must be between −1 and 0.5 (most metals: 0.3)");
    patch.nu = m.nu;
  }
  if (m.density !== undefined) {
    if (!isQuantity(m.density, "density") || !(m.density.value > 0)) return refuse("the density must be a positive value with its unit, like 2700 kg/m³");
    patch.density = { value: m.density.value, unit: m.density.unit };
  }
  if (m.yield !== undefined) {
    if (m.yield !== null && (!isQuantity(m.yield, "pressure") || !(m.yield.value > 0))) return refuse("the yield strength must be a positive value with its unit, like 250 MPa, or none");
    patch.yield = m.yield === null ? null : { value: m.yield.value, unit: m.yield.unit };
  }
  writeSetup(ctx, (s) => {
    if (!s.material || typeof s.material !== "object") s.material = normalizeSetup(null).material;
    // a changed number makes it its own material, unless it was named in the same breath
    if (patch.name === undefined && Object.keys(patch).length && !/\(edited\)$/.test(s.material.name ?? "")) s.material.name = `${s.material.name ?? "Material"} (edited)`;
    for (const [k, v] of Object.entries(patch)) s.material[k] = v;
  });
  return { ok: true };
}

export function setMesh(ctx, { size, order } = {}) {
  if (size !== undefined && !MESH_PRESETS.includes(size) && !(isQuantity(size, "length") && size.value > 0)) return refuse(`the mesh size must be ${MESH_PRESETS.join(", ")} or a length like 2 mm`);
  if (order !== undefined && order !== 1 && order !== 2) return refuse("the element order must be 1 (four-node) or 2 (ten-node)");
  writeSetup(ctx, (s) => {
    if (size !== undefined) s.mesh.size = typeof size === "string" ? size : { value: size.value, unit: size.unit };
    if (order !== undefined) s.mesh.order = order;
  });
  return { ok: true };
}

export function setModes(ctx, modes) {
  if (!(Number.isInteger(modes) && modes >= 1 && modes <= MAX_MODES)) return refuse(`the number of modes must be a whole number from 1 to ${MAX_MODES}`);
  writeSetup(ctx, (s) => {
    s.modes = modes;
  });
  return { ok: true };
}

/** The faces of a list that the part has: the list, or a refusal naming the ones it doesn't. */
function checkFaces(part, faces, { flat = false } = {}) {
  if (!Array.isArray(faces) || !faces.every((f) => Number.isInteger(f) && f >= 0)) return refuse("faces must be a list of face numbers");
  if (!part) return faces.length ? refuse("link a part before picking faces") : { ok: true, faces: [] };
  const known = new Map(part.faces.map((f) => [f.id, f]));
  const gone = faces.filter((f) => !known.has(f));
  if (gone.length) return refuse(`the part has no face ${gone.join(", ")}: its faces are numbered 0 to ${part.faces.length - 1}`);
  if (flat) {
    const curved = faces.filter((f) => !known.get(f).flat);
    if (curved.length) return refuse(`a sliding support needs flat faces; face ${curved.join(", ")} ${curved.length === 1 ? "is" : "are"} curved`);
  }
  return { ok: true, faces: [...new Set(faces)].sort((a, b) => a - b) };
}

/**
 * Add a support. @param {{ kind?: "fixed"|"slide", name?: string, faces?: number[] }} o
 * @returns {{ ok: true, id: string } | { ok: false, error: string }}
 */
export function addSupport(ctx, part, { kind = "fixed", name = null, faces = [] } = {}) {
  if (!SUPPORT_KINDS.some((k) => k.id === kind)) return refuse(`a support is one of ${SUPPORT_KINDS.map((k) => k.id).join(", ")}`);
  const checked = checkFaces(part, faces, { flat: kind === "slide" });
  if (!checked.ok) return checked;
  const id = newId(nowOf(ctx));
  const item = { ...newSupport(kind, name), faces: checked.faces };
  writeSetup(ctx, (s) => {
    s.supports[id] = item;
  });
  return { ok: true, id };
}

/**
 * Add a load. @param {object} o  `kind` and that kind's fields (src/setup.js): a force's `magnitude` and
 * `direction`, a pressure's `pressure`, gravity's `acceleration` and `direction`; `name`, `faces`.
 */
export function addLoad(ctx, part, o = {}) {
  const kind = o.kind ?? "force";
  if (!LOAD_KINDS.some((k) => k.id === kind)) return refuse(`a load is one of ${LOAD_KINDS.map((k) => k.id).join(", ")}`);
  const item = newLoad(kind, o.name ?? null);
  const checkedFields = loadFields(kind, o);
  if (!checkedFields.ok) return checkedFields;
  Object.assign(item, checkedFields.fields);
  if (kind !== "gravity") {
    const checked = checkFaces(part, o.faces ?? []);
    if (!checked.ok) return checked;
    item.faces = checked.faces;
  }
  const id = newId(nowOf(ctx));
  writeSetup(ctx, (s) => {
    s.loads[id] = item;
  });
  return { ok: true, id };
}

/** The fields of a load of a kind out of a patch, checked. */
function loadFields(kind, o) {
  const fields = {};
  const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && Math.hypot(...v) > 0;
  if (o.direction !== undefined) {
    if (kind === "pressure") return refuse("a pressure has no direction of its own: it pushes square onto its faces");
    if (!vector(o.direction)) return refuse("a direction is three numbers, not all zero: [0, -1, 0] is down");
    const l = Math.hypot(...o.direction);
    fields.direction = o.direction.map((x) => Number((x / l).toPrecision(12)));
  }
  if (o.magnitude !== undefined) {
    if (kind !== "force") return refuse("only a force has a magnitude");
    if (!isQuantity(o.magnitude, "force") || o.magnitude.value < 0) return refuse("a force's size must be a value with its unit, like 250 N, and not negative (turn its direction instead)");
    fields.magnitude = { value: o.magnitude.value, unit: o.magnitude.unit };
  }
  if (o.pressure !== undefined) {
    if (kind !== "pressure") return refuse("only a pressure load has a pressure");
    if (!isQuantity(o.pressure, "pressure")) return refuse("a pressure must be a value with its unit, like 2 MPa");
    fields.pressure = { value: o.pressure.value, unit: o.pressure.unit };
  }
  if (o.acceleration !== undefined) {
    if (kind !== "gravity") return refuse("only gravity has an acceleration");
    if (!isQuantity(o.acceleration, "acceleration") || o.acceleration.value < 0) return refuse("gravity's acceleration must be a value with its unit, like 1 g, and not negative");
    fields.acceleration = { value: o.acceleration.value, unit: o.acceleration.unit };
  }
  return { ok: true, fields };
}

/** Change a support: any of name, kind, faces. */
export function updateSupport(ctx, part, id, patch) {
  const at = normalizeSetup(ctx.handle.doc().setup).supports[id];
  if (!at) return refuse("that support isn't in the study any more");
  const kind = patch.kind ?? at.kind;
  if (!SUPPORT_KINDS.some((k) => k.id === kind)) return refuse(`a support is one of ${SUPPORT_KINDS.map((k) => k.id).join(", ")}`);
  const faces = patch.faces ?? (patch.kind !== undefined ? at.faces : undefined);
  let checked = null;
  if (faces !== undefined) {
    checked = checkFaces(part, faces, { flat: kind === "slide" });
    if (!checked.ok) return checked;
  }
  writeSetup(ctx, (s) => {
    const t = s.supports[id];
    if (!t) return;
    if (patch.name !== undefined) t.name = String(patch.name).trim().slice(0, 80) || at.name;
    if (patch.kind !== undefined) t.kind = kind;
    if (patch.faces !== undefined) t.faces = checked.faces;
  });
  return { ok: true };
}

/** Change a load: its name, faces, or its kind's own fields. */
export function updateLoad(ctx, part, id, patch) {
  const at = normalizeSetup(ctx.handle.doc().setup).loads[id];
  if (!at) return refuse("that load isn't in the study any more");
  const fields = loadFields(at.kind, patch);
  if (!fields.ok) return fields;
  let checked = null;
  if (patch.faces !== undefined) {
    if (at.kind === "gravity") return refuse("gravity acts on the whole part, not on faces");
    checked = checkFaces(part, patch.faces);
    if (!checked.ok) return checked;
  }
  writeSetup(ctx, (s) => {
    const t = s.loads[id];
    if (!t) return;
    if (patch.name !== undefined) t.name = String(patch.name).trim().slice(0, 80) || at.name;
    for (const [k, v] of Object.entries(fields.fields)) t[k] = v;
    if (checked) t.faces = checked.faces;
  });
  return { ok: true };
}

export function removeSupport(ctx, id) {
  if (!normalizeSetup(ctx.handle.doc().setup).supports[id]) return refuse("that support isn't in the study any more");
  writeSetup(ctx, (s) => {
    delete s.supports[id];
  });
  return { ok: true };
}
export function removeLoad(ctx, id) {
  if (!normalizeSetup(ctx.handle.doc().setup).loads[id]) return refuse("that load isn't in the study any more");
  writeSetup(ctx, (s) => {
    delete s.loads[id];
  });
  return { ok: true };
}

/** Put a face on a support or load, or take it off if it is on (what a click on the part does). */
export function toggleFace(ctx, part, what, id, face) {
  const setup = normalizeSetup(ctx.handle.doc().setup);
  const at = (what === "support" ? setup.supports : setup.loads)[id];
  if (!at) return refuse(`that ${what} isn't in the study any more`);
  if (!Array.isArray(at.faces)) return refuse("gravity acts on the whole part, not on faces");
  const faces = at.faces.includes(face) ? at.faces.filter((f) => f !== face) : [...at.faces, face];
  return what === "support" ? updateSupport(ctx, part, id, { faces }) : updateLoad(ctx, part, id, { faces });
}

// ---------------------------------------------------------------- the server and runs

/** Point the study at a server (a task queue an FEA host serves). Checks it is a queue. */
export async function setServer(ctx, url) {
  if (!url) {
    write(ctx, (d) => {
      d.server = null;
    });
    return { ok: true, server: null };
  }
  let doc;
  try {
    doc = (await findWhenThere(ctx.repo, url, { tries: 3 })).doc();
  } catch (err) {
    return refuse(`couldn't load that server (${err?.message ?? err})`);
  }
  if (!isQueue(doc)) return refuse("that isn't an FEA server: paste the queue link the FEA host printed when it started (daemon/start.sh in this package)");
  write(ctx, (d) => {
    d.server = url;
  });
  return { ok: true, server: doc };
}

/**
 * Run the study as it is set up: freeze the setup and the part into a new run
 * and ask the server (a task queue) for it, as a task keyed by the run doc's
 * url. Refused while no machine is heard serving the queue: a run asked then
 * would sit in the queue with nothing to say why.
 * `ctx.hear` (tests) stands in for listening to the queue (hearServing).
 * @returns {Promise<{ ok: true, url: string, pools: object[] } | { ok: false, error: string, blocking?: string[] }>}
 */
export async function runStudy(ctx) {
  const study = ctx.handle.doc();
  const setup = normalizeSetup(study.setup);
  let part;
  try {
    part = await keptPart(ctx.repo, study);
  } catch (err) {
    return refuse(`the study's part couldn't be loaded (${err?.message ?? err})`);
  }
  const ready = readiness(setup, part);
  if (ready.blocking.length) return { ok: false, error: `not ready to run: ${ready.blocking.join("; ")}`, blocking: ready.blocking };
  if (!study.server) return refuse("choose a server to run on: paste the queue link an FEA host printed when it started");
  let server;
  try {
    server = await findWhenThere(ctx.repo, study.server, { tries: 3 });
  } catch (err) {
    return refuse(`couldn't reach the server's document (${err?.message ?? err})`);
  }
  if (!isQueue(server.doc())) return refuse("the study's server isn't an FEA server");
  try {
    codeUrl(RUN_CODE);
  } catch (err) {
    return refuse(String(err.message).replace(/\.$/, ""));
  }
  const pools = await (ctx.hear ?? hearServing)(ctx.repo, study.server);
  if (!pools.length) return refuse(`the server “${server.doc().title ?? "FEA server"}” isn't running: start it (daemon/start.sh on its machine), or choose another`);
  const now = nowOf(ctx);
  // the kept part, as it is kept: its bytes inline or the same segment refs (they never change)
  const kept = (await ctx.repo.find(study.part.kept)).doc();
  const { ["@patchwork"]: _type, study: _study, ...frozen } = plain(kept);
  frozen.title = frozen.source?.title ?? study.part.title ?? "part";
  const run = await ctx.repo.create2(newRun({ studyUrl: ctx.handle.url, serverUrl: study.server, setup, part: frozen, by: ctx.by ?? null, now, made: TOOL }));
  write(ctx, (d) => {
    if (!Array.isArray(d.runs)) d.runs = [];
    d.runs.push(run.url);
    d.selected = run.url;
  });
  await askRun(ctx.repo, study.server, run, RUN_CODE, ctx.message ? { message: ctx.message } : undefined);
  return { ok: true, url: run.url, pools };
}

/** Cancel a run that hasn't finished: a stop recorded in its task (src/task-runs.js). */
export async function stopRun(ctx, runUrl) {
  let h;
  try {
    h = await ctx.repo.find(runUrl);
  } catch (err) {
    return refuse(`couldn't load that run (${err?.message ?? err})`);
  }
  if (typeOf(h.doc()) !== RUN_TYPE) return refuse("that isn't an FEA run");
  const { status } = shownRun(h.doc(), await lookAtTask(ctx.repo, h.doc()));
  if (isTerminal(status)) return refuse(`that run has already ${status === "done" ? "finished" : status}`);
  if (!(await cancelRun(ctx.repo, h.doc(), runUrl))) return refuse("its queue no longer lists that run, so there's nothing to cancel");
  return { ok: true };
}

/** Which run the study shows (and a scene draws). */
export function selectRun(ctx, runUrl) {
  const runs = ctx.handle.doc().runs ?? [];
  if (runUrl !== null && !runs.includes(runUrl)) return refuse("that run isn't one of this study's");
  write(ctx, (d) => {
    d.selected = runUrl;
  });
  return { ok: true };
}

/** Take a run off the study's list (the run's own document stays). */
export function forgetRun(ctx, runUrl) {
  if (!(ctx.handle.doc().runs ?? []).includes(runUrl)) return refuse("that run isn't one of this study's");
  write(ctx, (d) => {
    const i = (d.runs ?? []).indexOf(runUrl);
    if (i >= 0) d.runs.splice(i, 1);
    if (d.selected === runUrl) d.selected = null;
  });
  return { ok: true };
}

/** A new study's contents (what the datatype's init writes, as a plain value: for an agent or a scene making one). */
export function newStudy(title = "FEA study") {
  return { "@patchwork": { type: STUDY_TYPE }, title, part: null, setup: normalizeSetup(null), server: null, runs: [], selected: null };
}
