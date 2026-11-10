// The trim read off a sail (trim.js), on the 12 m sloop's main and jib
// families (the stock contract's): each threshold at, just below and just
// above its boundary, each state, the flog and σ exactly, and the belly's
// sign. Finite cases: the boundaries are the model's own constants.
import { describe, it, expect } from "vitest";
import { STATES, TELLTALE_LIFT, streaming, arcLength, burgeeLines, jibSheets, mainsheetSlack, mastheadAir, maxSwingDist, ribbon, rigGeometry, sagOf, sheetCurve, swingCoeffs, swingDist, telltaleOf, trimModelOf, trimOf, vaneAngle, vaneLines } from "./trim.js";
import { rigDrawing } from "./ship.js";
import { JIB_EASED_DEG, stockContract } from "./stock-rig.js";
import { rigSailCoeffs } from "./physics-foils.js";
import { swungCE } from "./rig-sails.js";
import KEPT from "./stock-rig-12m.js";
import { partGLB } from "./ship.js";
import { contractShip, windFrom } from "./test/agreement-harness.js";
import fixture from "./test/rig-contract/sloop-12m.json";

const DEG = Math.PI / 180;
const MAIN = trimModelOf({ model: KEPT.models.main });
const JIB = trimModelOf({ model: KEPT.models.jib, sheeting: { wing: KEPT.models.jib.wing } });
const S = (lo, hi, x) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * A sail as read().sails has it, on starboard tack (its air from
 * starboard, β_e `beta`), its sheet asking for `alphaSheet`, at `alpha`
 * (where it stands: pinned, alpha = alphaSheet; free, alpha0), upwash `up`.
 */
function sail({ main = false, beta = 80, alphaSheet, alpha = alphaSheet, up = 0, area = 10 }) {
  const sheet = beta - alpha - up;
  return { id: main ? "main" : "jib", main, from: beta * DEG, angle: -sheet * DEG, limit: (beta - alphaSheet - up) * DEG, sheet, alpha, area };
}

describe("the thresholds come from the family's constants", () => {
  it("the stock main: alpha0 −4, stall 18, width 22, luff's onset 5, drawing from 9.5, out to 85, never winged; the jib: −5, 20, 30, 5, 10, 30, winged from β 140", () => {
    expect(MAIN).toEqual({ alpha0: -4, stall: 18, width: 22, luffAt: 5, drawAt: 9.5, maxDeg: 85, wingFrom: null });
    expect(JIB).toEqual({ alpha0: -5, stall: 20, width: 30, luffAt: 5, drawAt: 10, maxDeg: 30, wingFrom: 140 });
  });

  it("the stock contract's own sails give the same, but the jib's sheet eases to JIB_EASED_DEG (60°)", () => {
    const rig = JSON.parse(new TextDecoder().decode(partGLB("rig").bytes.subarray(20, 20 + new DataView(partGLB("rig").bytes.buffer).getUint32(12, true)))).scenes[0].extras.rig;
    expect(trimModelOf(rig.sails.find((s) => s.id === "main"))).toEqual(MAIN);
    expect(trimModelOf(rig.sails.find((s) => s.id === "jib"))).toEqual({ ...JIB, maxDeg: JIB_EASED_DEG });
    expect(JIB_EASED_DEG).toBe(60);
  });
});

