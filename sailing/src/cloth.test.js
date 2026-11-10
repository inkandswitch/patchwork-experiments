// The cloth (cloth.js) as the GLB draws it and as each view rewrites it
// (DESIGN.md "Trim feedback" §4, finite case 6): the file is the function at
// neutral trim, bit for bit; the reef's and the furl's outlines are the
// contract's own areas; no flog, no flutter; the flutter never goes past
// its amplitude; the clew vertex is where the jib's sheet is made fast.
import { describe, it, expect } from "vitest";
import { parseGLB } from "./glb.js";
import { partGLB, rigDrawing } from "./ship.js";
import { stockContract } from "./stock-rig.js";
import { furled } from "./rig-sails.js";
import { toBody } from "./rig-contract.js";
import { trimModelOf, trimOf } from "./trim.js";
import { BUBBLE, NEUTRAL, FLAT, battenCount, battenVertices, clothCount, clothNormals, clothVertices, outlineArea } from "./cloth.js";

/** A GLB's extras, and its named node's primitives' positions (Float32Array each). */
function glbOf(kind) {
  const { json, bin } = parseGLB(partGLB(kind).bytes);
  const positions = (name) => {
    const node = json.nodes.find((n) => n.name === name);
    return json.meshes[node.mesh].primitives.map((p) => {
      const a = json.accessors[p.attributes.POSITION];
      const v = json.bufferViews[a.bufferView];
      const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
      return new Float32Array(bin.buffer.slice(off, off + a.count * 12));
    });
  };
  return { extras: json.scenes[0].extras, positions };
}

const DEG = Math.PI / 180;
const rig = glbOf("rig");
const jib = glbOf("jib");
const MAIN = rig.extras.sail.cloth;
const JIB = jib.extras.sail.cloth;
const contract = stockContract(rigDrawing());
const sailOf = (id) => contract.sails.find((s) => s.id === id);
const look = (o) => ({ ...NEUTRAL, ...o });
const verts = (cloth, l, t = 0) => clothVertices(new Float64Array(clothCount(cloth) * 3), cloth, l, t);

describe("the GLB's cloth is clothVertices at neutral trim (6)", () => {
  it("the main's Sail node and the jib's Jib node, bit for bit, from the cloth their own extras state", () => {
    expect(MAIN.rows).toBe(26);
    expect(MAIN.cols).toBe(12);
    expect(JIB.rows).toBe(20);
    expect(JIB.cols).toBe(10);
    expect(rig.positions("Sail")[0]).toEqual(Float32Array.from(verts(MAIN, NEUTRAL)));
    expect(jib.positions("Jib")[0]).toEqual(Float32Array.from(verts(JIB, NEUTRAL)));
  });

  it("the battens are ribbons on rows 6, 11, 16 and 21 from the cloth's own vertices", () => {
    expect(MAIN.battens.rows).toEqual([6, 11, 16, 21]);
    const v = battenVertices(new Float64Array(battenCount(MAIN) * 3), verts(MAIN, NEUTRAL), MAIN);
    expect(rig.positions("Sail")[1]).toEqual(Float32Array.from(v));
  });

  it("the cloth's outline is the contract's sail: the main's area, the jib's area", () => {
    expect(outlineArea(verts(MAIN, NEUTRAL), MAIN) / sailOf("main").areaM2 - 1).toBeLessThan(0.005);
    expect(Math.abs(outlineArea(verts(JIB, NEUTRAL), JIB) / sailOf("jib").areaM2 - 1)).toBeLessThan(1e-9);
  });
});

describe("the reef and the furl are the physics' own (6)", () => {
  it("the reefed main's outline is the contract's reefs[].areaM2 at 0.15 and 0.30, to 0.5%", () => {
    const reefs = sailOf("main").reefs;
    for (const f of [0.15, 0.3]) {
      const r = reefs.find((x) => Math.abs(x.fraction - f) < 1e-9);
      expect(r, `a reef at ${f}`).toBeTruthy();
      const a = outlineArea(verts(MAIN, look({ reef: f })), MAIN);
      expect(Math.abs(a / r.areaM2 - 1), `reef ${f}: ${a} vs ${r.areaM2}`).toBeLessThan(0.005);
    }
  });

  it("the reefed cloth's foot is on the boom: cut level at f of the contract's luff and lowered by f·(head − tack), as rig-sails.reefed", () => {
    const L = MAIN.luff, R = MAIN.rows, W = MAIN.cols + 1;
    const T = MAIN.reef.tack, H = MAIN.reef.head;
    for (const f of [0.15, 0.3]) {
      const p = verts(MAIN, look({ reef: f }));
      // the cut is at T + f(H − T), lowered by f(H − T): the reefed foot at the tack's height, its head f(H − T) down
      expect(p[1]).toBeCloseTo(T[1], 9);
      expect(p[3 * (W - 1) + 1]).toBeCloseTo(T[1], 9);
      expect(p[3 * (R * W) + 1]).toBeCloseTo(L[3 * R + 1] - f * (H[1] - T[1]), 9);
    }
  });

  it("the furled jib's outline is furled(sail, furl).area at 0.1, 0.3 and 0.6, to 0.5%", () => {
    const s = sailOf("jib");
    const body = { tackM: toBody(s.tackM), headM: toBody(s.headM), clewM: toBody(s.clewM), polygonM: s.polygonM.map((p) => toBody(p)), areaM2: s.areaM2, ceM: toBody(s.ceM), luffM: s.luffM };
    for (const f of [0.1, 0.3, 0.6]) {
      const a = outlineArea(verts(JIB, look({ furl: f })), JIB);
      expect(Math.abs(a / furled(body, f).area - 1), `furl ${f}`).toBeLessThan(0.005);
    }
  });
});

