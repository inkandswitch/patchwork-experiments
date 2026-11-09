// The ship as a rigid body, moved only by the forces on it: its weight,
// the water's buoyancy sampled over the hull, the hull's resistance, the
// keel and rudder as hydrofoils, the sail's lift and drag in the apparent
// wind, the wind on the hull and rig, and an anchor's rode. Pure: no THREE,
// no clock; `step` returns a new state.
//
// Body frame: bow toward −Z, starboard +X, up +Y, waterline at y = 0.
// World: +Y up, sea level y = 0. SI units, radians.
//
// The integration runs at a fixed 120 Hz. `step` adds dt to the time it
// owes (`state.acc`), takes as many whole substeps as fit and carries the
// remainder, so any frame rate gives the same motion. Past MAX_SUBSTEPS in
// one call the rest is dropped, not owed: the caller skips that time (sim.js).
//
// The boom is the one part with a state of its own (`state.boom`): it swings
// toward where the wind and the sheet put it no faster than BOOM_RATE, so a
// gybe takes most of a second, not a frame. A rig contract's ship has two
// more: her crew (`state.crew`) and, with a headsail, its clew (`state.jib`),
// and flies each of its sails as its own foil (riggedSails).

import { buildHull, mergeSpec, SLOOP, specFromBox } from "./hull-model.js";
import { liftSlope, foilCL, foilCD, sailCL, sailCD, planformAspect, planformSlope, planformCL, planformCD, ittc57, rigSailCoeffs, wrap180 } from "./physics-foils.js";
import { contractResistance } from "./resistance.js";
import { rigSails, swungCE } from "./rig-sails.js";

export { SLOOP, specFromBox };

export const SUBSTEP = 1 / 120;
/** After a stall (a hidden tab, a slow frame) no more than this many substeps in one step. */
export const MAX_SUBSTEPS = 30;

const G = 9.81;
const RHO = 1025;
const RHO_AIR = 1.225;
const NU = 1.19e-6; // sea water's kinematic viscosity
const DEG = Math.PI / 180;
const RUDDER_MAX = 35 * DEG;
// no traveller: the sheet pulls the boom down and in, never quite amidships
const BOOM_IN = 10 * DEG;
const BOOM_OUT = 85 * DEG;
const BOOM_RATE = 200 * DEG; // per second: a gybe swings across in about a second
// a chain's pull is bounded by what the anchor holds: past this it would drag
const ANCHOR_HOLD = 0.5; // of the ship's weight
// going astern the keel and rudder lead with their trailing edges, and the
// transom pushes water: the hull's lengthwise resistance is this much more
const STERNWAY = 6;
const CE_HEIGHT = 0.38; // up the luff
// A rig contract's crew (spec.rig.crew) sits to windward of the apparent
// wind, all the way out once she heels this far to leeward and coming in
// as she comes upright, so a light wind doesn't roll her to windward; they
// cross over in CREW_RATE: the whole arm per second, two seconds tack to tack.
const CREW_FULL_HEEL = 3 * DEG;
const CREW_RATE = 1;
// A rig contract's headsails (spec.rig.sails) swing on their sheets as the
// boom does; backed, they're held to windward of the apparent wind, except
// within this of dead ahead, where they stay on the side they're on
const JIB_RATE = BOOM_RATE;
const BACKED_DEADBAND = 10 * DEG;



// Water's resistance to the hull moving through it other than lengthwise
// (that is the resistance below): per column, a linear part so small
// motions die away and a quadratic cross-flow part. Heave is damped hardest.
const HEAVE_LINEAR = 2500; // N·s/m per m² of plan area
const HEAVE_CD = 0.6;
const SWAY_LINEAR = 300; // N·s/m per m² of lateral area
const SWAY_CD = 1.0;
const FORM_FACTOR = 0.15;
// and a little lengthwise, so a slow creep through the water dies away; it
// stops growing past a creep (N per m² wetted, reached at 0.1 m/s)
const SURGE_CREEP = 3;

// Added mass: water the hull has to push aside when it accelerates, as a
// fraction of the ship's own mass (and inertia), scaled by how much of it
// is in the water. Body axes: x sway / pitch, y heave / yaw, z surge / roll.
export const ADDED_MASS = [0.6, 0.8, 0.05];
const ADDED_INERTIA = [0.8, 0.5, 0.3];

/**
 * @typedef {{ position: number[], quaternion: number[], velocity: number[], spin: number[], t: number, acc?: number, boom?: number, crew?: number, jib?: number }} ShipState
 * `velocity` is the body origin's, `spin` the world angular velocity; `acc`
 * is time owed to the integrator, less than one substep; `boom` where the
 * boom is (radians, + to starboard; missing: where the wind puts it);
 * `crew`, only for a ship whose rig contract has one, where they sit
 * (−1..1 of their arm, + starboard; missing: where the wind puts them);
 * `jib`, only for a ship whose rig contract has a headsail, where its clew
 * is (the chord tack to clew, radians, + to starboard; missing: where the
 * wind and its sheet put it).
 * @typedef {{ rudder?: number, sail?: number, sheet?: number, anchor?: null | { at: number[], rode: number }, jibSheet?: number, jibBacked?: boolean, furl?: number, flat?: number }} ShipControls
 * A rig contract's sails also read `jibSheet` (0..1, hard in at the least
 * sheeting angle to eased at the most; missing: the headsail trimmed to the
 * main's sheet angle, within its own range), `jibBacked` (held to
 * windward), `furl` (0..1 of LP rolled away; missing: the contract's furl,
 * or more as the main comes down, 1 − sail) and `flat` (§6.3's flattening,
 * flatMin..1; missing: 1). `sail` is the main's hoist: lowered, it is reefed
 * by 1 − sail of its luff.
 * @typedef {{ water?: { heightAt: Function, velocityAt: Function }, wind?: { at: Function } }} ShipEnv
 */

const CALM = { heightAt: () => 0, velocityAt: (x, y, z, t, out = [0, 0, 0]) => ((out[0] = out[1] = out[2] = 0), out) };
const STILL = { at: (x, z, t, out = [0, 0]) => ((out[0] = out[1] = 0), out) };

/**
 * A ship from a spec (the default 12 m sloop's numbers fill in anything
 * missing). See DESIGN.md for the state, controls and diagnostics.
 * @param {Partial<import("./hull-model.js").ShipSpec>} [input]
 */