describe("states, flog, luff and σ (1)", () => {
  // [α_sheet, α where it stands, state]: free below alpha0 (it stands at alpha0), luffing below the
  // luff's onset (alpha0 + ½ stall), soft below drawing (alpha0 + ¾ stall), stalled from σ ½
  const MAIN_CASES = [
    [-6, -4, "luffing"],
    [-4, -4, "luffing"],
    [4.9, 4.9, "luffing"],
    [5, 5, "soft"],
    [9.4, 9.4, "soft"],
    [9.5, 9.5, "drawing"],
    [14, 14, "drawing"],
    [24.9, 24.9, "drawing"],
    [25, 25, "stalled"],
    [36, 36, "stalled"],
  ];
  const JIB_CASES = [
    [-7, -5, "luffing"],
    [-5, -5, "luffing"],
    [4.9, 4.9, "luffing"],
    [5, 5, "soft"],
    [9.9, 9.9, "soft"],
    [10, 10, "drawing"],
    [29.9, 29.9, "drawing"],
    [30, 30, "stalled"],
    [50, 50, "stalled"],
  ];
  for (const [name, k, cases, main] of [["main", MAIN, MAIN_CASES, true], ["jib", JIB, JIB_CASES, false]]) {
    for (const [as, a, state] of cases) {
      it(`${name}: α_sheet ${as}, α ${a} → ${state}, free, flog, luff and σ exactly`, () => {
        const t = trimOf(sail({ main, alphaSheet: as, alpha: a }), k);
        expect(t.state).toBe(state);
        expect(t.alphaSheet).toBeCloseTo(as, 9);
        expect(t.free).toBe(as < k.alpha0);
        const ask = as < k.alpha0 ? as : a;
        expect(t.ask).toBeCloseTo(ask, 9);
        expect(t.flog).toBeCloseTo(Math.min(1, Math.max(0, (k.luffAt - ask) / (k.luffAt - k.alpha0 + k.stall))), 12);
        expect(t.luff).toBeCloseTo(1 - S(k.luffAt, k.drawAt, ask), 12);
        expect(t.sigma).toBeCloseTo(S(k.stall, k.stall + k.width, Math.abs(a - k.alpha0)), 12);
      });
    }
  }

  it("the main's upwash: its α_sheet is β_e − limit − ε, ε read back from β_e − δ_s − α", () => {
    const t = trimOf(sail({ main: true, alphaSheet: 6, up: 3 }), MAIN);
    expect(t.upwash).toBeCloseTo(3, 9);
    expect(t.alphaSheet).toBeCloseTo(6, 9);
  });

  it("flog is 1 a stall angle's worth past alpha0 below the luff's onset, and no more; 0 from the onset up", () => {
    expect(trimOf(sail({ alphaSheet: -25, alpha: -5 }), JIB).flog).toBe(1);
    expect(trimOf(sail({ alphaSheet: -60, alpha: -5 }), JIB).flog).toBe(1);
    expect(trimOf(sail({ alphaSheet: -10, alpha: -5 }), JIB).flog).toBeCloseTo(0.5, 12);
    expect(trimOf(sail({ alphaSheet: 5 }), JIB).flog).toBe(0);
  });

  it("sheet −10 at β_e 30 → backed; sheet −40 at β_e 150 → wing (the jib); the main is never winged; area 0 → down", () => {
    const backed = { id: "jib", main: false, from: 30 * DEG, angle: 10 * DEG, limit: 10 * DEG, sheet: -10, alpha: 40, area: 10 };
    expect(trimOf(backed, JIB).state).toBe("backed");
    const wing = { id: "jib", main: false, from: 150 * DEG, angle: 40 * DEG, limit: 40 * DEG, sheet: -40, alpha: 190, area: 10 };
    expect(trimOf(wing, JIB).state).toBe("wing");
    expect(trimOf({ ...wing, main: true }, MAIN).state).toBe("backed");
    expect(trimOf({ ...backed, area: 0 }, JIB).state).toBe("down");
    expect(STATES).toEqual(["down", "wing", "backed", "luffing", "soft", "stalled", "drawing"]);
  });

  it("backed, pressed full by its air, it neither flogs nor lifts its luff: held to starboard at 18.5° (and 30°), its air from 0°, 3° and 10° (the irons case)", () => {
    for (const limit of [18.5, 30]) {
      for (const from of [0, 3, 10]) {
        // held to starboard (θ +), its air from `from` on the starboard side: δ_s = −limit (to windward), α = β_e + limit
        const t = trimOf({ id: "jib", main: false, from: from * DEG, angle: limit * DEG, limit: limit * DEG, sheet: -limit, alpha: from + limit, area: 10 }, JIB);
        expect(t.state).toBe("backed");
        expect(t.flog).toBe(0);
        expect(t.luff).toBe(0);
      }
    }
  });

  it("stalled with its sheet all the way out (its maxDeg) is atStop; anywhere short of it, or any other state, isn't", () => {
    const k = { ...JIB, maxDeg: 60 };
    // β_e 100, the sheet at 60°: α 40, σ ≥ ½
    expect(trimOf(sail({ beta: 100, alphaSheet: 40 }), k)).toMatchObject({ state: "stalled", atStop: true });
    expect(trimOf(sail({ beta: 100, alphaSheet: 41 }), k)).toMatchObject({ state: "stalled", atStop: false });
    expect(trimOf(sail({ beta: 75, alphaSheet: 15 }), k)).toMatchObject({ state: "drawing", atStop: false });
  });

  it("writes into the object it's given, and returns it", () => {
    const out = {};
    expect(trimOf(sail({ alphaSheet: 10 }), JIB, out)).toBe(out);
  });
});

