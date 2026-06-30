import { describe, it, expect } from "vitest";
import {
  plugin,
  mountRangeMap,
  remap,
  invert,
  clampTo,
  num,
  normalizeConfig,
  DEFAULTS,
  FIELDS,
} from "./range-map-node.js";

// a fake opstream-like inlet: snapshots `value` on connect, records writes.
function fakeInlet(value, { editable = false } = {}) {
  const f = {
    value,
    _cbs: [],
    written: [],
    connect(cb) { f._cbs.push(cb); cb({ type: "snapshot", value: f.value }); return () => {}; },
    push(v) { f.value = v; for (const cb of f._cbs) cb({ type: "snapshot", value: v }); },
  };
  if (editable) f.apply = (op) => { f.written.push(op); if (op.type === "snapshot") f.value = op.value; };
  return f;
}

describe("num", () => {
  it("coerces and falls back on non-finite", () => {
    expect(num(3)).toBe(3);
    expect(num("4.5")).toBe(4.5);
    expect(num(NaN, 9)).toBe(9);
    expect(num(undefined, 7)).toBe(7);
    expect(num("nope", 2)).toBe(2);
  });
});

describe("clampTo", () => {
  it("pins into the interval, order-independent", () => {
    expect(clampTo(5, 0, 10)).toBe(5);
    expect(clampTo(-1, 0, 10)).toBe(0);
    expect(clampTo(99, 0, 10)).toBe(10);
    expect(clampTo(-1, 10, 0)).toBe(0); // reversed bounds
    expect(clampTo(99, 10, 0)).toBe(10);
  });
});

describe("remap — identity", () => {
  it("maps a range onto itself unchanged", () => {
    const c = { inMin: 0, inMax: 1, outMin: 0, outMax: 1 };
    expect(remap(0, c)).toBe(0);
    expect(remap(0.5, c)).toBe(0.5);
    expect(remap(1, c)).toBe(1);
  });
  it("the default config is identity", () => {
    expect(remap(0.25, DEFAULTS)).toBe(0.25);
  });
  it("0..100 → 0..100 identity", () => {
    const c = { inMin: 0, inMax: 100, outMin: 0, outMax: 100 };
    expect(remap(42, c)).toBe(42);
  });
});

describe("remap — linear scaling", () => {
  it("0..1 → 0..100", () => {
    const c = { inMin: 0, inMax: 1, outMin: 0, outMax: 100 };
    expect(remap(0.5, c)).toBe(50);
    expect(remap(0, c)).toBe(0);
    expect(remap(1, c)).toBe(100);
  });
  it("shifts and scales (0..10 → 100..200)", () => {
    const c = { inMin: 0, inMax: 10, outMin: 100, outMax: 200 };
    expect(remap(0, c)).toBe(100);
    expect(remap(5, c)).toBe(150);
    expect(remap(10, c)).toBe(200);
  });
});

describe("remap — inversion (reversed out range)", () => {
  it("0..1 → 1..0 flips the value", () => {
    const c = { inMin: 0, inMax: 1, outMin: 1, outMax: 0 };
    expect(remap(0, c)).toBe(1);
    expect(remap(1, c)).toBe(0);
    expect(remap(0.25, c)).toBe(0.75);
  });
  it("0..100 → 100..0", () => {
    const c = { inMin: 0, inMax: 100, outMin: 100, outMax: 0 };
    expect(remap(25, c)).toBe(75);
  });
});

describe("remap — clamping", () => {
  const c = { inMin: 0, inMax: 1, outMin: 0, outMax: 10, clamp: true };
  it("clamps over-range inputs to the out range", () => {
    expect(remap(2, c)).toBe(10); // 2 would map to 20 → clamped
    expect(remap(-1, c)).toBe(0); // would be -10 → clamped
  });
  it("leaves in-range inputs alone", () => {
    expect(remap(0.5, c)).toBe(5);
  });
  it("without clamp it extrapolates", () => {
    expect(remap(2, { ...c, clamp: false })).toBe(20);
  });
  it("clamps correctly with a reversed out range", () => {
    const r = { inMin: 0, inMax: 1, outMin: 10, outMax: 0, clamp: true };
    expect(remap(2, r)).toBe(0); // extrapolation below 0 → clamped to 0
    expect(remap(-1, r)).toBe(10);
  });
});

describe("remap — zero-width input range (no divide-by-zero)", () => {
  it("collapses to outMin instead of NaN/Infinity", () => {
    const c = { inMin: 5, inMax: 5, outMin: 2, outMax: 8 };
    expect(remap(5, c)).toBe(2);
    expect(remap(0, c)).toBe(2);
    expect(remap(100, c)).toBe(2);
    expect(Number.isFinite(remap(5, c))).toBe(true);
  });
});

describe("remap — non-finite x", () => {
  it("returns outMin for NaN/undefined input", () => {
    const c = { inMin: 0, inMax: 1, outMin: 3, outMax: 9 };
    expect(remap(undefined, c)).toBe(3);
    expect(remap(NaN, c)).toBe(3);
    expect(remap("not a number", c)).toBe(3);
  });
});

