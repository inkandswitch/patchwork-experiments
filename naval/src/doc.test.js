import { describe, it, expect } from "vitest";
import { normalize, defaultDoc, setPath, STOCK_SLOOP, displacementOf } from "./doc.js";
import { RigDesignDatatype } from "./datatype.js";
import { plugins } from "./index.js";
import { computeNumbers } from "./numbers.js";

const undefinedPaths = (v, path = "") => {
  if (v === undefined) return [path];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => undefinedPaths(x, `${path}.${k}`));
  return [];
};

describe("doc", () => {
  it("normalize() round-trips", () => {
    const a = defaultDoc();
    expect(normalize(a)).toEqual(a);
    expect(normalize(normalize({}))).toEqual(normalize({}));
    const odd = { rig: { type: "ketch", P: "tall", headsail: null, main: { reefs: [0.2, "x"] } }, loading: { crew: { mode: "flying" } } };
    expect(normalize(normalize(odd))).toEqual(normalize(odd));
  });

  it("normalize() never yields undefined, and repairs garbage to the stock sloop", () => {
    for (const raw of [undefined, null, {}, { rig: 5 }, { hull: { dims: { lwl: NaN } } }, STOCK_SLOOP]) {
      const n = normalize(raw);
      expect(undefinedPaths(n)).toEqual([]);
      expect(Number.isFinite(n.hull.dims.lwl)).toBe(true);
    }
    const n = normalize({ rig: { type: "ketch", headsail: null } });
    expect(n.rig.type).toBe("fractional"); // ketch is not here yet
    expect(n.rig.headsail).toBeNull(); // an explicit "no headsail" is kept
  });

  it("the stock sloop's designer area is SLOOP's 55 m²", () => {
    const { plan } = computeNumbers(defaultDoc());
    expect(plan.designer.areaM2).toBeCloseTo(55, 9);
  });

  it("setPath writes, makes the way, and clears an estimated mark", () => {
    const d = defaultDoc();
    expect(d.prov["rig.I"]).toBe("estimated");
    setPath(d, ["rig", "I"], 11);
    expect(d.rig.I).toBe(11);
    expect(d.prov["rig.I"]).toBeUndefined();
    setPath(d, ["rig", "staysail", "I2"], 9);
    expect(d.rig.staysail.I2).toBe(9);
    setPath(d, ["rig", "staysail", "I2"], undefined);
    expect("I2" in d.rig.staysail).toBe(false);
  });

  it("displacement comes from the hull unless one is given", () => {
    const d = defaultDoc();
    expect(displacementOf(d)).toEqual({ kg: 8000, from: "hull" });
    d.loading.displacement = { from: "given", kg: 9000 };
    expect(displacementOf(d)).toEqual({ kg: 9000, from: "given" });
  });

  it("warns plainly when LOA is under 2 m", () => {
    const d = defaultDoc();
    d.hull.dims.loa = 1;
    d.hull.dims.lwl = 0.9;
    expect(computeNumbers(d).warnings.join(" ")).toMatch(/model, not a boat/);
    expect(computeNumbers(defaultDoc()).warnings.join(" ")).not.toMatch(/model/);
  });

  it("the default doc's numbers are all finite", () => {
    const { sections } = computeNumbers(defaultDoc());
    for (const s of sections) for (const r of s.rows) expect(Number.isFinite(r.value), r.id).toBe(true);
  });
});

describe("datatype", () => {
  it("init seeds a normalized stock sloop; title, setTitle, markCopy", () => {
    const d = {};
    RigDesignDatatype.init(d);
    expect(d).toEqual(defaultDoc());
    expect(RigDesignDatatype.getTitle(d)).toBe("12 m sloop (stock)");
    RigDesignDatatype.setTitle(d, "Mine");
    RigDesignDatatype.markCopy(d);
    expect(d.title).toBe("Copy of Mine");
  });
});

describe("entry module", () => {
  it("is structuredClone-safe and metadata only", async () => {
    for (const p of plugins) {
      const { load, ...meta } = p;
      expect(typeof load).toBe("function");
      expect(() => structuredClone(meta)).not.toThrow();
      for (const v of Object.values(meta)) expect(typeof v).not.toBe("function");
    }
    expect(plugins.map((p) => [p.type, p.id])).toEqual([
      ["patchwork:datatype", "rig-design"],
      ["patchwork:tool", "rig-design"],
      ["scene:source", "rig-design"],
      ["patchwork:datatype", "naval-study"],
      ["patchwork:tool", "naval-study"],
    ]);
    expect(plugins[0].name).toBe("Rig");
    const dt = await plugins[0].load();
    expect(typeof dt.init).toBe("function");
  });
});
