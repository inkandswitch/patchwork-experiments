// A run's headline figures, read out of its doc: what the run view shows
// and what the agent's results tool quotes. Pure.

import { G, MODE_LABELS, formatSpeed } from "./setup.js";

/**
 * The weight the hull floats at, as the run has it: its displaced volume at
 * rest (the frozen hull, at the run's attitude) times the water's density
 * times g. Null when the run doesn't say (no hull measurements, or no summary).
 * @returns {{ W: number, mass: number } | null}  W in N, mass in kg
 */
export function weightOf(run) {
  const volume = run?.hull?.info?.volume;
  const rho = run?.summary?.rho;
  if (!(volume > 0) || !(rho > 0)) return null;
  return { W: volume * rho * G, mass: volume * rho };
}

/** How a finished run stopped, in a few words. */
export function convergenceText(s) {
  if (!s) return "–";
  if (s.stoppedBy === "residuals" || (s.converged && !s.stoppedBy)) return "converged";
  if (s.stoppedBy === "settled") return "settled";
  if (s.stoppedBy === "asked") return "stopped early";
  return "not converged";
}

/**
 * One run's figures, as numbers (null where it has none), for a table.
 * Fz/W only for a free surface: a double body's Fz is its squat suction,
 * not something weight answers.
 */
export function runFigures(run) {
  const s = run?.summary ?? null;
  const done = run?.status === "done" && !!s;
  const w = done ? weightOf(run) : null;
  const free = (s?.mode ?? run?.setup?.mode) === "free-surface";
  const took = Number.isFinite(run?.startedAt) && Number.isFinite(run?.finishedAt) ? (run.finishedAt - run.startedAt) / 1000 : null;
  const failedStage = (run?.stages ?? []).find((st) => st.status === "failed") ?? null;
  const runningStage = (run?.stages ?? []).find((st) => st.status === "running") ?? null;
  return {
    status: run?.status ?? "unknown",
    mode: s?.mode ?? run?.setup?.mode ?? null,
    speed: run?.setup?.speed ?? null,
    mesh: run?.setup?.mesh ?? null,
    attitude: run?.setup?.attitude ?? null,
    Rt: done ? s.Rt : null,
    RtStd: done ? s.RtStd : null,
    Rp: done ? s.Rp : null,
    Rv: done ? s.Rv : null,
    Fz: done ? s.Fz : null,
    W: w?.W ?? null,
    FzOverW: done && free && w ? s.Fz / w.W : null,
    converged: done ? convergenceText(s) : null,
    settledNote: done ? (s.settledNote ?? null) : null,
    cells: s?.cells ?? run?.mesh?.cells ?? null,
    iterations: done ? s.iterations : (run?.progress?.iteration ?? null),
    of: run?.progress?.of ?? run?.setup?.iterations ?? null,
    seconds: took,
    stage: runningStage?.label ?? null,
    error: run?.status === "failed" ? String(run?.error ?? failedStage?.note ?? "failed").replace(/\s+/g, " ").trim() : null,
    failedStage: failedStage?.label ?? null,
  };
}

const n0 = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en") : "–");
const dur = (s) => (!Number.isFinite(s) ? "–" : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const att = (a) => (a ? `${+(a.sinkage ?? 0).toFixed(4)} / ${+(a.trim ?? 0).toFixed(3)} / ${+(a.heel ?? 0).toFixed(2)}` : "–");
const modeShort = (m) => (m === "free-surface" ? "free surface" : m === "double-body" ? "double body" : (m ?? "–"));

/** The table's rows at most; more runs are counted, not listed. */
export const MAX_ROWS = 40;
/** How much of a failed run's error is quoted. */
export const MAX_ERROR = 240;

/**
 * Runs as one Markdown table an agent (or a person) can quote, plus a line
 * for each run that failed or hasn't finished. Bounded: MAX_ROWS rows,
 * errors cut to MAX_ERROR characters. `runs`: [{ url, doc }] in the order to
 * list them; a doc that couldn't be read is { url, doc: null, error }.
 */
export function resultsTable(runs) {
  const shown = runs.slice(0, MAX_ROWS);
  const head = "| # | run | status | speed | analysis | mesh | sinkage m / trim ° / heel ° | R_T N | R_p N | R_v N | F_z N | weight N | F_z/W | convergence | cells | iterations | time |";
  const rule = `|${head.split("|").slice(1, -1).map(() => "---").join("|")}|`;
  const rows = [];
  const notes = [];
  shown.forEach(({ url, doc, error }, i) => {
    const k = i + 1;
    if (!doc) {
      rows.push(`| ${k} | ${url} | unreadable | | | | | | | | | | | | | | |`);
      notes.push(`${k}. ${url}: couldn't be read (${String(error ?? "unavailable").slice(0, MAX_ERROR)})`);
      return;
    }
    const f = runFigures(doc);
    const status = f.status === "solving" && Number.isFinite(f.iterations) && f.of ? `solving ${f.iterations}/${f.of}` : f.status;
    const RtCell = Number.isFinite(f.Rt) ? `${n0(f.Rt)}${Number.isFinite(f.RtStd) && f.RtStd > 0 ? ` ±${n0(f.RtStd)}` : ""}` : "–";
    rows.push(
      `| ${k} | ${url} | ${status} | ${formatSpeed(f.speed)} | ${modeShort(f.mode)} | ${f.mesh ?? "–"} | ${att(f.attitude)} | ${RtCell} | ${n0(f.Rp)} | ${n0(f.Rv)} | ${n0(f.Fz)} | ${n0(f.W)} | ${Number.isFinite(f.FzOverW) ? f.FzOverW.toFixed(3) : "–"} | ${f.converged ?? "–"} | ${n0(f.cells)} | ${Number.isFinite(f.iterations) ? f.iterations : "–"} | ${dur(f.seconds)} |`,
    );
    if (f.status === "failed") {
      const e = f.error.length > MAX_ERROR ? `${f.error.slice(0, MAX_ERROR)}…` : f.error;
      notes.push(`${k}. failed${f.failedStage ? ` at “${f.failedStage}”` : ""}: ${e}`);
    } else if (f.status === "cancelled") notes.push(`${k}. cancelled.`);
    else if (f.status !== "done") notes.push(`${k}. ${f.status}${f.stage ? ` (${f.stage})` : ""}: not finished.`);
  });
  const more = runs.length > shown.length ? `\n(${runs.length - shown.length} more runs not listed: pass \`runs\` to pick.)` : "";
  const key =
    "R_T total resistance (± its scatter over the averaging window), R_p pressure part, R_v viscous part, all as resistance (positive astern), for the whole hull. " +
    "F_z the vertical force on the hull held at its attitude; weight = displaced volume at rest × ρ × g; F_z/W only for a free surface (a double body's F_z is squat suction). " +
    "convergence: converged (residuals), settled (resistance steady within 1%), stopped early (asked), not converged (ran out of iterations).";
  return `${head}\n${rule}\n${rows.join("\n")}${more}${notes.length ? `\n\n${notes.join("\n")}` : ""}\n\n${key}`;
}

/** A one-line description of a run, for lists: "8 kn · free surface · coarse · queued". */
export function runLine(run) {
  const f = runFigures(run);
  return `${formatSpeed(f.speed)} · ${MODE_LABELS[f.mode] ?? f.mode ?? "?"} · ${f.mesh ?? "?"} mesh · ${f.status}`;
}
