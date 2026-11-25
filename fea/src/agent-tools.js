// The study, handed to the agent: five `agent:tool` executors over the same
// model the study tool's controls call (src/study-model.js), so neither has
// to drive the other and both get the same refusals in the same words.
// Their descriptions and schemas are plain JSON in src/agent-meta.js (the
// agent reads them before it loads anything); src/agent-tools.test.js keeps
// the two in step.
//
//   fea_study    make a study, link or re-read its part, choose its server, the
//                run it shows; reports the part and every face by number
//   fea_setup    analysis, modes, material, mesh, supports and loads on faces;
//                all checked first, written as one change or not at all
//   fea_run      ask the server for a run; says which path to watch
//   fea_results  the runs table, each finished run's figures and notes
//   fea_stop     cancel runs
//
// Every input is something another tool produces: automerge: URLs, numbers
// with their units, face numbers and ids that fea_study's report lists.
// Every write is a change whose message names the agent session and what it
// did.

import { STUDY_TYPE, RUN_TYPE, isTerminal, shownRun } from "./protocol.js";
import { isQueue, hearServing, queueCounts, servedBy, lookAtTask } from "./run-tasks.js";
import { normalizeSetup, setupProblems, readiness, meshEstimate, listOf, describeLoad, readQuantity, MESH_PRESETS } from "./setup.js";
import { MATERIALS } from "./materials.js";
import { unitsOf, pretty, prettyUnit, format, num, toSI, DIMENSIONS } from "./units.js";
import { describeFace, facingWord } from "./part/faces.js";
import { placeOf } from "./draw/glyphs.js";
import { runsTable, figures, inputs, statusLine } from "./results.js";
import { parseAutomergeUrl } from "./dnd.js";
import * as model from "./study-model.js";

// ---------------------------------------------------------------- helpers

/** The change message: who (the agent, which session) and what. */
const message = (ctx, why) => `agent${ctx?.sessionUrl ? ` ${ctx.sessionUrl}` : ""}: ${why}`;
/** Who asked, for the run doc. */
const BY = "agent";
/** How many faces a report lists unless asked for all. */
export const MAX_FACES = 60;
/** How many runs fea_results reads at once. */
export const MAX_RUNS = 40;
/** How much of a failed run's error is quoted. */
export const MAX_ERROR = 240;
/** Which path of a run doc to watch, and the values it ends on. */
export const STATUS_PATH = Object.freeze(["status"]);
export const STATUS_END = "done|failed|cancelled";

const typeOf = (doc) => doc?.["@patchwork"]?.type;
const quote = (v) => JSON.stringify(v);
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stamp = (t) => (Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC` : "?");

function urlOf(input, field, what) {
  if (input == null || input === "") throw new Error(`Pass \`${field}\`: ${what}.`);
  const url = parseAutomergeUrl(input);
  if (!url) throw new Error(`\`${field}\` ${quote(input)} isn't an automerge: URL (${what}).`);
  return url;
}

async function findTyped(ctx, url, type, label, hint) {
  let h;
  try {
    h = await ctx.repo.find(url);
  } catch (err) {
    throw new Error(`Couldn't open ${url} (${err?.message ?? err}).`);
  }
  const t = typeOf(h.doc());
  if (t !== type) throw new Error(`${url} is ${t ? `a ${t} document` : "not a typed document"}, not ${label}.${hint ? ` ${hint}` : ""}`);
  return h;
}

const findStudy = (ctx, input) => findTyped(ctx, urlOf(input, "study", "the automerge: URL of an FEA study (fea_study makes one)"), STUDY_TYPE, "an FEA study", "fea_study makes one.");

/** The context study-model's actions take, for this study, naming the agent's session. */
const modelCtx = (ctx, handle, why) => ({
  repo: ctx.repo,
  handle,
  by: BY,
  message: message(ctx, why),
  getRegistry: ctx.plugins?.getRegistry ?? ctx.getRegistry,
});

/** A plain copy of a doc's value (nothing shared with the doc). */
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The same JSON whatever order the keys were written in. */
function same(a, b) {
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  return JSON.stringify(sorted(a ?? null)) === JSON.stringify(sorted(b ?? null));
}

/**
 * A stand-in for a study's handle that study-model's actions can write to
 * without touching the study: a plain copy of the fields they read and write.
 */
function scratchOf(handle, keys) {
  const src = handle.doc();
  let doc = Object.fromEntries(keys.map((k) => [k, plain(src?.[k])]));
  return {
    url: handle.url,
    doc: () => doc,
    change(fn) {
      const draft = plain(doc);
      fn(draft);
      doc = draft;
    },
  };
}

/** Make `parent[key]` equal `value` in place, writing only what differs (so a concurrent edit elsewhere in it stands). */
function assign(parent, key, value) {
  const cur = parent[key];
  const isMap = (v) => v && typeof v === "object" && !Array.isArray(v) && !ArrayBuffer.isView(v);
  if (isMap(cur) && isMap(value)) {
    for (const k of Object.keys(cur)) if (!(k in value)) delete cur[k];
    for (const [k, v] of Object.entries(value)) assign(cur, k, v);
  } else if (!same(cur, value)) parent[key] = plain(value);
}