describe("the cues on the lift curve: the luff's onset and both telltales streaming (1)", () => {
  // the stock contract's own sails, their lift slope and family's constants, as the physics flies them (rigSailCoeffs)
  const rig = stockContract(rigDrawing());
  for (const id of ["main", "jib"]) {
    const s = rig.sails.find((x) => x.id === id);
    const k = trimModelOf(s);
    const CL = (a) => rigSailCoeffs([0, 0], s.model, s.liftSlope, a, 15)[0];
    it(`${id}: CL at the luff's onset (α ${k.luffAt}) is over half clMax, and the α of its greatest CL has both telltales streaming`, () => {
      expect(CL(k.luffAt)).toBeGreaterThan(0.5 * s.model.clMax);
      // its greatest CL, to 0.01°, over the attached and stalling range
      let best = -Infinity, at = 0;
      for (let a = k.alpha0; a <= k.alpha0 + k.stall + k.width; a += 0.01) {
        const c = CL(a);
        if (c > best) (best = c), (at = a);
      }
      const tr = trimOf(sail({ main: id === "main", alphaSheet: at }), k);
      expect(tr.state).toBe("drawing");
      expect(streaming(telltaleOf({}, tr, true)) && streaming(telltaleOf({}, tr, false))).toBe(true);
      // and the windward one doesn't stream at the luff's onset, the leeward one doesn't once stalled
      expect(streaming(telltaleOf({}, trimOf(sail({ main: id === "main", alphaSheet: k.luffAt }), k), true))).toBe(false);
      expect(streaming(telltaleOf({}, trimOf(sail({ main: id === "main", alphaSheet: k.alpha0 + k.stall + k.width / 2 }), k), false))).toBe(false);
    });
  }
});

describe("the belly's sign (2)", () => {
  const belly = (o, k = JIB) => trimOf({ limit: 0, area: 1, ...o, from: o.from * DEG, angle: o.angle * DEG }, k).belly;
  it("drawing to leeward: to port −1, to starboard +1; backed, inboard; winged, by the formula", () => {
    expect(belly({ from: 40, angle: -10, sheet: 10, alpha: 30 })).toBe(-1); // starboard tack, the jib to port
    expect(belly({ from: -40, angle: 10, sheet: 10, alpha: 30 })).toBe(1); // port tack, to starboard
    expect(belly({ from: 40, angle: 10, sheet: -10, alpha: 50 })).toBe(-1); // backed to starboard: bellied to port, inboard
    expect(belly({ from: -40, angle: -10, sheet: -10, alpha: 50 })).toBe(1);
    expect(belly({ from: 160, angle: 60, sheet: -60, alpha: 220 })).toBeCloseTo(Math.max(-1, Math.min(1, Math.sin((-160 - 60) * DEG) / Math.sin(5 * DEG))), 12);
  });
  it("measured from zero lift: flat at alpha0, to leeward from there on, full |alpha0| past it (the air 40° from starboard, pressed at its sheet)", () => {
    for (const [alpha, want] of [[-5, 0], [-3, -Math.sin(2 * DEG) / Math.sin(5 * DEG)], [-1, -Math.sin(4 * DEG) / Math.sin(5 * DEG)], [0, -1], [2, -1], [20, -1]]) {
      const b = belly({ from: 40, angle: -(40 - alpha), sheet: 40 - alpha, alpha });
      expect(b).toBeCloseTo(want, 12);
      expect(b).toBeLessThanOrEqual(0); // never to windward while it draws or luffs
    }
  });
});

