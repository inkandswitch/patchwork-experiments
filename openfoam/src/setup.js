// The analysis a case describes, and the physics both sides read: the tool
// (pre-flight figures) and the daemon (the case it writes). Pure: no DOM, no
// automerge, no node. Everything is SI and in the FLOATING frame: metres, x
// toward the bow, y to port, z up, the design waterline at z = 0. A boat going
// ahead sees the stream come from +x (U = (−V, 0, 0)).

/** @typedef {"double-body" | "free-surface"} Mode */
/**
 * A speed is one value with its unit, as whoever set it gave it: 8 kn is
 * { value: 8, unit: "kn" }. Nothing infers a unit from a bare number, and
 * nothing stores a speed converted: m/s is computed (metresPerSecond) where
 * the physics needs it. So what is shown is what was set.
 * @typedef {{ value: number, unit: "kn" | "m/s" }} Speed
 */
/** @typedef {"coarse" | "medium" | "fine"} MeshPreset */

/**
 * @typedef {object} Setup
 * @property {Mode} mode
 * @property {Speed} speed            the boat's speed through the water, in the unit it was given in
 * @property {"salt"|"fresh"} water
 * @property {number} temperature      °C, 0–30
 * @property {{ sinkage: number, trim: number }} attitude
 *   sinkage: metres the hull is lowered from as drawn (negative raises it);
 *   trim: degrees, bow down positive, about the hull's mid-length on the waterline;
 *   heel: degrees, starboard down positive, about the waterline's centreline
 *   (a heeled hull has no symmetry plane, so it always runs the full domain)
 * @property {MeshPreset} mesh
 * @property {number} iterations       solver iterations (steady, or LTS pseudo-time)
 * @property {"auto"|"half"|"full"} domain   half: y ≤ 0 with a symmetry plane, for a symmetric hull
 * @property {number} cores            0: the daemon decides
 * @property {string|null} warmStart  a finished run (automerge url) whose solution starts this one,
 *   when the daemon still has its case; null starts from rest
 * @property {"settled"|"iterations"} stop  settled: stop once the resistance settles
 *   (src/convergence.js), with `iterations` as the ceiling; iterations: run them all
 */

export const MODES = Object.freeze(["double-body", "free-surface"]);
export const MODE_LABELS = Object.freeze({
  "double-body": "Double body (no waves)",
  "free-surface": "Free surface (waves)",
});
export const MESH_PRESETS = Object.freeze(["coarse", "medium", "fine"]);
export const KNOT = 1852 / 3600; // m/s
export const G = 9.80665;

/** Each speed unit, as m/s. */
export const SPEED_UNITS = Object.freeze({ kn: KNOT, "m/s": 1 });
/** The speeds a run can take, m/s. */
export const SPEED_RANGE = Object.freeze([0.05, 40]);

/** Is this a speed: a finite value with one of SPEED_UNITS? */
export const isSpeed = (v) => !!v && typeof v === "object" && typeof v.value === "number" && Number.isFinite(v.value) && Object.hasOwn(SPEED_UNITS, v.unit);

/** A speed in m/s. */
export function metresPerSecond(speed) {
  if (!isSpeed(speed)) throw new Error(`not a speed: ${JSON.stringify(speed)} (a speed is { value, unit } with unit ${Object.keys(SPEED_UNITS).join(" or ")})`);
  return speed.value * SPEED_UNITS[speed.unit];
}

/** The same speed in another unit (to 6 decimals, so 8 kn → m/s → kn is 8 again). */
export function speedIn(speed, unit) {
  if (!Object.hasOwn(SPEED_UNITS, unit)) throw new Error(`unknown speed unit ${JSON.stringify(unit)}: use ${Object.keys(SPEED_UNITS).join(" or ")}`);
  if (speed.unit === unit) return { value: speed.value, unit };
  return { value: +(metresPerSecond(speed) / SPEED_UNITS[unit]).toFixed(6), unit };
}

const UNIT_WORDS = Object.freeze({ kn: "kn", kt: "kn", kts: "kn", knot: "kn", knots: "kn", "m/s": "m/s", mps: "m/s" });

/**
 * A speed from what a person or a tool wrote: { value, unit } or text such as
 * "8 kn" or "4.1 m/s". A number with no unit is refused, never guessed at.
 * @returns {Speed}
 */
