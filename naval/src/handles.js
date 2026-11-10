// Drag handles on the profile: where each sits, and what dragging it to a
// point writes. Pure (no DOM): the tool turns pointer events into points in
// the drawing's frame (x forward, z up, m) and writes what this returns
// through handle.change. Geometry is read from the numbers at the drag's
// start, so a drag is one smooth change of one or two fields, however the
// drawing re-lays itself out under it.

const RAD = Math.PI / 180;
const round = (v, q = 1e-3) => Math.round(v / q) * q;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const MIN = 0.05;

/** The mast's unit vector, partners to head. */
function mastDir(plan) {
  const th = plan.rakeDeg * RAD;
  return [-Math.sin(th), Math.cos(th)];
}

/**
 * Every handle for a set of numbers: { id, at (where it's drawn), ref (the
 * point it moves, which dragWrites reads; usually the same), label }.
 * @param {ReturnType<import("./numbers.js").computeNumbers>} n
 */
export function handlePoints(n) {
  const { plan } = n;
  const out = [];
  const h = (id, at, label, ref = at) => at && Number.isFinite(at[0]) && Number.isFinite(at[1]) && out.push({ id, at, ref, label });
  const u = mastDir(plan);
  h("mast", plan.mast.partners, plan.forestay ? "Rig: drag fore and aft (mast and forestay tack together, sails kept). Alt or Shift: the mast alone (J changes; the headsail keeps its LP %)" : "Mast: drag fore and aft");
  const H = plan.mast.heightM;
  h("rake", [plan.mast.head[0] + u[0] * 0.05 * H, plan.mast.head[1] + u[1] * 0.05 * H], "Rake: drag the masthead fore and aft", plan.mast.head);
  if (plan.forestay) {
    const { tack, head } = plan.forestay;
    // on the forestay just below the hounds, so it doesn't sit on the main's head
    h("hounds", [head[0] + 0.04 * (tack[0] - head[0]), head[1] + 0.04 * (tack[1] - head[1])], "I: drag the hounds up and down", head);
    h("tack", tack, "Forestay tack: drag fore and aft (J; the headsail keeps its LP %)");
  }
  const main = plan.sails.find((s) => s.id === "main");
  if (main && plan.boom) {
    h("head", main.polygon[1], "P: drag the head of the main");
    h("gooseneck", plan.boom.gooseneck, "BAS: drag the gooseneck");
    h("clew", plan.boom.end, "E: drag the clew");
  }
  const jib = plan.sails.find((s) => s.id === "jib");
  if (jib) h("jibClew", jib.polygon[2], "LP: drag the headsail's clew");
  for (const f of n.analysis?.app.foils ?? []) {
    const L = f.id === "keel" ? "Keel" : "Rudder";
    h(`${f.id}.rootLE`, f.corners.rootLE, `${L}: drag fore and aft`);
    h(`${f.id}.rootTE`, f.corners.rootTE, `${L} root chord`);
    h(`${f.id}.tipLE`, f.corners.tipLE, `${L} span and sweep`);
    h(`${f.id}.tipTE`, f.corners.tipTE, `${L} tip chord`);
  }
  return out;
}

/**
 * Draw positions that don't cover each other. Handles sit on real points, and
 * some real points are close: the gooseneck is BAS (often 0.2 m) above the
 * mast's partners, a handle's width at most zoom levels, so the gooseneck's
 * circle covered the mast's and a press on the mast dragged BAS instead
 * (found by the browser probe). In list order, each handle closer than `gap`
 * to one already placed moves straight away from it (aft, if they coincide)
 * until it is `gap` clear. Only `at` moves: `ref` is still the real point,
 * and a drag moves the ref by the pointer's travel, so where the circle sits
 * doesn't change what a drag writes.
 * @param {{ id: string, at: number[], ref: number[] }[]} points handlePoints(n), in priority order
 * @param {number} gap the least centre-to-centre distance (drawing units, m)
 */
export function spreadHandles(points, gap) {
  const placed = [];
  for (const hp of points) {
    let at = hp.at;
    for (let tries = 0; tries < 8; tries++) {
      const c = placed.find((q) => Math.hypot(at[0] - q.at[0], at[1] - q.at[1]) < gap - 1e-12);
      if (!c) break;
      const d = sub(at, c.at);
      const len = Math.hypot(d[0], d[1]);
      const u = len > 1e-9 * gap ? [d[0] / len, d[1] / len] : [-1, 0];
      at = [c.at[0] + u[0] * gap, c.at[1] + u[1] * gap];
    }
    placed.push(at === hp.at ? hp : { ...hp, at });
  }
  return placed;
}