describe("on the physics' own read: free is exactly 'not pinned', and a free sail lies at zero lift (P1)", () => {
  const ship = contractShip(fixture);
  const geo = rigGeometry(fixture);
  const readOf = (fromDeg, controls) => ship.read(ship.rest(), { sail: 1, furl: 0, ...controls }, { wind: windFrom(6, fromDeg) });
  it("the jib: eased past its air it lies free (CL 0) and reads luffing, flogging; pinned it isn't free; at every whole degree of wind 5°–60°", () => {
    for (let from = 5; from <= 60; from++) {
      for (const jibSheet of [0, 0.25, 0.5, 1]) {
        const j = readOf(from, { jibSheet }).sails.find((x) => x.id === "jib");
        const pinned = Math.abs(Math.abs(j.angle) - j.limit) < 1e-9;
        const t = trimOf(j, JIB);
        expect(t.free, `${from}° sheet ${jibSheet}`).toBe(!pinned);
        if (t.free) {
          expect(t.state).toBe("luffing");
          expect(t.flog).toBeGreaterThan(0);
          expect(Math.abs(j.cl)).toBeLessThan(1e-9);
        }
      }
    }
  });
  it("the main eased to its stop with the jib drawing: free exactly when its sheet is slack, and then it lies at its zero-lift angle, its upwash counted (|CL| < 1e-9)", () => {
    let free = 0;
    for (let from = 25; from <= 120; from += 5) {
      for (const sheet of [0.3, 0.6, 0.8, 1]) {
        const r = readOf(from, { sheet, jibSheet: 0.3 });
        const m = r.sails.find((x) => x.main);
        const t = trimOf(m, MAIN);
        const slack = mainsheetSlack(geo.main, m.angle, m.limit);
        expect(slack > 0, `${from}° sheet ${sheet}`).toBe(t.free);
        if (t.free) {
          free++;
          expect(m.upwash).toBeGreaterThan(0);
          expect(m.alpha).toBeCloseTo(MAIN.alpha0, 9);
          expect(Math.abs(m.cl)).toBeLessThan(1e-9);
          expect(t.state).toBe("luffing");
        }
      }
    }
    expect(free).toBeGreaterThan(5);
  });
});

// ─── the visuals' geometry (trim.js), on the stock sloop's contract ────────