export function createShip(input) {
  const spec = mergeSpec(SLOOP, input);
  const hull = buildHull(spec);
  const m = spec.mass;
  const L = spec.length;
  const cb = hull.cb;
  // A rig contract (spec.rig, rig-contract.js) states her mass properties,
  // foils and crew; without one, everything is as it always was.
  const rig = spec.rig ?? null;
  // ballasted to float on its lines: the centre of gravity is over the
  // centre of buoyancy; a contract's is where its mass roll-up put it, so
  // she trims to it (the trait's cg, a height, still wins)
  const CG = rig ? [rig.cgM[0], spec.cg ?? rig.cgM[1], rig.cgM[2]] : [cb[0], spec.cg ?? SLOOP.cg * (spec.draft / SLOOP.draft), cb[2]];

  const hb = spec.draft + spec.freeboard;
  const B = spec.beam;
  let I;
  if (rig?.gyradiiM) {
    // the contract's radii of gyration about her centre of gravity, body axes [pitch, yaw, roll]
    I = rig.gyradiiM.map((k) => m * k * k);
  } else {
    // inertia of a box thinned toward its ends, and the mast up high
    I = [
      (m * 0.8 * (hb * hb + L * L)) / 12, // pitch
      (m * 0.8 * (B * B + L * L)) / 12, // yaw
      (m * (B * B + hb * hb)) / 12, // roll
    ];
    const y0 = spec.sail.tack[1] - CG[1];
    const y1 = y0 + spec.sail.luff;
    const mast = 0.03 * m * ((y1 * y1 * y1 - y0 * y0 * y0) / (3 * spec.sail.luff));
    I[0] += mast;
    I[2] += mast;
  }

  // everything below is relative to the centre of gravity, in the body frame
  const C = hull.cols;
  const nc = C.n;
  const cx = new Float64Array(nc), cz = new Float64Array(nc), cb0 = new Float64Array(nc), ct = new Float64Array(nc);
  for (let i = 0; i < nc; i++) {
    cx[i] = C.x[i] - CG[0];
    cz[i] = C.z[i] - CG[2];
    cb0[i] = C.bottom[i] - CG[1];
    ct[i] = C.top[i] - CG[1];
  }
  const rel = (p) => [p[0] - CG[0], p[1] - CG[1], p[2] - CG[2]];
  // the water's motion is sampled once per row of columns abreast: it
  // hardly changes across the beam, and the ocean's queries are the cost
  const stationAt = hull.stations.map(rel);
  const stationVel = new Float64Array(3 * stationAt.length);
  const keelAt = rel([cb[0], -spec.keel.depth, hull.keel.z]);
  const rudderAt = rel(spec.rudder.at);
  const hullAt = rel(cb); // where the hull's resistance acts
  const tack = rel(spec.sail.tack);
  const windageAt = rel([cb[0], spec.freeboard / 2, cb[2]]);
  const center = spec.center ?? [0, 0];
  const bowAt = rel([center[0], spec.freeboard, center[1] - L / 2 + 0.03 * L]);
  const keelSlope = liftSlope(hull.keel.aspect);
  const rudderAspect = 3; // with the hull above it as an end plate
  const rudderSlope = liftSlope(rudderAspect);
  const sailAspect = (1.3 * spec.sail.luff * spec.sail.luff) / spec.sail.area;
  const hullSide = 0.7 * L * spec.freeboard;
  const hullFront = 0.7 * B * spec.freeboard;
  const mastArea = 0.15 * spec.sail.luff;
  const anchorK = 2.5 * m; // a chain's catenary, as a spring
  // damped twice critically: a chain lying on the bottom soaks up a snatch, it doesn't hand it back
  const anchorC = 4 * Math.sqrt(anchorK * m * (1 + ADDED_MASS[2]));
  const anchorMax = ANCHOR_HOLD * m * G;
  const sqrtGL = Math.sqrt(G * L);

  // A contract's keel and rudder (§6.4): each a planform acting at its own
  // MAC's quarter chord, with its own aspect ratio, sweep and stall, wet as
  // far as its span is under the surface; the keel's downwash turns the
  // flow the rudder meets. The keel first, so its downwash is known.
  const planforms = rig ? rig.appendages.filter((a) => (a.id === "keel" || a.id === "rudder") && a.areaM2 > 0).sort((a, b) => (a.id === "keel" ? -1 : 1) - (b.id === "keel" ? -1 : 1)).map(planformOf) : null;
  const rudderMax = rig && Number.isFinite(spec.rudder.maxDeg) ? spec.rudder.maxDeg * DEG : RUDDER_MAX;
  function planformOf(a) {
    const c = a.cornersM;
    const quarter = (le, te) => [le[0] + 0.25 * (te[0] - le[0]), le[1] + 0.25 * (te[1] - le[1]), le[2] + 0.25 * (te[2] - le[2])];
    const tan = Math.tan((a.sweepHalfDeg ?? 0) * DEG);
    return {
      rudder: a.id === "rudder",
      at: rel(a.qcM),
      root: rel(quarter(c.rootLE, c.rootTE)),
      tip: rel(quarter(c.tipLE, c.tipTE)),
      area: a.areaM2,
      arGeom: a.arGeom,
      endPlate: a.endPlateFactor ?? 1,
      secHalf2: 1 + tan * tan,
      stall: (a.stallDeg ?? 15) * DEG,
      mac: a.macM,
      // the contract's appendage friction: 2·C_f·(1 + 2t/c + 60(t/c)⁴), C_f at the MAC's Reynolds number
      form: 2 * (1 + 2 * a.tc + 60 * a.tc ** 4),
    };
  }

  // A contract's canoe body in the water (§6.4, §6.5): its resistance from
  // the contract's R(V, φ) table (resistance.js) along the flow at her LCB,
  // the induced drag of her whole side force, and her canoe body's side
  // force, Y_h = q·LWL²·|Y'v|·sin λ·cos φ. That is a linear sway damping
  // ½ρ·LWL²·|Y'v|·V in place of the columns' own SWAY_LINEAR, shared among
  // the wet columns by their lateral area as it is at that moment (heeled,
  // the lee topsides add area, and the side force doesn't grow with it):
  // each column's sway through the water, ux, is V·sin λ·cos φ, so the shares
  // add up to Y_h, and a turn's sway along her damps it. Slow, where that is
  // less than SWAY_LINEAR over her lateral area at rest, that stands. It is
  // moved to act at mid-LWL, as §6.4's does, and the Munk moment
  // N_h = q·LWL³·|N'v|·sin λ·cos φ turns her bow to windward. Both fade as
  // she leaves the water (subRatio).
  const cres = rig ? contractResistance(rig) : null;
  const sideF = rig?.hull?.sideForce ?? null;
  const yhPerV = sideF ? 0.5 * RHO * sideF.lwlM * sideF.lwlM * Math.abs(sideF.yv) : 0; // N per (m/s of sway) per (m/s of her speed)
  let latRest = 0; // the columns' lateral area afloat on her lines
  for (let i = 0; i < nc; i++) if (C.station[i] >= 0) latRest += C.side[i] * Math.max(0, Math.min(0, C.top[i]) - C.bottom[i]);
  const swayLinear = cres ? 0 : SWAY_LINEAR; // per column: a contract's is all in the aggregate
  // and the columns' quadratic cross-flow (SWAY_CD) only where §6.4 stops
  // holding: weighted by how far sin²λ (her leeway at the LCB) is past her
  // keel's stall, so none in normal sailing and all of it sliding broadside
  const crossStall2 = cres ? Math.sin(planforms?.find((f) => !f.rudder)?.stall ?? 15 * DEG) ** 2 : 0;
  // and a keel's bulb's skin friction (§6.5.4): q·S·C_f(Re_L)·(1 + 1.5(D/L)^1.5 + 7(D/L)³), S a spheroid's
  const bulbs = cres
    ? rig.appendages
        .filter((a) => a.bulb && a.bulb.lengthM > 0 && a.bulb.diameterM > 0)
        .map(({ bulb: b }) => {
          const ra = b.lengthM / 2, rb = b.diameterM / 2;
          const e = ra > rb ? Math.sqrt(1 - (rb * rb) / (ra * ra)) : 0;
          const dl = b.diameterM / b.lengthM;
          return { at: rel(b.centreM), length: b.lengthM, area: e > 0 ? 2 * Math.PI * rb * rb * (1 + (ra / (rb * e)) * Math.asin(e)) : 4 * Math.PI * rb * rb, form: 1 + 1.5 * dl ** 1.5 + 7 * dl ** 3 };
        })
    : [];
  const nhPerV = sideF ? 0.5 * RHO * sideF.lwlM ** 3 * Math.abs(sideF.nv) : 0;
  const midAt = sideF ? sideF.midZM - CG[2] : 0; // mid-LWL, body z from the centre of gravity
  const hullLatY = (sideF?.atM?.[1] ?? cb[1]) - CG[1]; // the canoe body's lateral centroid's depth, from the centre of gravity
  // what this step's foils and canoe body push sideways (body x, N) and its moment's height: for the induced drag
  let sideLift = 0, sideLiftY = 0;

  // the crew's weight, out on the windward side by its arm (§6.6): a pure
  // moment, since cgM already has them, on the centreline
  const crew = rig?.crew && rig.crew.massKg > 0 && Math.abs(rig.crew.armM) > 0 ? { w: rig.crew.massKg * G, arm: Math.abs(rig.crew.armM) } : null;
  const sinFullHeel = Math.sin(CREW_FULL_HEEL);

  // A contract's sails (§6.2–6.3; rig-sails.js), when it states them: each
  // its own foil, with its own area, CE, lift slope and family's
  // coefficients, in the air at its own CE. The main is the boom; the
  // headsails swing together on their sheets (`jibAt`, the first one's
  // chord; another's is held within its own range). Without them a
  // contract boat flies its lumped sail (§6.8), as every other ship does.
  const rs = rig ? rigSails(rig) : null;
  const sailN = rs ? rs.sails.length : 0;
  const head0 = rs && rs.heads.length ? rs.heads[0] : null;
  // headsails first: the main's upwash reads their lift (§6.3)
  const sailOrder = rs ? [...rs.heads, ...(rs.main ? [rs.main] : [])].map((x) => rs.sails.indexOf(x)) : [];
  const sAir = new Float64Array(2 * sailN); // each sail's air across and along her (body x, z)
  const sArm = new Float64Array(3 * sailN); // its CE from the centre of gravity (world)
  const sArea = new Float64Array(sailN), sSlope = new Float64Array(sailN), sCl = new Float64Array(sailN), sCd = new Float64Array(sailN);
  const ceAt = [0, 0, 0];
  const coef = new Float64Array(2);
  let jibAt = NaN; // the headsails' chord (radians, + to starboard); NaN: not yet known (where the wind and the sheet put it)
  let jibGoal = 0;
  /** A headsail's chord when the jib's is `a`: the jib's own, another's held within its range. */
  const headAngle = (S, a) => (S === head0 ? a : a >= 0 ? Math.min(a, S.max) : Math.max(a, -S.max));

  // working state: the centre of gravity's position and velocity, the
  // orientation and its rotation matrix, the spin
  const P = new Float64Array(3), V = new Float64Array(3), Q = new Float64Array(4), W = new Float64Array(3);
  const R = new Float64Array(9);
  const F = new Float64Array(3), T = new Float64Array(3);
  // scratch for the water's velocity and the true wind, which an ocean or
  // wind may write into instead of allocating (or ignore and return its own)
  const wv = [0, 0, 0];
  const tw = [0, 0];
  const foil = new Float64Array(2);
  // what read() reports, filled in by forces()
  const diag = { boom: 0, awSpeed: 0, awAngle: 0, sailForce: 0, submerged: 0, surge: 0, sway: 0, planing: 0 };
  let subRatio = 0;
  let boomAt = NaN; // the carried boom angle; NaN: not yet known (it starts where the wind puts it)
  let boomGoal = 0; // where the wind and the sheet would put it
  // a contract's crew: where they sit, −1..1 of their arm (+ starboard); NaN: not yet known (where the wind puts them)
  let crewAt = NaN;
  let crewGoal = 0;
  // what planformForce found: the foil's lift coefficient, and its lift across her (body x, N)
  let foilCl = 0;
  let foilLiftX = 0;

  function rotation() {
    const x = Q[0], y = Q[1], z = Q[2], w = Q[3];
    R[0] = 1 - 2 * (y * y + z * z);
    R[1] = 2 * (x * y - z * w);
    R[2] = 2 * (x * z + y * w);
    R[3] = 2 * (x * y + z * w);
    R[4] = 1 - 2 * (x * x + z * z);
    R[5] = 2 * (y * z - x * w);
    R[6] = 2 * (x * z - y * w);
    R[7] = 2 * (y * z + x * w);
    R[8] = 1 - 2 * (x * x + y * y);
  }

  /** Force f (world) at arm a (world, from the centre of gravity). */
  function apply(fx, fy, fz, ax, ay, az) {
    F[0] += fx;
    F[1] += fy;
    F[2] += fz;
    T[0] += ay * fz - az * fy;
    T[1] += az * fx - ax * fz;
    T[2] += ax * fy - ay * fx;
  }

  /**
   * A foil's force in its plane, into `foil` as body (x, z): (ux, uz) the
   * flow past it, (chx, chz) its chord from leading to trailing edge, q·area
   * the dynamic pressure times its area. Lift is across the flow toward the
   * face the flow pushes on, drag along it.
   */
  function foilForce(ux, uz, chx, chz, qa, sail, slope, aspect) {
    foil[0] = foil[1] = 0;
    const s = Math.hypot(ux, uz);
    if (s < 1e-6 || qa <= 0) return;
    const fx = ux / s, fz = uz / s;
    const along = fx * chx + fz * chz;
    let nx = chz, nz = -chx;
    let across = fx * nx + fz * nz;
    if (across < 0) {
      nx = -nx;
      nz = -nz;
      across = -across;
    }
    const alpha = Math.atan2(across, along);
    const cl = sail ? sailCL(alpha) : foilCL(alpha, slope);
    const cd = sail ? sailCD(alpha, cl, aspect) : foilCD(alpha, cl, aspect);
    let lx = nx - across * fx, lz = nz - across * fz;
    const ll = Math.hypot(lx, lz);
    if (ll > 1e-9) {
      lx /= ll;
      lz /= ll;
    } else lx = lz = 0;
    foil[0] = qa * (cl * lx + cd * fx);
    foil[1] = qa * (cl * lz + cd * fz);
  }

  /**
   * foilForce for a contract's planform: §6.4's lift (planformCL), its own
   * friction and induced drag (planformCD). Leaves its lift coefficient in
   * foilCl.
   */
  function planformForce(ux, uz, chx, chz, qa, slope, aspect, cd0, stall) {
    foil[0] = foil[1] = 0;
    foilCl = 0;
    foilLiftX = 0;
    const s = Math.hypot(ux, uz);
    if (s < 1e-6 || qa <= 0) return;
    const fx = ux / s, fz = uz / s;
    const along = fx * chx + fz * chz;
    let nx = chz, nz = -chx;
    let across = fx * nx + fz * nz;
    if (across < 0) {
      nx = -nx;
      nz = -nz;
      across = -across;
    }
    const alpha = Math.atan2(across, along);
    const cl = planformCL(alpha, slope, stall);
    const cd = planformCD(alpha, cl, aspect, cd0, stall);
    foilCl = cl;
    let lx = nx - across * fx, lz = nz - across * fz;
    const ll = Math.hypot(lx, lz);
    if (ll > 1e-9) {
      lx /= ll;
      lz /= ll;
    } else lx = lz = 0;
    foilLiftX = qa * cl * lx;
    foil[0] = qa * (cl * lx + cd * fx);
    foil[1] = qa * (cl * lz + cd * fz);
  }

  /**
   * A contract's keel and rudder (§6.4), into F and T. Each acts at its MAC's
   * quarter chord, or, part out of the water, the wet part's (from its low
   * end, linear to the quarter chord when all of it is in); its area is the
   * wet fraction of its span. The rudder meets the flow turned by the keel's
   * downwash, ε = dε/dα·α_k with dε/dα = a_k/(π·AR_eff,k), α_k here the
   * keel's lift over its slope (α_k while it's unstalled), and none going astern.
   */
  function planformFoils(t, controls, water, px, py, pz, vx, vy, vz, w0, w1, w2) {
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    let downwash = 0;
    // with the contract's resistance, induced drag is the whole side force's (§6.5.5), not each foil's own
    const ownInduced = !cres;
    for (let k = 0; k < planforms.length; k++) {
      const f = planforms[k];
      const yr = py + r3 * f.root[0] + r4 * f.root[1] + r5 * f.root[2];
      const yt = py + r3 * f.tip[0] + r4 * f.tip[1] + r5 * f.tip[2];
      const low = yt <= yr ? f.tip : f.root;
      const lo = yt <= yr ? yt : yr, hi = yt <= yr ? yr : yt;
      const p0 = f.at;
      const h = water.heightAt(px + r0 * p0[0] + r1 * p0[1] + r2 * p0[2], pz + r6 * p0[0] + r7 * p0[1] + r8 * p0[2], t);
      const wet = hi - lo > 1e-3 ? clamp((h - lo) / (hi - lo), 0, 1) : h > lo ? 1 : 0;
      if (wet <= 0) continue;
      const bx = low[0] + wet * (p0[0] - low[0]), by = low[1] + wet * (p0[1] - low[1]), bz = low[2] + wet * (p0[2] - low[2]);
      const ax = r0 * bx + r1 * by + r2 * bz;
      const ay = r3 * bx + r4 * by + r5 * bz;
      const az = r6 * bx + r7 * by + r8 * bz;
      const wu = water.velocityAt(px + ax, py + ay, pz + az, t, wv);
      const rx = wu[0] - (vx + w1 * az - w2 * ay);
      const ry = wu[1] - (vy + w2 * ax - w0 * az);
      const rz = wu[2] - (vz + w0 * ay - w1 * ax);
      let ux = r0 * rx + r3 * ry + r6 * rz;
      let uz = r2 * rx + r5 * ry + r8 * rz;
      if (f.rudder && downwash !== 0) {
        // the flow's angle θ = atan2(ux, uz) less ε
        const c = Math.cos(downwash), s = Math.sin(downwash);
        const nx = ux * c - uz * s;
        uz = uz * c + ux * s;
        ux = nx;
      }
      const s2 = ux * ux + uz * uz;
      const aspect = planformAspect(f.arGeom, f.endPlate, r4);
      const slope = planformSlope(aspect, f.secHalf2);
      const cd0 = f.form * ittc57((Math.sqrt(s2) * f.mac) / NU);
      const qa = 0.5 * RHO * s2 * f.area * wet;
      if (f.rudder) {
        // + rudder: the trailing edge to starboard, which pushes the stern to port and the bow to starboard
        const d = clamp(controls.rudder ?? 0, -1, 1) * rudderMax;
        planformForce(ux, uz, Math.sin(d), Math.cos(d), qa, slope, ownInduced ? aspect : 0, cd0, f.stall);
      } else {
        planformForce(ux, uz, 0, 1, qa, slope, ownInduced ? aspect : 0, cd0, f.stall);
        // flowing from ahead, its downwash: the same sign as the flow's angle
        if (uz > 0 && slope > 0) downwash = (ux >= 0 ? 1 : -1) * (foilCl / slope) * (slope / (Math.PI * aspect)) * wet;
      }
      const fx = foil[0], fz = foil[1];
      apply(r0 * fx + r2 * fz, r3 * fx + r5 * fz, r6 * fx + r8 * fz, ax, ay, az);
      sideLift += foilLiftX;
      sideLiftY += foilLiftX * by;
    }
  }

  /**
   * A contract's sails (§6.2–6.3), into F and T. Each sail's CE is where its
   * swing about its luff has put it, and the air there (the true wind less
   * her motion at that point, across and along her: §6.1's heeled sail
   * plane) gives its β_e, the side the wind is on and its pressure. Its
   * sheeting angle δ is its chord's angle to leeward of that (negative: to
   * windward); α = β_e − δ, the main's less the headsails' upwash, a
   * leeward headsail's coefficients blanketed, a goose-winged one's ×
   * wing.qFactor. The rig's CL is the area-weighted sum, flattened; its
   * induced drag CL²/(π·ARe) is shared out as each sail's CL·CL_rig/(π·ARe),
   * so it adds up to the rig's. Each sail's drive and heeling force (§6.3,
   * its own q) act at its own CE, square to the mast.
   *
   * The boom goes where the main's own air would put it, within the sheet's
   * travel (the contract's 0..85°: a traveller); the jib where its air puts
   * it, within its sheet's (no closer than its least sheeting angle, its
   * lead's line); backed, it is held to windward at its sheet's angle (from
   * β_e ≥ wing.fromBeta goose-winged, at the wing's), and within
   * BACKED_DEADBAND of dead ahead on the side it is on.
   */
  function riggedSails(t, controls, wind, px, py, pz, vx, vy, vz, w0, w1, w2) {
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    const raised = clamp(controls.sail ?? 0, 0, 1);
    const flat = clamp(Number.isFinite(controls.flat) ? controls.flat : 1, rs.flatMin, 1);
    const furlIn = Number.isFinite(controls.furl) ? clamp(controls.furl, 0, 1) : NaN;
    const M = rs.main;
    const mainLimit = M ? M.min + (M.max - M.min) * clamp(controls.sheet ?? 0.5, 0, 1) : 0;
    const js = Number.isFinite(controls.jibSheet) ? clamp(controls.jibSheet, 0, 1) : NaN;

    // each sail's shape for the hoist and furl, where its CE is, the air
    // there (a sail not yet placed is sampled on the centreline, then again
    // once the wind has placed it, below)
    const boomKnown = Number.isFinite(boomAt), jibKnown = Number.isFinite(jibAt);
    for (let i = 0; i < sailN; i++) {
      const S = rs.sails[i];
      const g = S.shape(S.main ? 1 - raised : Number.isFinite(furlIn) ? furlIn : Math.max(S.furl, 1 - raised));
      sArea[i] = g.area;
      sSlope[i] = g.slope;
      sampleSail(i, g.ce, S.main ? (boomKnown ? boomAt : 0) : jibKnown ? headAngle(S, jibAt) : 0, t, wind, px, pz, vx, vy, vz, w0, w1, w2);
    }

    // where the sheets would put the boom and the jib
    if (M) {
      const i = rs.sails.indexOf(M);
      const ux = sAir[2 * i], uz = sAir[2 * i + 1];
      const free = ux * ux + uz * uz > 1e-4 ? Math.atan2(ux, uz) : 0;
      boomGoal = free >= 0 ? Math.min(free, mainLimit) : Math.max(free, -mainLimit);
      if (!Number.isFinite(boomAt)) boomAt = boomGoal;
    }
    diag.boom = M ? boomAt : 0;
    if (head0) {
      const i = rs.sails.indexOf(head0);
      const ux = sAir[2 * i], uz = sAir[2 * i + 1];
      const calm = ux * ux + uz * uz <= 1e-4;
      const free = calm ? 0 : Math.atan2(ux, uz);
      const from = calm ? 0 : Math.atan2(-ux, uz); // + from starboard
      if (controls.jibBacked) {
        const side = Math.abs(from) < BACKED_DEADBAND && Number.isFinite(jibAt) && jibAt !== 0 ? Math.sign(jibAt) : from >= 0 ? 1 : -1;
        const W = head0.wing;
        const k = Number.isFinite(js) ? js : 0;
        jibGoal = side * (W && Math.abs(from) >= W.from * DEG ? W.lo + (W.hi - W.lo) * k : head0.min + (head0.max - head0.min) * k);
      } else {
        const lim = Number.isFinite(js) ? head0.min + (head0.max - head0.min) * js : clamp(mainLimit, head0.min, head0.max);
        jibGoal = free >= 0 ? Math.min(free, lim) : Math.max(free, -lim);
      }
      if (!Number.isFinite(jibAt)) jibAt = jibGoal;
    }
    for (let i = 0; i < sailN; i++) {
      const S = rs.sails[i];
      if (S.main ? !boomKnown : !jibKnown) sampleSail(i, S.shape(S.main ? 1 - raised : Number.isFinite(furlIn) ? furlIn : Math.max(S.furl, 1 - raised)).ce, S.main ? boomAt : headAngle(S, jibAt), t, wind, px, pz, vx, vy, vz, w0, w1, w2);
    }

    // each sail's coefficients, the headsails first
    const up = rs.upwash, bl = rs.blanket;
    let A = 0, aJib = 0, clJib = 0;
    for (let n = 0; n < sailOrder.length; n++) {
      const i = sailOrder[n];
      const S = rs.sails[i];
      sCl[i] = sCd[i] = 0;
      const area = sArea[i];
      if (!(area > 0)) continue;
      A += area;
      if (!S.main) aJib += area;
      const ux = sAir[2 * i], uz = sAir[2 * i + 1];
      if (ux * ux + uz * uz < 1e-12) continue;
      const from = Math.atan2(-ux, uz);
      const side = from >= 0 ? 1 : -1;
      const be = Math.abs(from) / DEG;
      const dS = (-side * (S.main ? boomAt : headAngle(S, jibAt))) / DEG; // + to leeward
      let alpha = be - dS;
      let q = 1;
      if (S.main) alpha -= rs.kInt * (aJib > 0 ? clJib / aJib : 0) * (1 - smooth(be, up[0], up[1]));
      else if (dS < 0) q = S.wing && be >= S.wing.from ? S.wing.q : 1;
      else q = 1 - bl.max * smooth(be, bl.from, bl.to);
      rigSailCoeffs(coef, S.model, sSlope[i], alpha, dS, rs.cnExp);
      sCl[i] = coef[0] * q;
      sCd[i] = coef[1] * q;
      if (!S.main && dS >= 0) clJib += sCl[i] * area;
    }

    // the rig's lift and induced drag, and each sail's force at its CE
    diag.sailForce = 0;
    if (!(A > 0)) return;
    let CL = 0;
    for (let i = 0; i < sailN; i++) CL += flat * sCl[i] * sArea[i];
    CL /= A;
    const are = (rs.he * rs.he) / A;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < sailN; i++) {
      const area = sArea[i];
      if (!(area > 0)) continue;
      const ux = sAir[2 * i], uz = sAir[2 * i + 1];
      const v2 = ux * ux + uz * uz;
      if (v2 < 1e-12) continue;
      const from = Math.atan2(-ux, uz);
      const side = from >= 0 ? 1 : -1;
      const be = Math.abs(from);
      const cl = flat * sCl[i];
      const cd = sCd[i] + (are > 0 ? (cl * CL) / (Math.PI * are) : 0);
      const q = 0.5 * rs.rho * v2 * area;
      const sb = Math.sin(be), cb = Math.cos(be);
      const fx = -side * q * (cl * cb + cd * sb); // the heeling force, to leeward
      const fz = -q * (cl * sb - cd * cb); // the drive, forward (−z)
      const wx = r0 * fx + r2 * fz, wy = r3 * fx + r5 * fz, wz = r6 * fx + r8 * fz;
      apply(wx, wy, wz, sArm[3 * i], sArm[3 * i + 1], sArm[3 * i + 2]);
      sx += wx;
      sy += wy;
      sz += wz;
    }
    diag.sailForce = Math.hypot(sx, sy, sz);
  }

  /** A contract sail's CE swung to θ (sArm, world, from the CG) and the air there (sAir, body x and z). */
  function sampleSail(i, ce, theta, t, wind, px, pz, vx, vy, vz, w0, w1, w2) {
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    swungCE(ceAt, rs.sails[i], ce, theta);
    const bx = ceAt[0] - CG[0], by = ceAt[1] - CG[1], bz = ceAt[2] - CG[2];
    const ax = r0 * bx + r1 * by + r2 * bz;
    const ay = r3 * bx + r4 * by + r5 * bz;
    const az = r6 * bx + r7 * by + r8 * bz;
    sArm[3 * i] = ax;
    sArm[3 * i + 1] = ay;
    sArm[3 * i + 2] = az;
    const tv = wind.at(px + ax, pz + az, t, tw);
    const qx = tv[0] - (vx + w1 * az - w2 * ay);
    const qy = -(vy + w2 * ax - w0 * az);
    const qz = tv[1] - (vz + w0 * ay - w1 * ax);
    sAir[2 * i] = r0 * qx + r3 * qy + r6 * qz;
    sAir[2 * i + 1] = r2 * qx + r5 * qy + r8 * qz;
  }

  /** Where a contract's crew would sit: to windward of the air (body x) `ux`, out as far as her heel asks. */
  function crewTo(ux, r3) {
    // to windward (the apparent wind from starboard, ux < 0: starboard),
    // out as far as her heel to leeward asks; a wind from dead ahead keeps them where they are
    const side = ux < -0.1 ? 1 : ux > 0.1 ? -1 : crewAt < 0 ? -1 : 1;
    crewGoal = side * clamp((side * r3) / sinFullHeel, 0, 1);
  }

  /** The sum of forces and torques about the centre of gravity, into F and T. */
  function forces(t, controls, water, wind) {
    rotation();
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    const px = P[0], py = P[1], pz = P[2];
    const vx = V[0], vy = V[1], vz = V[2];
    const w0 = W[0], w1 = W[1], w2 = W[2];
    F[0] = F[2] = T[0] = T[1] = T[2] = 0;
    F[1] = -m * G;

    // A contract's canoe body: how she moves through the water at her LCB,
    // and (in the columns' loop) her wet lateral area and the sway across it
    let hrx = 0, hrz = 0, hu = 0, hs = 0, hv = 0, hax = 0, hay = 0, haz = 0, crossFlow = 1;
    let lat = 0, latZ = 0, latU = 0, latUY = 0, latUZ = 0;
    // and the horizontal square to her keel line, (x, z) world
    let shx = 0, shz = 0;
    if (cres) {
      const l = Math.hypot(r2, r8);
      if (l > 1e-9) {
        shx = -r8 / l;
        shz = r2 / l;
      }
      hax = r0 * hullAt[0] + r1 * hullAt[1] + r2 * hullAt[2];
      hay = r3 * hullAt[0] + r4 * hullAt[1] + r5 * hullAt[2];
      haz = r6 * hullAt[0] + r7 * hullAt[1] + r8 * hullAt[2];
      const wu = water.velocityAt(px + hax, py + hay, pz + haz, t, wv);
      hrx = vx + w1 * haz - w2 * hay - wu[0];
      const hry = vy + w2 * hax - w0 * haz - wu[1];
      hrz = vz + w0 * hay - w1 * hax - wu[2];
      hu = r2 * hrx + r5 * hry + r8 * hrz; // + astern
      hs = r0 * hrx + r3 * hry + r6 * hrz; // + sliding to starboard
      hv = Math.hypot(hrx, hrz); // her speed through the water, horizontal
      const s2 = hs * hs + hu * hu;
      crossFlow = s2 > 1e-12 ? clamp((hs * hs) / s2 - crossStall2, 0, 1) / (1 - crossStall2) : 1;
    }
    sideLift = sideLiftY = 0;

    // Buoyancy: each column displaces what of it is below the surface
    // there, pushing up through the middle of that part. Heeling puts more
    // of the low side under, which is the righting moment.
    let vSub = 0, bx = 0, by = 0, bz = 0;
    // and a plane fitted to the surface under the hull: its slope is the
    // pressure gradient that pushes a floating body down a wave's face
    let sn = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
    let sampled = -1;
    for (let i = 0; i < nc; i++) {
      const ax = cx[i], az = cz[i], ab = cb0[i], at = ct[i];
      const wx = r0 * ax + r2 * az, wz = r6 * ax + r8 * az;
      // the waterline point is at body y = 0, which is −CG[1] from the centre of gravity
      const wlx = wx - r1 * CG[1], wlz = wz - r7 * CG[1];
      const h = water.heightAt(px + wlx, pz + wlz, t);
      if (C.station[i] >= 0) {
        sn++;
        sx += wlx;
        sz += wlz;
        sh += h;
        sxx += wlx * wlx;
        szz += wlz * wlz;
        sxz += wlx * wlz;
        sxh += wlx * h;
        szh += wlz * h;
      }
      const yb = py + r3 * ax + r4 * ab + r5 * az;
      const yt = py + r3 * ax + r4 * at + r5 * az;
      // the column fills from whichever end is lower (the deck, capsized)
      const up = yt >= yb;
      const span = up ? yt - yb : yb - yt;
      let f = span > 1e-3 ? (h - (up ? yb : yt)) / span : h > yb ? 1 : 0;
      if (f <= 0) continue;
      if (f > 1) f = 1;
      // the submerged part's middle, in the body and then from the centre of gravity
      const cy = up ? ab + 0.5 * f * (at - ab) : at - 0.5 * f * (at - ab);
      const kx = wx + r1 * cy, ky = r3 * ax + r4 * cy + r5 * az, kz = wz + r7 * cy;
      const vol = f * C.vol[i];
      const lift = RHO * G * vol;
      F[1] += lift;
      T[0] -= kz * lift;
      T[2] += kx * lift;
      vSub += vol;
      bx += vol * kx;
      by += vol * ky;
      bz += vol * kz;

      const st = C.station[i];
      if (st >= 0) {
        if (st !== sampled) {
          const p = stationAt[st];
          const u = water.velocityAt(
            px + r0 * p[0] + r1 * p[1] + r2 * p[2],
            py + r3 * p[0] + r4 * p[1] + r5 * p[2],
            pz + r6 * p[0] + r7 * p[1] + r8 * p[2],
            t,
            wv,
          );
          stationVel[3 * st] = u[0];
          stationVel[3 * st + 1] = u[1];
          stationVel[3 * st + 2] = u[2];
          sampled = st;
        }
        const rx = vx + w1 * kz - w2 * ky - stationVel[3 * st];
        const ry = vy + w2 * kx - w0 * kz - stationVel[3 * st + 1];
        const rz = vz + w0 * ky - w1 * kx - stationVel[3 * st + 2];
        const ux = r0 * rx + r3 * ry + r6 * rz;
        const uy = r1 * rx + r4 * ry + r7 * rz;
        const depth = f * (at - ab);
        const wet = depth < 0.3 ? depth / 0.3 : 1;
        const a = C.area[i] * wet;
        const sa = C.side[i] * depth;
        const fx = -(swayLinear + 0.5 * RHO * SWAY_CD * crossFlow * Math.abs(ux)) * sa * ux;
        if (cres) {
          // a contract's: heave damped along her body's vertical as every
          // ship's is (moving ahead pitched, that's her bottom's lift, which
          // steadies her in a sea), less her slide across her keel line
          // (horizontal, square to it): heeled, that would be damped as heave,
          // a second side force on top of §6.4's (below)
          const uh = uy - (rx * shx + rz * shz) * (r1 * shx + r7 * shz);
          const fy = -(HEAVE_LINEAR + 0.5 * RHO * HEAVE_CD * Math.abs(uh)) * a * uh;
          lat += sa;
          latZ += sa * az;
          latU += sa * ux;
          latUY += sa * ux * cy;
          latUZ += sa * ux * az;
          apply(r0 * fx + r1 * fy, r3 * fx + r4 * fy, r6 * fx + r7 * fy, kx, ky, kz);
        } else {
          const fy = -(HEAVE_LINEAR + 0.5 * RHO * HEAVE_CD * Math.abs(uy)) * a * uy;
          apply(r0 * fx + r1 * fy, r3 * fx + r4 * fy, r6 * fx + r7 * fy, kx, ky, kz);
        }
      }
    }
    subRatio = Math.min(1, vSub / hull.restVolume);
    diag.submerged = vSub / hull.totalVolume;

    if (vSub > 0) {
      bx /= vSub;
      by /= vSub;
      bz /= vSub;
      // Froude–Krylov: the surface's slope under the hull
      const mx = sx / sn, mz = sz / sn, mh = sh / sn;
      const cxx = sxx - sn * mx * mx, czz = szz - sn * mz * mz, cxz = sxz - sn * mx * mz;
      const cxh = sxh - sn * mx * mh, czh = szh - sn * mz * mh;
      const det = cxx * czz - cxz * cxz;
      if (det > 1e-6) {
        const gx = (cxh * czz - czh * cxz) / det;
        const gz = (czh * cxx - cxh * cxz) / det;
        const push = RHO * G * vSub;
        apply(-push * gx, 0, -push * gz, bx, by, bz);
      }
    }

    if (cres) {
      // A contract's canoe body: the table's R(V, φ) along the flow, at her
      // LCB, more going astern (STERNWAY) and less as she leaves the water;
      // below a creep, SURGE_CREEP so a slow drift dies away, gone by 0.5 m/s
      diag.surge = -hu;
      diag.sway = hs;
      diag.planing = cres.planing(hv);
      if (hv > 1e-6 && vSub > 0) {
        const heelDeg = Math.asin(clamp(Math.abs(r3), 0, 1)) / DEG;
        let r = cres.hull(hv, heelDeg) * subRatio;
        r *= 1 + (STERNWAY - 1) * clamp(hu / hv, 0, 1);
        r += SURGE_CREEP * hull.wetted * (hv < 0.1 ? hv / 0.1 : hv < 0.5 ? (0.5 - hv) / 0.4 : 0);
        apply((-r * hrx) / hv, 0, (-r * hrz) / hv, hax, hay, haz);
      }
      // her canoe body's side force (§6.4): the linear sway damping shared by
      // lateral area (a force across her and its moments, body axes), moved
      // from her lateral area's centroid to mid-LWL; and the Munk moment
      // (about her body's vertical, + turning the bow to port)
      if (lat > 0) {
        // Y_h is lift: square to her flow at the LCB (in her body's
        // horizontal, (hs, hu)), as §6.4–6.6 have it, so it does no work
        // and, going ahead, leans forward by her leeway (Y_h·sin λ of it
        // along her bow); the slow floor under it is damping, across her.
        // Past her keel's stall §6.4's small-leeway lift gives way to the
        // columns' cross-flow drag (crossFlow), gone sliding broadside.
        const kl = (yhPerV * hv * subRatio * (1 - crossFlow)) / lat;
        const kd = (Math.max(0, SWAY_LINEAR * latRest - yhPerV * hv) * subRatio) / lat;
        const hb = Math.hypot(hs, hu);
        const c = hb > 1e-9 ? Math.abs(hu) / hb : 1; // cos λ: the lift's share across her
        const k = kl * c + kd;
        const fx = -k * latU;
        // the lift's lean, along body z, at mid-LWL and the side force's height
        const fz = hb > 1e-9 ? (kl * latU * hs * (hu < 0 ? -1 : 1)) / hb : 0;
        const tx = Math.abs(latU) > 1e-12 ? (latUY / latU) * fz : 0;
        const ty = -k * latUZ - (midAt - latZ / lat) * k * lat * hs + nhPerV * hv * hs * subRatio + CG[0] * fz;
        const tz = k * latUY;
        F[0] += r0 * fx + r2 * fz;
        F[1] += r3 * fx + r5 * fz;
        F[2] += r6 * fx + r8 * fz;
        T[0] += r0 * tx + r1 * ty + r2 * tz;
        T[1] += r3 * tx + r4 * ty + r5 * tz;
        T[2] += r6 * tx + r7 * ty + r8 * tz;
      }
    } else
    // Hull resistance, lengthwise: skin friction (ITTC '57) and wave-making,
    // which climbs steeply toward a Froude number of 0.4, the hull speed
    {
      const ax = r0 * hullAt[0] + r1 * hullAt[1] + r2 * hullAt[2];
      const ay = r3 * hullAt[0] + r4 * hullAt[1] + r5 * hullAt[2];
      const az = r6 * hullAt[0] + r7 * hullAt[1] + r8 * hullAt[2];
      const wu = water.velocityAt(px + ax, py + ay, pz + az, t, wv);
      const rx = vx + w1 * az - w2 * ay - wu[0];
      const ry = vy + w2 * ax - w0 * az - wu[1];
      const rz = vz + w0 * ay - w1 * ax - wu[2];
      const u = r2 * rx + r5 * ry + r8 * rz; // + is moving astern
      diag.surge = -u;
      diag.sway = r0 * rx + r3 * ry + r6 * rz;
      const s = Math.abs(u);
      if (s > 1e-6 && vSub > 0) {
        const wetted = hull.wetted * Math.cbrt(Math.min(1.5, vSub / hull.restVolume) ** 2);
        const lg = Math.log10(Math.max(1e5, (s * L) / NU)) - 2;
        const cf = 0.075 / (lg * lg);
        const friction = 0.5 * RHO * s * s * wetted * cf * (1 + FORM_FACTOR) + SURGE_CREEP * wetted * Math.min(1, s / 0.1);
        const r = s / sqrtGL / 0.4;
        const r4_ = r * r * r * r;
        const waves = m * G * (0.004 * r4_ + 0.016 * r4_ * r4_) * subRatio;
        const f = -(u > 0 ? STERNWAY : -1) * (friction + waves);
        apply(r2 * f, r5 * f, r8 * f, ax, ay, az);
      }
    }

    // Keel and rudder: foils in the water flowing past them
    if (planforms) planformFoils(t, controls, water, px, py, pz, vx, vy, vz, w0, w1, w2);
    // a contract keel's bulb, along the flow past it, while it's under
    for (let k = 0; k < bulbs.length; k++) {
      const b = bulbs[k], p = b.at;
      const ax = r0 * p[0] + r1 * p[1] + r2 * p[2];
      const ay = r3 * p[0] + r4 * p[1] + r5 * p[2];
      const az = r6 * p[0] + r7 * p[1] + r8 * p[2];
      if (water.heightAt(px + ax, pz + az, t) <= py + ay) continue;
      const wu = water.velocityAt(px + ax, py + ay, pz + az, t, wv);
      const rx = vx + w1 * az - w2 * ay - wu[0];
      const ry = vy + w2 * ax - w0 * az - wu[1];
      const rz = vz + w0 * ay - w1 * ax - wu[2];
      const sp = Math.hypot(rx, ry, rz);
      if (sp < 1e-6) continue;
      const d = 0.5 * RHO * sp * b.area * ittc57((sp * b.length) / NU) * b.form; // the drag over the speed
      apply(-d * rx, -d * ry, -d * rz, ax, ay, az);
    }
    // and a contract's induced drag (§6.5.5): R_i = Y²/(π·T_e²·q) for her
    // whole side force Y (foils and canoe body, in her heeled plane), along
    // the flow at her LCB and the side force's height; ahead only
    if (cres && hv > 0.05) {
      const yh = lat > 0 ? (-yhPerV * hv * subRatio * (1 - crossFlow) * latU) / lat : 0; // the canoe body's Y_h
      const Y = sideLift + yh;
      const te = cres.effectiveDraft(hv);
      const ri = (clamp(-hu / hv, 0, 1) * Y * Y) / (Math.PI * te * te * 0.5 * RHO * hv * hv);
      if (ri > 0) {
        const yY = Math.abs(Y) > 1e-9 ? (sideLiftY + yh * hullLatY) / Y : hullLatY;
        const ax = r0 * hullAt[0] + r1 * yY + r2 * hullAt[2];
        const ay = r3 * hullAt[0] + r4 * yY + r5 * hullAt[2];
        const az = r6 * hullAt[0] + r7 * yY + r8 * hullAt[2];
        apply((-ri * hrx) / hv, 0, (-ri * hrz) / hv, ax, ay, az);
      }
    }
    // the lumped keel and rudder, for a ship without a contract's planforms
    // (a contract's flies only its own, at every speed)
    if (!planforms) for (let k = 0; k < 2; k++) {
      const p = k === 0 ? keelAt : rudderAt;
      const area = k === 0 ? spec.keel.area : spec.rudder.area;
      if (area <= 0) continue;
      const ax = r0 * p[0] + r1 * p[1] + r2 * p[2];
      const ay = r3 * p[0] + r4 * p[1] + r5 * p[2];
      const az = r6 * p[0] + r7 * p[1] + r8 * p[2];
      const h = water.heightAt(px + ax, pz + az, t);
      const wet = Math.min(1, Math.max(0, (h - py - ay) / 0.3 + 0.5));
      if (wet <= 0) continue;
      const wu = water.velocityAt(px + ax, py + ay, pz + az, t, wv);
      // the flow past the foil is the water's velocity less the foil's
      const rx = wu[0] - (vx + w1 * az - w2 * ay);
      const ry = wu[1] - (vy + w2 * ax - w0 * az);
      const rz = wu[2] - (vz + w0 * ay - w1 * ax);
      const ux = r0 * rx + r3 * ry + r6 * rz;
      const uz = r2 * rx + r5 * ry + r8 * rz;
      const qa = 0.5 * RHO * (ux * ux + uz * uz) * area * wet;
      if (k === 0) foilForce(ux, uz, 0, 1, qa, false, keelSlope, hull.keel.aspect);
      else {
        // + rudder: the trailing edge to starboard, which pushes the stern to port and the bow to starboard
        const d = clamp(controls.rudder ?? 0, -1, 1) * RUDDER_MAX;
        foilForce(ux, uz, Math.sin(d), Math.cos(d), qa, false, rudderSlope, rudderAspect);
      }
      const fx = foil[0], fz = foil[1];
      apply(r0 * fx + r2 * fz, r3 * fx + r5 * fz, r6 * fx + r8 * fz, ax, ay, az);
    }

    // The wind, sampled once at the mast: it doesn't change across a deck
    const mx = r0 * tack[0] + r1 * (tack[1] + CE_HEIGHT * spec.sail.luff) + r2 * tack[2];
    const my = r3 * tack[0] + r4 * (tack[1] + CE_HEIGHT * spec.sail.luff) + r5 * tack[2];
    const mz = r6 * tack[0] + r7 * (tack[1] + CE_HEIGHT * spec.sail.luff) + r8 * tack[2];
    const tv = wind.at(px + mx, pz + mz, t, tw);
    const twx = tv[0], twz = tv[1];

    // The sail. The apparent wind at the mast decides where the boom goes:
    // to leeward, as far as the sheet lets it. Either it lies along the wind,
    // luffing, or it is pinned at the sheet and the wind meets it at an angle.
    {
      const ax = twx - (vx + w1 * mz - w2 * my);
      const ay = -(vy + w2 * mx - w0 * mz);
      const az = twz - (vz + w0 * my - w1 * mx);
      const ux = r0 * ax + r3 * ay + r6 * az;
      const uz = r2 * ax + r5 * ay + r8 * az;
      if (rs) {
        // a contract's own sails, each in its own air
        diag.awSpeed = Math.hypot(ux, uz);
        diag.awAngle = Math.atan2(-ux, uz);
        if (crew) crewTo(ux, r3);
        riggedSails(t, controls, wind, px, py, pz, vx, vy, vz, w0, w1, w2);
      } else {
      // where the boom would lie if let go (amidships in a flat calm)
      const free = ux * ux + uz * uz > 1e-4 ? Math.atan2(ux, uz) : 0;
      const limit = BOOM_IN + (BOOM_OUT - BOOM_IN) * clamp(controls.sheet ?? 0.5, 0, 1);
      boomGoal = free >= 0 ? Math.min(free, limit) : Math.max(free, -limit);
      if (!Number.isFinite(boomAt)) boomAt = boomGoal;
      const boom = boomAt;
      diag.boom = boom;
      diag.awSpeed = Math.hypot(ux, uz);
      diag.awAngle = Math.atan2(-ux, uz);
      if (crew) crewTo(ux, r3);
      diag.sailForce = 0;
      const raised = clamp(controls.sail ?? 0, 0, 1);
      if (raised > 0) {
        const sb = Math.sin(boom), cbm = Math.cos(boom);
        const qa = 0.5 * RHO_AIR * (ux * ux + uz * uz) * spec.sail.area * raised;
        foilForce(ux, uz, sb, cbm, qa, true, 0, sailAspect);
        const fx = foil[0], fz = foil[1];
        diag.sailForce = Math.hypot(fx, fz);
        // the centre of effort: a third along the foot, and up the luff where
        // a main and jib's together is, a little above the triangle's centroid
        const ex = tack[0] + (spec.sail.foot / 3) * sb, ey = tack[1] + CE_HEIGHT * spec.sail.luff, ez = tack[2] + (spec.sail.foot / 3) * cbm;
        apply(
          r0 * fx + r2 * fz,
          r3 * fx + r5 * fz,
          r6 * fx + r8 * fz,
          r0 * ex + r1 * ey + r2 * ez,
          r3 * ex + r4 * ey + r5 * ez,
          r6 * ex + r7 * ey + r8 * ez,
        );
      }
      }
    }

    // The crew's weight out to windward: a moment, their weight off the centreline by crewAt·arm
    if (crew) {
      if (!Number.isFinite(crewAt)) crewAt = crewGoal;
      const o = crewAt * crew.arm;
      T[0] += r6 * o * crew.w;
      T[2] -= r0 * o * crew.w;
    }

    // Windage: the wind on the topsides and the bare mast
    for (let k = 0; k < 2; k++) {
      const p = k === 0 ? windageAt : null;
      const ax = k === 0 ? r0 * p[0] + r1 * p[1] + r2 * p[2] : mx;
      const ay = k === 0 ? r3 * p[0] + r4 * p[1] + r5 * p[2] : my;
      const az = k === 0 ? r6 * p[0] + r7 * p[1] + r8 * p[2] : mz;
      const rx = twx - (vx + w1 * az - w2 * ay);
      const ry = -(vy + w2 * ax - w0 * az);
      const rz = twz - (vz + w0 * ay - w1 * ax);
      const ux = r0 * rx + r3 * ry + r6 * rz;
      const uz = r2 * rx + r5 * ry + r8 * rz;
      let fx, fz;
      if (k === 0) {
        fx = 0.5 * RHO_AIR * hullSide * Math.abs(ux) * ux;
        fz = 0.5 * RHO_AIR * hullFront * Math.abs(uz) * uz;
      } else {
        const s = 0.5 * RHO_AIR * mastArea * Math.hypot(ux, uz);
        fx = s * ux;
        fz = s * uz;
      }
      apply(r0 * fx + r2 * fz, r3 * fx + r5 * fz, r6 * fx + r8 * fz, ax, ay, az);
    }

    // The anchor: a rode from the bow that pulls once it is taut
    const anchor = controls.anchor;
    if (anchor && anchor.at) {
      const ax = r0 * bowAt[0] + r1 * bowAt[1] + r2 * bowAt[2];
      const ay = r3 * bowAt[0] + r4 * bowAt[1] + r5 * bowAt[2];
      const az = r6 * bowAt[0] + r7 * bowAt[1] + r8 * bowAt[2];
      const dx = anchor.at[0] - (px + ax), dy = anchor.at[1] - (py + ay), dz = anchor.at[2] - (pz + az);
      const d = Math.hypot(dx, dy, dz);
      const over = d - Math.max(0, anchor.rode ?? 0);
      if (over > 0 && d > 1e-6) {
        const nx = dx / d, ny = dy / d, nz = dz / d;
        // how fast the bow is moving away from the anchor
        const out = -((vx + w1 * az - w2 * ay) * nx + (vy + w2 * ax - w0 * az) * ny + (vz + w0 * ay - w1 * ax) * nz);
        const pull = Math.min(anchorMax, Math.max(0, anchorK * over + anchorC * out));
        apply(pull * nx, pull * ny, pull * nz, ax, ay, az);
      }
    }
  }

  /** One semi-implicit Euler substep from F and T. */
  function integrate(h) {
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    // linear: in the body frame, where the added mass is diagonal
    const fx = (r0 * F[0] + r3 * F[1] + r6 * F[2]) / (m * (1 + ADDED_MASS[0] * subRatio));
    const fy = (r1 * F[0] + r4 * F[1] + r7 * F[2]) / (m * (1 + ADDED_MASS[1] * subRatio));
    const fz = (r2 * F[0] + r5 * F[1] + r8 * F[2]) / (m * (1 + ADDED_MASS[2] * subRatio));
    V[0] += (r0 * fx + r1 * fy + r2 * fz) * h;
    V[1] += (r3 * fx + r4 * fy + r5 * fz) * h;
    V[2] += (r6 * fx + r7 * fy + r8 * fz) * h;
    P[0] += V[0] * h;
    P[1] += V[1] * h;
    P[2] += V[2] * h;
    // angular: Euler's equations in the body frame
    const tx = r0 * T[0] + r3 * T[1] + r6 * T[2];
    const ty = r1 * T[0] + r4 * T[1] + r7 * T[2];
    const tz = r2 * T[0] + r5 * T[1] + r8 * T[2];
    let ox = r0 * W[0] + r3 * W[1] + r6 * W[2];
    let oy = r1 * W[0] + r4 * W[1] + r7 * W[2];
    let oz = r2 * W[0] + r5 * W[1] + r8 * W[2];
    const lx = I[0] * ox, ly = I[1] * oy, lz = I[2] * oz;
    const gx = oy * lz - oz * ly, gy = oz * lx - ox * lz, gz = ox * ly - oy * lx;
    ox += ((tx - gx) / (I[0] * (1 + ADDED_INERTIA[0] * subRatio))) * h;
    oy += ((ty - gy) / (I[1] * (1 + ADDED_INERTIA[1] * subRatio))) * h;
    oz += ((tz - gz) / (I[2] * (1 + ADDED_INERTIA[2] * subRatio))) * h;
    const wx = r0 * ox + r1 * oy + r2 * oz;
    const wy = r3 * ox + r4 * oy + r5 * oz;
    const wz = r6 * ox + r7 * oy + r8 * oz;
    W[0] = wx;
    W[1] = wy;
    W[2] = wz;
    // q̇ = ½ ω ⊗ q
    const qx = Q[0], qy = Q[1], qz = Q[2], qw = Q[3];
    const k = 0.5 * h;
    const nx = qx + k * (qw * wx + wy * qz - wz * qy);
    const ny = qy + k * (qw * wy + wz * qx - wx * qz);
    const nz = qz + k * (qw * wz + wx * qy - wy * qx);
    const nw = qw - k * (wx * qx + wy * qy + wz * qz);
    const n = Math.hypot(nx, ny, nz, nw);
    Q[0] = nx / n;
    Q[1] = ny / n;
    Q[2] = nz / n;
    Q[3] = nw / n;
  }

  /** Copy a state into the working arrays, as the centre of gravity's motion. */
  function load(state) {
    const q = state.quaternion ?? [0, 0, 0, 1];
    const p = state.position ?? [0, 0, 0];
    const v = state.velocity ?? [0, 0, 0];
    const w = state.spin ?? [0, 0, 0];
    boomAt = Number.isFinite(state.boom) ? state.boom : NaN;
    if (crew) crewAt = Number.isFinite(state.crew) ? state.crew : NaN;
    if (head0) jibAt = Number.isFinite(state.jib) ? state.jib : NaN;
    Q[0] = q[0];
    Q[1] = q[1];
    Q[2] = q[2];
    Q[3] = q[3];
    W[0] = w[0];
    W[1] = w[1];
    W[2] = w[2];
    rotation();
    const ax = R[0] * CG[0] + R[1] * CG[1] + R[2] * CG[2];
    const ay = R[3] * CG[0] + R[4] * CG[1] + R[5] * CG[2];
    const az = R[6] * CG[0] + R[7] * CG[1] + R[8] * CG[2];
    P[0] = p[0] + ax;
    P[1] = p[1] + ay;
    P[2] = p[2] + az;
    V[0] = v[0] + W[1] * az - W[2] * ay;
    V[1] = v[1] + W[2] * ax - W[0] * az;
    V[2] = v[2] + W[0] * ay - W[1] * ax;
  }

  /** The working arrays as a new state of the body origin. */
  function store(t, acc) {
    rotation();
    const ax = R[0] * CG[0] + R[1] * CG[1] + R[2] * CG[2];
    const ay = R[3] * CG[0] + R[4] * CG[1] + R[5] * CG[2];
    const az = R[6] * CG[0] + R[7] * CG[1] + R[8] * CG[2];
    const out = {
      position: [P[0] - ax, P[1] - ay, P[2] - az],
      quaternion: [Q[0], Q[1], Q[2], Q[3]],
      velocity: [V[0] - (W[1] * az - W[2] * ay), V[1] - (W[2] * ax - W[0] * az), V[2] - (W[0] * ay - W[1] * ax)],
      spin: [W[0], W[1], W[2]],
      t,
      acc,
      boom: boomAt,
    };
    if (crew) out.crew = crewAt;
    if (head0) out.jib = jibAt;
    return out;
  }

  return {
    spec,
    /** her moments of inertia about her centre of gravity (kg·m², body axes: pitch, yaw, roll), without added mass */
    inertia: [I[0], I[1], I[2]],
    /** her centre of gravity in the body frame */
    cg: [CG[0], CG[1], CG[2]],
    /** hull speed (m/s): 1.34·√(LWL in feet) knots */
    hullSpeed: 1.34 * Math.sqrt(L / 0.3048) * 0.514444,

    /**
     * Floating level with its waterline at sea level, still.
     * `yaw` is the rotation about +Y (the object's), so the heading is −yaw.
     * @returns {ShipState}
     */
    rest({ position = [0, 0, 0], yaw = 0, t = 0 } = {}) {
      return {
        position: [position[0] ?? 0, 0, position[2] ?? 0],
        quaternion: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        velocity: [0, 0, 0],
        spin: [0, 0, 0],
        t,
        acc: 0,
      };
    },

    /**
     * Advance by dt, in whole 1/120 s substeps; the remainder is carried in
     * `acc` to the next call.
     * @param {ShipState} state
     * @param {ShipControls} controls
     * @param {ShipEnv} env
     * @param {number} dt
     * @returns {ShipState}
     */
    step(state, controls = {}, env = {}, dt = 0) {
      let acc = (state.acc ?? 0) + Math.max(0, dt);
      let n = Math.floor(acc / SUBSTEP + 1e-6);
      acc = Math.max(0, acc - n * SUBSTEP);
      if (acc < 1e-9) acc = 0;
      if (n > MAX_SUBSTEPS) n = MAX_SUBSTEPS;
      const water = env.water ?? CALM;
      const wind = env.wind ?? STILL;
      const c = controls ?? {};
      load(state);
      let t = state.t ?? 0;
      for (let i = 0; i < n; i++) {
        forces(t, c, water, wind);
        integrate(SUBSTEP);
        boomAt += clamp(boomGoal - boomAt, -BOOM_RATE * SUBSTEP, BOOM_RATE * SUBSTEP);
        if (crew) crewAt += clamp(crewGoal - crewAt, -CREW_RATE * SUBSTEP, CREW_RATE * SUBSTEP);
        if (head0) jibAt += clamp(jibGoal - jibAt, -JIB_RATE * SUBSTEP, JIB_RATE * SUBSTEP);
        t += SUBSTEP;
      }
      return store(t, acc);
    },

    /**
     * The forces and moments on her at a state, with no integration: the
     * sum `step` would integrate in its first substep, except that the boom
     * is where the wind and the sheet put it (its goal), not where its
     * swing has got to. Gravity, buoyancy, resistance, foils, sail, windage
     * and the anchor, all in the world frame: `force` (N), `torque` (N·m)
     * about her centre of gravity `cg` (world), and her weight (N). A rig
     * contract's crew sit at `pose.crew` (−1..1 of their arm, + starboard,
     * as the state's) if it's given, else where the wind and her heel put
     * them; `crew` says where that was. Its headsails are at `pose.jib` (as
     * the state's) if it's given, else at their goal, as the boom; `jib`
     * says where that was.
     * @param {{ position: number[], quaternion: number[], t?: number, crew?: number, jib?: number }} pose  her body origin's
     * @param {{ velocity?: number[], spin?: number[] }} [motion]  the body origin's velocity, world spin
     * @param {ShipControls} [controls]
     * @param {ShipEnv} [env]
     */
    wrench(pose, motion = {}, controls = {}, env = {}) {
      load({ position: pose.position, quaternion: pose.quaternion, velocity: motion?.velocity, spin: motion?.spin, crew: pose.crew, jib: pose.jib });
      forces(pose.t ?? 0, controls ?? {}, env.water ?? CALM, env.wind ?? STILL);
      const out = {
        force: [F[0], F[1], F[2]],
        torque: [T[0], T[1], T[2]],
        cg: [P[0], P[1], P[2]],
        boom: boomAt,
        weight: m * G,
      };
      if (crew) out.crew = crewAt;
      if (head0) out.jib = jibAt;
      return out;
    },

    /**
     * What a sailor would read off the boat: speed through the water
     * (forward, m/s; negative going astern), heading (0 = −Z, increasing
     * toward +X), heel (+ starboard down), pitch (+ bow up), leeway (the
     * angle between the bow and the way the hull moves through the water,
     * + sliding to starboard), the apparent wind's speed and the angle it
     * comes from (+ from starboard), the boom's angle (+ out to starboard),
     * the sail's force (N) and how much of the hull is under water (0..1).
     * @param {ShipState} state
     * @param {ShipControls} controls
     * @param {ShipEnv} env
     */
    read(state, controls = {}, env = {}) {
      load(state);
      forces(state.t ?? 0, controls ?? {}, env.water ?? CALM, env.wind ?? STILL);
      // the bow (−Z) and starboard (+X) in the world
      const fx = -R[2], fy = -R[5], fz = -R[8];
      const sy = R[3];
      const speed = diag.surge;
      const sway = diag.sway;
      return {
        speed,
        heading: Math.atan2(fx, -fz),
        heel: Math.asin(clamp(-sy, -1, 1)),
        pitch: Math.asin(clamp(fy, -1, 1)),
        leeway: Math.hypot(speed, sway) > 0.05 ? Math.atan2(sway, Math.abs(speed)) : 0,
        apparentWind: { speed: diag.awSpeed, angle: diag.awAngle },
        boom: diag.boom,
        sailForce: diag.sailForce,
        submerged: diag.submerged,
        ...(crew ? { crew: crewAt } : null),
        ...(head0 ? { jib: jibAt } : null),
        ...(cres ? { planing: diag.planing } : null),
      };
    },
  };
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Smoothstep: 0 at lo, 1 at hi, S = t²(3 − 2t) between (§6.2's S). */
function smooth(x, lo, hi) {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}