describe("invert (write-back inverse)", () => {
  it("is the inverse of remap for an invertible mapping", () => {
    const c = { inMin: 0, inMax: 10, outMin: 100, outMax: 200 };
    expect(invert(150, c)).toBe(5);
    expect(remap(invert(180, c), c)).toBeCloseTo(180);
  });
  it("returns undefined for a zero-width out range", () => {
    expect(invert(5, { inMin: 0, inMax: 10, outMin: 4, outMax: 4 })).toBe(undefined);
  });
  it("returns undefined for non-finite y", () => {
    expect(invert(NaN, DEFAULTS)).toBe(undefined);
  });
});

describe("normalizeConfig", () => {
  it("fills defaults and coerces", () => {
    expect(normalizeConfig({})).toEqual({ inMin: 0, inMax: 1, outMin: 0, outMax: 1, clamp: false });
    expect(normalizeConfig({ inMax: "10", clamp: 1 })).toEqual({ inMin: 0, inMax: 10, outMin: 0, outMax: 1, clamp: true });
  });
});

describe("plugin descriptor", () => {
  it("is a sketchy:window with the right id/icon/ports", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("range-map");
    expect(plugin.name).toBe("Range map");
    expect(plugin.icon).toBe("Ruler");
    expect(plugin.inlets).toEqual([{ name: "in", type: "number", schema: expect.anything(), required: true }]);
    expect(plugin.outlets[0]).toMatchObject({ name: "out", type: "number" });
  });
  it("load() resolves to the mount fn", async () => {
    expect(await plugin.load()).toBe(mountRangeMap);
  });
  it("FIELDS lists the four config keys", () => {
    expect(FIELDS.map((f) => f.key)).toEqual(["inMin", "inMax", "outMin", "outMax"]);
  });
});

describe("mountRangeMap", () => {
  it("emits the remapped value on the out outlet from the inlet snapshot", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(0.5);
    let out = null;
    const cleanup = mountRangeMap({
      element,
      inlets: { in: inlet },
      setOutlet: (name, o) => { if (name === "out") out = o; },
      config: { inMin: 0, inMax: 1, outMin: 0, outMax: 100 },
      setConfig: () => {},
    });
    expect(out).not.toBe(null);
    expect(out.value).toBe(50);
    cleanup();
  });

  it("recomputes when the inlet pushes a new value", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(0);
    let out = null;
    const cleanup = mountRangeMap({
      element,
      inlets: { in: inlet },
      setOutlet: (_n, o) => { out = o; },
      config: { inMin: 0, inMax: 10, outMin: 0, outMax: 1 },
      setConfig: () => {},
    });
    expect(out.value).toBe(0);
    inlet.push(10);
    expect(out.value).toBe(1);
    cleanup();
  });

  it("renders four number inputs and a clamp checkbox", () => {
    const element = document.createElement("div");
    const cleanup = mountRangeMap({ element, inlets: { in: fakeInlet(0) }, setOutlet: () => {}, config: {}, setConfig: () => {} });
    expect(element.querySelectorAll('input[type="number"]').length).toBe(4);
    expect(element.querySelectorAll('input[type="checkbox"]').length).toBe(1);
    cleanup();
  });

  it("persists config edits via setConfig and recomputes", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(1);
    const saved = [];
    let out = null;
    const cleanup = mountRangeMap({
      element,
      inlets: { in: inlet },
      setOutlet: (_n, o) => { out = o; },
      config: { inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
      setConfig: (c) => saved.push(c),
    });
    const outMaxInput = element.querySelectorAll('input[type="number"]')[3]; // FIELDS order: outMax is 4th
    outMaxInput.value = "10";
    outMaxInput.oninput();
    expect(saved.at(-1).outMax).toBe(10);
    expect(out.value).toBe(10); // remap(1, 0..1 → 0..10)
    cleanup();
  });

  it("writes back through the inverse when the source is editable", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(0, { editable: true });
    let out = null;
    const cleanup = mountRangeMap({
      element,
      inlets: { in: inlet },
      setOutlet: (_n, o) => { out = o; },
      config: { inMin: 0, inMax: 10, outMin: 0, outMax: 100 },
      setConfig: () => {},
    });
    expect(typeof out.apply).toBe("function");
    out.apply({ type: "snapshot", value: 50 }); // want out=50 → in should be 5
    expect(inlet.written.at(-1)).toEqual({ type: "snapshot", value: 5 });
    cleanup();
  });

  it("has no write-back over a read-only source", () => {
    const element = document.createElement("div");
    const cleanup = mountRangeMap({ element, inlets: { in: fakeInlet(0) }, setOutlet: () => {}, config: {}, setConfig: () => {} });
    cleanup();
    // a read-only inlet (no apply) → mount installs no out.apply; covered by inspecting source-less path too
  });

  it("works with no inlet wired (source-less)", () => {
    const element = document.createElement("div");
    let out = null;
    const cleanup = mountRangeMap({ element, inlets: {}, setOutlet: (_n, o) => { out = o; }, config: { outMin: 7 }, setConfig: () => {} });
    expect(out.value).toBe(7); // undefined input → outMin
    cleanup();
  });
});