const STOCK = rigGeometry(stockContract(rigDrawing()));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("the rig's geometry for the visuals", () => {
  it("the stock contract's: a main swung about the rig's Y from the gooseneck, its sheet point 0.95 E aft; a jib with leads both sides; the masthead", () => {
    const { main, jib, masthead } = STOCK;
    expect(main.axis[0]).toBeCloseTo(0, 12);
    expect(main.axis[1]).toBeCloseTo(1, 12);
    expect(main.pivot).toEqual(rigDrawing().boom.gooseneck);
    expect(main.traveller[0]).toBeCloseTo(0, 12);
    expect(main.traveller[2]).toBeGreaterThan(main.pivot[2]);
    expect(jib.leads.port.length).toBe(4);
    expect(jib.leads.port[0].at[0]).toBeLessThan(0);
    expect(jib.leads.starboard[0].at[0]).toBeGreaterThan(0);
    expect(jib.travel).toBeGreaterThanOrEqual(85 * DEG);
    expect(masthead).toEqual(rigDrawing().mast.head);
  });

  it("swingCoeffs is exact: A + B cos θ + C sin θ is the squared distance of the point swung by swungCE", () => {
    const k = new Float64Array(3);
    const X = [0.4, 1.1, 2.6];
    swingCoeffs(k, STOCK.jib.pivot, STOCK.jib.axis, STOCK.jib.clew, X);
    for (let deg = -170; deg <= 170; deg += 17) {
      const p = swungCE([0, 0, 0], { pivot: STOCK.jib.pivot, axis: STOCK.jib.axis }, STOCK.jib.clew, deg * DEG);
      expect(swingDist(k, deg * DEG)).toBeCloseTo(dist(p, X), 9);
    }
    // the largest over a range is the sampled one's upper bound, and is reached
    let most = 0;
    for (let d = -60; d <= 60; d += 0.01) most = Math.max(most, swingDist(k, d * DEG));
    expect(maxSwingDist(k, -60 * DEG, 60 * DEG)).toBeGreaterThanOrEqual(most - 1e-12);
    expect(maxSwingDist(k, -60 * DEG, 60 * DEG) - most).toBeLessThan(1e-6);
  });
});

describe("the mainsheet (3)", () => {
  const k = new Float64Array(3);
  swingCoeffs(k, STOCK.main.pivot, STOCK.main.axis, STOCK.main.boom, STOCK.main.traveller);
  it("d(θ), the traveller to the boom's sheet point, strictly increases at every 0.5° on [0, 85°] (and is even in θ)", () => {
    for (let h = 0; h < 170; h++) {
      expect(swingDist(k, ((h + 1) / 2) * DEG)).toBeGreaterThan(swingDist(k, (h / 2) * DEG));
      expect(swingDist(k, -(h / 2) * DEG)).toBeCloseTo(swingDist(k, (h / 2) * DEG), 12);
    }
  });
  it("s = 0 when the boom is at its sheet's limit, and s > 0 exactly when |θ| < limit, at limits 0, 20, 45, 85°", () => {
    for (const lim of [0, 20, 45, 85]) {
      for (const side of [-1, 1]) {
        expect(mainsheetSlack(STOCK.main, side * lim * DEG, lim * DEG)).toBe(0);
        for (let th = 0; th <= 85; th += 0.5) {
          const s = mainsheetSlack(STOCK.main, side * th * DEG, lim * DEG);
          expect(s > 0, `limit ${lim}, θ ${side * th}`).toBe(th < lim);
          // the spec's L − d(θ), d increasing
          expect(s).toBeCloseTo(Math.max(0, swingDist(k, lim * DEG) - swingDist(k, th * DEG)), 12);
        }
      }
    }
  });
});

describe("the jib's sheets (4)", () => {
  it("the lazy sheet's s ≥ 0 at every whole degree over the jib's travel × furl 0, 0.1, 0.2, 0.3; the working sheet's s = 0 at θ = side·limit", () => {
    const out = {};
    const T = Math.round(STOCK.jib.travel / DEG);
    for (const furl of [0, 0.1, 0.2, 0.3]) {
      for (let th = -T; th <= T; th++) {
        jibSheets(out, STOCK.jib, th * DEG, 20 * DEG, furl);
        const lazy = out.working < 0 ? out.starboard : out.port;
        expect(lazy.s).toBeGreaterThanOrEqual(0);
        // it's never short: its length reaches the clew wherever it is
        expect(out.working).toBe(th < 0 ? -1 : 1);
      }
      // the working sheet: taut at its limit, slack exactly when the jib stands inside it, even inside the lead's own angle (7.2°)
      for (const lim of [5, 7, 12, 30, 60]) {
        for (const side of [-1, 1]) {
          jibSheets(out, STOCK.jib, side * lim * DEG, lim * DEG, furl);
          expect((side < 0 ? out.port : out.starboard).s).toBe(0);
          for (let th = 0; th <= T; th++) {
            jibSheets(out, STOCK.jib, side * th * DEG, lim * DEG, furl);
            const w = side < 0 || th === 0 ? (th === 0 ? out.starboard : out.port) : out.starboard;
            expect(w.s > 0, `furl ${furl} limit ${lim} θ ${side * th}`).toBe(th < lim);
          }
        }
      }
    }
  });

  it("the leads move with the furl (interpolated, clamped to the track's ends)", () => {
    const out = {};
    jibSheets(out, STOCK.jib, 10 * DEG, 10 * DEG, 0);
    const at0 = [...out.starboard.lead];
    jibSheets(out, STOCK.jib, 10 * DEG, 10 * DEG, 0.6);
    const L = STOCK.jib.leads.starboard;
    expect(out.starboard.lead).toEqual(L[L.length - 1].at);
    expect(at0).toEqual(L[0].at);
  });
});

