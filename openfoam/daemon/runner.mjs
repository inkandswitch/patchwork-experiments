// One run, start to finish: write the case, mesh it, solve it, read it back,
// and keep the run doc up to date throughout. The run doc's `control` is
// watched the whole time: cancel kills the running command (and its whole
// process group); finish-now tells the solver to write and stop, which keeps
// every result.

import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { caseFiles, zeroFiles, inletResetDict } from "./case.mjs";
import { run as runFoam } from "./foam.mjs";
import { datTail, forceRow, residualColumns, parseCheckMesh, parseLayers } from "./parse.mjs";
import { readLayers, summarize } from "./results.mjs";
import { normalizeSetup } from "../src/setup.js";
import { packChunk, requestIdOf, isTerminal, stagesFor } from "../src/protocol.js";
import { settled } from "../src/convergence.js";

const TAIL_LINES = 14;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const FLUSH_MS = 2000;

class Stopped extends Error {
  constructor(kind) {
    super(kind === "cancel" ? "cancelled" : "stopped");
    this.kind = kind;
  }
}

/** Bytes appended to a file since `pos`, and the new position. */
function readFrom(file, pos) {
  if (!existsSync(file)) return { text: "", pos };
  const size = statSync(file).size;
  if (size <= pos) return { text: "", pos: size < pos ? 0 : pos };
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - pos);
    readSync(fd, buf, 0, buf.length, pos);
    return { text: buf.toString("utf8"), pos: size };
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {object} o
 * @param {import("@automerge/automerge-repo").Repo} o.repo
 * @param {import("@automerge/automerge-repo").DocHandle} o.handle   the run doc
 * @param {object} o.env          foamEnvironment()
 * @param {string} o.workDir      where case directories go
 * @param {number} o.cores        the default when the setup says 0
 * @param {object} o.daemon       { id, host } written to the run
 * @param {(msg: string) => void} [o.say]
 * @returns {Promise<"done"|"failed"|"cancelled">}
 */
