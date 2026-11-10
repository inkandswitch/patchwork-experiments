// Sail forces from an angle-of-attack model, one per sail kind, so the VPP
// (which trims each sail to its best δ) and sailing's sim (which knows its
// boom and sheets, so its α) use the same curves. Pure, no DOM.
//
// What this module states (the contract's §6.2–6.3 repeat it, and
// contract/v1/reference/compose.js is the same rules against the contract
// alone):
//
// Angles. β is the apparent wind angle off the bow in the heeled sail plane;
// δ the sail's sheeting angle, its chord off the centreline (the boom for a
// main, tack to clew for a headsail; negative is goose-winged, to windward);
// α = wrap₁₈₀(β − δ) the angle of attack. A sail sheeted past the wind (α
// below its zero-lift angle α0) is backed.
//
// Coefficients on the sail's own area, as a function of α and δ, with the
// kind's constants (SAIL_KINDS) and S(x; lo, hi) the smoothstep:
//   easing     L = 1 − ease.loss·S(|δ|; ease.from, ease.to)   (a main eased
//              past 25° twists off: 0.25 by 85°; a headsail loses none)
//   attached   CL_a = clMax·L·sat(a·(α − α0)/(clMax·L))        α ≥ α0
//              CL_a = −clBack·L·sat(a·(α0 − α)/(clBack·L))     α < α0 (backed)
//              sat(x) = x/(1 + x⁴)^¼; a = Helmbold's slope (foils.js) for
//              the sail's AR = 2·luff²/area (the deck's mirror)
//   separated  CN = cn90·|sin α|^0.3 (a cambered plate holds most of its
//              normal force from about 35°); CL_s = sign(α)·CN·cos α,
//              CD_s = CN·|sin α|
//   blend      σ = S(|α − α0|; stall, stall + width)
//              CL  = (1 − σ)·CL_a + σ·CL_s
//              CDv = cdp + (kv·CL_a² + ease.drag·S(|δ|; ease.from, ease.to))·(1 − σ) + σ·CD_s
// Rig level, ORC-style: the sails' coefficients are summed on their areas,
//   CL = Σ CL_i·A_i/A, CDv = Σ CDv_i·A_i/A, and the induced drag is the rig's,
//   CD = CDv + CL²/(π·ARe),  ARe = h_e²/A,  h_e = 1.1·(masthead height above
//   the DWL) (SPAN_FACTOR; ORC's effective span is similar).
// Interaction (INTERACTION). A headsail's upwash backwinds the main
//   close-hauled: the main sees α − ε, ε = 4°·CL_jib·(1 − S(β; 30°, 90°)),
//   CL_jib the headsails' area-weighted CL. Downwind the main blankets a
//   headsail to leeward: its coefficients × (1 − 0.35·S(β; 90°, 160°)); a
//   headsail goose-winged to windward (from β ≥ 140°) gets × 0.75 instead.
// Depowering. flat ∈ [0.5, 1] scales CL (and so the induced drag by flat²);
//   a reef lowers the main's head (sailplan.js), taking area, luff and CE
//   height.
// Heel. The sail plane is heeled by φ: β_e = atan(tan β·cos φ), AWS_e² =
//   AWS²·(cos²β + sin²β·cos²φ). Drive Fx = q·A·(CL sin β_e − CD cos β_e) along
//   the boat; the heeling force Fh = q·A·(CL cos β_e + CD sin β_e) is
//   perpendicular to the mast, its horizontal part Fh·cos φ, at the CE.
// Sheeting limits: a main's boom 0 … 85°; a jib 7 … 30° (its lead on the
//   rail, no pole), or −90 … −30° goose-winged; a staysail 9 … 28°.
// Trim. Each sail is trimmed to the δ that maximises the drive, CL·sin β −
//   (CDv + CL²/(π·ARe))·cos β, headsails first (the main's α reads their
//   CL), at every whole degree of β (trimmedTable).
//
// Calibration (sails.test.js): trimmed to its best α at each AWA, a main
// and a jib set together reproduce the ORC "low" sets' CL and CDv within the
// tolerances stated there:
// - main: ORC VPP Documentation 2026 Table 5.2 (low set), as copied in
//   motamman/signalk-weather-router-plus (Apache-2.0), and the ORC "low lift"
//   main as tabulated in Day (2017) Table 1 (transcribed by lofilobzik/sail,
//   MIT): the two differ by up to 0.13 in CL at 60–150°; both bound the band;
// - jib: ORC VPP Documentation 2026 Table 5.5 (low set), same copy.
// Hazen's (1980) original curves were not in hand; ORC's sets descend from them.

