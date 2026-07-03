import { describe, it, expect } from "vitest";
import { mathOp, OPS, opByName, DEFAULT_OP, fmt, mountMathOp, plugin } from "../src/math-op-node.js";

// a fake opstream-like inlet that snapshots on connect and lets us push new values.
function fakeInlet(initial) {
  let value = initial;
  let cb = null;
  return {
    get value() { return value; },
    connect(fn) { cb = fn; fn({ type: "snapshot", value }); return () => { cb = null; }; },
    apply() {},
    push(v) { value = v; if (cb) cb({ type: "snapshot", value }); },
  };
}

describe("mathOp — every op", () => {
  it("abs", () => {
    expect(mathOp("abs", -5)).toBe(5);
    expect(mathOp("abs", 5)).toBe(5);
    expect(mathOp("abs", 0)).toBe(0);
  });
  it("round / floor / ceil / trunc on a fraction", () => {
    expect(mathOp("round", 2.5)).toBe(3);
    expect(mathOp("round", 2.4)).toBe(2);
    expect(mathOp("floor", 2.9)).toBe(2);
    expect(mathOp("ceil", 2.1)).toBe(3);
    expect(mathOp("trunc", 2.9)).toBe(2);
  });
  it("round / floor / ceil / trunc on negatives", () => {
    expect(mathOp("round", -2.5)).toBe(-2); // JS rounds half toward +∞
    expect(mathOp("floor", -2.1)).toBe(-3);
    expect(mathOp("ceil", -2.9)).toBe(-2);
    expect(mathOp("trunc", -2.9)).toBe(-2);
  });
  it("negate", () => {
    expect(mathOp("negate", 5)).toBe(-5);
    expect(mathOp("negate", -5)).toBe(5);
    expect(Object.is(mathOp("negate", 0), -0)).toBe(true);
  });
  it("sqrt — including NaN for a negative", () => {
    expect(mathOp("sqrt", 9)).toBe(3);
    expect(mathOp("sqrt", 0)).toBe(0);
    expect(Number.isNaN(mathOp("sqrt", -1))).toBe(true);
  });
  it("sign", () => {
    expect(mathOp("sign", -7)).toBe(-1);
    expect(mathOp("sign", 7)).toBe(1);
    expect(mathOp("sign", 0)).toBe(0);
  });
});

describe("mathOp — bad / missing input", () => {
  it("non-numbers ⇒ NaN", () => {
    expect(Number.isNaN(mathOp("abs", undefined))).toBe(true);
    expect(Number.isNaN(mathOp("abs", null))).toBe(true);
    expect(Number.isNaN(mathOp("abs", "5"))).toBe(true);
    expect(Number.isNaN(mathOp("abs", NaN))).toBe(true);
  });
  it("unknown op name falls back to the default op", () => {
    expect(opByName("nope").name).toBe(DEFAULT_OP);
    expect(mathOp("nope", -3)).toBe(mathOp(DEFAULT_OP, -3));
  });
});

describe("OPS table", () => {
  it("contains the eight specified unary ops", () => {
    expect(OPS.map((o) => o.name)).toEqual([
      "abs", "round", "floor", "ceil", "negate", "sqrt", "sign", "trunc",
    ]);
  });
  it("every op is a pure unary function", () => {
    for (const o of OPS) expect(typeof o.fn).toBe("function");
  });
});

describe("fmt", () => {
  it("renders ∅ / NaN / numbers", () => {
    expect(fmt(undefined)).toBe("∅");
    expect(fmt(NaN)).toBe("NaN");
    expect(fmt(42)).toBe("42");
    expect(fmt(-3.5)).toBe("-3.5");
  });
});

describe("plugin descriptor", () => {
  it("is a sketchy:window math node with number in/out", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("math-op");
    expect(plugin.name).toBe("Math");
    expect(plugin.icon).toBe("Calculator");
    expect(plugin.inlets[0]).toMatchObject({ name: "in", type: "number", required: true });
    expect(plugin.outlets[0]).toMatchObject({ name: "out", type: "number" });
  });
  it("load() resolves to the mount function", async () => {
    expect(await plugin.load()).toBe(mountMathOp);
  });
});

describe("mountMathOp", () => {
  it("computes out from in via the persisted op, and recomputes on input change", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(-9);
    let outSource = null;
    const out = mountMathOp({
      element,
      inlets: { in: inlet },
      setOutlet: (name, src) => { if (name === "out") outSource = src; },
      config: { op: "abs" },
      setConfig: () => {},
    });
    expect(outSource.value).toBe(9); // abs(-9)
    inlet.push(-16);
    expect(outSource.value).toBe(16);
    out();
  });

  it("defaults to abs when config.op is missing or invalid", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(-4);
    let outSource = null;
    const cleanup = mountMathOp({
      element,
      inlets: { in: inlet },
      setOutlet: (_n, s) => { outSource = s; },
      config: { op: "bogus" },
      setConfig: () => {},
    });
    expect(element.querySelector("select").value).toBe(DEFAULT_OP);
    expect(outSource.value).toBe(4);
    cleanup();
  });

  it("changing the <select> persists config.op and recomputes", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(-9);
    let outSource = null;
    let saved = null;
    const cleanup = mountMathOp({
      element,
      inlets: { in: inlet },
      setOutlet: (_n, s) => { outSource = s; },
      config: {},
      setConfig: (c) => { saved = c; },
    });
    const select = element.querySelector("select");
    select.value = "sqrt";
    select.onchange();
    expect(saved).toEqual({ op: "sqrt" });
    expect(Number.isNaN(outSource.value)).toBe(true); // sqrt(-9)
    cleanup();
  });

  it("cleanup removes the DOM and disconnects", () => {
    const element = document.createElement("div");
    const inlet = fakeInlet(1);
    const cleanup = mountMathOp({ element, inlets: { in: inlet }, setOutlet: () => {}, config: {}, setConfig: () => {} });
    expect(element.querySelector(".ns-mathop")).toBeTruthy();
    cleanup();
    expect(element.querySelector(".ns-mathop")).toBe(null);
  });
});