export async function runJob({ repo, handle, env, workDir, cores, daemon, say = () => {}, signal = null }) {
  const run0 = handle.doc();
  if (isTerminal(run0.status)) return run0.status;
  const setup = normalizeSetup(run0.setup);
  const info = run0.hull?.info;
  const stl = run0.hull?.stl;
  const id = requestIdOf(handle.url);
  const dir = join(workDir, id);
  const np = Math.max(1, setup.cores || cores);
  const now = () => Date.now();
  const change = (fn) => handle.change(fn);
  const setStage = (sid, patch) =>
    change((d) => {
      const i = d.stages.findIndex((s) => s.id === sid);
      if (i < 0) return;
      for (const [k, v] of Object.entries(patch)) d.stages[i][k] = v;
    });

  // ---- control: cancel and finish-now
  let current = null; // the running command
  let stopKind = null;
  let finishAsked = false;
  let onFinish = null;
  const watch = () => {
    const c = handle.doc()?.control ?? {};
    if (c.cancel && !stopKind) {
      stopKind = "cancel";
      say(`run ${id}: cancel asked`);
      current?.kill();
    }
    if (c.finish && !finishAsked) {
      finishAsked = true;
      say(`run ${id}: finish-now asked`);
      onFinish?.();
    }
  };
  handle.on("change", watch);
  // the daemon shutting down: stop, but don't call it the user's cancel
  const onAbort = () => {
    if (stopKind) return;
    stopKind = "shutdown";
    current?.kill();
  };
  signal?.addEventListener("abort", onAbort);

  // ---- the log tail each stage shows
  let tail = [];
  let tailDirty = false;
  let flushTimer = null;
  let pending = { forces: [], residuals: [], iteration: null };
  let residualCols = null;
  const flush = (sid) => {
    const p = pending;
    pending = { forces: [], residuals: [], iteration: null };
    const wroteTail = tailDirty;
    tailDirty = false;
    if (!p.forces.length && !p.residuals.length && p.iteration == null && !wroteTail) return;
    change((d) => {
      if (p.forces.length) d.progress.forces.push(packChunk(["iter", "Rt", "Rp", "Rv", "Fz"], p.forces));
      if (p.residuals.length) d.progress.residuals.push(packChunk(["iter", ...residualCols], p.residuals));
      if (p.iteration != null) d.progress.iteration = p.iteration;
      if (wroteTail && sid) {
        const i = d.stages.findIndex((s) => s.id === sid);
        if (i >= 0) d.stages[i].tail = tail.join("\n");
      }
    });
  };

  /** Run one OpenFOAM command as a stage. */
  const foamStage = async (sid, cmd, { extra } = {}) => {
    if (stopKind) throw new Stopped(stopKind);
    say(`run ${id}: ${sid}: ${cmd}`);
    setStage(sid, { status: "running", startedAt: now(), tail: null });
    tail = [];
    const logFile = join(dir, `log.${sid}`);
    current = runFoam(env, cmd, {
      cwd: dir,
      logFile,
      onLine: (l) => {
        if (!l.trim()) return;
        tail.push(l.length > 200 ? l.slice(0, 200) + "…" : l);
        if (tail.length > TAIL_LINES) tail.shift();
        tailDirty = true;
      },
    });
    flushTimer = setInterval(() => {
      extra?.tick?.();
      flush(sid);
    }, FLUSH_MS);
    const { code, signal } = await current.done;
    clearInterval(flushTimer);
    extra?.tick?.();
    flush(sid);
    current = null;
    if (stopKind) {
      setStage(sid, { status: "failed", endedAt: now(), note: stopKind === "cancel" ? "cancelled" : "stopped" });
      throw new Stopped(stopKind);
    }
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    if (code !== 0) {
      const fatal = log.match(/--> FOAM FATAL[\s\S]{0,900}/)?.[0]?.split("\n").slice(0, 12).join("\n");
      setStage(sid, { status: "failed", endedAt: now(), note: `exit ${code ?? signal}` });
      throw new Error(`${sid} failed (exit ${code ?? signal})${fatal ? `:\n${fatal}` : ""}`);
    }
    return log;
  };

  const done = (sid, note) => setStage(sid, { status: "done", endedAt: now(), note: note ?? null });

  try {
    if (!info || !(stl instanceof Uint8Array) || !stl.byteLength) throw new Error("the run has no hull (its STL is missing)");
    const par = np > 1;
    change((d) => {
      d.status = "meshing";
      d.daemon = { ...daemon, cores: np };
      d.startedAt = now();
      d.error = null;
      // the stage order this daemon will follow (meshing splits first when it's parallel)
      d.stages = stagesFor(setup.mode, { parallel: par }).map((s) => ({ ...s, status: "pending", startedAt: null, endedAt: null, note: null, tail: null }));
    });

    // ---- prepare
    setStage("prepare", { status: "running", startedAt: now() });
    rmSync(dir, { recursive: true, force: true });
    const { files, geometry: g } = caseFiles(setup, info, { cores: np });
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
    mkdirSync(join(dir, "constant/triSurface"), { recursive: true });
    writeFileSync(join(dir, "constant/triSurface/hull.stl"), stl);
    done("prepare", `${g.half ? "half" : "full"} model, ${np} core${np > 1 ? "s" : ""}; the case is in ${dir.startsWith(homedir()) ? "~" + dir.slice(homedir().length) : dir}`);

    // ---- mesh
    await foamStage("surfaceFeatureExtract", "surfaceFeatureExtract");
    done("surfaceFeatureExtract");
    await foamStage("blockMesh", "blockMesh");
    done("blockMesh", `${g.dom.cells.join(" × ")} background cells`);
    // on several cores, split the background mesh and mesh the pieces in
    // parallel; the solver then runs on the same pieces (nothing is joined back)
    if (par) {
      await foamStage("decomposePar", "decomposePar -force");
      done("decomposePar", `${np} subdomains`);
    }
    const snappyLog = await foamStage("snappyHexMesh", par ? env.mpirun(np, "snappyHexMesh -overwrite") : "snappyHexMesh -overwrite");
    const layers = parseLayers(snappyLog);
    done("snappyHexMesh", layers ? `${layers.achieved.toFixed(1)} of ${layers.target} wall layers, ${layers.percent.toFixed(0)}% of their thickness` : null);
    const checkLog = await foamStage("checkMesh", par ? env.mpirun(np, "checkMesh") : "checkMesh");
    const cm = parseCheckMesh(checkLog);
    change((d) => {
      d.mesh = { cells: cm.cells, ok: cm.ok, failedChecks: cm.failed, maxNonOrtho: cm.maxNonOrtho, maxSkew: cm.maxSkew, layers: layers ?? null };
    });
    done("checkMesh", `${cm.cells?.toLocaleString("en") ?? "?"} cells${cm.ok ? ", mesh OK" : `, ${cm.failed} check${cm.failed === 1 ? "" : "s"} failed (running anyway)`}`);

    // the initial fields: written once, and into every piece when meshing ran in
    // parallel (setConstraintTypes covers each piece's processor patches)
    const zero = zeroFiles(g);
    const roots = par ? Array.from({ length: np }, (_, i) => join(dir, `processor${i}`)) : [dir];
    for (const root of [dir, ...(par ? roots : [])])
      for (const [p, text] of Object.entries(zero)) {
        mkdirSync(dirname(join(root, p)), { recursive: true });
        writeFileSync(join(root, p), text);
      }
    if (setup.mode === "free-surface") {
      await foamStage("setFields", par ? env.mpirun(np, "setFields") : "setFields");
      done("setFields");
    }
    if (!par) setStage("decomposePar", { status: "skipped", note: "one core" });

    // ---- a warm start: the past run's last solution, mapped onto this mesh
    const from = setup.warmStart ? join(workDir, requestIdOf(setup.warmStart)) : null;
    if (!from) setStage("initialise", { status: "skipped", note: "from rest" });
    else if (!existsSync(join(from, "system/controlDict")))
      setStage("initialise", { status: "skipped", note: "that run's case isn't on this daemon: from rest" });
    else {
      writeFileSync(join(dir, "system/changeDictionaryDict"), inletResetDict(g));
      const par = np > 1;
      const srcPar = existsSync(join(from, "processor0"));
      const map = `mapFields ${q(from)} -consistent -sourceTime latestTime${srcPar ? " -parallelSource" : ""}${par ? " -parallelTarget" : ""}`;
      // mapFields carries the past run's inlet values over too: put this speed's back
      const reset = par ? env.mpirun(np, "changeDictionary") : "changeDictionary";
      await foamStage("initialise", `${map} && ${reset}`);
      done("initialise", `mapped from ${setup.warmStart.replace("automerge:", "").slice(0, 8)}…, inlet reset to this speed`);
      change((d) => {
        d.warmFrom = setup.warmStart;
      });
    }

    // ---- solve
    change((d) => {
      d.status = "solving";
    });
    const forceTail = datTail();
    const history = []; // R_T per iteration, for the settled rule
    let settledNote = null;
    const resTail = datTail();
    let forcePos = 0;
    let resPos = 0;
    const forceFile = join(dir, "postProcessing/forces/0/force.dat");
    const resFile = join(dir, "postProcessing/solverInfo/0/solverInfo.dat");
    const tick = () => {
      const f = readFrom(forceFile, forcePos);
      forcePos = f.pos;
      for (const row of forceTail.push(f.text)) {
        const r = forceRow(forceTail.cols, row, { half: g.half });
        pending.forces.push([r.iter, r.Rt, r.Rp, r.Rv, r.Fz]);
        pending.iteration = r.iter;
        history.push(r.Rt);
      }
      // stop once the resistance has settled (the iteration count is then a ceiling)
      if (setup.stop === "settled" && !finishAsked && !settledNote) {
        const verdict = settled(history);
        if (verdict.settled) {
          settledNote = verdict.why;
          say(`run ${id}: ${verdict.why}; stopping`);
          finishAsked = true;
          onFinish?.();
        }
      }
      const r = readFrom(resFile, resPos);
      resPos = r.pos;
      for (const row of resTail.push(r.text)) {
        const cols = resTail.cols;
        if (!residualCols) residualCols = residualColumns(cols).map((c) => c.replace(/_initial$/, ""));
        pending.residuals.push([row[cols.indexOf("Time")], ...residualCols.map((c) => row[cols.indexOf(`${c}_initial`)])]);
      }
    };
    onFinish = () => {
      const cd = join(dir, "system/controlDict");
      writeFileSync(cd, readFileSync(cd, "utf8").replace(/^stopAt\s+\S+;/m, "stopAt          writeNow;"));
    };
    if (finishAsked) onFinish();
    const solver = g.solver;
    const solveLog = await foamStage("solve", np > 1 ? env.mpirun(np, solver) : solver, { extra: { tick } });
    const converged = /SIMPLE solution converged in/.test(solveLog) ? true : null;
    const last = handle.doc().progress.iteration;
    const stoppedBy = converged ? "residuals" : settledNote ? "settled" : finishAsked ? "asked" : "iterations";
    done("solve", `${last} iterations; ${{ residuals: "converged (residuals)", settled: settledNote, asked: "stopped early, as asked", iterations: "ran them all" }[stoppedBy]}`);

    // ---- results
    change((d) => {
      d.status = "post";
    });
    setStage("results", { status: "running", startedAt: now() });
    const summary = { ...summarize(dir, g, info, { cells: cm.cells, converged }), stoppedBy, settledNote };
    const { layers: layerDocs, notes } = readLayers(dir, g);
    const urls = {};
    for (const layer of layerDocs) {
      const h = await repo.create2({ ...layer, title: `${handle.doc().title} · ${layer.name}`, run: handle.url });
      urls[layer.name] = h.url;
    }
    // the layer docs are new: let them reach the sync server before their links do
    // (readers retry too, src/find.js; this keeps the first look from missing them)
    await new Promise((r) => setTimeout(r, 2500));
    change((d) => {
      d.summary = summary;
      d.layers = urls;
      d.status = "done";
      d.finishedAt = now();
      if (notes.length) d.notes = notes;
    });
    done("results", `${Object.keys(urls).length} layers${notes.length ? `; ${notes.join("; ")}` : ""}`);
    say(`run ${id}: done, Rt ${summary.Rt.toFixed(1)} N`);
    return "done";
  } catch (err) {
    clearInterval(flushTimer);
    if (stopKind === "shutdown") {
      change((d) => {
        d.status = "failed";
        d.error = "the daemon was stopped while this ran; run it again";
        d.finishedAt = now();
        for (const s of d.stages) if (s.status === "running") s.status = "failed";
      });
      return "failed";
    }
    if (err instanceof Stopped || stopKind) {
      change((d) => {
        d.status = "cancelled";
        d.finishedAt = now();
      });
      say(`run ${id}: cancelled`);
      return "cancelled";
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
    handle.off("change", watch);
    signal?.removeEventListener("abort", onAbort);
    current?.kill();
  }
}