/** Refuse fields an object doesn't have, naming those it does. */
function onlyKeys(obj, allowed, what) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error(`${what} is an object with any of: ${allowed.join(", ")}.`);
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) throw new Error(`${what} has no ${extra.map((k) => `\`${k}\``).join(", ")}: it takes ${allowed.join(", ")}.`);
}

/** A quantity of a dimension from an agent's input, or a refusal naming the units it may have. */
function quantity(input, dimension, what) {
  const q = readQuantity(input, dimension, what);
  if (!q.ok) throw new Error(`${q.error}. Its units: ${unitsOf(dimension).join(", ")}.`);
  return q.value;
}

// ---------------------------------------------------------------- reading a study

/** The study's server (a task queue), and the machines heard serving it. */
async function openServer(ctx, url) {
  if (!url) return { url: null, handle: null, doc: null, error: null, pools: [] };
  try {
    const handle = await ctx.repo.find(url);
    const doc = handle.doc();
    if (!isQueue(doc)) return { url, handle, doc, error: "isn't a task queue (the FEA host prints one when it starts)", pools: [] };
    return { url, handle, doc, error: null, pools: await hearServing(ctx.repo, url) };
  } catch (err) {
    return { url, handle: null, doc: null, error: `couldn't be loaded (${err?.message ?? err})`, pools: [] };
  }
}

/** Everything about a study a report needs: its setup, its kept part, whether the model changed, its server. */
async function loadStudy(ctx, handle) {
  const doc = handle.doc();
  const setup = normalizeSetup(doc.setup);
  let part = null;
  let partError = null;
  if (doc.part?.kept) {
    try {
      part = await model.keptPart(ctx.repo, doc);
    } catch (err) {
      partError = String(err?.message ?? err);
    }
  }
  const changed = doc.part?.url ? await model.partChanged(ctx.repo, doc) : null;
  const server = await openServer(ctx, doc.server ?? null);
  return { handle, doc, setup, part, partError, changed, server };
}

/** Lengths for a part in the unit its size reads best in (the study tool's choice). */
function lengths(part) {
  const unit = part ? prettyUnit(Math.max(...[0, 1, 2].map((k) => part.box.max[k] - part.box.min[k])), "length") : "mm";
  const k = DIMENSIONS.length.units[unit];
  return { unit, len: (x) => pretty(x, "length", { unit }), n: (x) => num(x / k, 4) };
}

function faceLine(f, L) {
  return `face ${f.id}: ${describeFace(f, L.len)}; area ${pretty(f.area, "area")}; centre (${f.centroid.map(L.n).join(", ")}) ${L.unit}`;
}

/** A face named in a support or load: its number and, briefly, what it is. */
function faceRef(part, id, L) {
  const f = part?.faces.find((x) => x.id === id);
  return f ? `${id} (${describeFace(f, L.len)})` : `${id} (the part has no such face)`;
}
const facesText = (part, faces, L) => (faces.length ? `${faces.length === 1 ? "face" : "faces"} ${faces.map((id) => faceRef(part, id, L)).join(", ")}` : "no faces yet");

/** Which faces a report lists: [faces, a line saying which]. */
function pickFaces(part, { faces = "largest", facing = null } = {}) {
  let list = part.faces;
  let which = "";
  if (facing) {
    const want = facing.replace("-", "−");
    list = list.filter((f) => (facing === "curved" ? !f.flat : facingWord(f.normal) === want));
    which = facing === "curved" ? "the curved ones" : `those facing ${want}`;
  }
  if (faces !== "all" && list.length > MAX_FACES) {
    const keep = new Set([...list].sort((a, b) => b.area - a.area || a.id - b.id).slice(0, MAX_FACES).map((f) => f.id));
    const total = list.length;
    list = list.filter((f) => keep.has(f.id));
    which = `the largest ${MAX_FACES} of ${total}${which ? `, ${which}` : ""}, by area; fea_study { study, faces: "all" } lists every one, or \`facing\` ("+x" … "-z", "curved") only those facing one way`;
  } else if (which) which = `${list.length} of them, ${which}`;
  return { list, which };
}

function partText(c, { listFaces = true, faces, facing } = {}) {
  const p = c.doc.part;
  if (!p?.url) return "Part: none linked. Link one with fea_study { study, part: <automerge: URL of an OpenSCAD or CAD model, a GLB or STL file, or a scene render> }.";
  const part = c.part;
  if (!part) return `Part: “${p.title ?? "part"}” (${p.url}), but its kept copy couldn't be loaded${c.partError ? ` (${c.partError})` : ""}: fea_study { study, reread: true } reads it again.`;
  const L = lengths(part);
  const dims = [0, 1, 2].map((k) => part.box.max[k] - part.box.min[k]);
  const m = c.setup.material;
  const lines = [
    `Part: “${p.title ?? part.title}” (${p.url}), read from a ${p.how ?? "model"} at ${stamp(p.readAt)}.`,
    `  size ${dims.map(L.n).join(" × ")} ${L.unit} (x × y × z, in the part's frame: y is up); ${part.solid ? `volume ${pretty(part.volume, "volume")}; mass ${pretty(part.volume * toSI(m.density, "density"), "mass")} in ${m.name}` : "no volume to weigh"}.`,
    part.solid ? "  A closed solid: it can be meshed." : `  Not a closed solid, so it can't be meshed: ${part.problems.join("; ")}.`,
  ];
  for (const note of part.notes) lines.push(`  note: ${note}.`);
  lines.push(
    c.changed === true
      ? "  The model has changed since it was read: fea_study { study, reread: true } reads it again (supports and loads move onto the faces still alike)."
      : c.changed === false
        ? "  The model hasn't changed since it was read."
        : "  Whether the model changed since it was read can't be told here.",
  );
  const tris = (part.tris.length / 3).toLocaleString("en");
  if (!listFaces) {
    lines.push(`  ${part.faces.length} faces (of ${tris} triangles): fea_study { study } lists them.`);
    return lines.join("\n");
  }
  const { list, which } = pickFaces(part, { faces, facing });
  lines.push(`  ${part.faces.length} faces (of ${tris} triangles), numbered when the part was read${which ? `; listed: ${which}` : ""}. Lengths in ${L.unit}:`);
  for (const f of list) lines.push(`  ${faceLine(f, L)}`);
  return lines.join("\n");
}

