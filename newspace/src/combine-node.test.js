import { describe, it, expect } from "vitest";
import { combine, collect, mountCombine, plugin } from "./combine-node.js";
import { Source } from "./opstreams.js";

// a fake opstream-like inlet: connect fires once with the current snapshot, then
// never again (good enough for the pure-collect path); for change-recompute tests
// we use the real Source below.
function fakeInlet(value) {
  return {
    value,
    connect(cb) { cb({ type: "snapshot", value }); return () => {}; },
    apply(_op) {},
  };
}

describe("combine (pure)", () => {
  it("drops undefined keys", () => {
    expect(combine({ a: 1, b: undefined, c: 3 })).toEqual({ a: 1, c: 3 });
  });

  it("keeps falsy-but-defined values (0, '', null, false)", () => {
    expect(combine({ a: 0, b: "", c: null, d: false })).toEqual({ a: 0, b: "", c: null, d: false });
  });

  it("returns an empty object for an empty/nullish input", () => {
    expect(combine({})).toEqual({});
    expect(combine(undefined)).toEqual({});
  });
});

describe("collect (pure)", () => {
  it("only reads present inlets and drops undefined values", () => {
    const inlets = { a: fakeInlet(1), b: fakeInlet(undefined), d: fakeInlet("x") };
    expect(collect(inlets)).toEqual({ a: 1, d: "x" });
  });

  it("ignores absent inlet names", () => {
    expect(collect({ a: fakeInlet(7) })).toEqual({ a: 7 });
  });
});

describe("mountCombine", () => {
  it("emits an object of only the wired, non-undefined inlets", () => {
    const a = fakeInlet(1);
    const b = fakeInlet("hi");
    let out;
    const cleanup = mountCombine({
      element: document.createElement("div"),
      inlets: { a, b },
      setOutlet: (_n, s) => { out = s; },
    });
    expect(out.value).toEqual({ a: 1, b: "hi" });
    cleanup();
  });

  it("two wired values yield an object with two keys", () => {
    const a = new Source(10);
    const c = new Source(20);
    let out;
    mountCombine({
      element: document.createElement("div"),
      inlets: { a, c },
      setOutlet: (_n, s) => { out = s; },
    });
    expect(out.value).toEqual({ a: 10, c: 20 });
  });

  it("recomputes whenever any inlet changes", () => {
    const a = new Source(1);
    const b = new Source(2);
    let out;
    const cleanup = mountCombine({
      element: document.createElement("div"),
      inlets: { a, b },
      setOutlet: (_n, s) => { out = s; },
    });
    expect(out.value).toEqual({ a: 1, b: 2 });
    a.push(99);
    expect(out.value).toEqual({ a: 99, b: 2 });
    b.push(100);
    expect(out.value).toEqual({ a: 99, b: 100 });
    cleanup();
  });

  it("drops an inlet once its value becomes undefined", () => {
    const a = new Source(1);
    const b = new Source(2);
    let out;
    mountCombine({
      element: document.createElement("div"),
      inlets: { a, b },
      setOutlet: (_n, s) => { out = s; },
    });
    expect(out.value).toEqual({ a: 1, b: 2 });
    b.push(undefined);
    expect(out.value).toEqual({ a: 1 });
  });

  it("renders status and cleans up its DOM", () => {
    const el = document.createElement("div");
    const cleanup = mountCombine({
      element: el,
      inlets: { a: fakeInlet(1) },
      setOutlet: () => {},
    });
    expect(el.querySelector(".ns-combine")).toBeTruthy();
    cleanup();
    expect(el.querySelector(".ns-combine")).toBeFalsy();
  });
});

describe("plugin descriptor", () => {
  it("declares the combine node shape", async () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("combine");
    expect(plugin.name).toBe("Combine");
    expect(plugin.icon).toBe("Combine");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["a", "b", "c", "d"]);
    expect(plugin.outlets.map((o) => o.name)).toEqual(["out"]);
    expect(await plugin.load()).toBe(mountCombine);
  });
});