export function parseSpeed(input) {
  const units = Object.keys(SPEED_UNITS).join(" or ");
  let speed = null;
  if (typeof input === "string") {
    const m = input.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z/]+)$/i);
    const unit = m ? UNIT_WORDS[m[2].toLowerCase()] : null;
    if (!m || !unit) throw new Error(`speed ${JSON.stringify(input)}: give a number and its unit, e.g. "8 kn" or "4.1 m/s"`);
    speed = { value: Number(m[1]), unit };
  } else if (input && typeof input === "object") {
    const unit = UNIT_WORDS[String(input.unit ?? "").toLowerCase()];
    if (!unit) throw new Error(`speed ${JSON.stringify(input)}: its unit must be ${units}`);
    speed = { value: Number(input.value), unit };
  } else throw new Error(`speed ${JSON.stringify(input)}: give a number with its unit, e.g. "8 kn" or { "value": 8, "unit": "kn" } — a bare number has no unit`);
  if (!Number.isFinite(speed.value)) throw new Error(`speed ${JSON.stringify(input)}: its value isn't a number`);
  const V = metresPerSecond(speed);
  if (V < SPEED_RANGE[0] || V > SPEED_RANGE[1]) {
    const [lo, hi] = SPEED_RANGE.map((v) => speedIn({ value: v, unit: "m/s" }, speed.unit));
    throw new Error(`speed ${formatSpeed(speed)} is outside ${+lo.value.toFixed(3)}–${formatSpeed(hi)}`);
  }
  return speed;
}

/** Iterations each mode needs to settle, by mesh preset. */
export const DEFAULT_ITERATIONS = Object.freeze({
  "double-body": { coarse: 600, medium: 1000, fine: 1500 },
  // LTS free-surface runs settle slowly: the first coarse run (narrow-transom,
  // 6 kn) was still losing 0.7 kN over its last 150 of 1500; DTCHull runs 4000
  "free-surface": { coarse: 4000, medium: 5000, fine: 6000 },
});

/** @returns {Setup} */
export function defaultSetup() {
  return {
    mode: "double-body",
    speed: { value: 6, unit: "kn" },
    water: "salt",
    temperature: 15,
    attitude: { sinkage: 0, trim: 0, heel: 0 },
    mesh: "coarse",
    iterations: DEFAULT_ITERATIONS["double-body"].coarse,
    domain: "auto",
    cores: 0,
    stop: "settled",
    warmStart: null,
    keepVolume: false,
  };
}

const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * A setup made safe: every field present, in range. Docs are written by
 * forms, agents and merges; both sides read through this, so they agree.
 * @returns {Setup}
 */
export function normalizeSetup(s) {
  const d = defaultSetup();
  s = s && typeof s === "object" ? s : {};
  const mode = MODES.includes(s.mode) ? s.mode : d.mode;
  const mesh = MESH_PRESETS.includes(s.mesh) ? s.mesh : d.mesh;
  return {
    mode,
    speed: isSpeed(s.speed) ? clampSpeed(s.speed) : d.speed,
    water: s.water === "fresh" ? "fresh" : "salt",
    temperature: clamp(num(s.temperature, d.temperature), 0, 30),
    attitude: {
      sinkage: clamp(num(s.attitude?.sinkage, 0), -50, 50),
      trim: clamp(num(s.attitude?.trim, 0), -10, 10),
      heel: clamp(num(s.attitude?.heel, 0), -60, 60),
    },
    mesh,
    iterations: Math.round(clamp(num(s.iterations, DEFAULT_ITERATIONS[mode][mesh]), 50, 20000)),
    domain: s.domain === "half" || s.domain === "full" ? s.domain : "auto",
    cores: Math.round(clamp(num(s.cores, 0), 0, 256)),
    stop: s.stop === "iterations" ? "iterations" : "settled",
    warmStart: typeof s.warmStart === "string" && /^automerge:[1-9A-HJ-NP-Za-km-z]+$/.test(s.warmStart) ? s.warmStart : null,
    // keep every cell's flow (the mesh and the last fields) in docs: big, so asked for
    keepVolume: s.keepVolume === true,
  };
}

/** A speed held to SPEED_RANGE, in its own unit. */
function clampSpeed(speed) {
  const V = metresPerSecond(speed);
  const W = clamp(V, SPEED_RANGE[0], SPEED_RANGE[1]);
  return W === V ? { value: speed.value, unit: speed.unit } : speedIn({ value: W, unit: "m/s" }, speed.unit);
}

