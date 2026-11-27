// The case, handed to the agent: five `agent:tool` executors over the same
// model the case tool's buttons use (src/case-model.js), so neither has to
// drive the other. Their descriptions and schemas are plain JSON in
// src/agent-meta.js (the agent reads them before it loads anything);
// src/agent-tools.test.js keeps the two in step.
//
//   openfoam_case     make a case, or link its hull, parts, bow, server; reports
//                     what the hull is (every part's extent, closed or not)
//   openfoam_setup    the analysis, speed with its unit, attitude or a mass to
//                     float at (with the trim and heel it floats at), mesh, …
//   openfoam_run      ask for one run or a sweep; says which path to watch
//   openfoam_results  one table of runs: status, R_T and its parts, F_z
//                     against weight, convergence, cells
//   openfoam_stop     cancel, or finish now
//
// Every input is something another tool produces: automerge: URLs, numbers
// with their units, part names. Every write is one change whose message
// names the agent session and why. Each call asks the registry for the task
// client (the Tasks package's library) and is refused at once, not held,
// where that package isn't installed.

import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { CASE_TYPE, RUN_TYPE, initCase, requestFinish } from "./protocol.js";
import { defaultSetup, normalizeSetup, patchSetup, writeSetup, setupProblems, parseSpeed, formatSpeed, formatSpeedBoth, formatDuration, MODES, MODE_LABELS, MESH_PRESETS } from "./setup.js";
import { readHull, hullModel, prepareModel, partShells, unknownParts, floatAt, keepDisplacement, parseMass, sinkageMeaning, keepHull, runBlocker, queueRuns, preflight } from "./case-model.js";
import { resultsTable, runLine, MAX_ROWS } from "./results.js";
import { pathLabel } from "./hull/acquire.js";
import { parseAutomergeUrl } from "./dnd.js";
import { version as TOOL_VERSION } from "../package.json";

// ---------------------------------------------------------------- helpers

/** The change message: who (the agent, which session) and why. */
// The session is the agent's to name: its tool context gives it as
// `ctx.session` ({ url, doc() }), and has no other field for it.
const message = (ctx, why) => `agent${ctx?.session?.url ? ` ${ctx.session.url}` : ""}: ${why}`;
const MADE = { tool: "openfoam", version: TOOL_VERSION };
/** The task client, or a refusal saying the Tasks package isn't here. */
async function taskClient() {
  const tasks = (await getRegistry("patchwork:library").load("tasks-next"))?.module;
  if (!tasks) throw new Error("OpenFOAM needs the Tasks package, which is not installed here.");
  return tasks;
}
/** How many parts a report lists; more are counted. */
export const MAX_PARTS = 40;
/** How many runs one call may ask for. */
export const MAX_SWEEP = 20;

function urlOf(input, field, what) {
  if (input == null || input === "") throw new Error(`Pass \`${field}\`: ${what}.`);
  const url = parseAutomergeUrl(input);
  if (!url) throw new Error(`\`${field}\` ${JSON.stringify(input)} isn't an automerge: URL (${what}).`);
  return url;
}

async function findTyped(ctx, url, type, label, hint) {
  let h;
  try {
    h = await ctx.repo.find(url);
  } catch (err) {
    throw new Error(`Couldn't open ${url} (${err?.message ?? err}).`);
  }
  const t = h.doc()?.["@patchwork"]?.type;
  if (t !== type) throw new Error(`${url} is ${t ? `a ${t} document` : "not a typed document"}, not ${label}.${hint ? ` ${hint}` : ""}`);
  return h;
}

const findCase = (ctx, input) => findTyped(ctx, urlOf(input, "case", "the automerge: URL of an OpenFOAM case (openfoam_case makes one)"), CASE_TYPE, "an OpenFOAM case", "openfoam_case makes one.");

/** The case's server (a task queue), and (unless `hear` is false) the machines heard serving it. */
async function openServer(ctx, tasks, url, { hear = true } = {}) {
  if (!url) return { url: null, handle: null, doc: null, error: null, pools: [] };
  try {
    const handle = await ctx.repo.find(url);
    const doc = handle.doc();
    if (!tasks.isQueue(doc)) return { url, handle, doc, error: "that link isn't a task queue (the OpenFOAM host prints one when it starts)", pools: [] };
    return { url, handle, doc, error: null, pools: hear ? await tasks.hearServing(ctx.repo, url) : [] };
  } catch (err) {
    return { url, handle: null, doc: null, error: `couldn't load the queue (${err?.message ?? err})`, pools: [] };
  }
}

