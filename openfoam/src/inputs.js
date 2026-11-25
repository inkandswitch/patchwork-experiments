// What a run was made from, read back out of its doc: enough to make it
// again, and to tell two runs (two variations of a model) apart. Pure,
// except geometryDigest (Web Crypto).
//
// A run freezes everything it needs when it's asked for: the setup, the
// hull as a closed STL in the analysis frame, where that hull came from (the
// doc, its heads, the reader, the parts, the bow), and the version of this
// tool. The daemon adds what it ran with (its host, its code's commit,
// OpenFOAM's version, the cores) and the case's recipe: every file it wrote,
// with a digest over them and the STL. Two runs with one recipe digest were
// the same OpenFOAM case.
//
// The hull's geometry digest is of its triangles in the analysis frame
// (bow turned to +x, waterline at z = 0) before it's sunk, trimmed or heeled,
// and rounded to float32 (how a kept hull holds them): the same hull floated
// differently has one geometry digest; a change to the model, or to which of
// its parts make the hull, gives another. That is what "a variation" is.

import { MODE_LABELS, waterProperties, isSpeed, formatSpeedBoth } from "./setup.js";

/** SHA-256 of a hull's triangles, as float32, in hex. */
export async function geometryDigest(triangles) {
  const f32 = Float32Array.from(triangles);
  const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(f32.buffer));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const short = (hex, n = 10) => (typeof hex === "string" && hex ? hex.slice(0, n) : null);
const num = (v, d) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const headsText = (h) => (Array.isArray(h) && h.length ? [...h].map(String).sort().map((x) => x.slice(0, 8)).join(" ") : null);

/**
 * A run's hull, for grouping runs into variations: its geometry digest when
 * it has one, else what it was read from.
 */
export function variantKey(run) {
  const h = run?.hull ?? {};
  if (h.geometry?.digest) return `g:${h.geometry.digest}`;
  const s = h.source ?? {};
  return `s:${s.url ?? s.title ?? "?"}|${headsText(s.heads) ?? ""}|${(s.parts ?? []).join(",")}|${h.frame?.bow ?? "+x"}`;
}

/**
 * Letters for the hull variations among some runs, in the order they first
 * appear (pass the runs oldest first, so a letter never moves).
 * @returns {Map<string, string>}  variantKey → "A", "B", …
 */
export function variantLetters(runs) {
  const out = new Map();
  for (const r of runs) {
    if (!r) continue;
    const k = variantKey(r);
    if (!out.has(k)) out.set(k, letter(out.size));
  }
  return out;
}
const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/**
 * Every input of a run, one row each: `value` to show, `raw` to compare.
 * Grouped as the case's setup is (hull, floating, flow, solver) plus where
 * and with what it ran.
 * @returns {{ group: string, key: string, label: string, value: string, raw: any }[]}
 */
