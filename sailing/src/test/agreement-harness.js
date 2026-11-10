// Sailing's physics held to the rig aid's predictions (agreement.slow.test.js).
// Pure, deterministic, no clock: a contract (extras.rig, patchwork-rig v1)
// becomes a ship through specFor's contract path, and each of the aid's
// predicted points becomes a state of that ship, at which ship.wrench()
// says how far from balance she is.
//
// A predicted point (§3.11) is a steady state: speed V along her track,
// the true wind TWA off the track, heel φ to leeward, leeway λ (her heading
// λ to windward of her track), rudder δ (+ weather helm), and each sail's
// sheet. Here she is on starboard tack (the wind from starboard), heading
// down −Z (heading 0), so leeward is port (−X). Heel is a roll about her
// fore-and-aft axis; trim is level (the contract's fixed trim); her height
// is the one where buoyancy carries her weight at that heel (the contract
// has no vertical equation, so it is solved, not compared).
//
// Her crew (a contract's, §6.6) sit fully out to windward at a heeled
// point, as the contract's righting curve has them. At an upright point
// they are "partly in" (§6.6: roll is not an equation there), so roll
// passes if somewhere between in and out they hold her upright.
//
// Signed residuals, in N and N·m, about her centre of gravity:
//   surge  + driving her forward          sway  + pushing her to leeward
//   roll   + heeling her further          yaw   + turning her bow to windward
// Each is what would make her accelerate off the predicted state.

import { createShip } from "../physics.js";
import { specFor } from "../sim.js";

const DEG = Math.PI / 180;
export const RUDDER_MAX_DEG = 35; // physics.js's RUDDER_MAX, when the contract doesn't say
/** Her rudder's travel (degrees): the contract's maxDeg, as the physics flies it. */
export const rudderMaxOf = (ship) => ship.spec.rudder.maxDeg ?? RUDDER_MAX_DEG;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const CALM = { heightAt: () => 0, velocityAt: (x, y, z, t, out = [0, 0, 0]) => ((out[0] = out[1] = out[2] = 0), out) };

/** The ship a contract makes, by specFor's contract path (a rig at the identity, no hull doc to check). */
export function contractShip(contract) {
  const spec = specFor(null, undefined, 1, { rig: { matrix: null, sail: null, contract } });
  return createShip(spec);
}

/**
 * The points the aid predicted that are equilibria of §6's rules: not
 * hollow, or (§6.7) hollow only by a `planing-range` flag (Savitsky's
 * model used outside its fitted trim or wetted length, which is still the
 * rules' own answer): a Laser's planing points among them.
 */
const EQUILIBRIUM_FLAGS = new Set(["dsyhs", "planing-range"]);
export const unflagged = (contract) =>
  contract.predicted.points.filter((p) => p.ok && Number.isFinite(p.speedMs) && (!p.hollow || (p.flags ?? []).every((f) => EQUILIBRIUM_FLAGS.has(f.id))));

/** Whether a point is in the planing range (flagged planing-range, §6.5.6). */
export const planingPoint = (p) => (p.flags ?? []).some((f) => f.id === "planing-range");

/** A steady true wind from `fromDeg` (heading convention: 0 from −Z, + toward +X). */
export const windFrom = (speed, fromDeg) => {
  const a = fromDeg * DEG;
  const v = [-Math.sin(a) * speed, Math.cos(a) * speed];
  return { at: (x, z, t, out = [0, 0]) => ((out[0] = v[0]), (out[1] = v[1]), out) };
};

/** The world's wind and water for a predicted point: the true wind TWA off her track, from starboard. */
export const envAt = (p) => ({ water: CALM, wind: windFrom(p.twsMs, p.twaDeg - p.leewayDeg) });

/** Her heading-frame velocity along the track: λ to leeward (port) of her bow. */
export const velocityAt = (p) => [-Math.sin(p.leewayDeg * DEG) * p.speedMs, 0, -Math.cos(p.leewayDeg * DEG) * p.speedMs];

/** Heeled φ to port: a roll about her fore-and-aft axis (+Z, heading 0). */
export const heelQuat = (deg) => [0, 0, Math.sin((deg * DEG) / 2), Math.cos((deg * DEG) / 2)];

