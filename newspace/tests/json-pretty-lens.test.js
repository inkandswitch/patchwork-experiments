import { describe, it, expect } from "vitest";
import { plugin, toPretty, fromPretty } from "../src/json-pretty-lens.js";
import { applyLens } from "../src/lenses.js";
import { snapshot } from "../src/opstreams.js";

describe("toPretty (pure project)", () => {
  it("pretty-prints objects with 2-space indent", () => {
    expect(toPretty({ a: 1, b: [2, 3] })).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });
  it("pretty-prints arrays", () => {
    expect(toPretty([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
  });
  it("renders numbers / strings / booleans / null", () => {
    expect(toPretty(42)).toBe("42");
    expect(toPretty("hi")).toBe('"hi"');
    expect(toPretty(true)).toBe("true");
    expect(toPretty(null)).toBe("null");
  });
  it("falls back to String(value) for non-JSONable values", () => {
    expect(toPretty(undefined)).toBe("undefined");
    const fn = function noop() {};
    expect(toPretty(fn)).toBe("" + fn);
  });
  it("falls back for cyclic objects instead of throwing", () => {
    const o = {};
    o.self = o;
    expect(() => toPretty(o)).not.toThrow();
    expect(typeof toPretty(o)).toBe("string");
  });
});

describe("fromPretty (pure unproject)", () => {
  it("parses valid JSON text", () => {
    expect(fromPretty('{\n  "a": 1\n}')).toEqual({ a: 1 });
    expect(fromPretty("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(fromPretty("42")).toBe(42);
  });
  it("returns the raw string on parse error", () => {
    expect(fromPretty("not json")).toBe("not json");
    expect(fromPretty("{ broken")).toBe("{ broken");
  });
});

describe("round-trips", () => {
  for (const value of [{ a: 1, b: { c: [true, null, "x"] } }, [1, 2, 3], 42, "hello", true, null]) {
    it(`survives toPretty → fromPretty for ${JSON.stringify(value)}`, () => {
      expect(fromPretty(toPretty(value))).toEqual(value);
    });
  }
});

describe("lens descriptor", () => {
  it("is a bidirectional sketchy:lens with unique id/icon", () => {
    expect(plugin.type).toBe("sketchy:lens");
    expect(plugin.id).toBe("json-pretty");
    expect(plugin.name).toBe("pretty JSON");
    expect(plugin.icon).toBe("Braces");
    expect(plugin.inlet).toMatchObject({ name: "in", type: "json" });
    expect(plugin.outlet).toMatchObject({ name: "out", type: "text" });
    expect(typeof plugin.project).toBe("function");
    expect(typeof plugin.unproject).toBe("function");
  });

  it("project/unproject on the descriptor match the pure helpers", () => {
    expect(plugin.project({ x: 1 })).toBe(toPretty({ x: 1 }));
    expect(plugin.unproject('{"x":1}')).toEqual({ x: 1 });
    expect(plugin.unproject("oops")).toBe("oops");
  });
});

// a minimal fake opstream matching the brief's shape, but with a real-ish apply
function fakeOpstream(initial) {
  const subs = new Set();
  return {
    value: initial,
    schema: undefined,
    complement: {},
    connect(cb) {
      cb({ type: "snapshot", value: this.value });
      subs.add(cb);
      return () => subs.delete(cb);
    },
    apply(op) {
      this.value = op && op.type === "snapshot" ? op.value : this.value;
      for (const cb of subs) cb(op);
    },
  };
}

describe("applyLens (mount-on-a-wire behaviour)", () => {
  it("projects the source value forward through the outlet", () => {
    const src = fakeOpstream({ a: 1 });
    const out = applyLens(plugin, src);
    let seen;
    out.connect((o) => { if (o.type === "snapshot") seen = o.value; });
    expect(seen).toBe(toPretty({ a: 1 }));
    expect(out.value).toBe(toPretty({ a: 1 }));
  });

  it("writes an edited text view back to the source as parsed JSON", () => {
    const src = fakeOpstream({ a: 1 });
    const out = applyLens(plugin, src);
    expect(typeof out.apply).toBe("function");
    out.apply(snapshot('{\n  "a": 99\n}'));
    expect(src.value).toEqual({ a: 99 });
  });

  it("writes a non-JSON edit back as a raw string (parse-error fallback)", () => {
    const src = fakeOpstream({ a: 1 });
    const out = applyLens(plugin, src);
    out.apply(snapshot("typing..."));
    expect(src.value).toBe("typing...");
  });

  it("is read-only over a source with no apply", () => {
    const readonly = {
      value: { a: 1 },
      complement: {},
      connect(cb) { cb({ type: "snapshot", value: this.value }); return () => {}; },
    };
    const out = applyLens(plugin, readonly);
    expect(out.apply).toBeUndefined();
  });
});