import { liftSlope } from "./foils.js";

const RAD = Math.PI / 180;
export const smooth = (x, lo, hi) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Per kind: shape, limits, drag. Angles in degrees. */
export const SAIL_KINDS = {
  main: { alpha0: -4, clMax: 1.5, clBack: 0.7, cdp: 0.022, kv: 0.006, stall: 18, width: 22, cn90: 1.35, sheet: [0, 85], wing: null, ease: { from: 25, to: 85, loss: 0.25, drag: 0.42 } },
  jib: { alpha0: -5, clMax: 1.55, clBack: 0.8, cdp: 0.028, kv: 0.006, stall: 20, width: 30, cn90: 1.3, sheet: [7, 30], wing: { fromBeta: 140, sheet: [-90, -30], qFactor: 0.75 }, ease: { from: 12, to: 30, loss: 0, drag: 0.2 } },
  staysail: { alpha0: -5, clMax: 1.5, clBack: 0.8, cdp: 0.03, kv: 0.006, stall: 20, width: 30, cn90: 1.3, sheet: [9, 28], wing: null, ease: { from: 12, to: 28, loss: 0, drag: 0.2 } },
};
/** A sail's id to its kind's curves (a genoa and a self-tacker fly the jib's). */
export const kindOf = (sail) => (sail.id === "main" ? "main" : sail.id === "staysail" ? "staysail" : "jib");

export const INTERACTION = { kIntDeg: 4, upwash: [30, 90], blanket: { max: 0.35, from: 90, to: 160 } };
export const FLAT_MIN = 0.5;
export const SPAN_FACTOR = 1.1;

/** An angle in (−180°, 180°]. */
export const wrap180 = (a) => {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
};

/** The attached curve's saturation, x/(1 + x⁴)^¼: linear at small x, 1 at large. */
const sat = (x) => x / (1 + x ** 4) ** 0.25;
/** The separated sail's normal force against α: cn90·|sin α|^0.3 (a cambered plate holds most of it from about 35°). */
export const CN_EXP = 0.3;

/** The sail's own geometric aspect ratio for its lift slope: luff²/area, doubled for the deck's mirror. */
export const sailAR = (luffM, areaM2) => (areaM2 > 0 ? (2 * luffM * luffM) / areaM2 : 0);

/**
 * CL and CDv of one sail at an angle of attack.
 * @param {string} kind "main" | "jib" | "staysail"
 * @param {number} alphaDeg
 * @param {{ slope: number, sheetDeg?: number }} o slope per rad (Helmbold on the sail's AR); sheetDeg for easing
 */
export function sailCoefficients(kind, alphaIn, { slope, sheetDeg = 0 }) {
  const k = SAIL_KINDS[kind];
  const alphaDeg = wrap180(alphaIn);
  sheetDeg = Math.abs(sheetDeg);
  const lossK = k.ease ? 1 - k.ease.loss * smooth(sheetDeg, k.ease.from, k.ease.to) : 1;
  const clMax = k.clMax * lossK;
  const clBack = k.clBack * lossK;
  const d = (alphaDeg - k.alpha0) * RAD;
  const cla = d >= 0 ? clMax * sat((slope * d) / clMax) : -clBack * sat((slope * -d) / clBack);
  const a = alphaDeg * RAD;
  const s = Math.abs(Math.sin(a));
  const cn = k.cn90 * s ** CN_EXP;
  const cls = cn * Math.cos(a) * Math.sign(a || 1);
  const cds = cn * s;
  const sig = smooth(Math.abs(alphaDeg - k.alpha0), k.stall, k.stall + k.width);
  const cl = (1 - sig) * cla + sig * cls;
  const easeDrag = k.ease ? k.ease.drag * smooth(sheetDeg, k.ease.from, k.ease.to) : 0;
  const cdv = k.cdp + (k.kv * cla * cla + easeDrag) * (1 - sig) + sig * cds;
  return { cl, cdv, separated: sig, backed: alphaDeg < k.alpha0 };
}

