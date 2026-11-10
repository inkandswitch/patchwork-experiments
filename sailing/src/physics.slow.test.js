// The polar: a minute of sailing at each of a dozen angles (the slow tier).
import { describe, it, expect } from "vitest";
import { createShip } from "./physics.js";
import { DEG, bestSpeed, speedAt } from "./test/sail-runs.js";

describe("the polar", () => {
  it("zero head to wind, a peak between 70° and 120°, slower running", { timeout: 60000 }, () => {
    const ship = createShip();
    const polar = [];
    for (let twa = 30; twa <= 180; twa += 15) polar.push({ twa, ...bestSpeed(ship, { twa, seconds: 45 }) });
    const head = speedAt(ship, { twa: 0, sheet: 0, seconds: 45 });
    console.log(
      "polar, 8 m/s true wind\n" +
        `   0°  ${head.toFixed(2)} m/s\n` +
        polar
          .map((p) => `${String(p.twa).padStart(4)}°  ${p.speed.toFixed(2)} m/s  sheet ${p.sheet.toFixed(2)}  ${"#".repeat(Math.round(p.speed * 10))}`)
          .join("\n"),
    );
    const peak = polar.reduce((a, b) => (b.speed > a.speed ? b : a));
    expect(head).toBeLessThan(0.2); // no headway: it drifts back
    expect(head).toBeGreaterThan(-0.5); // slowly: about half a knot astern, as a boat in irons does
    // no traveller: she can't point much above 45°, so beating at 30° makes less ground to windward
    const vmg = (twa) => polar.find((p) => p.twa === twa).speed * Math.cos(twa * DEG);
    expect(vmg(30)).toBeLessThan(vmg(45) * 0.95);
    expect(peak.twa).toBeGreaterThanOrEqual(70);
    expect(peak.twa).toBeLessThanOrEqual(120);
    expect(peak.speed).toBeGreaterThan(3);
    // rising from close-hauled to the peak, then not climbing again
    expect(polar[0].speed).toBeLessThan(peak.speed * 0.9);
    expect(polar.at(-1).speed).toBeLessThan(peak.speed);
    for (const p of polar) {
      expect(p.off).toBeLessThan(5 * DEG); // the helmsman held the course: it's the boat at this angle
      expect(p.speed).toBeGreaterThan(0.5);
      expect(p.speed).toBeLessThan(ship.hullSpeed * 1.1);
    }
  });

  it("never much past hull speed, even in 15 m/s of wind", { timeout: 60000 }, () => {
    const ship = createShip();
    let fastest = 0;
    for (const twa of [60, 90, 120, 150]) fastest = Math.max(fastest, bestSpeed(ship, { twa, wind: 15, seconds: 40 }).speed);
    expect(ship.hullSpeed).toBeCloseTo(4.33, 1);
    expect(fastest).toBeGreaterThan(ship.hullSpeed * 0.9);
    expect(fastest).toBeLessThan(ship.hullSpeed * 1.25);
  });
});
