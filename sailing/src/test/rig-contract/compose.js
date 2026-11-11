// patchwork-rig v1 — a reference consumer of §6, the force composition.
//
// Written from specification.md §6 against the contract alone: it imports
// nothing (not even the rig aid's own modules), so a consumer such as
// sailing's physics can copy it, and the naval package's
// src/contract-agreement.test.js checks that, evaluated at each unflagged
// predicted point of the contract fixtures, it balances (surge, sway, roll
// and yaw residuals at solver precision). That is the agreement the plan
// asks of the sim: the same rules, applied to the same coefficients.
//
//   const k = composer(contract)
//   k.forcesAt({ set, flat, twsMs, twaDeg }, { V, heelDeg, leewayDeg, rudderDeg })
//   k.residuals(point)  → { surge, sway, roll, yaw } scaled to O(1), roll null when she sails upright
//
// Air comes from each set's `trimmed` table (§6.3: the aid trims every sail
// to its best sheet at each whole degree of β_e; a sim with its own sheets
// evaluates §6.2 per sail instead). Water is evaluated from the formulas of
// §6.4–6.5 with the contract's coefficients; `resistanceFromTable` swaps
// the hull's part for the contract's R(V, φ) table.

const RAD = Math.PI / 180;
const G = 9.80665;
const G_SAVITSKY = 9.8066; // §6.5.6: as in the implementation it was checked against

const smooth = (x, lo, hi) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const ittc57 = (re) => (re > 1e3 ? 0.075 / (Math.log10(re) - 2) ** 2 : NaN);

/** Linear on a sorted axis; NaN beyond it. */
function lerp(xs, ys, x) {
  if (!(x >= xs[0] && x <= xs[xs.length - 1])) return NaN;
  let k = 0;
  while (k < xs.length - 2 && xs[k + 1] < x) k++;
  const t = xs[k + 1] === xs[k] ? 0 : (x - xs[k]) / (xs[k + 1] - xs[k]);
  return ys[k] + t * (ys[k + 1] - ys[k]);
}

/** A table's row at x, linear between rows, the end rows held beyond. */
function rowAt(axis, rows, x) {
  if (x <= axis[0]) return rows[0];
  const n = axis.length;
  if (x >= axis[n - 1]) return rows[n - 1];
  let k = 0;
  while (axis[k + 1] < x) k++;
  const t = (x - axis[k]) / (axis[k + 1] - axis[k]);
  return rows[k].map((a, i) => a + t * (rows[k + 1][i] - a));
}

/** §6.4 Helmbold with the half-chord sweep. */
export const helmbold = (A, sweepHalfDeg) => {
  if (!(A > 0)) return 0;
  const t = Math.tan(sweepHalfDeg * RAD);
  return (2 * Math.PI * A) / (2 + Math.sqrt(A * A * (1 + t * t) + 4));
};

/** §6.4 a foil's CL at α (deg) and heel. */
export function foilCL(f, alphaDeg, heelDeg) {
  if (!f) return { cl: 0, slope: 0, arEff: 0 };
  const ar = f.arGeom * (1 + (f.endPlateFactor - 1) * Math.cos(heelDeg * RAD) ** 2);
  const a = helmbold(ar, f.sweepHalfDeg);
  const lin = a * alphaDeg * RAD;
  const clMax = a * f.stallDeg * RAD;
  return { cl: clMax > 0 ? lin / (1 + (lin / clMax) ** 8) ** 0.125 : 0, slope: a, arEff: ar };
}

