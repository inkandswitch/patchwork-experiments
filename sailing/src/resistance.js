// A rig contract's resistance (§6.5 of patchwork-rig v1), read for the
// 120 Hz loop: everything is unpacked once into typed arrays, and nothing
// below allocates. Pure. Only a ship whose spec carries a contract with a
// computed resistance (spec.rig.resistance) flies this; every other ship
// keeps physics.js's own friction and wave terms.
//
// The contract samples the canoe body's resistance R(V, φ) with no side
// force (`hullN[φ][V]`: ITTC-57 friction on the heeled wetted skin, the
// DSYHS upright and heel residuary, and Savitsky's planing blended in by
// §6.5.7's weight). It is read as §6.5 "The table" says a consumer that
// can't evaluate the formulas in its loop should: bilinear in (V, φ), V²
// below the first speed, the last heel row held past it. Past the last
// speed the contract states nothing; this holds the last segment's trend
// (never falling), so a boat driven past her table (surfing, a gust on the
// plane) still meets more water the faster she goes. The appendages' skin
// friction is the foils' own (physics.js, §6.5.4); the induced drag of the
// whole side force (§6.5.5) is `effectiveDraft`'s.

const G = 9.80665;

/**
 * The contract's resistance at her scale (rig-contract.js bodyRig: speeds
 * by √k and forces by k³, Froude's scaling, which friction doesn't quite
 * obey: bodyRig warns when k isn't 1), or null when it states none.
 * - `hull(V, heelDeg)`: the canoe body's R (N) at V (m/s), heeled |φ|;
 * - `planing(V)`: §6.5.7's planing weight w there (0 a displacement hull, up to the hull's capability);
 * - `effectiveDraft(V)`: T_e upright (§6.5.5), so R_i = Y²/(π·T_e²·q) for a side force Y in her heeled plane;
 * - `lwl`, `vLast` (her table's last speed), `capability`.
 * @param {object} rig  spec.rig
 */
export function contractResistance(rig) {
  const R = rig?.resistance;
  if (!R || R.status !== "computed") return null;
  const speeds = R.speedsMs, heels = R.heelsDeg, table = R.hullN;
  if (!Array.isArray(speeds) || speeds.length < 2 || !Array.isArray(table) || !Array.isArray(heels) || table.length !== heels.length || !heels.length) return null;
  const k = rig.scale > 0 ? rig.scale : 1;
  const sv = Math.sqrt(k), sf = k * k * k;
  const nv = speeds.length, nh = heels.length;
  const vs = Float64Array.from(speeds, (v) => v * sv);
  const hs = Float64Array.from(heels);
  const rows = table.map((r) => Float64Array.from(r, (x) => x * sf));
  if (!rows.every((r) => r.length === nv && r.every(Number.isFinite))) return null;
  const pw = Array.isArray(R.planingWeight) && R.planingWeight.length === nv ? Float64Array.from(R.planingWeight, (w) => (Number.isFinite(w) ? w : 0)) : null;

  const H = rig.hull;
  const lwl = H.lwlM;
  const sqrtGL = Math.sqrt(G * lwl);
  // §6.5.5: T_e = T·(A1·r + A2·r² + A3·BWL/Tc + A4·TR)·(B0 + B1·Fn), r = min(1, Tc/T), T_e ≥ 0.1·T
  const ind = R.induced ?? {};
  const te = R.coefficients?.teUpright;
  const T = (ind.draftM ?? NaN) * k;
  const hasTe = Array.isArray(te) && te.length === 6 && te.every(Number.isFinite) && T > 0 && H.tcM > 0;
  const taper = Number.isFinite(ind.keelTaper) ? ind.keelTaper : 0.5;
  const teBase = hasTe ? T * (te[0] * Math.min(1, H.tcM / T) + te[1] * Math.min(1, H.tcM / T) ** 2 + te[2] * (H.bwlM / H.tcM) + te[3] * taper) : NaN;

  /** The index i with vs[i] ≤ V < vs[i + 1] (V inside the table). */
  function seg(V) {
    let lo = 0, hi = nv - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (vs[mid] <= V) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** One heel row of the table at V. */
  function rowAt(r, V, i) {
    if (V <= vs[0]) return r[0] * (V / vs[0]) * (V / vs[0]);
    if (V >= vs[nv - 1]) {
      const slope = (r[nv - 1] - r[nv - 2]) / (vs[nv - 1] - vs[nv - 2]);
      return r[nv - 1] + (slope > 0 ? slope : 0) * (V - vs[nv - 1]);
    }
    const t = (V - vs[i]) / (vs[i + 1] - vs[i]);
    return r[i] + t * (r[i + 1] - r[i]);
  }

  return {
    lwl,
    vLast: vs[nv - 1],
    capability: R.planing?.capability ?? 0,
    hull(V, heelDeg) {
      if (!(V > 0)) return 0;
      const i = V > vs[0] && V < vs[nv - 1] ? seg(V) : 0;
      let h = heelDeg < 0 ? -heelDeg : heelDeg;
      if (h <= hs[0] || nh === 1) return rowAt(rows[0], V, i);
      if (h >= hs[nh - 1]) return rowAt(rows[nh - 1], V, i);
      let j = 0;
      while (j < nh - 2 && hs[j + 1] < h) j++;
      const t = (h - hs[j]) / (hs[j + 1] - hs[j]);
      const a = rowAt(rows[j], V, i);
      return a + t * (rowAt(rows[j + 1], V, i) - a);
    },
    planing(V) {
      if (!pw || !(V > vs[0])) return 0;
      if (V >= vs[nv - 1]) return pw[nv - 1];
      const i = seg(V);
      return pw[i] + ((V - vs[i]) / (vs[i + 1] - vs[i])) * (pw[i + 1] - pw[i]);
    },
    effectiveDraft(V) {
      if (!hasTe) return NaN;
      const fn = V / sqrtGL;
      const t = teBase * (te[4] + te[5] * (fn < 0 ? 0 : fn > 0.75 ? 0.75 : fn));
      return t > 0.1 * T ? t : 0.1 * T;
    },
  };
}