function materialText(m) {
  return `Material: ${m.name}: E ${format(m.E)}, ν ${m.nu}, density ${format(m.density)}, yield ${m.yield ? format(m.yield) : "none (no safety factor can be given)"}.`;
}

function analysisText(s) {
  return s.analysis === "modal" ? `Analysis: modal, the first ${s.modes} ways it vibrates (loads are not used).` : "Analysis: static, stress and deflection under the loads.";
}

function itemsText(c) {
  const L = lengths(c.part);
  const lines = [];
  const supports = listOf(c.setup.supports);
  const loads = listOf(c.setup.loads);
  lines.push(supports.length ? "Supports:" : "Supports: none (nothing holds the part).");
  for (const s of supports) lines.push(`  [${s.id}] “${s.name}”: ${s.kind === "slide" ? "sliding" : "fixed"}, on ${facesText(c.part, s.faces, L)}.`);
  lines.push(loads.length ? "Loads:" : "Loads: none (nothing pushes on the part).");
  for (const l of loads) lines.push(`  [${l.id}] “${l.name}”: ${l.kind}, ${describeLoad(l)}${l.faces ? `: ${facesText(c.part, l.faces, L)}` : ", on the whole part"}.`);
  return lines.join("\n");
}

function meshText(c) {
  const s = c.setup.mesh;
  const size = typeof s.size === "string" ? s.size : format(s.size);
  const head = `Mesh: ${size}, ${s.order === 2 ? "ten-node (accurate)" : "four-node (rough)"} elements`;
  if (!c.part?.solid) return `${head}.`;
  const est = meshEstimate(c.setup, c.part);
  return `${head}; about ${est.nodes.toLocaleString("en")} nodes (${est.elements.toLocaleString("en")} elements) at ${pretty(est.size, "length")}.`;
}

function serverText(sv) {
  if (!sv.url) return "Server: none. Choose one with fea_study { study, server: <the queue link the FEA host printed> }.";
  if (sv.error) return `Server: ${sv.url}: ${sv.error}.`;
  const by = servedBy(sv.pools);
  const q = queueCounts(sv.doc, sv.pools);
  const state = by ? `served by ${by}` : "not running: nobody is heard serving its queue; start it (daemon/start.sh) on its machine";
  return `Server: “${sv.doc.title ?? "FEA server"}” (${sv.url}): ${state}; ${q.running ? `running ${q.running}` : "nothing running"}${q.waiting ? `, ${q.waiting} waiting` : ""}.`;
}

/** What blocks a run and what to look out for, as the study tool's Run section says it. */
function readinessOf(c) {
  const ready = c.part ? readiness(c.setup, c.part) : c.doc.part?.url ? { blocking: ["the study's part couldn't be loaded: fea_study { study, reread: true } reads it again"], warnings: [] } : readiness(c.setup, null);
  const blocking = [...ready.blocking];
  if (!c.server.url) blocking.push("choose a server");
  else if (c.server.error) blocking.push(`the server ${c.server.error}`);
  else if (!c.server.pools.length) blocking.push("the server isn't running: nobody is heard serving its queue");
  return { blocking, warnings: ready.warnings };
}