/** A sail's apparent-wind factor from the other sails: the main's α shift and a headsail's dynamic pressure. */
export function interaction(kind, betaDeg, clJib) {
  if (kind === "main") return { dAlphaDeg: -INTERACTION.kIntDeg * clJib * (1 - smooth(betaDeg, ...INTERACTION.upwash)), qFactor: 1 };
  const b = INTERACTION.blanket;
  return { dAlphaDeg: 0, qFactor: 1 - b.max * smooth(betaDeg, b.from, b.to) };
}

/**
 * The sails a VPP or the contract reads: kind, area, CE, slope, sheeting
 * limits, from a laid-out plan (sailplan.js) and a reef (index into the main's reefs, −1 none).
 */
export function rigSails(plan, { reef = -1 } = {}) {
  const out = [];
  for (const s of plan.sails) {
    const kind = kindOf(s);
    let areaM2 = s.areaM2, ce = s.ce, luff = s.luffM ?? s.areaM2 ** 0.5;
    if (kind === "main" && reef >= 0 && s.reefs?.[reef]) {
      const r = s.reefs[reef];
      areaM2 = r.areaM2;
      ce = r.ce;
      luff = luff * (1 - r.fraction);
    }
    const ar = sailAR(luff, areaM2);
    out.push({ id: s.id, kind, areaM2, ce, luffM: luff, ar, slope: liftSlope(ar), sheet: SAIL_KINDS[kind].sheet });
  }
  return out;
}

/** The rig's effective span and aspect ratio for the induced drag. */
export function rigSpan(plan, sails) {
  const A = sails.reduce((t, s) => t + s.areaM2, 0);
  const he = SPAN_FACTOR * Math.max(0, plan.mast.aboveDatumZ);
  return { he, are: A > 0 ? (he * he) / A : 0, areaM2: A };
}

/**
 * Trim one sail to its best drive at β (deg) in the rig's induced drag:
 * maximise CL sin β − (CDv + CL²/(π·ARe)) cos β over δ in its limits.
 * @returns {{ alphaDeg, sheetDeg, cl, cdv, separated, backed }}
 */
export function trimSail(sail, betaDeg, { are, clJib = 0 }) {
  const kind = sail.kind;
  const k = SAIL_KINDS[kind];
  const it = interaction(kind, betaDeg, clJib);
  const sb = Math.sin(betaDeg * RAD), cb = Math.cos(betaDeg * RAD);
  const at = (sheetDeg) => {
    const wing = sheetDeg < 0;
    const qf = wing ? k.wing.qFactor : it.qFactor;
    const alpha = wrap180(betaDeg - sheetDeg + (wing ? 0 : it.dAlphaDeg));
    const c = sailCoefficients(kind, alpha, { slope: sail.slope, sheetDeg });
    const cl = c.cl * qf, cdv = c.cdv * qf;
    const drive = cl * sb - (cdv + (are > 0 ? (cl * cl) / (Math.PI * are) : 0)) * cb;
    return { alphaDeg: alpha, sheetDeg, cl, cdv, separated: c.separated, backed: c.backed, wing, drive };
  };
  const ranges = [sail.sheet];
  if (k.wing && betaDeg >= k.wing.fromBeta) ranges.push(k.wing.sheet);
  let best = null;
  for (const [lo, hi] of ranges) {
    const r = goldenMax(at, lo, hi);
    if (!best || r.drive > best.drive) best = r;
  }
  return best;
}

/** Maximise f(x).drive on [lo, hi]: a coarse scan for the basin, then golden section. */
function goldenMax(at, lo, hi) {
  const N = 24;
  let best = at(lo), bi = 0;
  for (let i = 1; i <= N; i++) {
    const r = at(lo + ((hi - lo) * i) / N);
    if (r.drive > best.drive) [best, bi] = [r, i];
  }
  let a = lo + ((hi - lo) * Math.max(0, bi - 1)) / N, b = lo + ((hi - lo) * Math.min(N, bi + 1)) / N;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = at(c), fd = at(d);
  for (let i = 0; i < 30; i++) {
    if (fc.drive > fd.drive) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = at(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = at(d);
    }
  }
  const r = fc.drive > fd.drive ? fc : fd;
  return r.drive >= best.drive ? r : best;
}

