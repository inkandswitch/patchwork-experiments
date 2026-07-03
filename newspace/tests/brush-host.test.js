import { describe, it, expect, vi } from "vitest";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { resolveBrushHandlers, brushIsImperative, brushParamDefs, brushParamDefault, listRegistryBrushes } from "../src/brush-host.js";
import { paramsSchema } from "../src/ops.js";
import { PenBrush, penHandlers } from "../src/pen-brush.js";

describe("listRegistryBrushes — the sketchy:brush registry", () => {
  it("finds a brush registered solely as sketchy:brush, without warning", () => {
    registerPlugins([{ type: "sketchy:brush", id: "onlysketchy", name: "Only Sketchy" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ids = listRegistryBrushes().map((b) => b.id);
      expect(ids).toContain("onlysketchy");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
  it("still loads a legacy newspace:brush registrant, once, with a deprecation warning", () => {
    registerPlugins([
      { type: "newspace:brush", id: "legacyonly", name: "Legacy Only" },
      // the same id under both names — the canonical entry wins, no dupe
      { type: "sketchy:brush", id: "bothnames", name: "Both (canonical)" },
      { type: "newspace:brush", id: "bothnames", name: "Both (legacy)" },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const all = listRegistryBrushes();
      const ids = all.map((b) => b.id);
      expect(ids).toContain("legacyonly");
      expect(ids.filter((id) => id === "bothnames")).toEqual(["bothnames"]);
      expect(all.find((b) => b.id === "bothnames").name).toBe("Both (canonical)");
      expect(warn).toHaveBeenCalledTimes(1);
      // the log wrapper prepends the "[sketchy]" tag — assert on the whole call
      const call = warn.mock.calls[0].join(" ");
      expect(call).toContain("[sketchy]");
      expect(call).toContain("deprecated");
      expect(call).toContain("legacyonly");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("paramsSchema — validation + introspection", () => {
  const s = paramsSchema([
    { key: "color", label: "Colour", type: "color", default: "#000" },
    { key: "size", label: "Size", type: "size", default: 4 },
    { key: "blend", label: "Blend", type: "select", options: [{ value: "normal" }, { value: "multiply" }], default: "normal" },
  ]);
  it("exposes the fields and defaults for the panel", () => {
    expect(s.fields.map((f) => f.key)).toEqual(["color", "size", "blend"]);
    expect(s.defaults).toEqual({ color: "#000", size: 4, blend: "normal" });
  });
  it("validates a good config and rejects type/enum violations", () => {
    expect(s["~standard"].validate({ color: "#fff", size: 8, blend: "multiply" }).issues).toBeUndefined();
    expect(s["~standard"].validate({ size: "big" }).issues).toBeTruthy();   // wrong type
    expect(s["~standard"].validate({ blend: "screen" }).issues).toBeTruthy(); // not an option
    expect(s["~standard"].validate({ extra: 1 }).issues).toBeUndefined();    // unknown key allowed
  });
});

describe("resolveBrushHandlers", () => {
  const host = { param: () => 1 };
  it("uses the new use(host) contract", () => {
    const mod = { id: "x", use: (h) => ({ down: () => h.param() }) };
    const handlers = resolveBrushHandlers(mod, host);
    expect(typeof handlers.down).toBe("function");
    expect(brushIsImperative(mod)).toBe(true);
  });
  it("adapts a legacy behavior brush", () => {
    const beh = { down() {}, move() {} };
    const mod = { id: "y", behavior: beh };
    expect(resolveBrushHandlers(mod, host)).toBe(beh);
    expect(brushIsImperative(mod)).toBe(true);
  });
  it("returns null for a passive stroke brush (host strokes for it)", () => {
    const mod = { id: "z", stroke: { size: 10 } };
    expect(resolveBrushHandlers(mod, host)).toBe(null);
    expect(brushIsImperative(mod)).toBe(false);
  });
});

describe("brush param defs + defaults", () => {
  it("prefers a real schema's fields, falls back to a params array", () => {
    expect(brushParamDefs(PenBrush).map((f) => f.key)).toEqual(["color", "size", "thinning"]);
    expect(brushParamDefs({ params: [{ key: "size" }] })).toEqual([{ key: "size" }]);
    expect(brushParamDefs({})).toEqual([]);
  });
  it("resolves a declared default: schema default → stroke[key] → undefined", () => {
    expect(brushParamDefault(PenBrush, "size")).toBe(4);          // from schema.defaults
    expect(brushParamDefault({ stroke: { size: 9 } }, "size")).toBe(9); // from stroke
    expect(brushParamDefault({}, "size")).toBeUndefined();
  });
});

describe("PenBrush use() handlers — draw a stroke", () => {
  // a fake per-phase ctx whose preview/commit we observe
  function fakeCtx() {
    const out = { previews: [], committed: null, state: {} };
    return {
      out,
      p: { x: 0, y: 0 }, pressure: 0.5, state: out.state,
      param: (k) => ({ color: "#111", size: 6, thinning: 0.5 }[k]),
      preview: (d) => out.previews.push(d),
      commit: (item) => (out.committed = item),
      move(x, y) { this.p = { x, y }; },
    };
  }
  it("down→move→up previews live then commits a multi-point stroke", () => {
    const ctx = fakeCtx();
    penHandlers.down(ctx);
    expect(ctx.out.previews.at(-1).kind).toBe("stroke");
    expect(ctx.out.previews.at(-1).points.length).toBe(1);
    ctx.move(10, 5); penHandlers.move(ctx);
    ctx.move(20, 9); penHandlers.move(ctx);
    expect(ctx.out.previews.at(-1).points.length).toBe(3);
    penHandlers.up(ctx);
    expect(ctx.out.committed.kind).toBe("stroke");
    expect(ctx.out.committed.points.length).toBe(3);
    expect(ctx.out.committed.color).toBe("#111");
    expect(ctx.out.committed.size).toBe(6);
    expect(ctx.out.previews.at(-1)).toBe(null); // overlay cleared
  });
  it("a single-point tap commits nothing", () => {
    const ctx = fakeCtx();
    penHandlers.down(ctx);
    penHandlers.up(ctx);
    expect(ctx.out.committed).toBe(null);
  });
});
