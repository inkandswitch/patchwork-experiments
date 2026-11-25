// The CalculiX input deck (.inp) for a run, as text. Pure.
//
// Everything is SI: metres, newtons, pascals, kilograms, so stresses come
// back in pascals and displacements in metres with nothing to convert.
// Nodes and elements are numbered from 1 in the mesh's own order (node i of
// the mesh is node i + 1 of the deck), which is what readFrd relies on.
//
// Loads go in as forces at nodes (src/solver/loads.js works them out), never
// as *DLOAD on faces: one path for every kind of face load. Gravity is the
// one body load, and the solver's own.

/** A real number in at most 19 characters (CalculiX reads a field of 20). */
const e = (x) => (Object.is(x, -0) ? 0 : x).toExponential(11);

/** Ids, 12 to a line (CalculiX takes at most 16). */
function idLines(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 12) out.push(Array.from(ids.slice(i, i + 12), (n) => n + 1).join(", "));
  return out;
}

/**
 * Directions a node may not move along, as independent conditions: Gauss–
 * Jordan with the largest entry left as each pivot. Each `row` · u = 0 is one
 * condition; its `pivot` is a direction (0, 1, 2) that only it mentions, and
 * every other entry is exactly 0 or stands clear of rounding. A direction
 * already said by the others (the same face twice, a third wall square to
 * two) leaves nothing and is dropped. One direction alone comes back as it
 * was given.
 * @param {number[][]} normals
 * @returns {{ pivot: number, row: number[] }[]}  at most three
 */