/** §6.5.6 Savitsky's prismatic planing surface. */
export function savitsky({ weightN: W, beamM: b, deadriseDeg: beta, lcgFromAftM: lcg }, V, rho, nu) {
  const bisect = (f, target, lo, hi) => {
    let flo = f(lo) - target;
    const fhi = f(hi) - target;
    if (flo * fhi > 0) return Math.abs(flo) < Math.abs(fhi) ? lo : hi;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const fm = f(mid) - target;
      if (fm === 0) return mid;
      if (flo * fm < 0) hi = mid;
      else [lo, flo] = [mid, fm];
    }
    return 0.5 * (lo + hi);
  };
  const cv = V / Math.sqrt(G_SAVITSKY * b);
  const cLb = W / (0.5 * rho * V * V * b * b);
  const cL0 = bisect((c) => c - 0.0065 * beta * c ** 0.6, cLb, cLb, cLb + 0.0065 * beta * (cLb + 1) ** 0.6 + 1);
  const lam = bisect((l) => (0.75 - 1 / (5.21 * (cv / l) ** 2 + 2.39)) * l * b, lcg, 0.2, 12);
  const tau = (cL0 / (0.012 * Math.sqrt(lam) + (0.0055 * lam ** 2.5) / cv ** 2)) ** (1 / 1.1);
  const dyn = 0.012 * tau ** 1.1 * Math.sqrt(lam);
  const vm = V * Math.sqrt(Math.max(0, 1 - (dyn - 0.0065 * beta * dyn ** 0.6) / (lam * Math.cos(tau * RAD))));
  // wetted bottom λb²/cos β, C_f + ΔC_f (0.0004), §6.5.6
  const rf = (0.5 * rho * vm * vm * lam * b * b * (ittc57((vm * lam * b) / nu) + 0.0004)) / Math.cos(beta * RAD);
  return { total: W * Math.tan(tau * RAD) + rf / Math.cos(tau * RAD), tau, lam, cv };
}