/** β grid for trimmed tables, degrees. */
export const BETA_GRID = Array.from({ length: 181 }, (_, i) => i);

/**
 * Trimmed coefficients at every β of the grid, for a set of sails: each
 * sail's α, δ, CL, CDv, and the rig's CL and CDv on the total area.
 * Headsails are trimmed first (the main's α depends on their CL).
 */
export function trimmedTable(sails, are) {
  const A = sails.reduce((t, s) => t + s.areaM2, 0);
  const rows = BETA_GRID.map((beta) => {
    const per = {};
    let clJib = 0, aj = 0;
    for (const s of sails.filter((x) => x.kind !== "main")) {
      per[s.id] = trimSail(s, beta, { are });
      clJib += per[s.id].cl * s.areaM2;
      aj += s.areaM2;
    }
    clJib = aj > 0 ? clJib / aj : 0;
    for (const s of sails.filter((x) => x.kind === "main")) per[s.id] = trimSail(s, beta, { are, clJib });
    let cl = 0, cdv = 0;
    for (const s of sails) {
      cl += (per[s.id].cl * s.areaM2) / A;
      cdv += (per[s.id].cdv * s.areaM2) / A;
    }
    return { beta, cl, cdv, per };
  });
  return { areaM2: A, are, rows };
}

const TABLES = new Map(); // key → table, oldest first
const MAX_TABLES = 24;
/**
 * A sail set's trimmed table, memoised on what it depends on (the sails'
 * kinds, slopes and areas, and the rig's ARe). Moving the rig fore and aft
 * with J kept never re-trims it; anything that changes a sail's area (J, P,
 * E, I, LP) does, about 15 ms a set. Flattened for the VPP: cl[β], cdv[β]
 * and each sail's sheeting angle sheets[id][β], β every degree.
 * @param {{ sails: { id, kind, areaM2, slope, sheet }[], are: number }} set
 */
const BY_SET = new WeakMap();
export function tableOf(set) {
  const own = BY_SET.get(set);
  if (own) return own;
  const t0 = tableByKey(set);
  if (!t0.approximate) BY_SET.set(set, t0);
  return t0;
}

// While a handle is being dragged the tool asks for figures every frame, and
// re-trimming each set as its areas change costs more than a frame. Inside
// approximately(), a miss borrows the most recently used table of the same
// sails (ids and kinds): its coefficients, per unit area, for slightly
// different proportions. Marked approximate and never cached, so the render
// after the drag trims exactly.
let approx = 0;
export function approximately(fn) {
  approx++;
  try {
    return fn();
  } finally {
    approx--;
  }
}
const sigOf = (set) => JSON.stringify(set.sails.map((s) => [s.id, s.kind]));

function tableByKey(set) {
  const key = JSON.stringify([set.are, set.sails.map((s) => [s.id, s.kind, s.areaM2, s.slope])]);
  let t = TABLES.get(key);
  if (t) {
    TABLES.delete(key);
    TABLES.set(key, t);
    return t;
  }
  if (approx > 0) {
    const sig = sigOf(set);
    const near = [...TABLES.values()].reverse().find((x) => x.sig === sig);
    if (near) return { ...near, areaM2: set.sails.reduce((a, s) => a + s.areaM2, 0), are: set.are, approximate: true };
  }
  const full = trimmedTable(set.sails, set.are);
  t = {
    sig: sigOf(set),
    areaM2: full.areaM2,
    are: full.are,
    rows: full.rows.map((r) => ({ beta: r.beta, cl: r.cl, cdv: r.cdv })),
    sheets: Object.fromEntries(set.sails.map((s) => [s.id, full.rows.map((r) => r.per[s.id].sheetDeg)])),
    alphas: Object.fromEntries(set.sails.map((s) => [s.id, full.rows.map((r) => r.per[s.id].alphaDeg)])),
  };
  TABLES.set(key, t);
  while (TABLES.size > MAX_TABLES) TABLES.delete(TABLES.keys().next().value);
  return t;
}