/** Everything about a case a report needs: its hull read and prepared at the setup's attitude, its server. */
async function loadCase(ctx, tasks, handle, { fromSource = false, hullField } = {}) {
  const doc = handle.doc();
  const setup = normalizeSetup(doc.setup);
  const hf = hullField ?? doc.hull ?? null;
  const result = hf?.url ? await readHull(ctx.repo, hf, { tasks, fromSource }) : null;
  const model = result?.ok ? hullModel(result, hf) : null;
  let prepared = null;
  if (model) {
    try {
      prepared = prepareModel(result, model, setup.attitude);
    } catch (err) {
      prepared = { error: String(err?.message ?? err) };
    }
  }
  const server = await openServer(ctx, tasks, doc.server ?? null);
  return { tasks, handle, doc, setup, hullField: hf, result, model, prepared, server };
}

const blockerOf = (c) =>
  runBlocker({ tasks: c.tasks, hullUrl: c.hullField?.url, result: c.result, prepared: c.prepared, serverUrl: c.server.url, serverDoc: c.server.doc, serverError: c.server.error });

const m3 = (v) => (Number.isFinite(v) ? +v.toFixed(3) : "?");
const range = (lo, hi) => `${m3(lo)}…${m3(hi)}`;

// ---------------------------------------------------------------- the report

function hullText(c) {
  const hf = c.hullField;
  if (!hf?.url) return "Hull: none linked. Link one with openfoam_case { case, hull: <automerge: URL of a 3D file or hull document> }.";
  const r = c.result;
  if (!r?.ok) return `Hull: ${hf.url}, which can't be read here: ${r?.error ?? "unknown error"}.`;
  const m = c.model;
  const where = r.path === "stash" ? `kept with the case (read ${r.stash?.builtAt ? new Date(r.stash.builtAt).toISOString().slice(0, 16).replace("T", " ") : "?"}${r.providerName ? ` by ${r.providerName}` : ""}; the original isn't loaded)` : `read from the original (${pathLabel(r)})`;
  const lines = [
    `Hull: “${r.title}” (${hf.url}), ${where}.`,
    `  bow ${m.frame.bow}; waterline at model z = ${m3(m.frame.waterZ)} m ${m.water ? `(the water plane “${m.water.name}”)` : "(the model's z = 0: it draws no water plane)"}.`,
  ];
  if (m.parts.length) {
    const shells = partShells(r, m);
    const chosen = new Set(m.names);
    lines.push(`  parts: ${m.names.length} of ${m.parts.length} chosen as the hull${Array.isArray(hf.parts) ? "" : " (the default: what meets the water)"}. Extents in the model's frame, metres:`);
    for (const p of m.parts.slice(0, MAX_PARTS)) {
      const sh = shells[p.name];
      const shell = p === m.water ? "water plane" : sh?.checked ? (sh.closed ? "closed" : `${sh.openEdges.toLocaleString("en")} open edges`) : `not checked: ${sh?.why ?? "?"}`;
      lines.push(`  [${chosen.has(p.name) ? "x" : " "}] ${p.name} — ${p.triangles.toLocaleString("en")} triangles; x ${range(p.min[0], p.max[0])}, y ${range(p.min[1], p.max[1])}, z ${range(p.min[2], p.max[2])}; ${shell}`);
    }
    if (m.parts.length > MAX_PARTS) lines.push(`  … and ${m.parts.length - MAX_PARTS} more parts.`);
  }
  return lines.join("\n");
}

