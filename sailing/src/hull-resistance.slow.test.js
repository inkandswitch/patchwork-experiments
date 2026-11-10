// On a sea: a contract sloop and the stock sloop sailed 45 s each, on flat
// water and on a seeded sea (the slow tier).
import { describe, it, expect } from "vitest";
import { createShip } from "./physics.js";
import { contractShip, windFrom } from "./test/agreement-harness.js";
import { createOcean } from "./ocean.js";
import sloop from "./test/rig-contract/sloop-12m.json";

const shipOf = (c) => contractShip(c);

describe("on a sea", () => {
  it("a contract sloop keeps as much of her flat-water speed on a seeded sea as the stock sloop does (45 s, 11 kn, 45° off the wind)", () => {
    const DEG = Math.PI / 180;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const keep = (ship) => {
      const speed = (water) => {
        const env = { wind: windFrom(5.66, 45), ...(water ? { water } : null) };
        let s = { ...ship.rest(), velocity: [0, 0, -2] };
        const c = { sail: 1, sheet: 0.15, rudder: 0 };
        let sum = 0, k = 0;
        for (let i = 0; i < 45 * 30; i++) {
          const d = ship.read(s, c, env);
          c.rudder = Math.max(-1, Math.min(1, 2 * wrap(0 - d.heading) + 4 * s.spin[1]));
          if (i >= 30 * 30) (sum += d.speed), k++;
          s = ship.step(s, c, env, 1 / 30);
        }
        return sum / k;
      };
      return speed(createOcean({ wind: { speed: 5.66, from: 45 }, seed: 4242 })) / speed(null);
    };
    const stock = keep(createShip());
    const contract = keep(shipOf(sloop));
    expect(stock).toBeGreaterThan(0.7);
    expect(contract).toBeGreaterThan(stock);
  }, 120000);
});
