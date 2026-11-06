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
// remainder, so any frame rate gives the same motion.

import { buildHull, mergeSpec, SLOOP, specFromBox } from "./hull-model.js";
import { liftSlope, foilCL, foilCD, sailCL, sailCD } from "./physics-foils.js";

export { SLOOP, specFromBox };

export const SUBSTEP = 1 / 120;
// after a stall (a hidden tab) don't try to catch up more than this
const MAX_SUBSTEPS = 30;

const G = 9.81;
const RHO = 1025;
const RHO_AIR = 1.225;
const NU = 1.19e-6; // sea water's kinematic viscosity
const DEG = Math.PI / 180;
const RUDDER_MAX = 35 * DEG;
const BOOM_IN = 5 * DEG;
const BOOM_OUT = 85 * DEG;
const CE_HEIGHT = 0.38; // up the luff

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
const ADDED_MASS = [0.6, 0.8, 0.05];
const ADDED_INERTIA = [0.8, 0.5, 0.3];

/**
 * @typedef {{ position: number[], quaternion: number[], velocity: number[], spin: number[], t: number, acc?: number }} ShipState
 * `velocity` is the body origin's, `spin` the world angular velocity; `acc`
 * is time owed to the integrator, less than one substep.
 * @typedef {{ rudder?: number, sail?: number, sheet?: number, anchor?: null | { at: number[], rode: number } }} ShipControls
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
  // ballasted to float on its lines: the centre of gravity is over the centre of buoyancy
  const CG = [cb[0], spec.cg ?? SLOOP.cg * (spec.draft / SLOOP.draft), cb[2]];

  // inertia of a box thinned toward its ends, and the mast up high
  const hb = spec.draft + spec.freeboard;
  const B = spec.beam;
  const I = [
    (m * 0.8 * (hb * hb + L * L)) / 12, // pitch
    (m * 0.8 * (B * B + L * L)) / 12, // yaw
    (m * (B * B + hb * hb)) / 12, // roll
  ];
  {
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
  const anchorC = 2.0 * m;
  const sqrtGL = Math.sqrt(G * L);

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
  const diag = { boom: 0, awSpeed: 0, awAngle: 0, sailForce: 0, submerged: 0, surge: 0, sway: 0 };
  let subRatio = 0;

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

  /** The sum of forces and torques about the centre of gravity, into F and T. */
  function forces(t, controls, water, wind) {
    rotation();
    const r0 = R[0], r1 = R[1], r2 = R[2], r3 = R[3], r4 = R[4], r5 = R[5], r6 = R[6], r7 = R[7], r8 = R[8];
    const px = P[0], py = P[1], pz = P[2];
    const vx = V[0], vy = V[1], vz = V[2];
    const w0 = W[0], w1 = W[1], w2 = W[2];
    F[0] = F[2] = T[0] = T[1] = T[2] = 0;
    F[1] = -m * G;

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
        const fy = -(HEAVE_LINEAR + 0.5 * RHO * HEAVE_CD * Math.abs(uy)) * a * uy;
        const sa = C.side[i] * depth;
        const fx = -(SWAY_LINEAR + 0.5 * RHO * SWAY_CD * Math.abs(ux)) * sa * ux;
        apply(r0 * fx + r1 * fy, r3 * fx + r4 * fy, r6 * fx + r7 * fy, kx, ky, kz);
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
        const f = -(u > 0 ? 1 : -1) * (friction + waves);
        apply(r2 * f, r5 * f, r8 * f, ax, ay, az);
      }
    }

    // Keel and rudder: foils in the water flowing past them
    for (let k = 0; k < 2; k++) {
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
      // where the boom would lie if let go (amidships in a flat calm)
      const free = ux * ux + uz * uz > 1e-4 ? Math.atan2(ux, uz) : 0;
      const limit = BOOM_IN + (BOOM_OUT - BOOM_IN) * clamp(controls.sheet ?? 0.5, 0, 1);
      const boom = free >= 0 ? Math.min(free, limit) : Math.max(free, -limit);
      diag.boom = boom;
      diag.awSpeed = Math.hypot(ux, uz);
      diag.awAngle = Math.atan2(-ux, uz);
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
        const pull = Math.max(0, anchorK * over + anchorC * out);
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
    return {
      position: [P[0] - ax, P[1] - ay, P[2] - az],
      quaternion: [Q[0], Q[1], Q[2], Q[3]],
      velocity: [V[0] - (W[1] * az - W[2] * ay), V[1] - (W[2] * ax - W[0] * az), V[2] - (W[0] * ay - W[1] * ax)],
      spin: [W[0], W[1], W[2]],
      t,
      acc,
    };
  }

  return {
    spec,
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
        t += SUBSTEP;
      }
      return store(t, acc);
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
      };
    },
  };
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}