function floatingText(c) {
  const p = c.prepared;
  if (!p) return null;
  if (p.error) return `Floating: can't prepare the hull: ${p.error}.`;
  const i = p.info;
  const a = c.setup.attitude;
  const { rho } = preflight(c.setup, i);
  const lines = [
    `Floating: sinkage ${m3(a.sinkage)} m, trim ${a.trim}° (bow down positive), heel ${a.heel}° (starboard down positive) → displaces ${((i.volume * rho) / 1000).toFixed(3)} t (${i.volume.toFixed(3)} m³ of ${c.setup.water === "fresh" ? "fresh water" : "seawater"} at ${c.setup.temperature} °C); draft ${m3(i.draft)} m, waterline ${m3(i.lwl)} × ${m3(i.bwl)} m, wetted area ${i.wettedArea.toFixed(2)} m², LCB x = ${m3(i.lcb)} m.`,
    `  The hull is ${i.closed ? "one closed shell" : `not closed (${i.boundaryEdges} open edges)`}${i.reliable ? "" : ": the displacement and wetted area are rough"}${i.pierces ? "" : "; it doesn't cross the waterline"}.`,
    `  ${sinkageMeaning(i.attitude.pivotX).replace(/^s/, "S")}.`,
  ];
  for (const w of p.warnings ?? []) lines.push(`  warning: ${w}`);
  return lines.join("\n");
}

function setupText(s) {
  const bits = [
    MODE_LABELS[s.mode],
    formatSpeedBoth(s.speed),
    `${s.mesh} mesh`,
    `${s.iterations} iterations, ${s.stop === "settled" ? "stopping once settled (±1%)" : "all of them"}`,
    `${s.water === "fresh" ? "fresh water" : "seawater"} at ${s.temperature} °C`,
    `domain ${s.domain === "auto" ? "half if symmetric" : s.domain}`,
    s.cores ? `${s.cores} cores` : "the machine's choice of cores",
  ];
  if (s.keepVolume) bits.push("keeping the flow volume");
  if (s.warmStart) bits.push(`starting from ${s.warmStart}`);
  return `Setup: ${bits.join(" · ")}.`;
}

function expectText(c) {
  if (!c.prepared?.info) return null;
  const pf = preflight(c.setup, c.prepared.info);
  return `Expect: Fn ${pf.Fn.toFixed(3)}, Re ${pf.Re.toExponential(2)} on L = ${m3(pf.L)} m; ITTC-57 friction alone ${Math.round(pf.friction.R).toLocaleString("en")} N (the floor R_T should sit above); ${pf.half ? "half model" : "full model"}; ≈ ${Math.round(pf.cells / 1000)}k cells; ${pf.upTo ? "up to " : ""}≈ ${formatDuration(pf.seconds)} on ${pf.cores} cores${pf.volumeBytes ? `; flow volume ≈ ${Math.round(pf.volumeBytes / 1048576)} MB` : ""}.`;
}

function serverText(tasks, sv) {
  if (!sv.url) return "Server: none. Set one with openfoam_case { case, server: <the task queue URL the OpenFOAM host printed> }.";
  if (sv.error) return `Server: ${sv.url}: ${sv.error}.`;
  const by = tasks.servedBy(sv.pools);
  const q = tasks.queueCounts(sv.doc, sv.pools);
  return `Server: “${sv.doc.title ?? "OpenFOAM"}” (${sv.url}): ${by ? `served by ${by}` : "nobody is heard serving it (runs wait in its queue until a machine does)"}; ${q.running ? `running ${q.running}` : "nothing running"}${q.waiting ? `, ${q.waiting} waiting` : ""}.`;
}

