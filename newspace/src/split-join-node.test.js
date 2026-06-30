import { describe, it, expect } from "vitest";
import { splitBy, joinBy, mountSplitJoin, plugin } from "./split-join-node.js";

// a fake opstream: snapshots on connect, records what gets written back
function fakeStream(value, { editable = false } = {}) {
  const s = {
    value,
    _cbs: [],
    connect(cb) {
      cb({ type: "snapshot", value: s.value });
      s._cbs.push(cb);
      return () => {
        s._cbs = s._cbs.filter((c) => c !== cb);
      };
    },
    push(v) {
      s.value = v;
      for (const cb of s._cbs) cb({ type: "snapshot", value: v });
    },
  };
  if (editable) {
    s.apply = (op) => {
      s.value = op && op.type === "snapshot" ? op.value : s.value;
    };
  }
  return s;
}

describe("splitBy", () => {
  it("splits on the default comma", () => {
    expect(splitBy("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });
  it("empty string → [\"\"] (round-trips with join)", () => {
    expect(splitBy("", ",")).toEqual([""]);
  });
  it("custom delimiter", () => {
    expect(splitBy("a|b|c", "|")).toEqual(["a", "b", "c"]);
    expect(splitBy("a b  c", " ")).toEqual(["a", "b", "", "c"]);
  });
  it("non-strings → []", () => {
    expect(splitBy(undefined, ",")).toEqual([]);
    expect(splitBy(null, ",")).toEqual([]);
    expect(splitBy(42, ",")).toEqual([]);
  });
});

describe("joinBy", () => {
  it("joins with the delimiter", () => {
    expect(joinBy(["a", "b", "c"], ",")).toBe("a,b,c");
  });
  it("custom delimiter", () => {
    expect(joinBy(["a", "b"], " | ")).toBe("a | b");
  });
  it("[\"\"] → empty string", () => {
    expect(joinBy([""], ",")).toBe("");
  });
  it("non-arrays → empty string, coerces elements", () => {
    expect(joinBy(null, ",")).toBe("");
    expect(joinBy("nope", ",")).toBe("");
    expect(joinBy([1, 2, null, 3], "-")).toBe("1-2--3");
  });
});

describe("split / join round-trip", () => {
  for (const [str, d] of [
    ["a,b,c", ","],
    ["", ","],
    ["a|b|c", "|"],
    ["one  two", " "],
    ["trailing,", ","],
  ]) {
    it(`joinBy(splitBy(${JSON.stringify(str)})) === original (delim ${JSON.stringify(d)})`, () => {
      expect(joinBy(splitBy(str, d), d)).toBe(str);
    });
  }
});

describe("plugin descriptor", () => {
  it("is a bidirectional sketchy:window with the right ports", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("split-join");
    expect(plugin.name).toBe("Split / Join");
    expect(plugin.icon).toBe("Scissors");
    expect(plugin.inlets[0]).toMatchObject({ name: "in", type: "text" });
    expect(plugin.outlets[0]).toMatchObject({ name: "out", type: "json" });
  });
  it("load() resolves to the mount fn", async () => {
    expect(await plugin.load()).toBe(mountSplitJoin);
  });
});

describe("mountSplitJoin", () => {
  it("forwards: out = split(in)", () => {
    const el = document.createElement("div");
    const src = fakeStream("a,b,c");
    let out = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      setOutlet: (n, o) => { if (n === "out") out = o; },
    });
    expect(out.value).toEqual(["a", "b", "c"]);
    cleanup();
  });

  it("re-splits live as the source changes", () => {
    const el = document.createElement("div");
    const src = fakeStream("a,b");
    let out = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      setOutlet: (n, o) => { if (n === "out") out = o; },
    });
    src.push("x,y,z");
    expect(out.value).toEqual(["x", "y", "z"]);
    cleanup();
  });

  it("uses the persisted delimiter from config", () => {
    const el = document.createElement("div");
    const src = fakeStream("a|b|c");
    let out = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      config: { delim: "|" },
      setOutlet: (n, o) => { if (n === "out") out = o; },
    });
    expect(out.value).toEqual(["a", "b", "c"]);
    cleanup();
  });

  it("persists the delimiter via setConfig and re-splits when the field changes", () => {
    const el = document.createElement("div");
    const src = fakeStream("a|b|c");
    let out = null;
    let saved = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      setOutlet: (n, o) => { if (n === "out") out = o; },
      setConfig: (c) => { saved = c; },
    });
    const field = el.querySelector(".ns-split-join-delim");
    field.value = "|";
    field.oninput();
    expect(saved).toEqual({ delim: "|" });
    expect(out.value).toEqual(["a", "b", "c"]);
    cleanup();
  });

  it("backward: editing out joins back into an editable source", () => {
    const el = document.createElement("div");
    const src = fakeStream("a,b,c", { editable: true });
    let out = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      setOutlet: (n, o) => { if (n === "out") out = o; },
    });
    expect(typeof out.apply).toBe("function");
    out.apply({ type: "snapshot", value: ["x", "y", "z"] });
    expect(src.value).toBe("x,y,z");
    cleanup();
  });

  it("is read-only over a non-editable source (no out.apply)", () => {
    const el = document.createElement("div");
    const src = fakeStream("a,b,c"); // no apply
    let out = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      setOutlet: (n, o) => { if (n === "out") out = o; },
    });
    expect(out.apply).toBeUndefined();
    cleanup();
  });

  it("backward reconstruction with a custom delimiter round-trips", () => {
    const el = document.createElement("div");
    const src = fakeStream("a|b", { editable: true });
    let out = null;
    const cleanup = mountSplitJoin({
      element: el,
      inlets: { in: src },
      config: { delim: "|" },
      setOutlet: (n, o) => { if (n === "out") out = o; },
    });
    out.apply({ type: "snapshot", value: out.value.concat("c") });
    expect(src.value).toBe("a|b|c");
    cleanup();
  });
});
