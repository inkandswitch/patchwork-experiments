import { describe, it, expect } from "vitest";
import { plugin, compileMapper, applyMapper, mountMapList } from "../src/map-list-node.js";

// a fake opstream like the real inlets carry: { value, connect(cb), apply(op) }
function fakeInlet(value) {
  return {
    value,
    connect(cb) { cb({ type: "snapshot", value }); return () => {}; },
    apply(_op) {},
  };
}

describe("compileMapper", () => {
  it("compiles a function expression", () => {
    const { fn, error } = compileMapper("(x) => x * 2");
    expect(error).toBe(null);
    expect(fn(3)).toBe(6);
  });

  it("defaults to identity when given empty/blank code", () => {
    const { fn, error } = compileMapper("");
    expect(error).toBe(null);
    expect(fn(7)).toBe(7);
    expect(compileMapper("   ").fn(9)).toBe(9);
    expect(compileMapper(undefined).fn(1)).toBe(1);
  });

  it("rejects a non-function expression without throwing", () => {
    const { fn, error } = compileMapper("42");
    expect(fn).toBe(null);
    expect(error).toMatch(/function/);
  });

  it("returns an error (no throw) on a syntax error", () => {
    const { fn, error } = compileMapper("(x) =>");
    expect(fn).toBe(null);
    expect(typeof error).toBe("string");
    expect(error.length).toBeGreaterThan(0);
  });
});

describe("applyMapper", () => {
  it("maps numbers", () => {
    const { fn } = compileMapper("(x) => x + 1");
    expect(applyMapper([1, 2, 3], fn)).toEqual([2, 3, 4]);
  });

  it("identity default maps each element unchanged", () => {
    const { fn } = compileMapper("(x) => x");
    expect(applyMapper([1, "a", null], fn)).toEqual([1, "a", null]);
  });

  it("exposes the index as the second arg", () => {
    const { fn } = compileMapper("(x, i) => i");
    expect(applyMapper(["a", "b", "c"], fn)).toEqual([0, 1, 2]);
  });

  it("non-array input passes through to an empty array", () => {
    const { fn } = compileMapper("(x) => x");
    expect(applyMapper(null, fn)).toEqual([]);
    expect(applyMapper(undefined, fn)).toEqual([]);
    expect(applyMapper(42, fn)).toEqual([]);
    expect(applyMapper({ a: 1 }, fn)).toEqual([]);
  });

  it("a throwing element yields undefined, not a crash", () => {
    const { fn } = compileMapper("(x) => { throw new Error('boom') }");
    expect(applyMapper([1, 2], fn)).toEqual([undefined, undefined]);
  });

  it("returns [] when fn is null (e.g. a failed compile)", () => {
    expect(applyMapper([1, 2], null)).toEqual([]);
  });
});

describe("plugin descriptor", () => {
  it("is a sketchy:surface with id map-list, icon List", () => {
    expect(plugin.type).toBe("sketchy:surface");
    expect(plugin.id).toBe("map-list");
    expect(plugin.name).toBe("Map list");
    expect(plugin.icon).toBe("List");
  });
  it("declares a required json inlet and a json outlet", () => {
    expect(plugin.inlets[0]).toMatchObject({ name: "in", type: "json", required: true });
    expect(plugin.outlets[0]).toMatchObject({ name: "out", type: "json" });
  });
  it("load() resolves to the mount function", async () => {
    expect(await plugin.load()).toBe(mountMapList);
  });
});

describe("mountMapList (via DOM + fake opstreams)", () => {
  it("emits the mapped array on the out outlet", () => {
    const element = document.createElement("div");
    let out = null;
    const cleanup = mountMapList({
      element,
      inlets: { in: fakeInlet([1, 2, 3]) },
      setOutlet: (name, o) => { if (name === "out") out = o; },
      config: { code: "(x) => x * 10" },
      setConfig: () => {},
    });
    expect(out).not.toBe(null);
    expect(out.value).toEqual([10, 20, 30]);
    cleanup();
  });

  it("defaults to identity with no config, and persists code on input", () => {
    const element = document.createElement("div");
    let out = null;
    let saved = null;
    const cleanup = mountMapList({
      element,
      inlets: { in: fakeInlet([5, 6]) },
      setOutlet: (_n, o) => { out = o; },
      config: {},
      setConfig: (c) => { saved = c; },
    });
    expect(out.value).toEqual([5, 6]); // identity default

    const ta = element.querySelector("textarea");
    ta.value = "(x) => x - 1";
    ta.oninput();
    expect(saved).toEqual({ code: "(x) => x - 1" });
    expect(out.value).toEqual([4, 5]);
    cleanup();
  });

  it("recomputes when the source pushes a new value", () => {
    const element = document.createElement("div");
    let out = null;
    let cb = null;
    const src = {
      value: [1],
      connect(fn) { cb = fn; fn({ type: "snapshot", value: this.value }); return () => {}; },
      apply() {},
    };
    const cleanup = mountMapList({
      element,
      inlets: { in: src },
      setOutlet: (_n, o) => { out = o; },
      config: { code: "(x) => x + 100" },
      setConfig: () => {},
    });
    expect(out.value).toEqual([101]);
    src.value = [1, 2];
    cb({ type: "snapshot", value: src.value });
    expect(out.value).toEqual([101, 102]);
    cleanup();
  });

  it("a syntax error shows status without throwing and leaves out as []", () => {
    const element = document.createElement("div");
    let out = null;
    expect(() => {
      mountMapList({
        element,
        inlets: { in: fakeInlet([1, 2]) },
        setOutlet: (_n, o) => { out = o; },
        config: { code: "(x) =>" },
        setConfig: () => {},
      });
    }).not.toThrow();
    expect(out.value).toEqual([]);
    expect(element.querySelector(".ns-source-status").textContent).toMatch(/⚠/);
  });
});