/** The rig's trimmed CL and CDv at β (linear between grid degrees). */
export function rigCoefficientsAt(table, betaDeg) {
  const b = Math.min(180, Math.max(0, Math.abs(betaDeg)));
  const i = Math.min(179, Math.floor(b));
  const t = b - i;
  const r0 = table.rows[i], r1 = table.rows[i + 1];
  return { cl: r0.cl + t * (r1.cl - r0.cl), cdv: r0.cdv + t * (r1.cdv - r0.cdv) };
}

/**
 * The rig's forces at an apparent wind, heel and flat (N, and the sail-plane angle).
 * @param {{ areaM2, are, rows }} table trimmedTable's
 * @param {{ aws: number, awaDeg: number, heelDeg: number, flat: number, rho?: number }} s
 */
export function rigForces(table, { aws, awaDeg, heelDeg, flat = 1, rho = 1.225 }) {
  const p = heelDeg * RAD;
  const b = awaDeg * RAD;
  const be = Math.atan2(Math.sin(b) * Math.cos(p), Math.cos(b));
  const awsE = aws * Math.sqrt(Math.cos(b) ** 2 + (Math.sin(b) * Math.cos(p)) ** 2);
  const c = rigCoefficientsAt(table, be / RAD);
  const cl = flat * c.cl;
  const cd = c.cdv + (table.are > 0 ? (cl * cl) / (Math.PI * table.are) : 0);
  const q = 0.5 * rho * awsE * awsE * table.areaM2;
  return { drive: q * (cl * Math.sin(be) - cd * Math.cos(be)), heelForce: q * (cl * Math.cos(be) + cd * Math.sin(be)), betaE: be / RAD, awsE, cl, cd };
}

/** Tabulated CL, CDv against α for one sail (the contract's coeffs), α from −30° to 120°. */
export function coeffTable(sail, { stepDeg = 2.5, sheetDeg = 0 } = {}) {
  const alphaDeg = [], cl = [], cd = [];
  for (let a = -30; a <= 120 + 1e-9; a += stepDeg) {
    const c = sailCoefficients(sail.kind, a, { slope: sail.slope, sheetDeg });
    alphaDeg.push(+a.toFixed(3));
    cl.push(c.cl);
    cd.push(c.cdv);
  }
  return { alphaDeg, cl, cd };
}

// ───────────────────────────────── the published envelope

export const ORC_MAIN_2026 = {
  cite: "ORC VPP Documentation 2026, Table 5.2, mainsail LOW set, as copied in motamman/signalk-weather-router-plus src/vessel/vpp_physics.ts (Apache-2.0), retrieved 2026-11-06. The ORC document itself was not opened here.",
  beta: [0, 7, 9, 12, 28, 60, 90, 120, 150, 180],
  cl: [0.0, 0.86207, 1.05172, 1.16379, 1.34698, 1.35345, 1.26724, 0.93103, 0.38793, -0.11207],
  cdv: [0.0431, 0.02586, 0.02328, 0.02328, 0.03259, 0.11302, 0.3825, 0.96888, 1.31578, 1.34483],
};
export const ORC_MAIN_DAY2017 = {
  cite: "Day, A.H. (2017), 'Performance prediction for sailing dinghies', Ocean Engineering 136, pp. 67–79, Table 1 (ORC 'low lift' mainsail coefficients, CDv viscous only), as transcribed from the page image by lofilobzik/sail data/sail-coefficients.json (MIT), retrieved 2026-11-06.",
  beta: [0, 7, 9, 12, 28, 60, 90, 120, 150, 180],
  cl: [0.0, 0.862, 1.052, 1.164, 1.347, 1.239, 1.125, 0.838, 0.296, -0.112],
  cdv: [0.043, 0.026, 0.023, 0.023, 0.033, 0.113, 0.383, 0.969, 1.316, 1.345],
};
export const ORC_JIB_2026 = {
  cite: "ORC VPP Documentation 2026, Table 5.5, jib LOW set, as copied in motamman/signalk-weather-router-plus src/vessel/vpp_physics.ts (Apache-2.0), retrieved 2026-11-06.",
  beta: [7, 15, 20, 27, 50, 60, 100, 150, 180],
  cl: [0.0, 1.0, 1.375, 1.45, 1.45, 1.25, 0.4, 0.0, -0.1],
  cdv: [0.05, 0.032, 0.031, 0.037, 0.25, 0.35, 0.73, 0.95, 0.9],
};
