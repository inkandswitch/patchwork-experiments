import { describe, it, expect } from "vitest";
import { combine, collect, fanOut, mountCombine, plugin, SKIP } from "../src/combine-node.js";
import { Source, Opstream } from "../src/opstreams.js";
import { snapshot, set } from "../src/ops.js";

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

// an editable inlet whose writes we can count (they still apply for real)
function writableInlet(value) {
  const s = new Opstream(value);
  s.writes = [];
  const orig = s.apply.bind(s);
  s.apply = (op) => { s.writes.push(op); orig(op); };
  return s;
}

describe("fanOut — the WRITE side of the fan-in (lensN SKIP)", () => {
  it("writes each present slot to its source", () => {
    const a = writableInlet(1), b = writableInlet(2);
    fanOut({ a: 10, b: 20 }, { a, b });
    expect(a.value).toBe(10);
    expect(b.value).toBe(20);
  });

  it("a SKIP slot's source receives NO write; the other slots are still written", () => {
    const a = writableInlet(1), b = writableInlet(2);
    fanOut({ a: SKIP, b: 20 }, { a, b });
    expect(a.value).toBe(1);      // untouched
    expect(a.writes).toEqual([]); // and never even called
    expect(b.value).toBe(20);
  });

  it("SKIP still declines after a JSON hop (tag-checked, not identity)", () => {
    const a = writableInlet(1);
    fanOut(JSON.parse(JSON.stringify({ a: SKIP })), { a });
    expect(a.writes).toEqual([]);
  });

  it("an absent or undefined slot leaves its source alone", () => {
    const a = writableInlet(1), b = writableInlet(2);
    fanOut({ b: 9 }, { a, b });
    expect(a.writes).toEqual([]);
    fanOut({ a: undefined }, { a, b });
    expect(a.writes).toEqual([]);
  });

  it("idempotent: a slot equal to the source's current value is not re-written", () => {
    const a = writableInlet(7);
    fanOut({ a: 7 }, { a });
    expect(a.writes).toEqual([]);
  });

  it("a read-only inlet (no apply) is skipped, not crashed", () => {
    const a = new Source(1); // Source has no apply
    expect(() => fanOut({ a: 2 }, { a })).not.toThrow();
    expect(a.value).toBe(1);
  });

  it("tolerates a nullish / non-object write", () => {
    const a = writableInlet(1);
    expect(() => fanOut(null, { a })).not.toThrow();
    expect(() => fanOut("junk", { a })).not.toThrow();
    expect(a.writes).toEqual([]);
  });
});

describe("mountCombine — bidirectional out", () => {
  it("writing an object back into `out` fans out, and the combined value recomputes", () => {
    const a = writableInlet(1), b = writableInlet(2);
    let out;
    const cleanup = mountCombine({
      element: document.createElement("div"),
      inlets: { a, b },
      setOutlet: (_n, s) => { out = s; },
    });
    expect(typeof out.apply).toBe("function"); // bidi — the wire renders a diamond
    out.apply(snapshot({ a: 10, b: SKIP }));
    expect(a.value).toBe(10);
    expect(b.value).toBe(2); // SKIP: "don't write this source"
    expect(out.value).toEqual({ a: 10, b: 2 }); // recomputed from the inlets
    cleanup();
  });

  it("a granular op into `out` routes to the one slot it targets", () => {
    const a = writableInlet(1), b = writableInlet(2);
    let out;
    const cleanup = mountCombine({
      element: document.createElement("div"),
      inlets: { a, b },
      setOutlet: (_n, s) => { out = s; },
    });
    out.apply(set([], "b", 99)); // { path:[], range:"b", value:99 }
    expect(b.value).toBe(99);
    expect(a.writes).toEqual([]); // a's slot didn't change ⇒ idempotence skips it
    cleanup();
  });
});

describe("plugin descriptor", () => {
  it("declares the combine node shape", async () => {
    expect(plugin.type).toBe("sketchy:surface");
    expect(plugin.id).toBe("combine");
    expect(plugin.name).toBe("Combine");
    expect(plugin.icon).toBe("Combine");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["a", "b", "c", "d"]);
    expect(plugin.outlets.map((o) => o.name)).toEqual(["out"]);
    expect(await plugin.load()).toBe(mountCombine);
  });
});