function report(c, { head = null, listFaces = true, faces, facing } = {}) {
  const d = c.handle.doc();
  const problems = setupProblems(d.setup);
  const ready = readinessOf(c);
  const runs = Array.isArray(d.runs) ? d.runs : [];
  return [
    head,
    `FEA study “${d.title ?? "FEA study"}” (${c.handle.url}).`,
    partText(c, { listFaces, faces, facing }),
    materialText(c.setup.material),
    analysisText(c.setup),
    itemsText(c),
    meshText(c),
    serverText(c.server),
    problems.length ? `The setup as stored: ${problems.join("; ")}. It reads as shown above.` : null,
    `Runs: ${runs.length}${runs.length ? `; shown: ${d.selected ?? "none"}. fea_results { study } tabulates them` : ""}.`,
    ready.blocking.length ? `Not ready to run: ${ready.blocking.map(capital).join(". ")}.` : "Ready: fea_run { study } runs it.",
    ready.warnings.length ? `Look out: ${ready.warnings.map(capital).join(". ")}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------- fea_study

const FACE_CHOICES = ["largest", "all"];
const FACINGS = ["+x", "-x", "+y", "-y", "+z", "-z", "curved"];

export const studyTool = {
  async execute(input, ctx) {
    const changes = [];
    // what can be checked is checked before anything is written
    if (input.faces !== undefined && !FACE_CHOICES.includes(input.faces)) throw new Error(`\`faces\` is "largest" or "all", not ${quote(input.faces)}.`);
    const facing = input.facing === undefined ? null : String(input.facing).replace("−", "-");
    if (facing !== null && !FACINGS.includes(facing)) throw new Error(`\`facing\` is one of ${FACINGS.map(quote).join(", ")}, not ${quote(input.facing)}.`);
    const partUrl = input.part === undefined ? undefined : input.part === null || input.part === "" ? null : urlOf(input.part, "part", "the solid to analyse");
    const serverUrl = input.server === undefined ? undefined : input.server === null || input.server === "" ? null : urlOf(input.server, "server", "the queue link an FEA host printed");
    if (input.reread !== undefined && typeof input.reread !== "boolean") throw new Error("`reread` is true or false.");
    if (input.reread && partUrl === null) throw new Error("Give `part: null` (unlink) or `reread: true`, not both.");
    const title = input.title != null && String(input.title).trim() ? String(input.title).trim().slice(0, 200) : null;

    let handle = null;
    if (input.study) handle = await findStudy(ctx, input.study);
    else {
      for (const k of ["select_run", "forget_runs", "reread"]) if (input[k] !== undefined && input[k] !== false) throw new Error(`\`${k}\` is for a study that exists: pass \`study\`.`);
    }
    let folder = null;
    if (input.folder) {
      if (handle) throw new Error("`folder` files a new study: leave out `study` to make one.");
      const folderUrl = urlOf(input.folder, "folder", "the folder to file the new study in");
      folder = await ctx.repo.find(folderUrl).catch((err) => {
        throw new Error(`Couldn't open the folder ${folderUrl} (${err?.message ?? err}).`);
      });
      if (!Array.isArray(folder.doc()?.docs)) throw new Error(`${folderUrl} is not a folder.`);
    }
    if (serverUrl) {
      // the same check setServer makes, on a copy: a refusal here writes nothing
      const r = await model.setServer({ repo: ctx.repo, handle: scratchOf(handle ?? { url: null, doc: () => ({}) }, ["server"]) }, serverUrl);
      if (!r.ok) throw new Error(`\`server\` ${serverUrl}: ${r.error}.`);
    }
    if (handle && input.select_run !== undefined) {
      const runUrl = input.select_run === null || input.select_run === "" ? null : urlOf(input.select_run, "select_run", "one of the study's runs");
      const r = model.selectRun({ repo: ctx.repo, handle: scratchOf(handle, ["runs", "selected"]) }, runUrl);
      if (!r.ok) throw new Error(`\`select_run\` ${runUrl}: ${r.error}. Its runs: ${(handle.doc().runs ?? []).join(", ") || "none yet"}.`);
    }
    let forget = [];
    if (handle && input.forget_runs !== undefined) {
      if (!Array.isArray(input.forget_runs) || !input.forget_runs.length) throw new Error("`forget_runs` is a list of the study's run URLs.");
      const runs = handle.doc().runs ?? [];
      forget = input.forget_runs.map((u) => urlOf(u, "forget_runs", "one of the study's runs"));
      const strangers = forget.filter((u) => !runs.includes(u));
      if (strangers.length) throw new Error(`${strangers.join(", ")} ${strangers.length === 1 ? "isn't one" : "aren't"} of this study's runs. Its runs: ${runs.join(", ") || "none yet"}.`);
    }
    if (handle && input.reread && !handle.doc().part?.url && !partUrl) throw new Error("The study has no part to read again: link one with `part`.");

    // a new study (filed once its title is settled, below)
    let made = null;
    if (!handle) {
      handle = await ctx.repo.create2(model.newStudy(title ?? "FEA study"));
      made = { url: handle.url, name: null, kind: STUDY_TYPE };
      changes.push("made the study");
    }

    // the part: the one write that can still be refused (reading the model), so it goes first
    let notLinked = null;
    const linked = handle.doc().part?.url ?? null;
    if (partUrl === null) {
      if (handle.doc().part) {
        model.unlinkPart(modelCtx(ctx, handle, "unlink the part"));
        changes.push("unlinked the part");
      }
    } else if (input.reread || (partUrl !== undefined && partUrl !== linked)) {
      const again = (partUrl ?? linked) === linked;
      const r = await model.linkPart(modelCtx(ctx, handle, again ? "read the part again" : `link the part ${partUrl}`), partUrl ?? null);
      if (!r.ok) {
        if (!made) throw new Error(`Couldn't ${again ? "read the part again" : `link ${partUrl}`}: ${capital(r.error)}. Nothing was changed.`);
        notLinked = `the part ${partUrl} couldn't be linked: ${r.error}`;
      } else {
        let said = `${again ? "read the part again" : `linked the part ${partUrl}`}: “${r.part.title}” (${r.how}), ${r.part.faces.length} faces`;
        if (r.carried) said += `; ${r.carried} of the supports and loads kept their faces`;
        for (const l of r.lost) said += `; the ${l.what} “${l.name}” [${l.id}] lost ${l.faces} face${l.faces === 1 ? "" : "s"} the new part has nothing like: give it faces again with fea_setup update_${l.what}`;
        changes.push(said);
      }
    }
    if (serverUrl !== undefined && serverUrl !== (handle.doc().server ?? null)) {
      const r = await model.setServer(modelCtx(ctx, handle, serverUrl ? `use the server ${serverUrl}` : "no server"), serverUrl);
      if (!r.ok) throw new Error(`\`server\` ${serverUrl}: ${r.error}.${changes.length ? ` Done before it: ${changes.join("; ")}.` : ""}`);
      changes.push(serverUrl ? `server ${serverUrl}` : "no server");
    }
    if (input.select_run !== undefined) {
      const runUrl = input.select_run === null || input.select_run === "" ? null : parseAutomergeUrl(input.select_run);
      if (runUrl !== (handle.doc().selected ?? null)) {
        model.selectRun(modelCtx(ctx, handle, runUrl ? `show the run ${runUrl}` : "show no run"), runUrl);
        changes.push(runUrl ? `showing the run ${runUrl}` : "showing no run");
      }
    }
    for (const u of forget) {
      model.forgetRun(modelCtx(ctx, handle, `take the run ${u} off the list`), u);
      changes.push(`took the run ${u} off the list`);
    }
    if (title && !made && title !== handle.doc().title) {
      handle.change((d) => void (d.title = title), { message: message(ctx, `title “${title}”`) });
      changes.push(`title “${title}”`);
    }
    if (made) {
      made.name = handle.doc().title ?? "FEA study";
      changes[0] = `made the study “${made.name}”`;
      if (folder) {
        folder.change((f) => void f.docs.push({ name: made.name, type: STUDY_TYPE, url: handle.url }), { message: message(ctx, `file the FEA study “${made.name}”`) });
        changes.push(`filed it in ${folder.url}`);
      }
    }

    const c = await loadStudy(ctx, handle);
    const head = [changes.length ? `Done: ${changes.join("; ")}.` : null, notLinked ? `Not done: ${notLinked}. fea_study { study: "${handle.url}", part } tries again.` : null].filter(Boolean).join("\n");
    const text = report(c, { head: head || null, faces: input.faces, facing });
    return made ? { text, doc: made } : text;
  },
  summarize(input) {
    if (!input?.study) return `new FEA study${input?.title ? ` · ${input.title}` : ""}`;
    const what = ["part", "reread", "server", "title", "select_run", "forget_runs"].filter((k) => input[k] !== undefined);
    return what.length ? `FEA study · set ${what.join(", ")}` : "FEA study · inspect";
  },
};