/**
 * What in a setup as written isn't what it reads as: every field that
 * normalizeSetup() replaced or clamped, and any field a setup doesn't have.
 * Empty for a setup that means exactly what it says. The case shows these,
 * and the agent's tools refuse a change that would make one.
 * @returns {string[]}
 */
export function setupProblems(raw) {
  if (raw == null) return [];
  if (typeof raw !== "object") return [`the setup is ${JSON.stringify(raw)}, not an object`];
  const n = normalizeSetup(raw);
  const out = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of Object.keys(raw)) {
    if (!(k in n)) {
      out.push(`setup.${k} isn't part of a setup (ignored)`);
      continue;
    }
    if (k === "attitude" && raw.attitude && typeof raw.attitude === "object") {
      for (const a of Object.keys(raw.attitude)) {
        if (!(a in n.attitude)) out.push(`setup.attitude.${a} isn't part of an attitude (ignored)`);
        else if (!same(raw.attitude[a], n.attitude[a])) out.push(`setup.attitude.${a} is ${JSON.stringify(raw.attitude[a])}; it reads as ${n.attitude[a]}`);
      }
      continue;
    }
    if (same(raw[k], n[k])) continue;
    if (k === "speed" && !isSpeed(raw.speed))
      out.push(`setup.speed is ${JSON.stringify(raw.speed)}, which isn't a speed with a unit; it reads as ${formatSpeed(n.speed)}. A speed is { "value": 8, "unit": "kn" } (unit kn or m/s)`);
    else out.push(`setup.${k} is ${JSON.stringify(raw[k])}; it reads as ${k === "speed" ? formatSpeed(n.speed) : JSON.stringify(n[k])}`);
  }
  return out;
}

/**
 * A setup with some fields changed, as the case's form and the agent's
 * tools change it. `patch` holds setup fields; `attitude` and `speed` are
 * merged field by field. A new analysis takes its own default iterations
 * (the two need counts an order of magnitude apart); a new mesh does too,
 * unless someone chose the count. A patch that names `iterations` keeps it.
 * @returns {{ setup: Setup, problems: string[] }}  problems: what in the patch doesn't read as written
 */
export function patchSetup(current, patch) {
  const s = normalizeSetup(current);
  const raw = { ...s, ...patch, attitude: { ...s.attitude, ...(patch.attitude ?? {}) } };
  if (patch.mode !== undefined || patch.mesh !== undefined) {
    const wasDefault = Object.values(DEFAULT_ITERATIONS[s.mode]).includes(s.iterations);
    const next = normalizeSetup(raw);
    if (patch.iterations === undefined && ((patch.mode !== undefined && next.mode !== s.mode) || wasDefault)) raw.iterations = DEFAULT_ITERATIONS[next.mode][next.mesh];
  }
  const touched = new Set(Object.keys(patch).map((k) => `setup.${k}`));
  const problems = setupProblems(raw).filter((p) => [...touched].some((t) => p.startsWith(`${t} `) || p.startsWith(`${t}.`)));
  return { setup: normalizeSetup(raw), problems };
}

/**
 * Write a setup into a doc's (inside a change), touching only the fields
 * that differ, so two people changing two fields at once both keep theirs;
 * fields a setup doesn't have are removed.
 */
export function writeSetup(doc, next) {
  if (!doc.setup || typeof doc.setup !== "object") {
    doc.setup = JSON.parse(JSON.stringify(next));
    return;
  }
  const put = (target, want) => {
    for (const k of Object.keys(target)) if (!(k in want)) delete target[k];
    for (const [k, v] of Object.entries(want)) {
      if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) put(target[k], v);
      else if (JSON.stringify(target[k]) !== JSON.stringify(v)) target[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
    }
  };
  put(doc.setup, next);
}

// ---------------------------------------------------------------- water

