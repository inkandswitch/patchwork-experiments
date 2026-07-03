import { describe, it, expect } from "vitest";
import {
  roundTo,
  normalizeConfig,
  modeFn,
  fmt,
  mountRound,
  plugin,
  DEFAULT_MODE,
  DEFAULT_DECIMALS,
} from "../src/round-node.js";

// a fake opstream-like source: snapshots on connect, no-op apply.
function fakeSource(value) {
  return {
    value,
    connect(cb) {
      cb({ type: "snapshot", value: this.value });
      return () => {};
    },
    apply(_op) {},
  };
}

describe("roundTo", () => {
  it("round mode", () => {
    expect(roundTo(2.5, 0, "round")).toBe(3);
    expect(roundTo(2.4, 0, "round")).toBe(2);
    expect(roundTo(1.2345, 2, "round")).toBe(1.23);
    expect(roundTo(1.235, 2, "round")).toBe(1.24);
  });

  it("floor mode", () => {
    expect(roundTo(2.9, 0, "floor")).toBe(2);
    expect(roundTo(1.2399, 2, "floor")).toBe(1.23);
    expect(roundTo(-1.1, 0, "floor")).toBe(-2);
  });

  it("ceil mode", () => {
    expect(roundTo(2.1, 0, "ceil")).toBe(3);
    expect(roundTo(1.231, 2, "ceil")).toBe(1.24);
    expect(roundTo(-1.9, 0, "ceil")).toBe(-1);
  });

  it("negative decimals clamp to 0", () => {
    expect(roundTo(2.7, -3, "round")).toBe(3);
    expect(roundTo(2.2, -1, "floor")).toBe(2);
    expect(roundTo(2.2, -5, "ceil")).toBe(3);
  });

  it("non-finite input -> NaN", () => {
    expect(roundTo(NaN, 2)).toBeNaN();
    expect(roundTo(Infinity, 2)).toBeNaN();
    expect(roundTo(-Infinity, 0)).toBeNaN();
    expect(roundTo(undefined, 0)).toBeNaN();
    expect(roundTo("nope", 0)).toBeNaN();
  });

  it("coerces numeric strings", () => {
    expect(roundTo("2.567", 1, "round")).toBe(2.6);
  });

  it("defaults: decimals 0, round mode", () => {
    expect(roundTo(2.5)).toBe(3);
  });

  it("unknown mode falls back to round", () => {
    expect(roundTo(2.5, 0, "bogus")).toBe(3);
  });
});

describe("normalizeConfig", () => {
  it("defaults", () => {
    expect(normalizeConfig({})).toEqual({ decimals: DEFAULT_DECIMALS, mode: DEFAULT_MODE });
  });
  it("clamps negative decimals and truncates floats", () => {
    expect(normalizeConfig({ decimals: -4 })).toEqual({ decimals: 0, mode: "round" });
    expect(normalizeConfig({ decimals: 3.9 })).toEqual({ decimals: 3, mode: "round" });
  });
  it("rejects unknown mode", () => {
    expect(normalizeConfig({ mode: "wat" }).mode).toBe("round");
    expect(normalizeConfig({ mode: "floor" }).mode).toBe("floor");
  });
  it("non-numeric decimals -> default", () => {
    expect(normalizeConfig({ decimals: "x" }).decimals).toBe(DEFAULT_DECIMALS);
  });
});

describe("modeFn / fmt", () => {
  it("modeFn returns the right Math fn", () => {
    expect(modeFn("floor")).toBe(Math.floor);
    expect(modeFn("ceil")).toBe(Math.ceil);
    expect(modeFn("round")).toBe(Math.round);
    expect(modeFn("???")).toBe(Math.round);
  });
  it("fmt", () => {
    expect(fmt(undefined)).toBe("∅");
    expect(fmt(NaN)).toBe("NaN");
    expect(fmt(3)).toBe("3");
  });
});

describe("plugin descriptor", () => {
  it("has the right shape", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("round");
    expect(plugin.name).toBe("Round");
    expect(plugin.icon).toBe("Hash");
    expect(plugin.inlets[0].name).toBe("in");
    expect(plugin.outlets[0].name).toBe("out");
  });
});

describe("mountRound", () => {
  it("emits the rounded value on out from in", async () => {
    const element = document.createElement("div");
    const src = fakeSource(1.2345);
    let out = null;
    const cleanup = mountRound({
      element,
      inlets: { in: src },
      setOutlet: (name, o) => { if (name === "out") out = o; },
      config: { decimals: 2, mode: "round" },
      setConfig: () => {},
    });
    expect(out).not.toBeNull();
    expect(out.value).toBe(1.23);
    cleanup();
  });

  it("renders a number input and a mode select", () => {
    const element = document.createElement("div");
    const cleanup = mountRound({
      element,
      inlets: { in: fakeSource(5) },
      setOutlet: () => {},
      config: {},
    });
    expect(element.querySelector("input[type=number]")).not.toBeNull();
    expect(element.querySelector("select")).not.toBeNull();
    cleanup();
  });

  it("recomputes when the decimals field changes and persists config", () => {
    const element = document.createElement("div");
    let out = null;
    let saved = null;
    const cleanup = mountRound({
      element,
      inlets: { in: fakeSource(3.14159) },
      setOutlet: (name, o) => { if (name === "out") out = o; },
      config: { decimals: 0, mode: "round" },
      setConfig: (c) => { saved = c; },
    });
    expect(out.value).toBe(3);
    const input = element.querySelector("input[type=number]");
    input.value = "3";
    input.oninput();
    expect(out.value).toBe(3.142);
    expect(saved).toEqual({ decimals: 3, mode: "round" });
    cleanup();
  });

  it("recomputes when the mode select changes", () => {
    const element = document.createElement("div");
    let out = null;
    const cleanup = mountRound({
      element,
      inlets: { in: fakeSource(2.5) },
      setOutlet: (name, o) => { if (name === "out") out = o; },
      config: { decimals: 0, mode: "round" },
      setConfig: () => {},
    });
    expect(out.value).toBe(3);
    const select = element.querySelector("select");
    select.value = "floor";
    select.onchange();
    expect(out.value).toBe(2);
    cleanup();
  });

  it("cleanup removes the DOM", () => {
    const element = document.createElement("div");
    const cleanup = mountRound({
      element,
      inlets: { in: fakeSource(1) },
      setOutlet: () => {},
      config: {},
    });
    expect(element.children.length).toBe(1);
    cleanup();
    expect(element.children.length).toBe(0);
  });
});