// ---------------------------------------------------------------- fea_setup

/** Where in the input a change came from, for its refusal: `add_load`, or `add_load[1]` in a list. */
const listed = (v, field) => (Array.isArray(v) ? v.map((x, i) => [x, `\`${field}[${i}]\``]) : [[v, `\`${field}\``]]);

const SUPPORT_ADD = ["kind", "name", "faces"];
const SUPPORT_UPDATE = ["id", "name", "kind", "faces"];
const LOAD_ADD = { force: ["kind", "name", "faces", "magnitude", "direction"], pressure: ["kind", "name", "faces", "pressure"], gravity: ["kind", "name", "acceleration", "direction"] };
const LOAD_UPDATE = ["id", "name", "faces", "magnitude", "pressure", "acceleration", "direction"];
const MATERIAL_FIELDS = ["id", "name", "E", "nu", "density", "yield"];
const QUANTITY_FIELDS = { magnitude: ["force", "a force's magnitude"], pressure: ["pressure", "a pressure"], acceleration: ["acceleration", "gravity's acceleration"] };

/** A load's fields from an input, its quantities read (refusing what has no unit). A direction stays as given: "into"/"away" need the part. */
function loadPatch(o, keys, what) {
  const patch = {};
  for (const k of keys) {
    if (o[k] === undefined || k === "kind" || k === "id") continue;
    if (QUANTITY_FIELDS[k]) patch[k] = quantity(o[k], QUANTITY_FIELDS[k][0], `${what}.${k} (${QUANTITY_FIELDS[k][1]})`);
    else patch[k] = o[k];
  }
  if (patch.direction !== undefined && typeof patch.direction === "string" && patch.direction !== "into" && patch.direction !== "away")
    throw new Error(`${what}.direction is three numbers ([0, -1, 0] is down) or "into" / "away", not ${quote(patch.direction)}.`);
  return patch;
}

/** A direction of "into" or "away" from a load's faces, as the study tool's Direction menu makes it. */
function resolveDirection(patch, faces, part, what) {
  if (typeof patch.direction !== "string") return { ok: true };
  const place = part ? placeOf(part, faces ?? []) : null;
  if (!place?.normal) return { ok: false, error: `${what}.direction “${patch.direction}” needs faces that face one way, to point ${patch.direction === "into" ? "into" : "away from"} them` };
  patch.direction = place.normal.map((x) => Number((patch.direction === "into" ? -x : x).toPrecision(12)));
  return { ok: true };
}

/**
 * The changes an input asks for, in the order they are applied, each a
 * function of (a study-model context, the part) → study-model's answer.
 * Throws on anything that doesn't read as written (shape, units, kinds).
 */