/**
 * Density and kinematic viscosity of water, 0–30 °C, fresh or seawater at
 * 35 g/kg, at atmospheric pressure:
 *   density    UNESCO EOS-80 (Millero & Poisson 1981): the pure-water
 *              polynomial, plus the salinity terms at S = 35
 *   viscosity  pure water by the Vogel equation, μ = A·10^(B/(T − C)) with
 *              A = 2.414e-5 Pa·s, B = 247.8 K, C = 140 K (within 2% over the
 *              range, 0.2% at 15 °C); seawater by Sharqawy et al. (2010),
 *              μ_sw = μ_w (1 + A S + B S²), S in kg/kg
 * At 15 °C these give 999.10 kg/m³, 1.137e-6 m²/s fresh and 1025.97 kg/m³,
 * 1.187e-6 m²/s salt (ITTC 7.5-02-01-03 tabulates 999.10 / 1.1386e-6 and
 * 1026.0 / 1.1883e-6). Air is the usual 1.2 kg/m³, 1.5e-5 m²/s (only the
 * free-surface case reads it).
 * @returns {{ rho: number, nu: number, source: string }}
 */
export function waterProperties(water, t) {
  t = clamp(num(t, 15), 0, 30);
  const rhoW =
    999.842594 + 6.793952e-2 * t - 9.09529e-3 * t ** 2 + 1.001685e-4 * t ** 3 - 1.120083e-6 * t ** 4 + 6.536332e-9 * t ** 5;
  const muW = 2.414e-5 * 10 ** (247.8 / (t + 273.15 - 140));
  if (water === "fresh") return { rho: rhoW, nu: muW / rhoW, source: "fresh water: EOS-80 density, Vogel viscosity" };
  const S = 35; // g/kg
  const rho =
    rhoW +
    S * (0.824493 - 4.0899e-3 * t + 7.6438e-5 * t ** 2 - 8.2467e-7 * t ** 3 + 5.3875e-9 * t ** 4) +
    S ** 1.5 * (-5.72466e-3 + 1.0227e-4 * t - 1.6546e-6 * t ** 2) +
    4.8314e-4 * S * S;
  const s = S / 1000;
  const A = 1.541 + 1.998e-2 * t - 9.52e-5 * t * t;
  const B = 7.974 - 7.561e-2 * t + 4.724e-4 * t * t;
  const mu = muW * (1 + A * s + B * s * s);
  return { rho, nu: mu / rho, source: "seawater 35 g/kg: EOS-80 density, Sharqawy (2010) viscosity" };
}
export const AIR = Object.freeze({ rho: 1.2, nu: 1.5e-5 });

// ---------------------------------------------------------------- numbers

export const froude = (V, L) => (L > 0 ? V / Math.sqrt(G * L) : NaN);
export const reynolds = (V, L, nu) => (nu > 0 ? (V * L) / nu : NaN);
/** ITTC-1957 model–ship correlation line. */
export const ittc57 = (Re) => (Re > 100 ? 0.075 / (Math.log10(Re) - 2) ** 2 : NaN);
/** The wavelength of a free wave travelling at V (deep water). */
export const waveLength = (V) => (2 * Math.PI * V * V) / G;

/**
 * Friction-line screening resistance, for the pre-flight: ITTC-57 Cf on the
 * wetted area, times a form factor (none given: 1). Not a prediction of the
 * total; it is the floor the CFD's viscous drag should land near.
 */
export function frictionEstimate({ V, S, L, rho, nu, formFactor = 1 }) {
  const Re = reynolds(V, L, nu);
  const Cf = ittc57(Re);
  const R = formFactor * Cf * 0.5 * rho * V * V * S;
  return { Re, Cf, R };
}

// ---------------------------------------------------------------- mesh sizing

/**
 * How the case is meshed, as numbers the daemon writes and the tool shows.
 * Everything scales with the hull's length L, so the same preset makes a
 * similar mesh for a dinghy and a ship.
 *
 *   background cells: L / n0 across the box
 *   hull surface:     levels (lo, hi) of 2× refinement on top of that
 *   free surface:     a band round z = 0 refined until a wave of the boat's
 *                     own speed gets `cellsPerWave` cells, never past the hull's level
 *   layers:           wall layers on the hull (0 skips the layer stage)
 */
export const MESH_SIZING = Object.freeze({
  coarse: { n0: 8, hull: [5, 6], cellsPerWave: 16, layers: 3, near: 3 },
  medium: { n0: 10, hull: [6, 7], cellsPerWave: 24, layers: 3, near: 4 },
  fine: { n0: 12, hull: [7, 7], cellsPerWave: 32, layers: 5, near: 4 },
});