describe("sheetCurve (5)", () => {
  const a = [0, 3, 0], b = [0.4, 0.5, 2.5];
  const down = [0, -1, 0];
  const lengthOf = (pts, n) => {
    let L = 0;
    for (let i = 1; i < n; i++) L += Math.hypot(pts[3 * i] - pts[3 * i - 3], pts[3 * i + 1] - pts[3 * i - 2], pts[3 * i + 2] - pts[3 * i - 1]);
    return L;
  };
  it("straight at s = 0", () => {
    const out = new Float64Array(48);
    expect(sheetCurve(out, 0, a, b, 0, down)).toBe(0);
    const d = dist(a, b);
    expect(lengthOf(out, 16)).toBeCloseTo(d, 12);
  });
  it("its polyline's length is within 1% of d + s for s ≤ 0.3·d; h is monotone in s", () => {
    const d = dist(a, b);
    const out = new Float64Array(48);
    let last = 0;
    for (let i = 1; i <= 30; i++) {
      const s = (i / 100) * d;
      const h = sheetCurve(out, 0, a, b, s, down);
      expect(Math.abs(lengthOf(out, 16) / (d + s) - 1), `s ${s}`).toBeLessThan(0.01);
      expect(h).toBeGreaterThan(last);
      last = h;
    }
    // the parabola itself is exact
    expect(arcLength(d, sagOf(d, 0.2 * d))).toBeCloseTo(1.2 * d, 9);
  });
  it("given a floor, it sags no lower: a lazy sheet's slack lies on deck", () => {
    const out = new Float64Array(48);
    const p = [0, 3, 0], q = [3, 1, 0];
    const free = sheetCurve(out, 0, p, q, 4, down);
    const h = sheetCurve(out, 0, p, q, 4, down, 16, 0.9);
    expect(h).toBeLessThan(free);
    for (let i = 0; i < 16; i++) expect(out[3 * i + 1]).toBeGreaterThanOrEqual(0.9 - 1e-12);
    // a slack that doesn't reach the floor is untouched
    expect(sheetCurve(out, 0, p, q, 0.05, down, 16, 0.9)).toBe(sheetCurve(out, 0, p, q, 0.05, down));
  });
  it("sags straight down, in the vertical plane through its ends", () => {
    const out = new Float64Array(48);
    const p = [0, 2, 0], q = [3, 2, 0];
    sheetCurve(out, 0, p, q, 0.3, down);
    for (let i = 0; i < 16; i++) expect(out[3 * i + 2]).toBeCloseTo(0, 12);
    expect(out[3 * 8 + 1]).toBeLessThan(2);
  });
});