export function setupChanges(input) {
  const out = [];
  const add = (what, said, apply) => out.push({ what, said, apply });
  if (input.analysis !== undefined) add("`analysis`", `analysis ${input.analysis}`, (m) => model.setAnalysis(m, input.analysis));
  if (input.modes !== undefined) add("`modes`", `${input.modes} modes`, (m) => model.setModes(m, input.modes));
  if (input.material !== undefined) {
    const raw = typeof input.material === "string" ? { id: input.material } : input.material;
    onlyKeys(raw, MATERIAL_FIELDS, "`material`");
    const fields = {};
    if (raw.name !== undefined) fields.name = raw.name;
    if (raw.E !== undefined) fields.E = quantity(raw.E, "pressure", "`material.E` (Young's modulus)");
    if (raw.nu !== undefined) fields.nu = raw.nu;
    if (raw.density !== undefined) fields.density = quantity(raw.density, "density", "`material.density`");
    if (raw.yield !== undefined) fields.yield = raw.yield === null ? null : quantity(raw.yield, "pressure", "`material.yield` (yield strength)");
    const ids = MATERIALS.map((m) => m.id).join(", ");
    if (raw.id !== undefined)
      add("`material.id`", `material ${raw.id}`, (m) => {
        const r = model.setMaterial(m, { id: raw.id });
        return r.ok ? r : { ok: false, error: `${r.error}; the list: ${ids}` };
      });
    if (Object.keys(fields).length) add("`material`", `material ${Object.keys(fields).join(", ")}`, (m) => model.setMaterial(m, fields));
  }
  if (input.mesh !== undefined) {
    onlyKeys(input.mesh, ["size", "order"], "`mesh`");
    const o = {};
    if (input.mesh.size !== undefined) {
      if (MESH_PRESETS.includes(input.mesh.size)) o.size = input.mesh.size;
      else {
        const q = readQuantity(input.mesh.size, "length", "`mesh.size`");
        if (!q.ok) throw new Error(`\`mesh.size\` is ${MESH_PRESETS.join(", ")} or a length with its unit (like "2 mm"; units: ${unitsOf("length").join(", ")}), not ${quote(input.mesh.size)}.`);
        o.size = q.value;
      }
    }
    if (input.mesh.order !== undefined) o.order = input.mesh.order;
    add("`mesh`", `mesh ${[o.size === undefined ? null : typeof o.size === "string" ? o.size : format(o.size), o.order === undefined ? null : `order ${o.order}`].filter(Boolean).join(", ")}`, (m) => model.setMesh(m, o));
  }
  for (const [kind, field] of [["support", "remove_support"], ["load", "remove_load"]]) {
    if (input[field] === undefined) continue;
    const ids = Array.isArray(input[field]) ? input[field] : [input[field]];
    if (!ids.length || ids.some((id) => typeof id !== "string")) throw new Error(`\`${field}\` is an id, or a list of ids, as fea_study lists them in [brackets].`);
    for (const id of ids)
      add(`\`${field}\` ${quote(id)}`, `removed the ${kind} [${id}]`, (m) => {
        const items = normalizeSetup(m.handle.doc().setup)[`${kind}s`];
        if (!items[id]) return { ok: false, error: `there is no ${kind} with that id; ${Object.keys(items).length ? `the ${kind}s: ${listOf(items).map((x) => `[${x.id}] “${x.name}”`).join(", ")}` : `the study has no ${kind}s`}` };
        return kind === "support" ? model.removeSupport(m, id) : model.removeLoad(m, id);
      });
  }
  const unknownId = (kind) => (m, r) => {
    if (r.ok || !/isn't in the study/.test(r.error)) return r;
    const items = listOf(normalizeSetup(m.handle.doc().setup)[`${kind}s`]);
    return { ok: false, error: `${r.error}; the ${kind}s: ${items.map((x) => `[${x.id}] “${x.name}”`).join(", ") || "none"}` };
  };
  if (input.update_support !== undefined)
    for (const [o, what] of listed(input.update_support, "update_support")) {
      onlyKeys(o, SUPPORT_UPDATE, what);
      if (typeof o.id !== "string") throw new Error(`${what} needs the support's \`id\`, as fea_study lists it in [brackets].`);
      const patch = Object.fromEntries(["name", "kind", "faces"].filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
      add(what, `changed the support [${o.id}]: ${Object.keys(patch).join(", ") || "nothing"}`, (m, part) => unknownId("support")(m, model.updateSupport(m, part, o.id, patch)));
    }
  if (input.update_load !== undefined)
    for (const [o, what] of listed(input.update_load, "update_load")) {
      onlyKeys(o, LOAD_UPDATE, what);
      if (typeof o.id !== "string") throw new Error(`${what} needs the load's \`id\`, as fea_study lists it in [brackets].`);
      const patch = loadPatch(o, LOAD_UPDATE, what);
      add(what, `changed the load [${o.id}]: ${Object.keys(patch).join(", ") || "nothing"}`, (m, part) => {
        const at = normalizeSetup(m.handle.doc().setup).loads[o.id];
        const p = { ...patch };
        if (!at) return unknownId("load")(m, model.updateLoad(m, part, o.id, p));
        const dir = resolveDirection(p, p.faces ?? at.faces, part, what);
        if (!dir.ok) return dir;
        return unknownId("load")(m, model.updateLoad(m, part, o.id, p));
      });
    }
  if (input.add_support !== undefined)
    for (const [o, what] of listed(input.add_support, "add_support")) {
      onlyKeys(o, SUPPORT_ADD, what);
      if (!Array.isArray(o.faces) || !o.faces.length) throw new Error(`${what} needs \`faces\`: the face numbers it holds, as fea_study lists them.`);
      const kind = o.kind ?? "fixed";
      add(what, `added a ${kind === "slide" ? "sliding" : kind} support`, (m, part) => model.addSupport(m, part, { kind, name: o.name ?? null, faces: o.faces }));
    }
  if (input.add_load !== undefined)
    for (const [o, what] of listed(input.add_load, "add_load")) {
      if (!o || typeof o !== "object" || !LOAD_ADD[o.kind]) throw new Error(`${what} needs a \`kind\`: force, pressure or gravity (not ${quote(o?.kind)}).`);
      const keys = LOAD_ADD[o.kind];
      onlyKeys(o, keys, `${what} (${o.kind})`);
      const need = { force: ["faces", "magnitude", "direction"], pressure: ["faces", "pressure"], gravity: [] }[o.kind];
      const missing = need.filter((k) => o[k] === undefined || (k === "faces" && (!Array.isArray(o.faces) || !o.faces.length)));
      if (missing.length) throw new Error(`${what} (${o.kind}) needs ${missing.map((k) => `\`${k}\``).join(", ")}: a ${o.kind} is { ${keys.join(", ")} }.`);
      const patch = loadPatch(o, keys, what);
      add(what, `added a ${o.kind}`, (m, part) => {
        const p = { ...patch };
        const dir = resolveDirection(p, p.faces, part, what);
        if (!dir.ok) return dir;
        return model.addLoad(m, part, { kind: o.kind, ...p });
      });
    }
  return out;
}

const SETUP_INPUTS = ["study", "analysis", "modes", "material", "mesh", "remove_support", "remove_load", "update_support", "update_load", "add_support", "add_load"];

export const setupTool = {
  async execute(input, ctx) {
    onlyKeys(input, SETUP_INPUTS, "fea_setup");
    const handle = await findStudy(ctx, input.study);
    const changes = setupChanges(input);
    let c = await loadStudy(ctx, handle);
    if (!changes.length) return report(c, { head: "Nothing asked: the study as it is.", listFaces: false });
    // every change on a copy of the setup, by study-model's own actions; the first refusal stops it all
    const scratch = scratchOf(handle, ["setup"]);
    let t = Date.now();
    const m = { repo: ctx.repo, handle: scratch, now: () => t++, by: BY };
    const said = [];
    for (const ch of changes) {
      const r = ch.apply(m, c.part);
      if (!r.ok) throw new Error(`${ch.what}: ${capital(r.error)}. Nothing was changed.`);
      said.push(r.id ? `${ch.said} [${r.id}]` : ch.said);
    }
    const next = scratch.doc().setup;
    const differs = !same(handle.doc().setup, next);
    if (differs) handle.change((d) => assign(d, "setup", next), { message: message(ctx, `set up the study: ${said.join("; ")}`) });
    c = await loadStudy(ctx, handle);
    return report(c, { head: differs ? `Done: ${said.join("; ")}.` : "Nothing changed: the setup already reads so.", listFaces: false });
  },
  summarize(input) {
    const bits = ["analysis", "modes", "material", "mesh", "add_support", "update_support", "remove_support", "add_load", "update_load", "remove_load"].filter((k) => input?.[k] !== undefined);
    return `FEA setup${bits.length ? ` · ${bits.join(", ")}` : ""}`;
  },
};

// ---------------------------------------------------------------- fea_run

export const runTool = {
  async execute(input, ctx) {
    const handle = await findStudy(ctx, input.study);
    const c = await loadStudy(ctx, handle);
    const r = await model.runStudy(modelCtx(ctx, handle, `run the study “${handle.doc().title ?? "FEA study"}”`));
    if (!r.ok) throw new Error(`Can't run: ${r.error}. Nothing was asked for (fea_study { study } reports the study).`);
    const run = (await ctx.repo.find(r.url)).doc();
    const sv = c.server.handle?.doc() ?? c.server.doc;
    const ahead = queueCounts(sv, r.pools).listed - 1;
    const est = c.part?.solid ? meshEstimate(c.setup, c.part) : null;
    const lines = [
      `Asked “${sv.title ?? "FEA server"}” (served by ${servedBy(r.pools)}) for a run: ${r.url} — “${run.title}”, ${statusLine(run)}${ahead > 0 ? `, ${ahead} ahead of it` : ""}.`,
      est ? `Its mesh will be about ${est.nodes.toLocaleString("en")} nodes (${est.elements.toLocaleString("en")} ${c.setup.mesh.order === 2 ? "ten" : "four"}-node elements at ${pretty(est.size, "length")}).` : null,
      `A run's state is the small field ${JSON.stringify(STATUS_PATH)} of its document: queued → meshing → solving → post → done, or failed, or cancelled; only the machine running it writes it. A run cancelled before it started, or that its machine never finished, can stay "queued" there: fea_results says what became of it.`,
      `To wait, watch it: doc_watch { url: "${r.url}", path: ${JSON.stringify(STATUS_PATH)}, match: "${STATUS_END}" }. Then fea_results { runs: ["${r.url}"] }. fea_stop { runs: ["${r.url}"] } cancels it.`,
    ];
    return { text: lines.filter(Boolean).join("\n"), made: [{ url: r.url, name: run.title, kind: RUN_TYPE }] };
  },
  summarize() {
    return "FEA run";
  },
};

// ---------------------------------------------------------------- fea_results

/** One run's lines under the table: its URL and state, what it was asked, and what it found or why it didn't. */
function runSection(i, { url, run }) {
  const state = run.status === "failed" || run.status === "cancelled" ? run.status : run.status === "done" ? statusLine(run) : `${run.status}, ${statusLine(run)}`;
  const lines = [`${i}. ${url} — “${run.title ?? "FEA run"}”: ${state}.`];
  lines.push(`   Asked: ${inputs(run).map((r) => `${r.label} ${r.value}`).join("; ")}.`);
  if (run.status === "done") {
    const groups = new Map();
    for (const f of figures(run)) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(`${f.label} ${f.value}`);
    }
    for (const [g, rows] of groups) lines.push(`   ${g}: ${rows.join("; ")}.`);
    for (const note of run.notes ?? []) lines.push(`   Note: ${note}`);
  } else if (run.status === "failed") {
    const stage = (run.stages ?? []).find((s) => s.status === "failed");
    const err = String(run.error ?? "no reason given").replace(/\s+/g, " ").trim();
    lines.push(`   Failed${stage ? ` at “${stage.label}”` : ""}: ${err.length > MAX_ERROR ? `${err.slice(0, MAX_ERROR - 1)}…` : err}`);
  } else if (run.status === "cancelled") lines.push("   Cancelled: nothing was kept.");
  else lines.push(`   Not finished: watch ${JSON.stringify(STATUS_PATH)} with doc_watch until it is ${STATUS_END.split("|").join(", ")}.`);
  return lines.join("\n");
}