/**
 * The computational domain and its refinement, from the hull's extent (after
 * attitude). `hull`: { xMin, xMax, yMax (half-breadth), zMin, zMax } in the
 * floating frame. Half models keep y ≤ 0.
 */
export function domainFor(setup, hull, { half }) {
  const L = Math.max(hull.xMax - hull.xMin, 1e-3);
  const sz = MESH_SIZING[setup.mesh] ?? MESH_SIZING.coarse;
  const h0 = L / sz.n0;
  const free = setup.mode === "free-surface";
  const draft = Math.max(-hull.zMin, 0.01 * L);
  const x0 = hull.xMin - 2.5 * L;
  const x1 = hull.xMax + 1.25 * L;
  const y0 = -1.5 * L;
  const y1 = half ? 0 : 1.5 * L;
  // z is snapped to whole cells of h0 either side of 0, so a grid plane lies
  // exactly on the waterline, and every refinement of it too. Otherwise the
  // inlet face that straddles z = 0 is all water or all air (setFields goes
  // by its centre), the inflow's water level is off by up to half a cell,
  // and the whole domain fills or drains to that level: the first coarse
  // free-surface run lost 0.23 m of water depth that way, and with it 35 kN
  // of buoyancy and the drag's sign.
  const nzBelow = Math.max(2, Math.ceil(Math.max(1.25 * L, 4 * draft) / h0));
  const nzAbove = free ? Math.max(1, Math.ceil(Math.max(0.35 * L, hull.zMax + 0.15 * L) / h0)) : 0;
  const z0 = -nzBelow * h0;
  const z1 = nzAbove * h0;
  const cells = [Math.max(2, Math.round((x1 - x0) / h0)), Math.max(2, Math.round((y1 - y0) / h0)), nzBelow + nzAbove];
  const b = Math.max(hull.yMax, 0.02 * L);
  const yBox = (w) => (half ? [-w, 0] : [-w, w]);
  // nested refinement boxes round the hull (levels 1 and `near`)
  const boxes = [
    { level: 1, min: [hull.xMin - 1.0 * L, yBox(b + 0.6 * L)[0], -Math.max(0.6 * L, 2 * draft)], max: [hull.xMax + 0.4 * L, yBox(b + 0.6 * L)[1], free ? 0.2 * L : 0] },
    { level: sz.near, min: [hull.xMin - 0.35 * L, yBox(b + 0.2 * L)[0], -(draft + 0.2 * L)], max: [hull.xMax + 0.15 * L, yBox(b + 0.2 * L)[1], free ? Math.max(hull.zMax, 0) + 0.05 * L : 0] },
  ];
  let freeSurface = null;
  if (free) {
    const V = metresPerSecond(setup.speed);
    const lambda = waveLength(V);
    const target = lambda / sz.cellsPerWave;
    const level = clampInt(Math.ceil(Math.log2(h0 / target)), 1, sz.hull[0]);
    const h = h0 / 2 ** level;
    // the band near the hull: the bow wave rises about V²/2g; keep a few cells either side
    const a = Math.max(4 * h, 0.75 * ((V * V) / (2 * G)));
    // and a band one level coarser across the WHOLE domain. Without it the
    // interface far from the hull sits in background cells, smears over a
    // metre, and the water level drifts; a level difference of centimetres
    // along the hull is kilonewtons of hydrostatic force fore and aft (the
    // first coarse run went from +5.6 kN to −3.6 kN that way). DTCHull keeps
    // its interface fine everywhere for the same reason.
    const farLevel = Math.max(1, level - 1);
    const hFar = h0 / 2 ** farLevel;
    const aFar = Math.max(3 * hFar, 0.5 * ((V * V) / (2 * G)));
    freeSurface = {
      level,
      cell: h,
      lambda,
      cellsPerWave: lambda / h,
      box: { min: [hull.xMin - 1.5 * L, yBox(b + 0.9 * L)[0], -a], max: [hull.xMax + 0.25 * L, yBox(b + 0.9 * L)[1], a] },
      far: { level: farLevel, cell: hFar, box: { min: [x0, y0, -aFar], max: [x1, y1, aFar] } },
    };
  }
  // a point in the fluid, not on any cell face: upstream, off to the side, below the surface
  const inside = [x1 - 0.4371 * (x1 - hull.xMax), y0 * 0.3137, z0 * 0.2213];
  return {
    L,
    h0,
    min: [x0, y0, z0],
    max: [x1, y1, z1],
    cells,
    boxes,
    hullLevels: sz.hull,
    hullCell: h0 / 2 ** sz.hull[0],
    layers: sz.layers,
    freeSurface,
    inside,
    half,
  };
}

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * A rough cell count, for the pre-flight only (the real count comes from
 * checkMesh): the background, each refinement box's extra cells (refining a
 * cell once makes 8), and the hull's surface cells with their transition.
 * Good to a factor of two or so; it says which preset will fit a laptop.
 */