describe("flutter (6)", () => {
  const ts = Array.from({ length: 11 }, (_, i) => i / 10);
  it("flog 0 means no flutter displacement at any t: the cloth is the same at t 0, 0.1, … 1", () => {
    for (const cloth of [MAIN, JIB]) {
      const still = verts(cloth, look({ amp: 0.3, freq: 2, flog: 0 }), 0);
      for (const t of ts) expect(verts(cloth, look({ amp: 0.3, freq: 2, flog: 0 }), t)).toEqual(still);
    }
  });

  it("the displacement is no more than its amplitude (flog·amp) at those t", () => {
    for (const cloth of [MAIN, JIB]) {
      for (const flog of [0.4, 1]) {
        const amp = 0.3;
        const base = verts(cloth, look({ flog, amp: 0, freq: 2 }));
        for (const t of ts) {
          const v = verts(cloth, look({ flog, amp, freq: 2 }), t);
          let most = 0;
          for (let i = 0; i < v.length; i++) most = Math.max(most, Math.abs(v[i] - base[i]));
          expect(most).toBeLessThanOrEqual(flog * amp + 1e-12);
        }
      }
    }
  });

  it("flogging flattens it to FLAT of its camber, and the belly's side mirrors it", () => {
    const camberAt = (l) => verts(JIB, l)[3 * (10 * (JIB.cols + 1) + 4)];
    const full = camberAt(look({ belly: 1 }));
    expect(camberAt(look({ belly: -1 }))).toBeCloseTo(-full, 12);
    // no twist at the luff's row 10, column 4 is all camber and twist; with twist off the ratio is FLAT exactly
    const flat = { ...JIB, twist: 0 };
    const c1 = verts(flat, look({}))[3 * (10 * (JIB.cols + 1) + 4)];
    const c2 = verts(flat, look({ flog: 1 }))[3 * (10 * (JIB.cols + 1) + 4)];
    expect(c2 / c1).toBeCloseTo(FLAT, 12);
  });
});

describe("normals", () => {
  it("unit, and facing −x on the neutral cloth (as Shape.grid winds it)", () => {
    for (const cloth of [MAIN, JIB]) {
      const p = verts(cloth, NEUTRAL);
      const n = clothNormals(new Float64Array(p.length), p, cloth);
      for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 9);
      const mid = 3 * (Math.floor(cloth.rows / 2) * (cloth.cols + 1) + Math.floor(cloth.cols / 2));
      expect(n[mid]).toBeLessThan(-0.9);
    }
  });
});

describe("the cloth of the trims that disagreed with the physics (trim.js trimOf)", () => {
  const JIBK = trimModelOf(sailOf("jib"));
  it("a jib backed head to wind (held to starboard at 18.5°, its air from 0°, 3°, 10°) is drawn at full camber, unfluttered: NEUTRAL's, bellied to port", () => {
    for (const from of [0, 3, 10]) {
      const tr = trimOf({ id: "jib", main: false, from: from * DEG, angle: 18.5 * DEG, limit: 18.5 * DEG, sheet: -18.5, alpha: from + 18.5, area: 10 }, JIBK);
      expect(tr.state).toBe("backed");
      const got = verts(JIB, look({ belly: tr.belly, flog: tr.flog, luff: tr.luff, sigma: tr.sigma, amp: 0.05, freq: 2 }), 1.3);
      const want = verts(JIB, look({ belly: tr.belly, sigma: tr.sigma }), 1.3);
      expect(Array.from(got)).toEqual(Array.from(want));
      expect(tr.belly).toBe(-1);
    }
  });
  it("a sail at zero lift is flat (belly 0): no camber to either side, only what its flutter and bubble add", () => {
    const tr = trimOf({ id: "jib", main: false, from: 40 * DEG, angle: -45 * DEG, limit: 45 * DEG, sheet: 45, alpha: -5, area: 10 }, JIBK);
    expect(tr.belly).toBeCloseTo(0, 12);
    const flat = verts(JIB, look({ belly: tr.belly }));
    // the cloth's plane is x = 0 in its frame: every vertex on it
    for (let i = 0; i < flat.length; i += 3) expect(Math.abs(flat[i])).toBeLessThan(1e-9);
  });
  it("the luff's bubble: nothing at luff 0; at luff 1 the front BUBBLE.width of each row goes to windward (against the belly), the rest is as it was", () => {
    const base = verts(JIB, look({ belly: -1 }), 0);
    const lifted = verts(JIB, look({ belly: -1, luff: 1, freq: 0 }), 0);
    expect(Array.from(verts(JIB, look({ belly: -1, luff: 0 }), 0))).toEqual(Array.from(base));
    const C = JIB.cols;
    let moved = 0;
    for (let r = 1; r < JIB.rows; r++) {
      for (let c = 0; c <= C; c++) {
        const i = 3 * (r * (C + 1) + c), u = c / C;
        const dx = lifted[i] - base[i];
        if (u > 0 && u < BUBBLE.width) {
          expect(dx).toBeGreaterThan(0); // the belly to port (−x), the bubble to starboard
          moved++;
        } else expect(dx).toBe(0);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });
});