export function inputRows(run) {
  const s = run?.setup ?? {};
  const h = run?.hull ?? {};
  const src = h.source ?? {};
  const a = s.attitude ?? {};
  const dmn = run?.daemon ?? {};
  const rows = [];
  const add = (group, key, label, raw, value = raw == null ? "–" : String(raw)) => rows.push({ group, key, label, value, raw: raw ?? null });

  add("Hull", "hull.model", "Model", src.title ?? null);
  add("Hull", "hull.doc", "Document", src.url ?? null, src.url ? `${src.url.replace(/^automerge:/, "").slice(0, 10)}…` : "–");
  add("Hull", "hull.heads", "Version (heads)", headsText(src.heads));
  add("Hull", "hull.reader", "Read by", src.providerId ?? src.path ?? null, src.providerName ?? src.providerId ?? src.path ?? "–");
  add("Hull", "hull.parts", "Parts", src.parts?.length ? src.parts.join(", ") : null);
  add("Hull", "hull.bow", "Bow pointed", h.frame?.bow ?? null);
  add("Hull", "hull.waterZ", "Waterline at (model z)", num(h.frame?.waterZ, 4), Number.isFinite(h.frame?.waterZ) ? `${h.frame.waterZ.toFixed(3)} m` : "–");
  add("Hull", "hull.geometry", "Geometry", h.geometry?.digest ?? null, h.geometry?.digest ? `${short(h.geometry.digest)} · ${h.geometry.triangles?.toLocaleString("en") ?? "?"} triangles` : "–");

  add("Floating", "attitude.sinkage", "Sinkage", num(a.sinkage, 4), Number.isFinite(a.sinkage) ? `${a.sinkage.toFixed(3)} m` : "–");
  add("Floating", "attitude.trim", "Trim", num(a.trim, 3), Number.isFinite(a.trim) ? `${a.trim}° ${a.trim > 0 ? "bow down" : a.trim < 0 ? "bow up" : ""}`.trim() : "–");
  add("Floating", "attitude.heel", "Heel", num(a.heel ?? 0, 3), `${Math.abs(a.heel ?? 0)}°${a.heel ? ` to ${a.heel > 0 ? "starboard" : "port"}` : ""}`);
  if (h.info) {
    const { rho } = waterProperties(s.water, s.temperature);
    add("Floating", "hull.displacement", "Displacement", num((h.info.volume * rho) / 1000, 3), `${((h.info.volume * rho) / 1000).toFixed(2)} t`);
    add("Floating", "hull.lwl", "Waterline length", num(h.info.lwl, 3), `${h.info.lwl.toFixed(2)} m`);
    add("Floating", "hull.wetted", "Wetted area", num(h.info.wettedArea, 3), `${h.info.wettedArea.toFixed(2)} m²`);
  }

  add("Flow", "setup.mode", "Analysis", s.mode ?? null, MODE_LABELS[s.mode] ?? s.mode ?? "–");
  add("Flow", "setup.speed", "Speed", isSpeed(s.speed) ? { value: s.speed.value, unit: s.speed.unit } : null, formatSpeedBoth(s.speed));
  add("Flow", "setup.water", "Water", s.water ? `${s.water} ${s.temperature}` : null, s.water ? `${s.water === "fresh" ? "fresh" : "sea"}water at ${s.temperature} °C` : "–");

  add("Solver", "setup.mesh", "Mesh", s.mesh ?? null);
  add("Solver", "setup.iterations", "Iterations (at most)", s.iterations ?? null);
  add("Solver", "setup.stop", "Stop", s.stop ?? null, s.stop === "settled" ? "when settled (±1%)" : s.stop === "iterations" ? "after the iterations" : "–");
  add("Solver", "setup.domain", "Domain asked", s.domain ?? null);
  add("Solver", "setup.cores", "Cores asked", s.cores ?? null, s.cores ? String(s.cores) : "the machine's choice");
  add("Solver", "setup.keepVolume", "Flow volume", s.keepVolume === true, s.keepVolume ? volumeText(run?.volume) : "not kept");
  add("Solver", "setup.warmStart", "Started from", s.warmStart ?? null, s.warmStart ? `a past run (${s.warmStart.replace(/^automerge:/, "").slice(0, 8)}…)` : "rest");

  add("Ran on", "daemon.host", "Host", dmn.host ?? null);
  add("Ran on", "daemon.openfoam", "OpenFOAM", dmn.openfoam ?? null);
  add("Ran on", "daemon.cores", "Cores used", dmn.cores ?? null);
  add("Ran on", "daemon.code", "Run code", dmn.commit ? `${dmn.commit}${dmn.dirty ? "+" : ""}` : (dmn.version ?? null), dmn.commit ? `${dmn.version ?? ""} @ ${dmn.commit}${dmn.dirty ? " (with changes)" : ""}`.trim() : (dmn.version ?? "–"));
  add("Ran on", "made.tool", "Asked for with", run?.made?.version ?? null, run?.made ? `${run.made.tool ?? "openfoam"} ${run.made.version ?? ""}`.trim() : "–");
  add("Ran on", "recipe", "Case recipe", run?.recipe?.digest ?? null, run?.recipe?.digest ? `${short(run.recipe.digest)} · ${run.recipe.count ?? "?"} files` : "–");
  return rows;
}

const volumeText = (v) =>
  ({ posting: "being kept", kept: `kept, ${Math.round((v?.bytes ?? 0) / 1048576)} MB`, incomplete: "kept, but not all of it reached the server", failed: "asked for; keeping it failed" })[v?.status] ?? "asked for";

/** The input keys whose values differ between two runs. */
export function diffInputs(a, b) {
  const rb = new Map(inputRows(b).map((r) => [r.key, r.raw]));
  return new Set(inputRows(a).filter((r) => JSON.stringify(r.raw) !== JSON.stringify(rb.get(r.key) ?? null)).map((r) => r.key));
}

/**
 * The headline results of a run, one row each, to set side by side.
 * @returns {{ key: string, label: string, value: number|null, unit: string }[]}
 */
export function resultRows(run) {
  const s = run?.summary ?? {};
  const took = Number.isFinite(run?.startedAt) && Number.isFinite(run?.finishedAt) ? (run.finishedAt - run.startedAt) / 1000 : null;
  return [
    { key: "Rt", label: "Total resistance", value: s.Rt ?? null, unit: "N" },
    { key: "Rp", label: "Pressure part", value: s.Rp ?? null, unit: "N" },
    { key: "Rv", label: "Viscous part", value: s.Rv ?? null, unit: "N" },
    { key: "power", label: "Effective power", value: s.power ?? null, unit: "W" },
    { key: "Ct", label: "C_T", value: Number.isFinite(s.Ct) ? s.Ct * 1000 : null, unit: "×10⁻³" },
    { key: "Fz", label: "Vertical force", value: s.Fz ?? null, unit: "N" },
    { key: "Fy", label: "Side force", value: s.half ? null : (s.Fy ?? null), unit: "N" },
    { key: "cells", label: "Cells", value: s.cells ?? null, unit: "" },
    { key: "iterations", label: "Iterations", value: s.iterations ?? null, unit: "" },
    { key: "time", label: "Time", value: took, unit: "s" },
  ];
}

/**
 * The case setup and hull link that ask for this run again: the setup as
 * it was, and the hull it was read from (its doc, parts and bow). The doc
 * may have changed since; the run's own STL is what it ran.
 * @returns {{ setup: object, hull: { url: string, parts?: string[], bow: string, stash?: string } | null }}
 */
export function setupFromRun(run) {
  const setup = JSON.parse(JSON.stringify(run?.setup ?? {}));
  const src = run?.hull?.source ?? {};
  const hull = src.url ? { url: src.url, bow: run.hull.frame?.bow === "-x" ? "-x" : "+x" } : null;
  if (hull && Array.isArray(src.parts)) hull.parts = [...src.parts];
  if (hull && src.stash) hull.stash = src.stash;
  return { setup, hull };
}