function report(c, { head = null } = {}) {
  const d = c.handle.doc();
  const problems = setupProblems(d.setup);
  const blocker = blockerOf(c);
  const runs = Array.isArray(d.runs) ? d.runs.length : 0;
  return [
    head,
    `OpenFOAM case “${d.title ?? "OpenFOAM case"}” (${c.handle.url}).`,
    hullText(c),
    floatingText(c),
    setupText(c.setup),
    problems.length ? `Setup as stored: ${problems.join("; ")}. openfoam_setup writes it as shown above.` : null,
    expectText(c),
    serverText(c.tasks, c.server),
    `Runs: ${runs}${runs ? ": openfoam_results { case } tabulates them" : ""}.`,
    blocker ? `Not ready to run: ${blocker}` : `Ready: openfoam_run { case } asks for a run at ${formatSpeed(c.setup.speed)}, or pass \`speeds\` for a sweep.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------- openfoam_case

export const caseTool = {
  async execute(input, ctx) {
    const tasks = await taskClient();
    const changes = [];
    let handle;
    let made = null;
    if (input.case) handle = await findCase(ctx, input.case);
    else {
      const title = String(input.title ?? "").trim() || "OpenFOAM case";
      const doc = { "@patchwork": { type: CASE_TYPE } };
      initCase(doc, defaultSetup());
      doc.title = title;
      handle = await ctx.repo.create2(doc);
      made = { url: handle.url, name: title, kind: CASE_TYPE };
      changes.push(`made the case “${title}”`);
      if (input.folder) {
        const folderUrl = urlOf(input.folder, "folder", "the folder to file the new case in");
        const folder = await ctx.repo.find(folderUrl);
        if (!Array.isArray(folder.doc()?.docs)) throw new Error(`${folderUrl} is not a folder; the case was made but not filed (${handle.url}).`);
        folder.change((f) => void f.docs.push({ name: title, type: CASE_TYPE, url: handle.url }), { message: message(ctx, `file the OpenFOAM case “${title}”`) });
        changes.push(`filed it in ${folderUrl}`);
      }
    }

    // what the hull link becomes, checked before anything is written
    const doc = handle.doc();
    let hf = doc.hull ? JSON.parse(JSON.stringify(doc.hull)) : null;
    let hullChanged = false;
    if (input.hull !== undefined && input.hull !== null && input.hull !== "") {
      const url = urlOf(input.hull, "hull", "the 3D file or hull document to analyse");
      if (url === handle.url) throw new Error("A case can't be its own hull.");
      if (hf?.url !== url) {
        hf = { url };
        hullChanged = true;
        changes.push(`linked the hull ${url}`);
      }
    }
    if (input.bow !== undefined) {
      if (input.bow !== "+x" && input.bow !== "-x") throw new Error(`\`bow\` is "+x" or "-x" (the way the model's bow points), not ${JSON.stringify(input.bow)}.`);
      if (!hf) throw new Error("Link a hull (`hull`) before choosing which way its bow points.");
      if ((hf.bow ?? "+x") !== input.bow) changes.push(`bow ${input.bow}`);
      hf.bow = input.bow;
    }
    let partsChanged = false;
    if (input.parts !== undefined) {
      if (!hf) throw new Error("Link a hull (`hull`) before choosing its parts.");
      if (input.parts === "default") {
        partsChanged = Array.isArray(hf.parts);
        delete hf.parts;
        if (partsChanged) changes.push("parts back to the default (what meets the water)");
      } else {
        if (!Array.isArray(input.parts) || !input.parts.length || input.parts.some((p) => typeof p !== "string"))
          throw new Error('`parts` is a list of part names, exactly as openfoam_case lists them, or "default".');
        partsChanged = JSON.stringify(hf.parts ?? null) !== JSON.stringify(input.parts);
        hf.parts = [...input.parts];
        if (partsChanged) changes.push(`hull parts: ${input.parts.join(", ")}`);
      }
    }
    let serverUrl;
    if (input.server !== undefined && input.server !== null && input.server !== "") {
      serverUrl = urlOf(input.server, "server", "the task queue the OpenFOAM host printed");
      const sv = await openServer(ctx, tasks, serverUrl, { hear: false });
      if (sv.error) throw new Error(`\`server\` ${serverUrl}: ${sv.error}.`);
      if (serverUrl !== doc.server) changes.push(`server ${serverUrl}`);
      else serverUrl = undefined;
    }

    // read the hull as it will be linked: unknown parts are refused before anything is written
    const fromSource = input.reread === true;
    const c = await loadCase(ctx, tasks, handle, { fromSource, hullField: hf });
    if (input.parts !== undefined && input.parts !== "default" && c.model) {
      const unknown = unknownParts(c.model, input.parts);
      if (unknown.length) throw new Error(`No part named ${unknown.map((n) => JSON.stringify(n)).join(", ")} in “${c.result.title}”. Its parts: ${c.model.parts.map((p) => JSON.stringify(p.name)).join(", ")}.`);
    }
    // a hull someone chose (linked, parts the kept copy lacks, re-read) is kept with the case, as the case tool does
    let stash = hf?.stash ?? null;
    if (hf && (hullChanged || partsChanged || fromSource) && c.result?.ok && c.result.path !== "stash") {
      stash = await keepHull(ctx.repo, c.result, c.model, hf.url);
      changes.push(stash ? "kept the hull's chosen parts with the case" : "the hull is too big to keep with the case: it's read from the model each time");
      if (stash) hf.stash = stash;
    }
    const title = input.case && input.title != null && String(input.title).trim() ? String(input.title).trim() : null;
    if (title && title !== doc.title) changes.push(`title “${title}”`);
    const write = (title && title !== doc.title) || serverUrl || JSON.stringify(doc.hull ?? null) !== JSON.stringify(hf);
    if (write)
      handle.change(
        (d) => {
          if (title) d.title = title;
          if (JSON.stringify(d.hull ?? null) !== JSON.stringify(hf)) d.hull = hf;
          if (serverUrl) d.server = serverUrl;
        },
        { message: message(ctx, changes.join("; ") || "update the case") },
      );
    // the hull as just read stands (reading it again could mean converting the original twice)
    const after = { ...c, doc: handle.doc(), hullField: hf, server: serverUrl ? await openServer(ctx, tasks, serverUrl) : c.server };
    const text = report(after, { head: changes.length ? `Done: ${changes.join("; ")}.` : null });
    return made ? { text, doc: made } : text;
  },
  summarize(input) {
    if (!input?.case) return `new OpenFOAM case${input?.title ? ` · ${input.title}` : ""}`;
    const what = ["hull", "parts", "bow", "server", "title"].filter((k) => input[k] !== undefined);
    return what.length ? `OpenFOAM case · set ${what.join(", ")}` : "OpenFOAM case · inspect";
  },
};

