// A run's figures, read out of its document for people: the study's results
// table, a run's own page and an agent's table all say them in these words.
// Pure.

import { pretty, prettyUnit, num, DIMENSIONS } from "./units.js";
import { listOf, describeLoad, normalizeSetup } from "./setup.js";

/** A vector as its size and its parts; a part a millionth of the size is rounding, and is written 0. */
const vec = (v, dimension) => {
  if (!v) return "–";
  const size = Math.hypot(...v);
  return `${pretty(size, dimension)} (${v.map((x) => (Math.abs(x) <= size * 1e-6 ? "0" : pretty(x, dimension))).join(", ")})`;
};
/** Where something is: its three coordinates in one unit, the one its largest reads best in. */
const place = (p) => {
  if (!p) return "";
  const unit = prettyUnit(Math.max(...p.map(Math.abs)), "length");
  const k = DIMENSIONS.length.units[unit];
  return `at (${p.map((x) => num(x / k, 3)).join(", ")}) ${unit}`;
};

/** How long a run took, or has been going: "12 s", "3 min 20 s". */
export function duration(run, now = Date.now()) {
  if (!run?.startedAt) return "";
  const s = Math.max(0, ((run.finishedAt ?? now) - run.startedAt) / 1000);
  return s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** What a run is doing, in a few words: "solving", "done in 12 s", "failed: …". */
export function statusLine(run, now = Date.now()) {
  if (!run) return "";
  if (run.status === "done") return `done in ${duration(run, now)}`;
  if (run.status === "failed") return `failed: ${String(run.error ?? "").split("\n")[0]}`;
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "queued") return "waiting for the server";
  const stage = (run.stages ?? []).find((s) => s.status === "running");
  return `${stage?.label ?? run.status}… ${duration(run, now)}`;
}

/** The safety factor as people read it: how many times the load before yield. */
export function safetyText(safety) {
  if (!(safety > 0)) return "–";
  return safety >= 100 ? "over 100" : num(safety, 3);
}

/**
 * The headline of a finished run: a few values for a table row.
 * @returns {{ stress: string, displacement: string, safety: string, frequency: string, nodes: string }}
 */
export function headline(run) {
  const s = run?.summary;
  const nodes = run?.mesh?.nodes ? run.mesh.nodes.toLocaleString("en") : "–";
  if (!s) return { stress: "–", displacement: "–", safety: "–", frequency: "–", nodes };
  if (s.kind === "modal") return { stress: "–", displacement: "–", safety: "–", frequency: s.modes[0]?.hz != null ? pretty(s.modes[0].hz, "frequency", { sig: 4 }) : "–", nodes };
  return { stress: pretty(s.stress.max, "pressure"), displacement: pretty(s.displacement.max, "length"), safety: safetyText(s.safety), frequency: "–", nodes };
}

/**
 * Everything a finished run found, as rows: [{ group, label, value, title? }].
 * `title` says how the figure was made.
 */