export const resultsTool = {
  async execute(input, ctx) {
    let urls;
    let head = "";
    if (input.runs !== undefined) {
      if (!Array.isArray(input.runs) || !input.runs.length) throw new Error("`runs` is a list of run URLs (fea_run returns them).");
      if (input.runs.length > MAX_RUNS) throw new Error(`At most ${MAX_RUNS} runs a call; ${input.runs.length} were asked for.`);
      urls = input.runs.map((u) => urlOf(u, "runs", "an FEA run"));
    } else if (input.study !== undefined) {
      const handle = await findStudy(ctx, input.study);
      const all = Array.isArray(handle.doc().runs) ? [...handle.doc().runs] : [];
      urls = all.slice(-MAX_RUNS);
      head = `FEA study “${handle.doc().title ?? "FEA study"}” (${handle.url}): ${all.length} run${all.length === 1 ? "" : "s"}, oldest first${all.length > urls.length ? `; the ${all.length - urls.length} earliest aren't listed (pass \`runs\` to pick)` : ""}.\n`;
      if (!all.length) return `${head}No runs yet: fea_run asks for one.`;
    } else throw new Error("Pass `runs` (run URLs) or `study` (a study's URL: all its runs).");
    const rows = await Promise.all(
      urls.map(async (url) => {
        try {
          const doc = (await ctx.repo.find(url)).doc();
          if (typeOf(doc) !== RUN_TYPE) return { url, run: null, error: `not an FEA run (${typeOf(doc) ?? "untyped"})` };
          return { url, run: await shownDoc(ctx, doc) };
        } catch (err) {
          return { url, run: null, error: String(err?.message ?? err) };
        }
      }),
    );
    const readable = rows.filter((r) => r.run);
    const parts = [head + (readable.length ? `${runsTable(readable)}\n\nThe rows in order:` : "None of these could be read:")];
    let i = 0;
    for (const r of rows) {
      i++;
      parts.push(r.run ? runSection(i, r) : `${i}. ${r.url}: couldn't be read (${r.error}).`);
    }
    return parts.join("\n");
  },
  summarize(input) {
    return `FEA results · ${Array.isArray(input?.runs) ? `${input.runs.length} run${input.runs.length === 1 ? "" : "s"}` : "a study"}`;
  },
};