export function estimateCells(dom, wettedArea) {
  const vol = (b) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
  const cellVol = (level) => (dom.h0 / 2 ** level) ** 3;
  let n = dom.cells[0] * dom.cells[1] * dom.cells[2];
  let prevLevel = 0;
  for (const b of dom.boxes) {
    n += vol(b) * (1 / cellVol(b.level) - 1 / cellVol(prevLevel));
    prevLevel = b.level;
  }
  if (dom.freeSurface) {
    const fs = dom.freeSurface;
    const far = fs.far;
    if (far && far.level > 0) n += vol(far.box) * (1 / cellVol(far.level) - 1 / cellVol(0));
    const extra = 1 / cellVol(fs.level) - 1 / cellVol(Math.max(far?.level ?? 0, Math.min(fs.level, dom.boxes[0].level)));
    if (extra > 0) n += vol(fs.box) * extra;
  }
  const hc = dom.hullCell;
  const side = dom.half ? 0.5 : 1;
  // surface cells, a few cells deep at each level down to the near box
  n += ((side * wettedArea) / (hc * hc)) * (6 + 2 * dom.layers);
  return Math.round(n);
}

/**
 * Rough wall-clock, seconds: cell-iterations at a rate per core. A server
 * just has more cores.
 */
export function estimateSeconds(setup, cells, cores) {
  // core-seconds per cell-iteration, from the first runs on an M-series Mac
  // (2026-11-14, 8 ranks): simpleFoam 123k cells at 0.076 s an iteration,
  // interFoam (LTS) 360k cells at 0.78 s; parallel efficiency as cores^0.85
  const perCellIter = setup.mode === "free-surface" ? 1.3e-5 : 3.6e-6;
  const c = Math.max(1, cores || 1);
  const mesh = 15 + cells * 1e-4;
  return mesh + (perCellIter * cells * setup.iterations) / Math.pow(c, 0.85);
}

export function formatDuration(s) {
  if (!Number.isFinite(s)) return "–";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

/** A speed as it was given: "8 kn", "4.1 m/s" (at most 3 decimals). */
export function formatSpeed(speed) {
  if (!isSpeed(speed)) return "–";
  return `${+speed.value.toFixed(3)} ${speed.unit}`;
}

/** A speed as given, with the other unit beside it: "8 kn (4.116 m/s)". */
export function formatSpeedBoth(speed) {
  if (!isSpeed(speed)) return "–";
  const other = speedIn(speed, speed.unit === "kn" ? "m/s" : "kn");
  return `${formatSpeed(speed)} (${formatSpeed(other)})`;
}

// ---------------------------------------------------------------- the case from a hull

/** The hull's extent as domainFor() reads it, from prepareHull()'s info. */
export function hullExtent(info) {
  return {
    xMin: info.bounds.min[0],
    xMax: info.bounds.max[0],
    yMax: Math.max(Math.abs(info.bounds.min[1]), Math.abs(info.bounds.max[1])),
    zMin: info.bounds.min[2],
    zMax: info.bounds.max[2],
  };
}

/**
 * A half model (y ≤ 0, symmetry at y = 0)? "auto": when the hull is
 * symmetric. Never when it's heeled: a heeled hull isn't, whatever's asked.
 */
export function isHalfModel(setup, info) {
  if (Math.abs(setup.attitude?.heel ?? 0) > 1e-9) return false;
  if (setup.domain === "full") return false;
  if (setup.domain === "half") return true;
  return info.symmetric === true;
}

/** The domain a run of this setup on this hull would mesh: the daemon writes it, the tool previews it. */
export function domainForHull(setupIn, info) {
  const setup = normalizeSetup(setupIn);
  const half = isHalfModel(setup, info);
  return { half, dom: domainFor(setup, hullExtent(info), { half }) };
}