// ---------------------------------------------------------------- openfoam_setup

const ENUMS = { mesh: MESH_PRESETS, stop: ["settled", "iterations"], domain: ["auto", "half", "full"], water: ["salt", "fresh"] };

function numberIn(input, key, lo, hi, unit) {
  const v = input;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`\`${key}\` must be a number${unit ? ` (${unit})` : ""}, not ${JSON.stringify(v)}.`);
  if (v < lo || v > hi) throw new Error(`\`${key}\` ${v}${unit ? ` ${unit}` : ""} is outside ${lo}…${hi}.`);
  return v;
}

/** The setup fields an input asks to change, checked: throws on anything that wouldn't read as written. */
export function setupPatch(input) {
  const patch = {};
  if (input.analysis !== undefined) {
    if (!MODES.includes(input.analysis)) throw new Error(`\`analysis\` is ${MODES.map((m) => `"${m}"`).join(" or ")}, not ${JSON.stringify(input.analysis)}.`);
    patch.mode = input.analysis;
  }
  if (input.speed !== undefined) patch.speed = parseSpeed(input.speed);
  if (input.attitude !== undefined) {
    if (!input.attitude || typeof input.attitude !== "object") throw new Error("`attitude` is { sinkage (m), trim (°), heel (°) }, any of them.");
    const a = {};
    for (const k of Object.keys(input.attitude)) if (!["sinkage", "trim", "heel"].includes(k)) throw new Error(`\`attitude.${k}\` isn't part of an attitude: sinkage (m), trim (°, bow down positive), heel (°, starboard down positive).`);
    if (input.attitude.sinkage !== undefined) a.sinkage = numberIn(input.attitude.sinkage, "attitude.sinkage", -50, 50, "m");
    if (input.attitude.trim !== undefined) a.trim = numberIn(input.attitude.trim, "attitude.trim", -10, 10, "°");
    if (input.attitude.heel !== undefined) a.heel = numberIn(input.attitude.heel, "attitude.heel", -60, 60, "°");
    patch.attitude = a;
  }
  for (const [key, list] of Object.entries(ENUMS))
    if (input[key] !== undefined) {
      if (!list.includes(input[key])) throw new Error(`\`${key}\` is ${list.map((v) => `"${v}"`).join(", ")}; not ${JSON.stringify(input[key])}.`);
      patch[key] = input[key];
    }
  if (input.temperature !== undefined) patch.temperature = numberIn(input.temperature, "temperature", 0, 30, "°C");
  if (input.iterations !== undefined) {
    patch.iterations = numberIn(input.iterations, "iterations", 50, 20000);
    if (!Number.isInteger(patch.iterations)) throw new Error(`\`iterations\` is a whole number, not ${input.iterations}.`);
  }
  if (input.cores !== undefined) {
    patch.cores = numberIn(input.cores, "cores", 0, 256);
    if (!Number.isInteger(patch.cores)) throw new Error(`\`cores\` is a whole number (0: the machine decides), not ${input.cores}.`);
  }
  if (input.keep_volume !== undefined) {
    if (typeof input.keep_volume !== "boolean") throw new Error("`keep_volume` is true or false.");
    patch.keepVolume = input.keep_volume;
  }
  if (input.start_from !== undefined) patch.warmStart = input.start_from === null || input.start_from === "" ? null : urlOf(input.start_from, "start_from", "a finished run whose solution starts this one, or null for rest");
  return patch;
}