export function figures(run) {
  const s = run?.summary;
  const rows = [];
  const add = (group, label, value, title = "") => rows.push({ group, label, value, title });
  if (!s) return rows;
  if (s.kind === "modal") {
    for (const m of s.modes) add("Modes", `Mode ${m.mode}`, m.hz != null ? pretty(m.hz, "frequency", { sig: 4 }) : "–", "How many times a second it swings in this shape, left to ring on its own");
  } else {
    add("Result", "Highest stress", `${pretty(s.stress.max, "pressure")} ${place(s.stress.at)}`, "Von Mises stress, the measure a ductile material's yield is judged by, at the mesh's nodes");
    add("Result", "All but the top 1%", pretty(s.stress.p99, "pressure"), "99 of every 100 nodes are at or under this. Far under the highest: the peak is a small spot");
    if (s.safety != null) add("Result", "Safety factor", safetyText(s.safety), "The yield strength over the highest stress: how many times this load it would take to yield somewhere");
    add("Result", "Largest movement", `${pretty(s.displacement.max, "length")} ${place(s.displacement.at)}`, "How far the node that moves most ends up from where it started");
    for (const r of s.reactions ?? []) add("Forces", `${r.name} carries`, vec(r.force, "force"), "The force this support puts on the part (x, y, z), everything it carries");
    for (const l of s.loads ?? []) if (l.total) add("Forces", `${l.name} applies`, `${vec(l.total, "force")}${l.area ? ` over ${pretty(l.area, "area")}` : ""}`, "The load as it landed on the mesh, summed over its nodes");
    if (s.weight) add("Forces", "Weight", vec(s.weight, "force"), "Mass × gravity");
    if (s.balance != null) add("Checks", "Forces balance", s.balance < 1e-6 ? "exactly" : `within ${num(s.balance * 100, 2)}%`, "The supports' forces against the loads: they should cancel");
    if (s.adrift != null) add("Checks", "Energy against work", s.adrift < 1e-5 ? "agree" : `${num(s.adrift * 100, 2)}% apart`, "The strain energy the solver adds up from its stresses, against the work the loads did by its displacements: the same number two ways. A run where they differ by more than 0.1% is refused");
    if (s.work != null) add("Checks", "Work done by the loads", pretty(s.work, "energy"), "½ × force × movement, summed: the energy stored in the part. Less of it for the same load means a stiffer part");
  }
  add("Part", "Mass", pretty(s.mass, "mass"), "The mesh's volume × the density");
  add("Part", "Volume", pretty(s.volume, "volume"));
  const m = run.mesh;
  if (m) {
    add("Mesh", "Nodes", m.nodes.toLocaleString("en"));
    add("Mesh", "Elements", `${m.elements.toLocaleString("en")} ${m.order === 2 ? "ten" : "four"}-node tetrahedra`);
    add("Mesh", "Element size", `${pretty(m.size, "length")}${m.finer ? `, finer on ${m.finer} round face${m.finer === 1 ? "" : "s"}` : ""}`);
    if (m.reused) add("Mesh", "Made", "for an earlier run of this part at this size, and kept", "gmsh gives a slightly different mesh each time it runs, so the server keeps each one: runs of one part at one size share a mesh, and can be compared");
    add("Mesh", "Worst element", num(m.quality.worst, 2), "1 is a perfectly even tetrahedron, 0 a flat one. Under 0.02 is counted badly shaped");
    if (m.method === "angle") add("Mesh", "Faces", "split by gmsh, matched back by position", "A face of the part couldn't be laid out as it is (one that closes on itself), so gmsh split the surface its own way");
  }
  const d = run.daemon;
  if (d) add("Run", "Ran on", `${d.host ?? "?"}, CalculiX ${d.calculix ?? "?"}, gmsh ${d.gmsh ?? "?"}, ${d.cores ?? "?"} core${d.cores === 1 ? "" : "s"}`);
  if (run.startedAt && run.finishedAt) add("Run", "Took", duration(run));
  return rows;
}

/** What a run was asked: its setup in a few lines, for its page and for telling two runs apart. */
export function inputs(run) {
  const setup = normalizeSetup(run?.setup);
  const rows = [];
  const m = setup.material;
  rows.push({ label: "Analysis", value: setup.analysis === "modal" ? `modal, ${setup.modes} modes` : "static" });
  rows.push({ label: "Material", value: `${m.name}: E ${m.E.value} ${m.E.unit}, ν ${m.nu}, ${m.density.value} ${m.density.unit}${m.yield ? `, yield ${m.yield.value} ${m.yield.unit}` : ""}` });
  for (const s of listOf(setup.supports)) rows.push({ label: s.kind === "slide" ? "Sliding support" : "Fixed support", value: `${s.name}: ${s.faces.length} face${s.faces.length === 1 ? "" : "s"}` });
  for (const l of listOf(setup.loads)) rows.push({ label: { force: "Force", pressure: "Pressure", gravity: "Gravity" }[l.kind], value: `${l.name}: ${describeLoad(l)}` });
  rows.push({ label: "Mesh", value: `${typeof setup.mesh.size === "string" ? setup.mesh.size : `${setup.mesh.size.value} ${setup.mesh.size.unit}`}, ${setup.mesh.order === 2 ? "ten" : "four"}-node` });
  if (run?.part?.source?.title) rows.push({ label: "Part", value: `${run.part.source.title}, read ${new Date(run.part.source.readAt).toLocaleString()}` });
  return rows;
}

/** A study's runs as one Markdown table (for an agent, and for pasting). */
export function runsTable(runs, now = Date.now()) {
  const head = "| run | status | highest stress | safety | largest movement | first mode | nodes |\n|---|---|---|---|---|---|---|";
  const rows = runs.map(({ url, run }) => {
    const h = headline(run);
    return `| ${run?.title ?? url} | ${statusLine(run, now)} | ${h.stress} | ${h.safety} | ${h.displacement} | ${h.frequency} | ${h.nodes} |`;
  });
  return [head, ...rows].join("\n");
}
