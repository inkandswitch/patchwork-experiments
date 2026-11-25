// One run, start to finish: read the frozen part, mesh it, write the
// solver's input, solve, read the results back, and keep the run doc up to
// date throughout. `signal` stops it (daemon/run-task.mjs hands it the
// task's): the running program and every process under it are killed at
// once, and the run doc says why in the same moment (markStopped), since the
// thread this runs in is ended a few seconds later.

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, copyFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { run as runTool } from "./tools.mjs";
import { normalizeSetup, solverModel, meshEstimate } from "../src/setup.js";
import { decodePart } from "../src/part/kept.js";
import { surfaceMsh, geoScript, parseMsh } from "../src/solver/gmsh.js";
import { finishMesh } from "../src/solver/mesh.js";
import { applySetup } from "../src/solver/loads.js";
import { writeDeck } from "../src/solver/deck.js";
import { readFrd, readDat } from "../src/solver/frd.js";
import { vonMises, summarizeStatic, summarizeModal, skinLayer, staticNotes } from "../src/solver/post.js";
import { runIdOf, isTerminal, STAGES, encodeLayer, markStopped, STOP_REASONS } from "../src/protocol.js";
import { getBytes, externalize, serverWatch, sha256 } from "../src/segments.js";
import { pretty } from "../src/units.js";

/** How far apart a static run's strain energy and its loads' work may be before the run is refused (measured: under 1e-5 on every right answer). */
const ADRIFT = 1e-3;
const TAIL_LINES = 14;
const FLUSH_MS = 2000;

class Stopped extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

/**
 * The solver's input as a run keeps it: the deck with its long lists (nodes,
 * elements, node sets, nodal forces) cut to their first lines and a count.
 * What is left is what a person would read: the material, the supports, the
 * step and what it prints.
 */
export function deckOutline(text, keep = 6) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > keep * 2) out.push(...run.slice(0, keep), `** … ${run.length - keep} more lines`);
    else out.push(...run);
    run = [];
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("*")) {
      flush();
      out.push(line);
    } else run.push(line);
  }
  flush();
  return out.join("\n");
}

/**
 * @param {object} o
 * @param {import("@automerge/automerge-repo").Repo} o.repo
 * @param {import("@automerge/automerge-repo").DocHandle} o.handle   the run doc
 * @param {{ gmsh: string, ccx: string, gmshVersion: string|null, ccxVersion: string|null }} o.tools
 * @param {string} o.workDir      where run directories go
 * @param {number} o.cores        the default when the setup says 0
 * @param {number} o.maxNodes     the largest mesh this daemon will solve
 * @param {object} o.daemon       where and with what it runs ({ host, platform, calculix, gmsh, … }), written to the run
 * @param {(msg: string) => void} [o.say]
 * @param {AbortSignal} [o.signal] aborted with a reason in STOP_REASONS
 * @param {(urls: string[]) => Promise<string[]>} [o.verify]  a second peer's check of docs the server didn't acknowledge (src/segments.js)
 * @returns {Promise<"done"|"failed"|"cancelled"|"stopped">}  "stopped": told to stop by `signal` (the run doc says why, unless it yielded)
 */