export const setupTool = {
  async execute(input, ctx) {
    const tasks = await taskClient();
    const handle = await findCase(ctx, input.case);
    const patch = setupPatch(input);
    const fl = input.float;
    if (fl !== undefined && fl !== null) {
      if (typeof fl !== "object") throw new Error("`float` is { mass } (with its unit) or { keep_displacement: true }.");
      if (patch.attitude?.sinkage !== undefined) throw new Error("Give `attitude.sinkage` or `float`, not both: floating solves the sinkage.");
      if ((fl.mass !== undefined) === (fl.keep_displacement === true)) throw new Error("`float` takes one of `mass` (a mass with its unit, e.g. \"11984 kg\") or `keep_displacement: true`.");
    }
    if (patch.warmStart) {
      const run = await findTyped(ctx, patch.warmStart, RUN_TYPE, "an OpenFOAM run", "`start_from` takes a finished run's URL (openfoam_results lists them).");
      if (run.doc().status !== "done") throw new Error(`\`start_from\` ${patch.warmStart} is ${run.doc().status}; only a finished (done) run can start another.`);
    }
    const before = normalizeSetup(handle.doc().setup);
    const { setup: next, problems } = patchSetup(before, patch);
    if (problems.length) throw new Error(problems.join("; "));

    // float at the trim and heel this call ends with: the sinkage is solved for them
    const changes = Object.keys(patch).filter((k) => k !== "attitude").map((k) => `${k} ${k === "speed" ? formatSpeed(next.speed) : JSON.stringify(next[k])}`);
    for (const k of Object.keys(patch.attitude ?? {})) changes.push(`${k} ${next.attitude[k]}`);
    let floated = null;
    if (fl) {
      const c = await loadCase(ctx, tasks, handle);
      if (!c.result?.ok) throw new Error(`Can't float the hull: ${blockerOf(c) ?? c.result?.error ?? "no hull"}.`);
      if (fl.mass !== undefined) {
        const mass = parseMass(fl.mass);
        const f = floatAt(c.result, c.model, { mass, water: next.water, temperature: next.temperature, trim: next.attitude.trim, heel: next.attitude.heel });
        if (!f) throw new Error(`The whole hull displaces less than ${(mass / 1000).toFixed(3)} t at trim ${next.attitude.trim}° and heel ${next.attitude.heel}°: nothing was changed.`);
        next.attitude.sinkage = f.sinkage;
        floated = `floated at ${mass.toLocaleString("en")} kg: sinkage ${f.sinkage} m at trim ${next.attitude.trim}° and heel ${next.attitude.heel}°`;
      } else {
        const sink = keepDisplacement(c.result, c.model, next.attitude);
        if (sink == null) throw new Error(`The hull can't displace its upright volume heeled ${next.attitude.heel}°: nothing was changed.`);
        next.attitude.sinkage = sink;
        floated = `kept the upright displacement heeled ${next.attitude.heel}°: sinkage ${sink} m`;
      }
      changes.push(floated);
    }
    const stored = handle.doc().setup;
    const differs = JSON.stringify(normalizeSetup(stored)) !== JSON.stringify(next) || setupProblems(stored).length > 0;
    if (differs) handle.change((d) => writeSetup(d, next), { message: message(ctx, `set up the run: ${changes.join("; ") || "as shown"}`) });
    const c = await loadCase(ctx, tasks, handle);
    return report(c, { head: differs ? `Done: ${changes.join("; ") || "wrote the setup as shown"}.` : "Nothing changed: the setup already reads so." });
  },
  summarize(input) {
    const bits = [];
    if (input?.speed !== undefined) bits.push(typeof input.speed === "string" ? input.speed : `${input.speed?.value} ${input.speed?.unit}`);
    if (input?.analysis) bits.push(input.analysis);
    if (input?.float?.mass !== undefined) bits.push(`float ${typeof input.float.mass === "string" ? input.float.mass : `${input.float.mass?.value} ${input.float.mass?.unit}`}`);
    if (input?.mesh) bits.push(input.mesh);
    return `OpenFOAM setup${bits.length ? ` · ${bits.join(", ")}` : ""}`;
  },
};