/**
 * What dragging a handle to a point writes: [path, value, opts?] triples (SI).
 * `p` is where the handle's ref point has been dragged to. opts.keepProv:
 * the value follows from another the designer moved (LP kept as a % of J),
 * so an "estimated" mark on it stays.
 *
 * The mast handle moves the rig: mast and forestay tack together, so J, the
 * sails and their area are kept and only where they stand changes (as the
 * Move rig helpers do). With `alone` (Alt or Shift held) it moves the mast
 * by itself; J changes then, as it does when the tack is dragged, and the
 * headsail's LP is rescaled with J so a 100% jib stays a 100% jib.
 * @param {string} id a handlePoints id
 * @param {ReturnType<import("./numbers.js").computeNumbers>} n the numbers at the drag's start
 * @param {[number, number]} p
 * @param {{ alone?: boolean }} [opts]
 * @returns {[string[], number, { keepProv?: boolean }?][]}
 */
export function dragWrites(id, n, p, { alone = false } = {}) {
  const { plan } = n;
  const stemX = n.hull.datum.stemX;
  const partners = plan.mast.partners;
  const u = mastDir(plan);
  const up = (q) => dot(sub(q, partners), u);
  const rig = n.doc?.rig;
  // LP kept as a % of J when J changes
  const lpFor = (J1) => {
    const lp0 = rig?.headsail?.LP;
    return plan.J > 0 && J1 > 0 && lp0 > 0 ? [[["rig", "headsail", "LP"], round(Math.max(MIN, (lp0 * J1) / plan.J)), { keepProv: true }]] : [];
  };
  switch (id) {
    case "mast": {
      const aft = round(stemX - p[0]);
      if (!plan.forestay || !rig) return [[["rig", "mast", "aftOfStem"], aft]];
      if (alone) return [[["rig", "mast", "aftOfStem"], aft], ...lpFor(aft - rig.forestayAftOfStem)];
      const dx = aft - rig.mast.aftOfStem;
      return [
        [["rig", "mast", "aftOfStem"], aft],
        [["rig", "forestayAftOfStem"], round(rig.forestayAftOfStem + dx)],
      ];
    }
    case "rake":
      return [[["rig", "mast", "rakeDeg"], round(clamp(Math.atan2(-(p[0] - partners[0]), p[1] - partners[1]) / RAD, -10, 20), 0.01)]];
    case "hounds":
      return [[["rig", "I"], round(Math.max(MIN, up(p)))]];
    case "head":
      return [[["rig", "P"], round(Math.max(MIN, up(p) - plan.BAS))]];
    case "gooseneck":
      return [[["rig", "BAS"], round(Math.max(0, up(p)))]];
    case "clew":
      return [[["rig", "E"], round(Math.max(MIN, plan.boom.gooseneck[0] - p[0]))]];
    case "tack": {
      const tack = round(stemX - p[0]);
      return [[["rig", "forestayAftOfStem"], tack], ...(rig ? lpFor(rig.mast.aftOfStem - tack) : [])];
    }
    case "jibClew": {
      const { tack, head } = plan.forestay;
      const d = sub(head, tack);
      const len = Math.hypot(d[0], d[1]);
      // distance from the luff, on its aft side
      const lp = (d[0] * (p[1] - tack[1]) - d[1] * (p[0] - tack[0])) / len;
      return [[["rig", "headsail", "LP"], round(Math.max(MIN, lp))]];
    }
  }
  const m = /^(keel|rudder)\.(rootLE|rootTE|tipLE|tipTE)$/.exec(id);
  if (m) {
    const f = n.analysis.app[m[1]];
    if (!f) return [];
    const base = ["appendages", m[1]];
    const { rootLE, tipLE } = f.corners;
    switch (m[2]) {
      case "rootLE":
        return [[[...base, "aftOfStem"], round(stemX - p[0])]];
      case "rootTE":
        return [[[...base, "rootChord"], round(Math.max(MIN, rootLE[0] - p[0]))]];
      case "tipLE": {
        const span = Math.max(MIN, f.rootZ - p[1]);
        return [
          [[...base, "span"], round(span)],
          [[...base, "sweepDeg"], round(clamp(Math.atan2(rootLE[0] - p[0], span) / RAD, -30, 60), 0.01)],
        ];
      }
      case "tipTE":
        return [[[...base, "tipChord"], round(Math.max(0.02, tipLE[0] - p[0]))]];
    }
  }
  return [];
}