/** A composer for one contract. */
export function composer(c, { resistanceFromTable = false } = {}) {
  const R = c.resistance;
  const rho = R.rhoWaterKgM3;
  const nu = R.nuM2s;
  const rhoAir = c.sailModel.rhoAirKgM3;
  const H = c.hull;
  const d = H.dsyhs;
  const keel = c.appendages.find((a) => a.id === "keel") ?? null;
  const rudder = c.appendages.find((a) => a.id === "rudder") ?? null;
  const rt = c.loading.righting;
  const k = R.coefficients;

  // §6.5.2 the regression's parameters
  const cv3 = Math.cbrt(d.volumeM3);
  const P = {
    lcbFpp: d.lcbFppM / d.lwlM,
    cp: d.cp,
    volAw: (cv3 * cv3) / d.awM2,
    bwlLwl: d.bwlM / d.lwlM,
    lcbLcf: d.lcbFppM / d.lcfFppM,
    bwlTc: d.bwlM / d.tcM,
    cm: d.cm,
    volLwl: cv3 / d.lwlM,
  };
  const residuary = (V) => {
    const fn = V / Math.sqrt(G * d.lwlM);
    if (!(fn > 0)) return 0;
    const a = rowAt(k.residuaryFn, k.residuaryA, fn);
    const co = a[0] + (a[1] * P.lcbFpp + a[2] * P.cp + a[3] * P.volAw + a[4] * P.bwlLwl + a[5] * P.lcbLcf + a[6] * P.bwlTc + a[7] * P.cm) * P.volLwl;
    return (fn < k.residuaryFn[0] ? (co * fn) / k.residuaryFn[0] : co) * d.volumeM3 * rho * G;
  };
  const heelRes = (V, heelDeg) => {
    const fn = V / Math.sqrt(G * d.lwlM);
    if (!(fn > 0) || !heelDeg) return 0;
    const u = rowAt(k.heelFn, k.heelU, fn);
    const bt = d.bwlM / d.tcM;
    const co = (u[0] + u[1] * (d.lwlM / d.bwlM) + u[2] * bt + u[3] * bt * bt + u[4] * d.lcbPct + u[5] * d.lcbPct * d.lcbPct) / 1000;
    return (fn < k.heelFn[0] ? fn / k.heelFn[0] : 1) * co * d.volumeM3 * rho * G * 6 * Math.abs(heelDeg * RAD) ** 1.7;
  };
  const wsaAt = (heelDeg) => (rt.wettedAreaM2 ? lerp(rt.heelsDeg, rt.wettedAreaM2, heelDeg) || null : null) ?? d.wsaM2;
  const friction = (V, heelDeg) => (V > 0 ? 0.5 * rho * V * V * wsaAt(heelDeg) * ittc57((V * 0.7 * d.lwlM) / nu) : 0);
  const spheroidArea = (L, D) => {
    const a = L / 2, b = D / 2;
    if (!(a > b)) return 4 * Math.PI * b * b;
    const e = Math.sqrt(1 - (b * b) / (a * a));
    return 2 * Math.PI * b * b * (1 + (a / (b * e)) * Math.asin(e));
  };
  const appendagesN = (V) => {
    if (!(V > 0)) return 0;
    const q = 0.5 * rho * V * V;
    let r = 0;
    for (const f of [keel, rudder]) {
      if (!f) continue;
      r += q * f.areaM2 * 2 * ittc57((V * f.macM) / nu) * (1 + 2 * f.tc + 60 * f.tc ** 4);
      if (f.bulb) {
        const dl = f.bulb.diameterM / f.bulb.lengthM;
        r += q * spheroidArea(f.bulb.lengthM, f.bulb.diameterM) * ittc57((V * f.bulb.lengthM) / nu) * (1 + 1.5 * dl ** 1.5 + 7 * dl ** 3);
      }
    }
    return r;
  };
  const effectiveDraft = (fn, heelDeg) => {
    const T = R.induced.draftM;
    const r = Math.min(1, d.tcM / T);
    const [A1, A2, A3, A4, B0, B1] = k.teUpright;
    const taper = Number.isFinite(R.induced.keelTaper) ? R.induced.keelTaper : 0.5;
    const te = T * (A1 * r + A2 * r * r + A3 * (d.bwlM / d.tcM) + A4 * taper) * (B0 + B1 * Math.min(0.75, Math.max(0, fn)));
    return Math.max(0.1 * T, te) * Math.cos(heelDeg * RAD);
  };
  const tableHull = (V, heelDeg) => {
    // bilinear in (V, φ) on the contract's table; V² below its first speed
    const vs = R.speedsMs, hs = R.heelsDeg;
    const row = (i) => (V < vs[0] ? R.hullN[i][0] * (V / vs[0]) ** 2 : lerp(vs, R.hullN[i], V));
    const h = Math.min(hs[hs.length - 1], Math.max(hs[0], heelDeg));
    let j = 0;
    while (j < hs.length - 2 && hs[j + 1] < h) j++;
    if (hs.length === 1) return row(0);
    const t = (h - hs[j]) / (hs[j + 1] - hs[j]);
    return row(j) + t * (row(j + 1) - row(j));
  };

  /** §6.5 R(V, φ, Y). */
  function resistanceAt(V, heelDeg, Y) {
    const fn = V / Math.sqrt(G * d.lwlM);
    let hull;
    if (resistanceFromTable) hull = tableHull(V, heelDeg);
    else {
      const disp = friction(V, heelDeg) + residuary(V) + heelRes(V, heelDeg);
      const cap = R.planing.capability;
      const w = cap > 0 ? smooth(fn, R.planing.fnBlend[0], R.planing.fnBlend[1]) * cap : 0;
      const rp = w > 0 ? savitsky(R.planing, V, rho, nu).total : NaN;
      // no Savitsky solution: displacement only (§6.5.7)
      hull = w > 0 && Number.isFinite(rp) ? (1 - w) * disp + w * rp : disp;
    }
    const app = appendagesN(V);
    const te = effectiveDraft(fn, heelDeg);
    // §6.5.5: the horizontal side force Y·cos φ
    const yh = Y * Math.cos(heelDeg * RAD);
    const induced = V > 0 && te > 0 ? (yh * yh) / (Math.PI * te * te * 0.5 * rho * V * V) : 0;
    return { hull, appendages: app, induced, total: hull + app + induced };
  }

  /** §6.3 the set's forces from its trimmed table. */
  function rig(set, { aws, betaDeg, heelDeg, flat }) {
    const t = set.trimmed;
    const p = heelDeg * RAD, b = betaDeg * RAD;
    const be = Math.atan2(Math.sin(b) * Math.cos(p), Math.cos(b));
    const awsE = aws * Math.sqrt(Math.cos(b) ** 2 + (Math.sin(b) * Math.cos(p)) ** 2);
    const x = Math.min(180, Math.max(0, Math.abs(be / RAD)));
    const i = Math.min(t.betaDeg.length - 2, Math.floor(x));
    const f = x - t.betaDeg[i];
    const cl = flat * (t.cl[i] + f * (t.cl[i + 1] - t.cl[i]));
    const cdv = t.cdv[i] + f * (t.cdv[i + 1] - t.cdv[i]);
    const cd = cdv + (set.are > 0 ? (cl * cl) / (Math.PI * set.are) : 0);
    const q = 0.5 * rhoAir * awsE * awsE * set.areaM2;
    return { drive: q * (cl * Math.sin(be) - cd * Math.cos(be)), heel: q * (cl * Math.cos(be) + cd * Math.sin(be)) };
  }

  /** Every force at a state (§6.1–6.6). */
  function forcesAt({ set, flat, twsMs, twaDeg }, { V, heelDeg: phi, leewayDeg: lam, rudderDeg: del }) {
    const g = twaDeg * RAD;
    const ax = twsMs * Math.cos(g) + V, ay = twsMs * Math.sin(g);
    const aws = Math.hypot(ax, ay);
    const beta = Math.atan2(ay, ax) / RAD - lam;
    const s = rig(set, { aws, betaDeg: beta, heelDeg: phi, flat });
    const cphi = Math.cos(phi * RAD), sphi = Math.sin(phi * RAD);
    const q = 0.5 * rho * V * V;
    const ak = lam * cphi;
    const kc = foilCL(keel, ak, phi);
    const dEps = keel ? kc.slope / (Math.PI * kc.arEff) : 0;
    const rc = foilCL(rudder, ak * (1 - dEps) + del, phi);
    const Yk = keel ? q * keel.areaM2 * kc.cl : 0;
    const Yr = rudder ? q * rudder.areaM2 * rc.cl : 0;
    const sf = H.sideForce;
    const sl = Math.sin(lam * RAD), cl = Math.cos(lam * RAD);
    const Yh = q * sf.lwlM ** 2 * sf.yv * sl * cphi;
    const Nh = q * sf.lwlM ** 3 * sf.nv * sl * cphi;
    const Y = Yk + Yr + Yh;
    const zk = keel?.qcM[2] ?? 0, zr = rudder?.qcM[2] ?? 0, zh = sf.atM[2];
    const zY = Math.abs(Y) > 1e-9 ? (Yk * zk + Yr * zr + Yh * zh) / Y : keel ? zk : zh;
    const res = resistanceAt(V, phi, Y);
    const Rt = res.total;
    const L = Y * cphi;
    const [xCE, , zCE] = set.ceM;
    const rm = lerp(rt.heelsDeg, rt.boatNm, phi) + lerp(rt.heelsDeg, rt.crewNm, phi);
    const xk = keel?.qcM[0] ?? 0, xr = rudder?.qcM[0] ?? 0;
    return {
      surge: s.drive - Rt * cl + L * sl,
      sway: -s.heel * cphi + Rt * sl + L * cl,
      hm: s.heel * (zCE - zY),
      rm,
      yaw: (Yk * xk + Yr * xr + Yh * sf.xMidM) * cphi + Nh - s.heel * cphi * xCE + s.drive * zCE * sphi - (res.appendages + res.induced) * zY * sphi + Rt * sl * H.lcbM,
      res,
    };
  }

  /** A predicted point's residuals, scaled: forces by ½ρ_air·TWS²·A, moments by that × LWL. */
  function residuals(p) {
    const set = c.sets.find((x) => x.id === p.set);
    const F = forcesAt({ set, flat: p.flat, twsMs: p.twsMs, twaDeg: p.twaDeg }, { V: p.VMs, heelDeg: p.heelDeg, leewayDeg: p.leewayDeg, rudderDeg: p.rudderDeg });
    const sF = Math.max(1, 0.5 * rhoAir * p.twsMs * p.twsMs * set.areaM2);
    const sM = sF * Math.max(1, d.lwlM);
    // upright with the crew partly in: roll isn't an equation (§6.6)
    const upright = p.heelDeg === 0 && F.hm <= F.rm;
    return { surge: F.surge / sF, sway: F.sway / sF, roll: upright ? null : (F.hm - F.rm) / sM, yaw: F.yaw / sM, F };
  }

  return { forcesAt, residuals, resistanceAt };
}