describe("telltales (7)", () => {
  const T = (o) => ({ flog: 0, luff: 0, sigma: 0, state: "drawing", ...o });
  it("the windward one lifts by trim.luff (streaming exactly when it's 0); the leeward one's curl is σ", () => {
    const out = {};
    for (const luff of [0, 0.01, 0.5, 1]) {
      for (const sigma of [0, 0.3, 1]) {
        telltaleOf(out, T({ luff, sigma }), true);
        expect(out.lift === 0).toBe(luff === 0);
        expect(out.lift).toBeCloseTo(luff * TELLTALE_LIFT, 12);
        telltaleOf(out, T({ luff, sigma }), false);
        expect(out.curl).toBe(sigma);
        expect(out.lift).toBe(0);
      }
    }
  });
  it("backed or winged, both sides follow σ", () => {
    const out = {};
    for (const state of ["backed", "wing"]) {
      telltaleOf(out, T({ state, flog: 0.7, luff: 0.7, sigma: 0.4 }), true);
      expect(out).toEqual({ lift: 0, curl: 0.4 });
    }
  });
  it("streaming, a ribbon lies aft along the cloth, its length long; curled at 1 it goes down then forward", () => {
    const out = new Float64Array(9);
    const p = [0, 0, 0], a = [0, 0, 1], n = [1, 0, 0], c = [0, -1, 0];
    ribbon(out, 0, p, a, n, c, 0.25, 0, 0, 1.234);
    expect([...out].map((v) => +v.toFixed(12))).toEqual([0, 0, 0, 0, 0, 0.125, 0, 0, 0.25]);
    ribbon(out, 0, p, a, n, c, 0.25, 0, 1, 0);
    expect(out[4]).toBeCloseTo(-0.125, 12); // down
    expect(out[8]).toBeCloseTo(-0.125, 12); // then forward, back past where it came down
  });
});

describe("the masthead's vane (8)", () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const air = new Float64Array(3);
  it("still, the wind from dead ahead (moving aft, +z): it points at the bow", () => {
    mastheadAir(air, [0, 5], [0, 0, 0], [0, 0, 0], [0, 14, 0]);
    expect(vaneAngle(air, I)).toBeCloseTo(0, 15);
    const out = new Float64Array(18);
    vaneLines(out, 0, [0, 15, 0], air, I, 0.5);
    expect(out[2]).toBeCloseTo(0.25, 12); // tail aft
    expect(out[5]).toBeCloseTo(-0.25, 12); // tip toward the bow (−z)
  });
  it("3 m/s on a heading of 090° in 5 m/s from 000°: the angle of the known vector", () => {
    // world: north −z, east +x; she heads east (her bow, body −z, along world +x); the wind from the north blows toward +z
    const R = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]; // body x → world −z, body z → world +x
    mastheadAir(air, [0, 5], [3, 0, 0], [0, 0, 0], [0, 14, 0]);
    expect([...air]).toEqual([-3, -0, 5]);
    // in her body: u_x = air · (0, 0, −1) = −5, u_z = air · (1, 0, 0) = −3: atan2(5, −3), from her port... starboard bow
    expect(vaneAngle(air, R)).toBeCloseTo(Math.atan2(5, -3), 12);
  });
  it("rolling at 0.2 rad/s swings it by exactly atan(ω·h / V)", () => {
    const h = 14.6, V = 5;
    mastheadAir(air, [0, V], [0, 0, 0], [0, 0, 0.2], [0, h, 0]);
    expect(air[0]).toBeCloseTo(0.2 * h, 12);
    expect(vaneAngle(air, I)).toBeCloseTo(-Math.atan((0.2 * h) / V), 12);
  });
  it("the burgee streams down the true wind and hangs in a calm", () => {
    const out = new Float64Array(12);
    burgeeLines(out, 0, [0, 3, 0], [4, 0]);
    expect(out[9]).toBeGreaterThan(out[3]);
    expect(out[3]).toBeGreaterThan(0);
    burgeeLines(out, 0, [0, 3, 0], [0, 0]);
    expect(out[3]).toBeCloseTo(0, 12);
    expect(out[10]).toBeLessThan(out[4]);
  });
});