/**
 * Sailing's controls for a point: the rudder at δ (weather helm puts the
 * rudder's force to windward at the stern: its trailing edge to port on
 * starboard tack, which is − here), and each sail as the point has it
 * (§3.11 `sheetsDeg`, `set`, `flat`): the main's sheet letting the boom out
 * to its sheeting angle on the contract's travel (`sheeting`, 0–85°), the
 * main hoisted 1 − its reef's fraction (a reef lowers the head by that
 * much of P), the jib's sheet at its angle on its travel (7–30°), or, a
 * negative angle, goose-winged: backed to windward on the wing's travel
 * (30–90°), the jib unfurled, and the point's flattening.
 */
export function controlsAt(contract, p, rudderMax = rudderMaxDeg(contract)) {
  const set = contract.sets.find((s) => s.id === p.set) ?? contract.sets[0];
  const main = contract.sails.find((x) => (x.model?.family ?? x.kind) === "main");
  const jib = contract.sails.find((x) => (x.model?.family ?? x.kind) !== "main");
  const out = { rudder: clamp(-p.rudderDeg / rudderMax, -1, 1) };
  if (main) {
    const { minDeg: lo, maxDeg: hi } = main.sheeting;
    out.sheet = clamp(((p.sheetsDeg?.[main.id] ?? lo) - lo) / (hi - lo), 0, 1);
    const reef = set.reef >= 0 ? main.reefs[set.reef] : null;
    out.sail = reef ? 1 - reef.fraction : 1;
  } else out.sail = 1;
  if (jib) {
    const d = p.sheetsDeg?.[jib.id] ?? jib.sheeting.minDeg;
    const w = jib.sheeting.wing;
    if (d < 0 && w) {
      const [hi, lo] = w.sheet.map(Math.abs);
      out.jibBacked = true;
      out.jibSheet = clamp((-d - lo) / (hi - lo), 0, 1);
    } else {
      const { minDeg: lo, maxDeg: hi } = jib.sheeting;
      out.jibSheet = clamp((d - lo) / (hi - lo), 0, 1);
    }
    out.furl = 0;
  }
  out.flat = Number.isFinite(p.flat) ? p.flat : 1;
  return out;
}

/** The contract's rudder travel (degrees), as rig-contract.js reads it. */
const rudderMaxDeg = (contract) => contract.appendages.find((a) => a.id === "rudder")?.stock?.maxDeg ?? RUDDER_MAX_DEG;