// ---------------------------------------------------------------- openfoam_run

/** Which path of a run doc to watch, and the values it ends on. */
export const STATUS_PATH = Object.freeze(["status"]);
export const STATUS_END = "done|failed|cancelled";

export const runTool = {
  async execute(input, ctx) {
    const tasks = await taskClient();
    const handle = await findCase(ctx, input.case);
    let speeds = null;
    if (input.speeds !== undefined) {
      if (!Array.isArray(input.speeds) || !input.speeds.length) throw new Error('`speeds` is a list of speeds with their units, e.g. ["7 kn", "8 kn"]; leave it out to run at the setup\'s speed.');
      if (input.speeds.length > MAX_SWEEP) throw new Error(`At most ${MAX_SWEEP} runs a call; ${input.speeds.length} were asked for.`);
      speeds = input.speeds.map(parseSpeed);
    }
    const c = await loadCase(ctx, tasks, handle);
    const blocker = blockerOf(c);
    if (blocker) throw new Error(`Can't run yet: ${blocker} (openfoam_case reports the case).`);
    const setups = (speeds ?? [c.setup.speed]).map((speed) => normalizeSetup({ ...c.setup, speed }));
    const handles = await queueRuns(ctx.repo, {
      tasks,
      caseHandle: handle,
      serverHandle: c.server.handle,
      result: c.result,
      prepared: c.prepared,
      setups,
      by: "agent",
      made: MADE,
      message: message(ctx, `ask for ${setups.length === 1 ? "a run" : `${setups.length} runs`} at ${setups.map((s) => formatSpeed(s.speed)).join(", ")}`),
    });
    const online = c.server.pools.length > 0;
    const ahead = tasks.queueCounts(c.server.handle.doc(), c.server.pools).listed - handles.length;
    const lines = [
      `Asked for ${handles.length === 1 ? "a run" : `${handles.length} runs`} on “${c.server.doc.title ?? "OpenFOAM"}”: ${online ? `served by ${tasks.servedBy(c.server.pools)}` : "NOBODY IS SERVING IT — they wait in its queue until a machine does"}${ahead > 0 ? `; ${ahead} ahead of them` : ""}.`,
      ...handles.map((h, i) => `  ${i + 1}. ${h.url} — ${runLine(h.doc())}`),
      `Each run's state is the small field ${JSON.stringify(STATUS_PATH)} of its document: queued → meshing → solving → post → done, or failed, or cancelled. A run cancelled before it started stays "queued" there; openfoam_results says what became of it.`,
      `To wait, watch it: ${handles.map((h) => `doc_watch { url: "${h.url}", path: ${JSON.stringify(STATUS_PATH)}, match: "${STATUS_END}" }`).join("; ")}. Then openfoam_results { runs: [${handles.map((h) => `"${h.url}"`).join(", ")}] }.`,
      `Roughly: ${c.setup.mode === "free-surface" ? "a free-surface run takes tens of minutes" : "a double-body run takes about a minute"} on a laptop once it starts; runs go one after another unless the machine runs several at once.`,
    ];
    return { text: lines.join("\n"), made: handles.map((h) => ({ url: h.url, name: h.doc().title, kind: RUN_TYPE })) };
  },
  summarize(input) {
    return `OpenFOAM run${Array.isArray(input?.speeds) ? ` · sweep of ${input.speeds.length}` : ""}`;
  },
};

// ---------------------------------------------------------------- openfoam_results