export async function runJob({ repo, handle, tools, workDir, cores, maxNodes, daemon, say = () => {}, signal = null, verify = null }) {
  const run0 = handle.doc();
  if (isTerminal(run0.status)) return run0.status;
  const setup = normalizeSetup(run0.setup);
  // which of the docs this job makes the sync server has (start it before making any)
  const onServer = serverWatch(repo);
  const id = runIdOf(handle.url);
  const dir = join(workDir, id);
  const np = Math.max(1, setup.cores || cores);
  const now = () => Date.now();
  // once told to stop, nothing more is written: the stop wrote what is to be said
  let stopKind = null;
  const change = (fn) => {
    if (!stopKind) handle.change(fn);
  };
  const setStage = (sid, patch) =>
    change((d) => {
      const i = d.stages.findIndex((s) => s.id === sid);
      if (i < 0) return;
      for (const [k, v] of Object.entries(patch)) d.stages[i][k] = v;
    });
  const begin = (sid) => {
    if (stopKind) throw new Stopped(stopKind);
    const status = STAGES.find((s) => s.id === sid).status;
    change((d) => {
      if (d.status !== status) d.status = status;
    });
    setStage(sid, { status: "running", startedAt: now(), tail: null });
  };
  const done = (sid, note) => setStage(sid, { status: "done", endedAt: now(), note: note ?? null });

  // ---- the signal
  let current = null; // the running program
  let killed = null; // the kill under way: done once every process under the program has been sent SIGKILL
  const onAbort = () => {
    if (stopKind) return;
    const reason = STOP_REASONS.includes(signal.reason) ? signal.reason : "stopping";
    say(`run ${id}: ${reason}`);
    killed = current?.kill() ?? null;
    handle.change((d) => markStopped(d, reason, now()));
    stopKind = reason;
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort);

  // ---- running a program as (part of) a stage, its last lines shown
  let flushTimer = null;
  const program = async (sid, name, bin, args, env = {}) => {
    if (stopKind) throw new Stopped(stopKind);
    say(`run ${id}: ${name}`);
    const tail = [];
    let dirty = false;
    const flush = () => {
      if (!dirty) return;
      dirty = false;
      setStage(sid, { tail: tail.join("\n") });
    };
    const logFile = join(dir, `log.${name}`);
    current = runTool(bin, args, {
      cwd: dir,
      logFile,
      env,
      onLine: (l) => {
        if (!l.trim()) return;
        tail.push(l.length > 200 ? l.slice(0, 200) + "…" : l);
        if (tail.length > TAIL_LINES) tail.shift();
        dirty = true;
      },
    });
    flushTimer = setInterval(flush, FLUSH_MS);
    const { code, signal: sig } = await current.done;
    clearInterval(flushTimer);
    flush();
    current = null;
    if (stopKind) throw new Stopped(stopKind);
    return { code: code ?? sig, log: existsSync(logFile) ? readFileSync(logFile, "utf8") : "" };
  };
  const fail = (sid, message) => {
    setStage(sid, { status: "failed", endedAt: now(), note: message.split("\n")[0].slice(0, 200) });
    throw new Error(message);
  };

  try {
    change((d) => {
      d.status = "meshing";
      d.daemon = { ...daemon, cores: np };
      d.startedAt = now();
      d.error = null;
    });

    // ---- the part
    begin("prepare");
    const stl = await getBytes(repo, run0.part?.stl).catch((err) => fail("prepare", `the run's part didn't arrive: ${err.message}`));
    const faceOf = await getBytes(repo, run0.part?.faceOf).catch((err) => fail("prepare", `the run's part didn't arrive: ${err.message}`));
    if (!stl?.byteLength || !faceOf?.byteLength) fail("prepare", "the run has no part");
    const part = decodePart({ ...run0.part, stl, faceOf });
    if (!part.solid) fail("prepare", `the part can't be meshed: ${part.problems.join("; ") || "it isn't a closed solid"}`);
    const model = solverModel(setup, part);
    const guess = meshEstimate(setup, part);
    // a slip of the element size would otherwise mesh for an hour and then not fit in memory
    if (guess.nodes > 4 * maxNodes)
      fail("prepare", `at an element size of ${pretty(model.size, "length")} the mesh would have about ${guess.nodes.toLocaleString("en")} nodes; this server takes up to ${maxNodes.toLocaleString("en")}. Use a larger element size.`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const surface = surfaceMsh(part);
    writeFileSync(join(dir, "surface.msh"), surface);
    done("prepare", `${(part.tris.length / 3).toLocaleString("en")} triangles in ${part.faces.length} faces; the run is in ${dir.startsWith(homedir()) ? "~" + dir.slice(homedir().length) : dir}`);

    // ---- mesh: on the part's own faces, else (a face gmsh can't lay out) on gmsh's
    //
    // gmsh's surface mesher gives a slightly different mesh each time it runs, on one thread too
    // (measured: node counts within 2%, the stress at a hole within 5% on a medium mesh). So every
    // mesh made is kept, under a digest of exactly what made it (the surface, the script, gmsh's
    // version), and a run of the same part at the same size takes the kept one: two load cases on
    // one part are compared on one mesh, and a study run twice gives the same figures.
    begin("mesh");
    const meshDir = join(workDir, "..", "meshes");
    mkdirSync(meshDir, { recursive: true });
    let mesh = null, method = null, meshError = null, reused = false;
    for (const m of ["faces", "angle"]) {
      const out = `volume-${m}.msh`;
      const geo = geoScript({ method: m, input: "surface.msh", output: out, size: model.size, order: model.order, finer: model.finer, threads: np });
      writeFileSync(join(dir, `mesh-${m}.geo`), geo);
      const kept = join(meshDir, `${await sha256(new TextEncoder().encode(`gmsh ${tools.gmshVersion}\n${geo}\n${surface}`))}.msh`);
      const had = existsSync(kept);
      if (!had) {
        const r = await program("mesh", `gmsh-${m}`, tools.gmsh, [`mesh-${m}.geo`, "-"]);
        const errors = r.log.split("\n").filter((l) => /^Error\s*:/.test(l) && !/-{5,}|Mesh generation error summary|\d+ (error|warning)s?$|Check the full log/.test(l));
        if (r.code !== 0 || errors.length || !existsSync(join(dir, out))) {
          meshError = errors[0]?.replace(/^Error\s*:\s*/, "") ?? `gmsh stopped (exit ${r.code})`;
          say(`run ${id}: meshing on ${m === "faces" ? "the part's faces" : "gmsh's split"} failed: ${meshError}`);
          continue;
        }
      }
      try {
        const made = finishMesh(parseMsh(readFileSync(had ? kept : join(dir, out), "utf8")), { method: m, part });
        if (made.unplaced) throw new Error(`${made.unplaced} of the mesh's skin triangles are on no face of the part`);
        if (!had) {
          // copied beside it and renamed into place, which is one step: a run stopped or killed
          // mid-copy leaves no half a mesh under the name the next run of this part would take
          const partial = `${kept}.${id}.part`;
          copyFileSync(join(dir, out), partial);
          renameSync(partial, kept);
        }
        mesh = made;
        method = m;
        reused = had;
        break;
      } catch (err) {
        meshError = err.message;
        say(`run ${id}: the ${m} mesh couldn't be used: ${meshError}`);
      }
    }
    if (!mesh) fail("mesh", `gmsh couldn't mesh the part: ${meshError}`);
    const N = mesh.nodes.length / 3, T = mesh.tets.length / mesh.per;
    const volumeOff = part.volume > 0 ? mesh.volume / part.volume - 1 : 0;
    change((d) => {
      d.mesh = { nodes: N, elements: T, order: mesh.order, size: model.size, method, reused, volume: mesh.volume, volumeOff, quality: { worst: mesh.quality.worst, poor: mesh.quality.poor }, skin: mesh.skin.count, finer: model.finer.length };
    });
    if (N > maxNodes) fail("mesh", `the mesh has ${N.toLocaleString("en")} nodes; this server takes up to ${maxNodes.toLocaleString("en")}. Use a larger element size.`);
    done("mesh", `${N.toLocaleString("en")} nodes, ${T.toLocaleString("en")} ${mesh.order === 2 ? "ten" : "four"}-node tetrahedra${reused ? "; the mesh kept from an earlier run of this part at this size" : ""}${method === "angle" ? "; split by gmsh (a face of the part couldn't be laid out as it is)" : ""}${Math.abs(volumeOff) > 0.02 ? `; its volume is ${(volumeOff * 100).toFixed(1)}% off the part's` : ""}`);

    // ---- supports, loads, the deck
    begin("deck");
    const applied = applySetup(mesh, model);
    if (applied.problems.length) fail("deck", applied.problems.join("; "));
    const deck = writeDeck({ title: handle.doc().title, mesh, material: model.material, applied, analysis: model.analysis });
    writeFileSync(join(dir, "job.inp"), deck.text);
    const recipe = { deck: deckOutline(deck.text), geo: readFileSync(join(dir, `mesh-${method}.geo`), "utf8"), sha256: await sha256(new TextEncoder().encode(deck.text)), bytes: deck.text.length };
    change((d) => {
      d.recipe = recipe;
    });
    const loaded = applied.loads.filter((l) => l.kind !== "gravity");
    done("deck", `${deck.held.toLocaleString("en")} nodes held${loaded.length ? `; ${applied.nodal.size.toLocaleString("en")} loaded` : ""}${applied.gravity ? "; gravity on" : ""}`);

    // ---- solve
    begin("solve");
    // The equation solver on ONE thread, whatever the build: SPOOLES' threaded solver gave wrong
    // answers here, silently, in 9 runs of 30 (daemon/install-calculix.sh has the measurement;
    // probes/threads.mjs repeats it). The rest of ccx takes the cores.
    const r = await program("solve", "ccx", tools.ccx, ["-i", "job"], { OMP_NUM_THREADS: String(np), CCX_NPROC_EQUATION_SOLVER: "1" });
    const frdFile = join(dir, "job.frd");
    const said = r.log.split("\n").filter((l) => /\*ERROR/.test(l));
    if (r.code !== 0 || said.length || !existsSync(frdFile)) {
      const at = r.log.indexOf("*ERROR");
      const why = at >= 0 ? r.log.slice(at, at + 600).split("\n").slice(0, 6).map((l) => l.trim()).filter(Boolean).join(" ") : `CalculiX stopped (exit ${r.code})`;
      fail("solve", why);
    }
    done("solve", `${(N * 3 - 0).toLocaleString("en")} unknowns on ${np} core${np > 1 ? "s" : ""}`);

    // ---- results
    begin("results");
    const blocks = readFrd(readFileSync(frdFile, "utf8"), N);
    const dat = readDat(existsSync(join(dir, "job.dat")) ? readFileSync(join(dir, "job.dat"), "utf8") : "");
    let summary, layer, notes = [];
    if (model.analysis.kind === "modal") {
      const shapes = blocks.filter((b) => b.name === "DISP");
      if (!shapes.length) fail("results", "CalculiX wrote no mode shapes");
      const modes = shapes.map((b, i) => ({ mode: b.mode ?? i + 1, values: b.values }));
      summary = summarizeModal({ mesh, dat, material: model.material, modes });
      layer = skinLayer(mesh, { vectors: Object.fromEntries(modes.map((m) => [`m${m.mode}`, m.values])) });
    } else {
      const U = blocks.findLast((b) => b.name === "DISP")?.values;
      const S = blocks.findLast((b) => b.name === "STRESS")?.values;
      if (!U || !S) fail("results", "CalculiX wrote no displacements or stresses");
      if (!U.every(Number.isFinite)) fail("results", "CalculiX's answer isn't numbers: the part is probably not held in every direction");
      summary = summarizeStatic({ mesh, U, S, applied, sets: deck.sets, dat, material: model.material });
      // an answer that doesn't add up is not an answer (how the threaded solver's wrong ones were caught)
      if (summary.adrift != null && summary.adrift > ADRIFT)
        fail("results", `CalculiX's answer doesn't add up: the strain energy in the part (${summary.energy.toExponential(4)} J) should equal the work the loads did (${summary.work.toExponential(4)} J). Run it again; if it happens again, the solver on this server can't be trusted.`);
      notes = staticNotes(summary, { diagonal: part.diagonal, yield: model.material.yield, poor: mesh.quality.poor });
      layer = skinLayer(mesh, { scalars: { vm: vonMises(S) }, vectors: { u: U } });
    }
    const title = `${handle.doc().title} · results`;
    // a big layer's arrays go in segment docs (src/segments.js)
    const { value, handles } = await externalize(repo, { ...encodeLayer({ name: "skin", ...layer }), title, run: handle.url }, { title });
    const layerHandle = await repo.create2(value);
    // the layer doc is new: let it reach the sync server before its link does
    // (readers retry too, src/find.js; this keeps the first look from missing it)
    const there = await onServer.wait([...handles, layerHandle], { timeoutMs: 120_000, ackMs: 30_000, verify });
    if (there.ok === null) await new Promise((res) => setTimeout(res, 1500));
    else if (!there.ok) say(`run ${id}: the server hasn't acknowledged the results doc; readers will retry`);
    const found = summary.kind === "modal" ? `${summary.modes.length} modes` : `${(layer.indices.length / 3).toLocaleString("en")} triangles of skin`;
    // one change: a reader never sees a run that is done with a stage still going
    change((d) => {
      d.summary = summary;
      d.layers = { skin: layerHandle.url };
      d.notes = notes;
      d.status = "done";
      d.finishedAt = now();
      const stage = d.stages.find((s) => s.id === "results");
      if (stage) Object.assign(stage, { status: "done", endedAt: now(), note: found });
    });
    say(`run ${id}: done${summary.kind === "static" ? `, ${pretty(summary.stress.max, "pressure")} and ${pretty(summary.displacement.max, "length")}` : `, first mode ${summary.modes[0]?.hz?.toFixed(1)} Hz`}`);
    return stopKind ? "stopped" : "done";
  } catch (err) {
    clearInterval(flushTimer);
    if (err instanceof Stopped || stopKind) {
      // every process under the program is gone before this returns
      await killed;
      return "stopped";
    }
    say(`run ${id}: failed: ${err?.message ?? err}`);
    change((d) => {
      d.status = "failed";
      d.error = String(err?.message ?? err).slice(0, 4000);
      d.finishedAt = now();
      for (const s of d.stages) if (s.status === "running") s.status = "failed";
    });
    return "failed";
  } finally {
    onServer.dispose();
    signal?.removeEventListener("abort", onAbort);
    current?.kill();
  }
}