export function independent(normals) {
  const clean = (r) => {
    const m = Math.max(Math.abs(r[0]), Math.abs(r[1]), Math.abs(r[2]));
    for (let k = 0; k < 3; k++) if (Math.abs(r[k]) <= 1e-9 * m) r[k] = 0;
    return r;
  };
  const rows = normals.map((v) => clean([...v]));
  const out = [];
  const used = [false, false, false];
  while (out.length < 3) {
    // (a millionth: two faces a millionth of a turn apart ask the same thing)
    let best = 1e-6, bi = -1, bk = -1;
    rows.forEach((r, i) => {
      for (let k = 0; k < 3; k++) if (!used[k] && Math.abs(r[k]) > best) [best, bi, bk] = [Math.abs(r[k]), i, k];
    });
    if (bi < 0) break;
    const [pr] = rows.splice(bi, 1);
    used[bk] = true;
    for (const r of [...rows, ...out.map((o) => o.row)]) {
      const f = r[bk] / pr[bk];
      if (f === 0) continue;
      for (let k = 0; k < 3; k++) r[k] -= f * pr[k];
      r[bk] = 0;
      clean(r);
    }
    out.push({ pivot: bk, row: pr });
  }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {{ nodes: Float64Array, tets: Uint32Array, per: 4|10 }} o.mesh
 * @param {{ E: number, nu: number, density: number }} o.material   Pa, –, kg/m³
 * @param {ReturnType<import("./loads.js").applySetup>} o.applied
 * @param {{ kind: "static" } | { kind: "modal", modes: number }} o.analysis
 * @returns {{ text: string, sets: { id: string, set: string }[], held: number }}
 *   sets: the node set each support's reactions are printed for; held: how many nodes a support holds
 */
export function writeDeck({ title, mesh, material, applied, analysis }) {
  const { nodes, tets, per } = mesh;
  const N = nodes.length / 3, T = tets.length / per;
  const out = ["*HEADING", String(title ?? "fea").replace(/[\r\n*]/g, " ").slice(0, 80), "*NODE, NSET=NALL"];
  for (let n = 0; n < N; n++) out.push(`${n + 1}, ${e(nodes[n * 3])}, ${e(nodes[n * 3 + 1])}, ${e(nodes[n * 3 + 2])}`);
  out.push(`*ELEMENT, TYPE=${per === 4 ? "C3D4" : "C3D10"}, ELSET=EALL`);
  for (let t = 0; t < T; t++) {
    const ids = [];
    for (let k = 0; k < per; k++) ids.push(tets[t * per + k] + 1);
    out.push(`${t + 1}, ${ids.join(", ")}`);
  }

  const sets = [];
  applied.supports.forEach((s, i) => {
    const set = `SUP${i + 1}`;
    sets.push({ id: s.id, set });
    out.push(`*NSET, NSET=${set}`, ...idLines(s.nodes));
  });

  out.push("*MATERIAL, NAME=M1", "*ELASTIC", `${e(material.E)}, ${e(material.nu)}`, "*DENSITY", e(material.density), "*SOLID SECTION, ELSET=EALL, MATERIAL=M1");

  // Supports. A fixed node is held in x, y and z. A sliding one is held along
  // its support's normal only. A node may be on several supports, so what each
  // node is held to is gathered first, as directions, and reduced to
  // independent conditions (`independent`, below), each with a direction of
  // its own that no other condition at that node mentions. Such a direction
  // alone is a plain condition (*BOUNDARY); with others it is an equation
  // (*EQUATION) whose first term, the one CalculiX eliminates, is that
  // direction. So nothing is said twice, nothing one support asks is lost to
  // another, and no equation leans on another's eliminated unknown.
  const whole = new Set();
  for (const s of applied.supports) if (s.kind === "fixed") for (const n of s.nodes) whole.add(n);
  const slides = new Map(); // node → the normals it may not move along
  for (const s of applied.supports) {
    if (s.kind === "fixed") continue;
    for (const n of s.nodes) {
      if (whole.has(n)) continue;
      const list = slides.get(n);
      if (list) list.push(s.normal);
      else slides.set(n, [s.normal]);
    }
  }
  const fixed = [];
  applied.supports.forEach((s, i) => s.kind === "fixed" && fixed.push(`SUP${i + 1}, 1, 3`));
  const equations = [];
  for (const n of [...slides.keys()].sort((x, y) => x - y)) {
    const rows = independent(slides.get(n));
    if (rows.length === 3) {
      fixed.push(`${n + 1}, 1, 3`);
      continue;
    }
    for (const { pivot, row } of rows) {
      const others = [0, 1, 2].filter((k) => k !== pivot && row[k] !== 0);
      if (!others.length) fixed.push(`${n + 1}, ${pivot + 1}, ${pivot + 1}`);
      else equations.push(String(others.length + 1), [pivot, ...others].map((k) => `${n + 1}, ${k + 1}, ${e(row[k])}`).join(", "));
    }
  }
  if (equations.length) out.push("*EQUATION", ...equations);
  if (fixed.length) out.push("*BOUNDARY", ...fixed);

  out.push("*STEP");
  if (analysis.kind === "modal") {
    out.push("*FREQUENCY", String(Math.max(1, analysis.modes | 0)), "*NODE FILE", "U");
  } else {
    out.push("*STATIC");
    const forces = [...applied.nodal.entries()].sort((a, b) => a[0] - b[0]);
    const lines = [];
    for (const [n, f] of forces) for (let k = 0; k < 3; k++) if (f[k] !== 0) lines.push(`${n + 1}, ${k + 1}, ${e(f[k])}`);
    if (lines.length) out.push("*CLOAD", ...lines);
    if (applied.gravity) {
      const g = Math.hypot(...applied.gravity);
      out.push("*DLOAD", `EALL, GRAV, ${e(g)}, ${e(applied.gravity[0] / g)}, ${e(applied.gravity[1] / g)}, ${e(applied.gravity[2] / g)}`);
    }
    out.push("*NODE FILE", "U", "*EL FILE", "S");
    for (const { set } of sets) out.push(`*NODE PRINT, NSET=${set}, TOTALS=ONLY`, "RF");
    out.push("*EL PRINT, ELSET=EALL, TOTALS=ONLY", "ELSE");
  }
  out.push("*END STEP", "");
  return { text: out.join("\n"), sets, held: whole.size + slides.size };
}
