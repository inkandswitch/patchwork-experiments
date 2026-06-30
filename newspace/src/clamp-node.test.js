import { describe, it, expect } from "vitest";
import {
  clampTo,
  num,
  normalizeConfig,
  fmt,
  mountClamp,
  plugin,
} from "./clamp-node.js";

describe("clampTo", () => {
  it("passes through values within bounds", () => {
    expect(clampTo(0.5, 0, 1)).toBe(0.5);
    expect(clampTo(0, 0, 1)).toBe(0);
    expect(clampTo(1, 0, 1)).toBe(1);
  });

  it("clamps below min and above max", () => {
    expect(clampTo(-3, 0, 1)).toBe(0);
    expect(clampTo(5, 0, 1)).toBe(1);
    expect(clampTo(-100, -10, 10)).toBe(-10);
    expect(clampTo(100, -10, 10)).toBe(10);
  });

  it("swaps inverted bounds (min > max)", () => {
    expect(clampTo(0.5, 1, 0)).toBe(0.5);
    expect(clampTo(-3, 1, 0)).toBe(0);
    expect(clampTo(5, 1, 0)).toBe(1);
    expect(clampTo(7, 10, -10)).toBe(7);
    expect(clampTo(50, 10, -10)).toBe(10);
  });

  it("returns NaN for non-finite input", () => {
    expect(clampTo(NaN, 0, 1)).toBeNaN();
    expect(clampTo(Infinity, 0, 1)).toBeNaN();
    expect(clampTo(-Infinity, 0, 1)).toBeNaN();
  });

  it("returns NaN for non-number input", () => {
    expect(clampTo("0.5", 0, 1)).toBeNaN();
    expect(clampTo(undefined, 0, 1)).toBeNaN();
    expect(clampTo(null, 0, 1)).toBeNaN();
    expect(clampTo({}, 0, 1)).toBeNaN();
  });
});

describe("num", () => {
  it("coerces and falls back", () => {
    expect(num(3)).toBe(3);
    expect(num("3")).toBe(3);
    expect(num("nope", 7)).toBe(7);
    expect(num(NaN, 7)).toBe(7);
    expect(num(Infinity, 7)).toBe(7);
  });
});

describe("normalizeConfig", () => {
  it("defaults to {min:0, max:1}", () => {
    expect(normalizeConfig()).toEqual({ min: 0, max: 1 });
    expect(normalizeConfig({})).toEqual({ min: 0, max: 1 });
  });
  it("coerces provided bounds", () => {
    expect(normalizeConfig({ min: -5, max: 5 })).toEqual({ min: -5, max: 5 });
    expect(normalizeConfig({ min: "2", max: "8" })).toEqual({ min: 2, max: 8 });
    expect(normalizeConfig({ min: "x" })).toEqual({ min: 0, max: 1 });
  });
});

describe("fmt", () => {
  it("formats special cases", () => {
    expect(fmt(undefined)).toBe("∅");
    expect(fmt(NaN)).toBe("NaN");
    expect(fmt(3)).toBe("3");
  });
});

describe("plugin descriptor", () => {
  it("is a sketchy:window with id clamp", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("clamp");
    expect(plugin.name).toBe("Clamp");
    expect(plugin.icon).toBe("Brackets");
    expect(plugin.inlets[0].name).toBe("in");
    expect(plugin.outlets[0].name).toBe("out");
  });
  it("loads to mountClamp", async () => {
    const mount = await plugin.load();
    expect(mount).toBe(mountClamp);
  });
});

// a fake opstream: emits an initial snapshot on connect, lets the test push more.
function fakeSource(initial) {
  let val = initial;
  const cbs = new Set();
  return {
    get value() { return val; },
    connect(cb) { cb({ type: "snapshot", value: val }); cbs.add(cb); return () => cbs.delete(cb); },
    apply(op) {},
    _push(v) { val = v; for (const cb of cbs) cb({ type: "snapshot", value: v }); },
  };
}

describe("mountClamp", () => {
  it("clamps the inlet value and emits on out", () => {
    const element = document.createElement("div");
    const src = fakeSource(5);
    let out;
    const cleanup = mountClamp({
      element,
      inlets: { in: src },
      setOutlet: (name, o) => { out = o; },
      config: { min: 0, max: 1 },
      setConfig: () => {},
    });
    expect(out.value).toBe(1); // 5 clamped to max
    src._push(-2);
    expect(out.value).toBe(0); // -2 clamped to min
    src._push(0.4);
    expect(out.value).toBe(0.4);
    cleanup();
  });

  it("uses default bounds {0,1} when config absent", () => {
    const element = document.createElement("div");
    const src = fakeSource(9);
    let out;
    const cleanup = mountClamp({
      element,
      inlets: { in: src },
      setOutlet: (name, o) => { out = o; },
    });
    expect(out.value).toBe(1);
    cleanup();
  });

  it("recomputes when a field changes", () => {
    const element = document.createElement("div");
    const src = fakeSource(50);
    let out;
    const saved = [];
    const cleanup = mountClamp({
      element,
      inlets: { in: src },
      setOutlet: (name, o) => { out = o; },
      config: { min: 0, max: 1 },
      setConfig: (c) => saved.push(c),
    });
    expect(out.value).toBe(1);
    const maxInput = element.querySelectorAll("input")[1];
    maxInput.value = "100";
    maxInput.oninput();
    expect(out.value).toBe(50); // now within [0,100]
    expect(saved.at(-1)).toEqual({ min: 0, max: 100 });
    cleanup();
  });

  it("emits NaN for non-finite input", () => {
    const element = document.createElement("div");
    const src = fakeSource(Infinity);
    let out;
    const cleanup = mountClamp({
      element,
      inlets: { in: src },
      setOutlet: (name, o) => { out = o; },
      config: { min: 0, max: 10 },
    });
    expect(out.value).toBeNaN();
    cleanup();
  });

  it("cleanup removes the DOM and disconnects", () => {
    const element = document.createElement("div");
    const src = fakeSource(0.5);
    const cleanup = mountClamp({
      element,
      inlets: { in: src },
      setOutlet: () => {},
    });
    expect(element.children.length).toBe(1);
    cleanup();
    expect(element.children.length).toBe(0);
  });
});