/** Her height at a heel where buoyancy carries her (vertical force zero), by bisection. */
export function floatHeight(ship, q, velocity, controls, env, crew) {
  const fy = (y) => ship.wrench({ position: [0, y, 0], quaternion: q, crew }, { velocity, spin: [0, 0, 0] }, controls, env).force[1];
  const span = ship.spec.draft + ship.spec.freeboard;
  let lo = -span, hi = span;
  let flo = fy(lo);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = fy(mid);
    if (Math.sign(fm) === Math.sign(flo)) [lo, flo] = [mid, fm];
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * The state at a predicted point, afloat at that heel, her crew (if the
 * contract has one) fully out to windward: + starboard, the wind's side here.
 */
export function stateAt(ship, contract, p, crew = contract.loading.crew?.massKg > 0 ? 1 : undefined) {
  const q = heelQuat(p.heelDeg);
  const velocity = velocityAt(p);
  const controls = controlsAt(contract, p, rudderMaxOf(ship));
  const env = envAt(p);
  const y = floatHeight(ship, q, velocity, controls, env, crew);
  return { pose: { position: [0, y, 0], quaternion: q, crew }, motion: { velocity, spin: [0, 0, 0] }, controls, env };
}

/** The signed residuals (N, N·m) of a wrench, in the predicted state's terms. */
export const residualsOf = (w) => ({ surge: -w.force[2], sway: -w.force[0], heave: w.force[1], roll: w.torque[2], yaw: -w.torque[1] });

/**
 * The tolerances: forces 2% of her weight; moments the same 2% of her
 * weight at a waterline beam (roll) or a waterline length (yaw).
 */
export function tolerancesOf(contract) {
  const W = contract.loading.massKg * 9.80665;
  return { W, force: 0.02 * W, roll: 0.02 * W * contract.hull.bwlM, yaw: 0.02 * W * contract.hull.lwlM };
}

/**
 * How far sailing's physics is from balance at each unflagged point:
 * residuals, normalised by the tolerances (|x| ≤ 1 passes), and what the
 * moments mean as angles: the heel error (roll over the righting curve's
 * slope there) and the rudder error (yaw over the rudder's authority there,
 * from two more wrenches a degree either side). A point passes when every
 * residual is within its tolerance and, so that a wrong helm or heel can't
 * hide inside the moments' tolerances, the rudder it would settle at is
 * within HELM_DEG of the predicted one and the heel within HEEL_DEG.
 */
export const HELM_DEG = 1.5;
export const HEEL_DEG = 2;
export function agreement(contract, ship = contractShip(contract)) {
  const tol = tolerancesOf(contract);
  const rt = contract.loading.righting;
  const rmSlope = (deg) => {
    const hs = rt.heelsDeg;
    const rm = (x) => {
      let k = 0;
      while (k < hs.length - 2 && hs[k + 1] < x) k++;
      const t = (x - hs[k]) / (hs[k + 1] - hs[k]);
      return rt.boatNm[k] + t * (rt.boatNm[k + 1] - rt.boatNm[k]) + rt.crewNm[k] + t * (rt.crewNm[k + 1] - rt.crewNm[k]);
    };
    return (rm(Math.min(hs[hs.length - 1], deg + 1)) - rm(Math.max(0, deg - 1))) / ((Math.min(hs[hs.length - 1], deg + 1) - Math.max(0, deg - 1)) * DEG);
  };
  const rows = [];
  const rudderMax = rudderMaxOf(ship);
  const hasCrew = contract.loading.crew?.massKg > 0;
  for (const p of unflagged(contract)) {
    const s = stateAt(ship, contract, p);
    const r = residualsOf(ship.wrench(s.pose, s.motion, s.controls, s.env));
    if (hasCrew && p.heelDeg === 0) {
      // upright: the crew come in as far as holds her there (§6.6), so roll
      // is what's left with them all the way in or all the way out
      const inboard = residualsOf(ship.wrench({ ...s.pose, crew: 0 }, s.motion, s.controls, s.env)).roll;
      r.roll = inboard < 0 ? inboard : r.roll > 0 ? r.roll : 0;
    }
    const yawAt = (d) => residualsOf(ship.wrench(s.pose, s.motion, { ...s.controls, rudder: clamp(-(p.rudderDeg + d) / rudderMax, -1, 1) }, s.env)).yaw;
    const authority = (yawAt(1) - yawAt(-1)) / 2; // N·m per degree of weather helm (< 0: it bears her away)
    const slope = rmSlope(p.heelDeg); // N·m per radian
    const n = { surge: r.surge / tol.force, sway: r.sway / tol.force, roll: r.roll / tol.roll, yaw: r.yaw / tol.yaw };
    // where the residual would settle her instead: + more heel than
    // predicted (none where the curve is flat: a dinghy whose crew's
    // moment carries her); + more weather helm needed than predicted
    const heelErrDeg = Math.abs(slope) > 0.05 * tol.W * contract.hull.bwlM ? r.roll / slope / DEG : NaN;
    const rudderErrDeg = Math.abs(authority) > 1e-9 ? -r.yaw / authority : NaN;
    const wrench = Math.max(Math.abs(n.surge), Math.abs(n.sway), Math.abs(n.roll), Math.abs(n.yaw)) <= 1;
    // no rudder authority (none to settle by) fails the helm check
    const helm = Number.isFinite(rudderErrDeg) && Math.abs(rudderErrDeg) <= HELM_DEG;
    const heel = !(Math.abs(heelErrDeg) > HEEL_DEG);
    rows.push({ p, r, n, wrench, helm, heel, pass: wrench && helm && heel, heelErrDeg, rudderErrDeg });
  }
  return { tol, rows };
}

/** The worst |normalised residual| of each kind, the worst heel and rudder errors (deg), and how many points pass. */
export function summary(rows) {
  const worst = { surge: 0, sway: 0, roll: 0, yaw: 0, heelDeg: 0, rudderDeg: 0 };
  for (const row of rows) {
    for (const k of ["surge", "sway", "roll", "yaw"]) if (Math.abs(row.n[k]) > Math.abs(worst[k])) worst[k] = row.n[k];
    if (Math.abs(row.heelErrDeg) > Math.abs(worst.heelDeg)) worst.heelDeg = row.heelErrDeg;
    if (Math.abs(row.rudderErrDeg) > Math.abs(worst.rudderDeg)) worst.rudderDeg = row.rudderErrDeg;
  }
  const med = (k) => {
    const v = rows.map((r) => Math.abs(r[k])).filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : NaN;
  };
  return { pass: rows.filter((r) => r.pass).length, of: rows.length, worst, medianHeelErrDeg: med("heelErrDeg"), medianRudderErrDeg: med("rudderErrDeg") };
}

/**
 * Sail her from the predicted point on flat water in its steady wind, the
 * sheet and sail as there, a helmsman (physics.test.js's) holding her
 * heading, and average the last `over` seconds: speed through the water,
 * heel (+ to leeward), leeway (+ to leeward) and rudder (+ weather helm),
 * in the contract's terms. `before` is the same average over the `over`
 * seconds before those, so a caller can see she has stopped changing.
 */
export function settle(contract, p, { seconds = 120, over = 15, dt = 1 / 30, ship = contractShip(contract) } = {}) {
  const env = envAt(p);
  const rudderMax = rudderMaxOf(ship);
  const c = controlsAt(contract, p, rudderMax);
  const helm = (d, s) => clamp(2 * wrap(0 - d.heading) + 4 * s.spin[1], -1, 1);
  let s = { ...ship.rest({ yaw: 0 }), velocity: [0, 0, -p.speedMs] };
  const n = Math.round(seconds / dt);
  const m = Math.round(over / dt);
  const sums = [0, 1].map(() => ({ speed: 0, heel: 0, leeway: 0, rudder: 0 }));
  for (let i = 0; i < n; i++) {
    const d = ship.read(s, c, env);
    c.rudder = helm(d, s);
    const w = i >= n - m ? sums[0] : i >= n - 2 * m ? sums[1] : null;
    if (w) {
      w.speed += Math.hypot(d.speed, d.speed * Math.tan(d.leeway));
      w.heel += -d.heel / DEG;
      w.leeway += -d.leeway / DEG;
      w.rudder += -c.rudder * rudderMax;
    }
    s = ship.step(s, c, env, dt);
  }
  const mean = (x) => ({ speedMs: x.speed / m, heelDeg: x.heel / m, leewayDeg: x.leeway / m, rudderDeg: x.rudder / m });
  return { ...mean(sums[0]), before: mean(sums[1]) };
}

/** Whether a settle has stopped changing: its last window's means within these of the window before. */
export const SETTLED = { speedMs: 0.005, deg: 0.05 };
export const converged = (got) =>
  Math.abs(got.speedMs - got.before.speedMs) <= SETTLED.speedMs &&
  ["heelDeg", "leewayDeg", "rudderDeg"].every((k) => Math.abs(got[k] - got.before[k]) <= SETTLED.deg);

/** The settle tolerances: speed ±10%, heel ±2°, leeway ±1.5°, the rudder on the same side. */
export function settleVerdict(p, got) {
  const checks = {
    speed: Math.abs(got.speedMs - p.speedMs) <= 0.1 * p.speedMs,
    heel: Math.abs(got.heelDeg - p.heelDeg) <= 2,
    leeway: Math.abs(got.leewayDeg - p.leewayDeg) <= 1.5,
    rudder: Math.sign(got.rudderDeg) === Math.sign(p.rudderDeg),
  };
  return { ...checks, pass: Object.values(checks).every(Boolean) };
}

/**
 * Where the gap is, at a point: the sail's drive and heeling force (§6.3,
 * the contract's from its set's trimmed table; sailing's as the wrench
 * with the sails up less the wrench with the main down and the jib
 * furled), and the hull's
 * resistance upright at that speed (the contract's §6.5 with no side force;
 * sailing's as the wrench with the wind moving with her, so no windage),
 * and her windage there (the wind on her hull and bare mast, which §6.1
 * leaves out: N and N·m, signed as the residuals) beside her residual.
 */
export function breakdown(contract, ship, p, compose) {
  const s = stateAt(ship, contract, p);
  const up = ship.wrench(s.pose, s.motion, s.controls, s.env);
  const down = ship.wrench(s.pose, s.motion, { ...s.controls, sail: 0, furl: 1 }, s.env);
  // in her heeled sail plane: drive along her bow, the heeling force square to the mast
  const fx = -(up.force[2] - down.force[2]);
  const fside = -(up.force[0] - down.force[0]);
  const fup = up.force[1] - down.force[1];
  const phi = p.heelDeg * DEG;
  const sailing = { drive: fx, heel: fside * Math.cos(phi) - fup * Math.sin(phi) };
  const set = contract.sets.find((x) => x.id === p.set);
  const g = p.twaDeg * DEG;
  const ax = p.twsMs * Math.cos(g) + p.speedMs, ay = p.twsMs * Math.sin(g);
  const aws = Math.hypot(ax, ay);
  const b = Math.atan2(ay, ax) - p.leewayDeg * DEG;
  const be = Math.atan2(Math.sin(b) * Math.cos(phi), Math.cos(b));
  const awsE = aws * Math.sqrt(Math.cos(b) ** 2 + (Math.sin(b) * Math.cos(phi)) ** 2);
  const t = set.trimmed;
  const x = Math.min(180, Math.max(0, Math.abs(be / DEG)));
  const i = Math.min(t.betaDeg.length - 2, Math.floor(x));
  const f = x - t.betaDeg[i];
  const cl = p.flat * (t.cl[i] + f * (t.cl[i + 1] - t.cl[i]));
  const cd = t.cdv[i] + f * (t.cdv[i + 1] - t.cdv[i]) + (cl * cl) / (Math.PI * set.are);
  const q = 0.5 * contract.sailModel.rhoAirKgM3 * awsE * awsE * set.areaM2;
  const theirs = { drive: q * (cl * Math.sin(be) - cd * Math.cos(be)), heel: q * (cl * Math.cos(be) + cd * Math.sin(be)) };

  // resistance upright, no leeway, the air moving with her
  const V = p.speedMs;
  const still = { water: CALM, wind: { at: (x_, z_, t_, out = [0, 0]) => ((out[0] = 0), (out[1] = -V), out) } };
  const y = floatHeight(ship, [0, 0, 0, 1], [0, 0, -V], { sail: 0 }, still);
  const rSailing = ship.wrench({ position: [0, y, 0], quaternion: [0, 0, 0, 1] }, { velocity: [0, 0, -V], spin: [0, 0, 0] }, { sail: 0 }, still).force[2];
  const rTheirs = compose ? compose.resistanceAt(V, 0, 0).total : NaN;

  // the wind on her hull and bare mast, which §6.1 leaves out: her sails
  // stowed, in the point's wind less in air moving with her
  const v = s.motion.velocity;
  const withHer = { water: CALM, wind: { at: (x_, z_, t_, out = [0, 0]) => ((out[0] = v[0]), (out[1] = v[2]), out) } };
  const stowed = { ...s.controls, sail: 0, furl: 1 };
  const inWind = residualsOf(down), calm = residualsOf(ship.wrench(s.pose, s.motion, stowed, withHer));
  const windage = { surge: inWind.surge - calm.surge, sway: inWind.sway - calm.sway, roll: inWind.roll - calm.roll, yaw: inWind.yaw - calm.yaw };
  return { sail: { sailing, contract: theirs }, resistance: { sailing: rSailing, contract: rTheirs }, windage, residual: residualsOf(up) };
}

/**
 * Her hydrodynamic forces at a predicted point, horizontal, in the track's
 * frame: `side` square to her track (+ to windward) and `drag` along it
 * (+ resisting), sailing's from the wrench with her sails stowed and the air
 * moving with her (no sail, no windage: the water's forces alone), the
 * contract's (§6.4–6.5) as compose has them: L = Y·cos φ and R_total, with
 * L from compose's sway equation at that point (its sail heeling force from
 * `breakdown`'s §6.3 reading, its residual included, so L is compose's own).
 */
export function hydroAt(contract, ship, p, compose) {
  const s = stateAt(ship, contract, p);
  const v = s.motion.velocity;
  const withHer = { water: CALM, wind: { at: (x_, z_, t_, out = [0, 0]) => ((out[0] = v[0]), (out[1] = v[2]), out) } };
  const f = ship.wrench(s.pose, s.motion, { ...s.controls, sail: 0, furl: 1 }, withHer).force;
  const lam = p.leewayDeg * DEG, phi = p.heelDeg * DEG;
  // her track (−sin λ, −cos λ) in (x, z); square to it, to windward (+x): (cos λ, −sin λ)
  const sailing = { side: f[0] * Math.cos(lam) - f[2] * Math.sin(lam), drag: f[0] * Math.sin(lam) + f[2] * Math.cos(lam) };
  const set = contract.sets.find((x) => x.id === p.set);
  const F = compose.forcesAt({ set, flat: p.flat, twsMs: p.twsMs, twaDeg: p.twaDeg }, { V: p.VMs, heelDeg: p.heelDeg, leewayDeg: p.leewayDeg, rudderDeg: p.rudderDeg });
  const heel = breakdown(contract, ship, p, null).sail.contract.heel;
  const Rt = F.res.total;
  const L = (F.sway + heel * Math.cos(phi) - Rt * Math.sin(lam)) / Math.cos(lam);
  return { sailing, contract: { side: L, drag: Rt } };
}