/** A run as a person sees it: its doc, with the status its task gives it (shownRun), from one look at the task. */
async function shownDoc(ctx, doc) {
  if (isTerminal(doc.status)) return doc;
  const s = shownRun(doc, await lookAtTask(ctx.repo, doc));
  return s.status === doc.status && s.error === (doc.error ?? null) ? doc : { ...doc, status: s.status, error: s.error };
}

// ---------------------------------------------------------------- fea_stop

export const stopTool = {
  async execute(input, ctx) {
    if (!Array.isArray(input.runs) || !input.runs.length) throw new Error("`runs` is a list of run URLs to cancel.");
    // every one checked before any is asked
    const handles = [];
    for (const raw of input.runs) {
      const url = urlOf(raw, "runs", "an FEA run");
      handles.push(await findTyped(ctx, url, RUN_TYPE, "an FEA run", "Nothing was cancelled."));
    }
    const lines = [];
    for (const h of handles) {
      const st = (await shownDoc(ctx, h.doc())).status;
      if (isTerminal(st)) {
        lines.push(`${h.url}: already ${st}; nothing to cancel.`);
        continue;
      }
      const r = await model.stopRun({ repo: ctx.repo, handle: null, message: message(ctx, `cancel the run ${h.url}`) }, h.url);
      lines.push(
        !r.ok
          ? `${h.url}: ${r.error}.`
          : st === "queued"
            ? `${h.url}: cancelled. If it hadn't started it never will, and its status field stays "queued" (fea_results shows it cancelled); if it had, the field says cancelled within seconds.`
            : `${h.url}: cancelled (it was ${st}): the solver is stopped within seconds, and its status (${JSON.stringify(STATUS_PATH)}) then says cancelled.`,
      );
    }
    return lines.join("\n");
  },
  summarize(input) {
    return `FEA cancel · ${input?.runs?.length ?? 0} run${input?.runs?.length === 1 ? "" : "s"}`;
  },
};
