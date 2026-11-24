// The contract is enough: a consumer that composes forces by §6 from the
// contract alone (contract/v1/reference/compose.js, which imports nothing
// of the aid) finds every unflagged predicted point of every contract
// fixture in balance. This is the agreement test sailing's physics will run
// against its own force code; here it proves that the spec and the
// contract state everything the aid's VPP used.
//
// The fixtures hold numbers to 9 significant digits, so the residuals are
// that rounding, not zero: they are held to 1e-5 of ½ρ_air·TWS²·A (forces)
// and of that × LWL (moments). With the hull's resistance read from the
// contract's R(V, φ) table instead of the formulas, the residual is the
// table's interpolation error, printed and held to 2% of the force scale.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { composer } from "../contract/v1/reference/compose.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../contract/v1/fixtures/valid");
const read = (f) => JSON.parse(readFileSync(resolve(ROOT, f), "utf8"));
const TOL = 1e-5;

describe("§6 from the contract alone balances the aid's predictions", () => {
  for (const id of ["sloop-12m", "catalina-30", "j24", "laser-ilca7", "cuvature-first-guess"])
    it(id, () => {
      const c = read(`${id}.json`);
      const k = composer(c);
      const kt = composer(c, { resistanceFromTable: true });
      const pts = [...c.predicted.points, ...c.predicted.beat, ...c.predicted.run, c.predicted.reference].filter((p) => p && p.ok && !p.hollow);
      expect(pts.length).toBeGreaterThan(20);
      let worst = { v: 0 }, worstTable = 0, planing = 0, upright = 0;
      for (const p of pts) {
        const r = k.residuals(p);
        if (r.roll == null) upright++;
        if (p.planingWeight > 0) planing++;
        for (const key of ["surge", "sway", "roll", "yaw"]) {
          const v = Math.abs(r[key] ?? 0);
          if (v > worst.v) worst = { v, key, p };
          expect(v, `${id} ${key} at ${p.twsKn.toFixed(0)} kn ${p.twaDeg}°`).toBeLessThan(TOL);
        }
        const rt = kt.residuals(p);
        worstTable = Math.max(worstTable, Math.abs(rt.surge));
      }
      console.log(
        `  ${id}: ${pts.length} unflagged points (${planing} with planing in the blend, ${upright} upright): worst residual ${worst.v.toExponential(2)} (${worst.key}, ${worst.p?.twsKn.toFixed(0)} kn ${worst.p?.twaDeg?.toFixed(1)}°); surge with the hull's R from the table: ${worstTable.toExponential(2)}`,
      );
      expect(worstTable).toBeLessThan(0.02);
    });

  it("the Laser's planing points (flagged only because Savitsky runs outside his tested trims) balance too: the planing blend is stated exactly", () => {
    const c = read("laser-ilca7.json");
    const k = composer(c);
    const pts = [...c.predicted.points, ...c.predicted.beat, ...c.predicted.run].filter((p) => p.ok && p.planingWeight > 0 && p.flags.every((f) => f.id === "planing-range" || f.id === "dsyhs"));
    expect(pts.length).toBeGreaterThan(10);
    let worst = 0;
    for (const p of pts) {
      const r = k.residuals(p);
      for (const key of ["surge", "sway", "roll", "yaw"]) worst = Math.max(worst, Math.abs(r[key] ?? 0));
    }
    const full = pts.filter((p) => p.planingWeight === 1).length;
    console.log(`  laser planing: ${pts.length} points with Savitsky in the blend (${full} fully planing), worst residual ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(TOL);
  });

  it("flagged points are left out, as §6.7 says, and a flagged point need not balance", () => {
    const c = read("laser-ilca7.json");
    const hollow = c.predicted.points.filter((p) => p.hollow);
    expect(hollow.length).toBeGreaterThan(0);
    for (const p of hollow) expect(p.flags.some((f) => f.id !== "dsyhs")).toBe(true);
  });
});