export const resultsTool = {
  async execute(input, ctx) {
    const tasks = await taskClient();
    let urls;
    let head = "";
    if (input.runs !== undefined) {
      if (!Array.isArray(input.runs) || !input.runs.length) throw new Error("`runs` is a list of run URLs (openfoam_run returns them).");
      urls = input.runs.map((u) => urlOf(u, "runs", "an OpenFOAM run"));
    } else if (input.case !== undefined) {
      const handle = await findCase(ctx, input.case);
      const all = Array.isArray(handle.doc().runs) ? [...handle.doc().runs] : [];
      urls = all.slice(-MAX_ROWS);
      head = `OpenFOAM case “${handle.doc().title ?? ""}” (${handle.url}): ${all.length} runs, oldest first${all.length > urls.length ? `; the ${all.length - urls.length} earliest aren't listed` : ""}.\n`;
      if (!all.length) return `${head}No runs yet: openfoam_run asks for one.`;
    } else throw new Error("Pass `runs` (run URLs) or `case` (a case URL: all its runs).");
    const runs = await Promise.all(
      urls.map(async (url) => {
        try {
          const h = await ctx.repo.find(url);
          const doc = h.doc();
          if (doc?.["@patchwork"]?.type !== RUN_TYPE) return { url, doc: null, error: `not an OpenFOAM run (${doc?.["@patchwork"]?.type ?? "untyped"})` };
          return { url, doc: await shownDoc(ctx, tasks, doc) };
        } catch (err) {
          return { url, doc: null, error: String(err?.message ?? err) };
        }
      }),
    );
    return `${head}${resultsTable(runs)}`;
  },
  summarize(input) {
    return `OpenFOAM results · ${Array.isArray(input?.runs) ? `${input.runs.length} runs` : "a case"}`;
  },
};

/** A run as a person sees it: its doc, with the status its task gives it (shownRun), from one look at the task. */
async function shownDoc(ctx, tasks, doc) {
  if (tasks.isRunEnded(doc.status)) return doc;
  const s = tasks.shownRun(doc, await tasks.lookAtTask(ctx.repo, doc));
  return s.status === doc.status && s.error === (doc.error ?? null) ? doc : { ...doc, status: s.status, error: s.error };
}

// ---------------------------------------------------------------- openfoam_stop

export const stopTool = {
  async execute(input, ctx) {
    const tasks = await taskClient();
    if (!Array.isArray(input.runs) || !input.runs.length) throw new Error("`runs` is a list of run URLs to stop.");
    if (typeof input.keep !== "boolean") throw new Error("`keep`: true finishes now (the solver writes what it has and the results are read), false cancels (nothing is kept).");
    const lines = [];
    for (const raw of input.runs) {
      const url = urlOf(raw, "runs", "an OpenFOAM run");
      const h = await findTyped(ctx, url, RUN_TYPE, "an OpenFOAM run");
      const run = await shownDoc(ctx, tasks, h.doc());
      const st = run.status;
      if (tasks.isRunEnded(st)) lines.push(`${url}: already ${st}; nothing to stop.`);
      else if (input.keep && st !== "solving") lines.push(`${url}: ${st}, not solving, so there's nothing to finish yet; cancel it (keep: false) or wait.`);
      else if (input.keep) {
        h.change((d) => requestFinish(d), { message: message(ctx, "finish the run now") });
        lines.push(`${url}: asked to finish now: the solver writes what it has, then the results are read. Its status (${JSON.stringify(STATUS_PATH)}) says when it has.`);
      } else if (await tasks.cancelRun(ctx.repo, h.doc(), url)) {
        lines.push(
          st === "queued"
            ? `${url}: cancelled. If it hadn't started it never will, and its status field stays "queued" (openfoam_results shows it cancelled); if it had, the field says cancelled within seconds.`
            : `${url}: cancelled: the solver is stopped within seconds, and its status (${JSON.stringify(STATUS_PATH)}) then says cancelled.`,
        );
      } else lines.push(`${url}: its queue no longer lists it, so there's nothing to cancel; openfoam_results says how it ended.`);
    }
    return lines.join("\n");
  },
  summarize(input) {
    return `OpenFOAM ${input?.keep ? "finish" : "cancel"} · ${input?.runs?.length ?? 0} runs`;
  },
};
