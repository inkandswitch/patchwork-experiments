// Where a hull would float at speed, from a double-body run: its squat force
// and pitching moment against the waterplane's stiffness. Pure.
//
// A double body has no waves, so its forces are the flow's dynamic pressure
// alone (simpleFoam has no gravity): the Bernoulli suction under a hull that
// pulls it down (F_z < 0) and pitches it. Against them, the waterplane:
//
//   sinkage at the LCF   s = −F_z / (ρ g A_WP)        (down positive)
//   trim about the LCF   θ = M_y,LCF / (ρ g I_L)      (bow down positive; GM_L ≈ BM_L = I_L/∇)
//   M_y,LCF = M_y,CofR − (x_CofR − x_LCF) F_z
//
// Linear, and blind to waves: at higher Froude numbers the wave system adds
// sinkage and trims the hull by the stern. It is a first estimate for seeding
// a free-surface run nearer its running attitude, and says so.
import { G, waterProperties } from "./setup.js";

/**
 * @param {object} summary  a finished double-body run's summary (Fz, My, cofrX)
 * @param {object} info     the run's frozen hull info (awp, lcf, il, attitude)
 * @param {object} setup    the run's setup (water, temperature)
 * @returns {{ sinkage: number, trimDeg: number, attitude: { sinkage: number, trim: number, heel: number }, why: string } | null}
 *   sinkage/trimDeg: the change at the LCF; attitude: the hull inputs that put it there
 *   (sinkage and trim as prepareHull takes them, added to the run's own)
 */
export function runningAttitude(summary, info, setup) {
  if (!summary || summary.mode !== "double-body") return null;
  const { awp, lcf, il } = info ?? {};
  if (!(awp > 0) || !(il > 0) || !Number.isFinite(lcf) || !Number.isFinite(summary.Fz)) return null;
  const { rho } = waterProperties(setup?.water, setup?.temperature);
  const s = -summary.Fz / (rho * G * awp);
  const My = Number.isFinite(summary.My) ? summary.My - (summary.cofrX - lcf) * summary.Fz : 0;
  const th = My / (rho * G * il);
  // prepareHull trims about the as-drawn mid-length (pivotX), then lowers: trimming
  // there by θ moves the LCF down by (x_LCF − pivotX)·sin θ, which the sinkage makes up
  const pivotX = info.attitude?.pivotX ?? lcf;
  const base = { sinkage: info.attitude?.sinkage ?? 0, trim: info.attitude?.trim ?? 0, heel: info.attitude?.heel ?? 0 };
  const dSink = s - (lcf - pivotX) * Math.sin(th);
  return {
    sinkage: s,
    trimDeg: (th * 180) / Math.PI,
    attitude: { sinkage: base.sinkage + dSink, trim: base.trim + (th * 180) / Math.PI, heel: base.heel },
    why: "the double body's dynamic lift and moment on the waterplane's stiffness; linear and without waves",
  };
}
